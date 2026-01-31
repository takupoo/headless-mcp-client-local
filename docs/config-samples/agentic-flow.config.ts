/**
 * agentic-flow 設定ファイル
 *
 * BigQuery/GA4分析エージェント用の設定
 */

import { AgenticFlowConfig } from 'agentic-flow';

export const config: AgenticFlowConfig = {
  // 基本設定
  name: 'bigquery-ga4-analyzer',
  version: '1.0.0',

  // モデル設定
  models: {
    // デフォルトモデル
    default: 'claude-3-5-sonnet-20241022',

    // Multi-Model Router設定
    router: {
      enabled: true,
      tiers: {
        simple: {
          complexityRange: [0, 0.3],
          model: 'gemini-1.5-flash',
          fallback: 'claude-3-5-haiku-20241022',
        },
        moderate: {
          complexityRange: [0.3, 0.6],
          model: 'claude-3-5-haiku-20241022',
          fallback: 'claude-3-5-sonnet-20241022',
        },
        complex: {
          complexityRange: [0.6, 0.8],
          model: 'claude-3-5-sonnet-20241022',
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

  // API認証
  apiKeys: {
    anthropic: {
      source: 'env',
      key: 'ANTHROPIC_API_KEY',
    },
    gemini: {
      source: 'env',
      key: 'GEMINI_API_KEY',
    },
  },

  // MCPサーバー設定
  mcpServers: {
    // BigQuery MCP
    bigquery: {
      type: 'stdio',
      command: 'npx',
      args: ['@google/mcp-toolbox', '--config', './config/bigquery-mcp.yaml'],
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: '${GCP_SA_KEY_PATH}',
      },
      timeout: 120000,
      retries: 3,
    },

    // GA4 MCP
    ga4: {
      type: 'stdio',
      command: 'npx',
      args: ['@google/ga4-mcp-server', '--config', './config/ga4-mcp.yaml'],
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: '${GCP_SA_KEY_PATH}',
      },
      timeout: 60000,
      retries: 3,
    },

    // データマスキング MCP (In-SDK)
    'data-masking': {
      type: 'in-sdk',
      module: './src/mcp/dataMaskingServer.ts',
    },
  },

  // エージェント設定
  agents: {
    // コーディネーターエージェント
    coordinator: {
      name: 'coordinator',
      description: '分析タスクの調整と管理',
      model: 'claude-3-5-sonnet-20241022',
      systemPrompt: './prompts/coordinator.md',
      tools: ['dispatch_agent', 'aggregate_results'],
      maxConcurrency: 5,
    },

    // クエリ生成エージェント
    'query-generator': {
      name: 'query-generator',
      description: 'BigQuery/GA4クエリの生成',
      model: 'claude-3-5-sonnet-20241022',
      systemPrompt: './prompts/query-generator.md',
      tools: ['bigquery_describe_table', 'ga4_list_dimensions', 'ga4_list_metrics'],
      maxConcurrency: 3,
    },

    // データ取得エージェント
    'data-fetcher': {
      name: 'data-fetcher',
      description: 'MCP経由でのデータ取得',
      model: 'claude-3-5-haiku-20241022',
      tools: ['bigquery_execute_sql', 'ga4_run_report', 'mask_json'],
      maxConcurrency: 5,
    },

    // 分析エージェント
    analyst: {
      name: 'analyst',
      description: 'データの統計分析とトレンド検出',
      model: 'claude-3-5-sonnet-20241022',
      systemPrompt: './prompts/analyst.md',
      tools: ['statistical_analysis', 'trend_detection'],
      maxConcurrency: 3,
    },

    // 洞察抽出エージェント
    'insight-extractor': {
      name: 'insight-extractor',
      description: '高度な洞察と戦略的提案の生成',
      model: 'claude-opus-4-5-20251101',
      systemPrompt: './prompts/insight-extractor.md',
      tools: ['insight_synthesis', 'recommendation_engine'],
      maxConcurrency: 2,
    },

    // レポート生成エージェント
    'report-generator': {
      name: 'report-generator',
      description: 'レポートの生成とフォーマット',
      model: 'claude-3-5-haiku-20241022',
      tools: ['markdown_generator', 'unmask_text'],
      maxConcurrency: 5,
    },
  },

  // SONA（自己学習）設定
  sona: {
    enabled: true,
    profile: 'balanced', // 'real-time' | 'batch' | 'research' | 'balanced'

    learning: {
      patterns: ['query_optimization', 'analysis_methodology', 'insight_generation'],
      autoTrain: true,
    },

    reasoningBank: {
      enabled: true,
      retention: {
        shortTerm: '24h',
        longTerm: '30d',
      },
    },

    gnnQueryRefinement: {
      enabled: true,
      layers: 3,
    },
  },

  // セキュリティ設定
  security: {
    // データマスキング
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

    // クエリ制限
    queryRestrictions: {
      allowedDatasets: ['analytics', 'ads_reporting', 'conversions'],
      maxBytesProcessed: 10 * 1024 * 1024 * 1024, // 10GB
      maxRowsReturned: 100000,
      forbiddenOperations: ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE'],
    },

    // 監査ログ
    auditLog: {
      enabled: true,
      logLevel: 'info',
      destination: 'file',
      filePath: './logs/audit.log',
    },
  },

  // コスト管理
  costManagement: {
    enabled: true,

    budget: {
      monthly: {
        llmApi: 500, // USD
        bigquery: 100, // USD
        total: 650, // USD
      },
    },

    alerts: {
      warning: 0.7, // 70%
      critical: 0.9, // 90%
      channels: ['slack', 'email'],
    },

    tracking: {
      granularity: 'per_request',
      retention: '90d',
    },
  },

  // ログ設定
  logging: {
    level: process.env.LOG_LEVEL ?? 'info',
    format: 'json',
    outputs: [
      { type: 'console' },
      { type: 'file', path: './logs/app.log', maxSize: '100MB', maxFiles: 10 },
    ],
  },

  // 同時実行制限
  concurrency: {
    maxSessions: 10,
    maxAgentsPerSession: 5,
    queueSize: 100,
  },

  // タイムアウト設定
  timeouts: {
    sessionTotal: 600000, // 10分
    agentTask: 180000, // 3分
    mcpCall: 120000, // 2分
  },
};

export default config;
