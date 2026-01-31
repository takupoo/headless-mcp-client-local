/**
 * Configuration loader for BigQuery/GA4 analyzer
 */

import { config as dotenvConfig } from 'dotenv';
import * as fs from 'fs';
import * as yaml from 'yaml';
import { logger } from '../utils/logger.js';

// Load environment variables
dotenvConfig();

export interface ModelConfig {
  default: string;
  router: {
    enabled: boolean;
    tiers: {
      simple: { complexityRange: [number, number]; model: string; fallback: string };
      moderate: { complexityRange: [number, number]; model: string; fallback: string };
      complex: { complexityRange: [number, number]; model: string; fallback: string };
      expert: { complexityRange: [number, number]; model: string; fallback: string | null };
    };
  };
}

export interface MCPServerConfig {
  type: 'stdio' | 'in-sdk';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
  retries?: number;
  module?: string;
}

export interface AgentConfig {
  name: string;
  description: string;
  model: string;
  systemPrompt?: string;
  tools: string[];
  maxConcurrency: number;
}

export interface SecurityConfig {
  masking: {
    enabled: boolean;
    configPath: string;
    categories: Record<string, { alwaysMask: boolean; allowUnmask: boolean }>;
  };
  queryRestrictions: {
    allowedDatasets: string[];
    maxBytesProcessed: number;
    maxRowsReturned: number;
    forbiddenOperations: string[];
  };
  auditLog: {
    enabled: boolean;
    logLevel: string;
    destination: string;
    filePath: string;
  };
}

export interface CostManagementConfig {
  enabled: boolean;
  budget: {
    monthly: {
      llmApi: number;
      bigquery: number;
      total: number;
    };
  };
  alerts: {
    warning: number;
    critical: number;
    channels: string[];
  };
}

export interface AppConfig {
  name: string;
  version: string;
  models: ModelConfig;
  mcpServers: Record<string, MCPServerConfig>;
  agents: Record<string, AgentConfig>;
  security: SecurityConfig;
  costManagement: CostManagementConfig;
  concurrency: {
    maxSessions: number;
    maxAgentsPerSession: number;
    queueSize: number;
  };
  timeouts: {
    sessionTotal: number;
    agentTask: number;
    mcpCall: number;
  };
}

export interface EnvConfig {
  gcpProjectId: string;
  gcpSaKeySecret?: string;
  bigqueryDataset: string;
  bigqueryLocation: string;
  ga4PropertyId: string;
  anthropicApiKey: string;
  geminiApiKey?: string;
  nodeEnv: string;
  logLevel: string;
}

class ConfigLoader {
  private static instance: ConfigLoader;
  private appConfig: AppConfig | null = null;
  private envConfig: EnvConfig | null = null;

  private constructor() {}

  static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  loadEnv(): EnvConfig {
    if (this.envConfig) return this.envConfig;

    this.envConfig = {
      gcpProjectId: process.env.GCP_PROJECT_ID ?? '',
      gcpSaKeySecret: process.env.GCP_SA_KEY_SECRET,
      bigqueryDataset: process.env.BIGQUERY_DATASET ?? '',
      bigqueryLocation: process.env.BIGQUERY_LOCATION ?? 'asia-northeast1',
      ga4PropertyId: process.env.GA4_PROPERTY_ID ?? '',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
      geminiApiKey: process.env.GEMINI_API_KEY,
      nodeEnv: process.env.NODE_ENV ?? 'development',
      logLevel: process.env.LOG_LEVEL ?? 'info',
    };

    this.validateEnvConfig();

    return this.envConfig;
  }

  private validateEnvConfig(): void {
    const required = ['anthropicApiKey'];
    const missing = required.filter(
      (key) => !this.envConfig?.[key as keyof EnvConfig]
    );

    if (missing.length > 0) {
      logger.warn('Missing required environment variables', { missing });
    }
  }

  loadAppConfig(configPath?: string): AppConfig {
    if (this.appConfig) return this.appConfig;

    // Default configuration
    this.appConfig = this.getDefaultConfig();

    // Try to load from file if path provided
    if (configPath && fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        if (configPath.endsWith('.yaml') || configPath.endsWith('.yml')) {
          const fileConfig = yaml.parse(content);
          this.appConfig = this.mergeConfig(this.appConfig, fileConfig);
        } else if (configPath.endsWith('.json')) {
          const fileConfig = JSON.parse(content);
          this.appConfig = this.mergeConfig(this.appConfig, fileConfig);
        }
        logger.info('App config loaded from file', { configPath });
      } catch (error) {
        logger.warn('Failed to load config file, using defaults', { error: String(error) });
      }
    }

    return this.appConfig;
  }

  private getDefaultConfig(): AppConfig {
    return {
      name: 'bigquery-ga4-analyzer',
      version: '1.0.0',
      models: {
        default: 'claude-sonnet-4-20250514',
        router: {
          enabled: true,
          tiers: {
            simple: {
              complexityRange: [0, 0.3],
              model: 'claude-3-5-haiku-20241022',
              fallback: 'claude-3-5-haiku-20241022',
            },
            moderate: {
              complexityRange: [0.3, 0.6],
              model: 'claude-3-5-haiku-20241022',
              fallback: 'claude-sonnet-4-20250514',
            },
            complex: {
              complexityRange: [0.6, 0.8],
              model: 'claude-sonnet-4-20250514',
              fallback: 'claude-opus-4-5-20251101',
            },
            expert: {
              complexityRange: [0.8, 1.0],
              model: 'claude-opus-4-5-20251101',
              fallback: null,
            },
          },
        },
      },
      mcpServers: {
        bigquery: {
          type: 'stdio',
          command: 'npx',
          args: ['@google-cloud/bigquery-mcp'],
          timeout: 120000,
          retries: 3,
        },
        ga4: {
          type: 'stdio',
          command: 'npx',
          args: ['@google-analytics/ga4-mcp'],
          timeout: 60000,
          retries: 3,
        },
      },
      agents: {
        coordinator: {
          name: 'coordinator',
          description: 'Coordinates analysis tasks',
          model: 'claude-sonnet-4-20250514',
          tools: ['dispatch_agent', 'aggregate_results'],
          maxConcurrency: 5,
        },
        'query-generator': {
          name: 'query-generator',
          description: 'Generates BigQuery/GA4 queries',
          model: 'claude-sonnet-4-20250514',
          tools: ['bigquery_describe_table', 'ga4_list_dimensions', 'ga4_list_metrics'],
          maxConcurrency: 3,
        },
        'data-fetcher': {
          name: 'data-fetcher',
          description: 'Fetches data via MCP',
          model: 'claude-3-5-haiku-20241022',
          tools: ['bigquery_execute_sql', 'ga4_run_report', 'mask_json'],
          maxConcurrency: 5,
        },
        analyst: {
          name: 'analyst',
          description: 'Analyzes data and detects trends',
          model: 'claude-sonnet-4-20250514',
          tools: ['statistical_analysis', 'trend_detection'],
          maxConcurrency: 3,
        },
        'insight-extractor': {
          name: 'insight-extractor',
          description: 'Extracts insights and recommendations',
          model: 'claude-opus-4-5-20251101',
          tools: ['insight_synthesis', 'recommendation_engine'],
          maxConcurrency: 2,
        },
        'report-generator': {
          name: 'report-generator',
          description: 'Generates reports',
          model: 'claude-3-5-haiku-20241022',
          tools: ['markdown_generator', 'unmask_text'],
          maxConcurrency: 5,
        },
      },
      security: {
        masking: {
          enabled: true,
          configPath: './config/masking-rules.yaml',
          categories: {
            financial: { alwaysMask: true, allowUnmask: true },
            pii: { alwaysMask: true, allowUnmask: false },
            identifier: { alwaysMask: false, allowUnmask: true },
            business: { alwaysMask: true, allowUnmask: true },
          },
        },
        queryRestrictions: {
          allowedDatasets: ['analytics', 'ads_reporting', 'conversions'],
          maxBytesProcessed: 10 * 1024 * 1024 * 1024, // 10GB
          maxRowsReturned: 100000,
          forbiddenOperations: ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE'],
        },
        auditLog: {
          enabled: true,
          logLevel: 'info',
          destination: 'file',
          filePath: './logs/audit.log',
        },
      },
      costManagement: {
        enabled: true,
        budget: {
          monthly: {
            llmApi: 500,
            bigquery: 100,
            total: 650,
          },
        },
        alerts: {
          warning: 0.7,
          critical: 0.9,
          channels: ['console'],
        },
      },
      concurrency: {
        maxSessions: 10,
        maxAgentsPerSession: 5,
        queueSize: 100,
      },
      timeouts: {
        sessionTotal: 600000,
        agentTask: 180000,
        mcpCall: 120000,
      },
    };
  }

  private mergeConfig(base: AppConfig, override: Partial<AppConfig>): AppConfig {
    return {
      ...base,
      ...override,
      models: { ...base.models, ...override.models },
      mcpServers: { ...base.mcpServers, ...override.mcpServers },
      agents: { ...base.agents, ...override.agents },
      security: { ...base.security, ...override.security },
      costManagement: { ...base.costManagement, ...override.costManagement },
      concurrency: { ...base.concurrency, ...override.concurrency },
      timeouts: { ...base.timeouts, ...override.timeouts },
    } as AppConfig;
  }
}

export const configLoader = ConfigLoader.getInstance();
export const getEnvConfig = () => configLoader.loadEnv();
export const getAppConfig = (path?: string) => configLoader.loadAppConfig(path);
