/**
 * BigQuery/GA4 Autonomous Analysis Agent
 *
 * Main entry point for the analysis system
 */

import Anthropic from '@anthropic-ai/sdk';
import { getEnvConfig, getAppConfig } from './config/index.js';
import { logger } from './utils/logger.js';
import { DataMasker } from './utils/masking.js';
import { BigQueryMCPClient } from './mcp/bigqueryClient.js';
import { GA4MCPClient } from './mcp/ga4Client.js';
import { QueryValidator } from './mcp/queryValidator.js';
import { ModelRouter, createModelRouter } from './router/modelRouter.js';
import { createBigQueryTools } from './agents/tools/bigqueryTools.js';
import { createGA4Tools } from './agents/tools/ga4Tools.js';
import { CoordinatorAgent, createCoordinator } from './agents/coordinator.js';
import { AnalystAgent, createAnalyst } from './agents/analyst.js';
import { ReportGeneratorAgent, createReportGenerator } from './agents/reportGenerator.js';
import { BaseAgent } from './agents/baseAgent.js';

export interface AnalyzerConfig {
  anthropicApiKey?: string;
  gcpProjectId?: string;
  bigqueryDataset?: string;
  ga4PropertyId?: string;
}

export interface AnalysisSession {
  id: string;
  createdAt: Date;
  status: 'active' | 'completed' | 'error';
  results?: string;
}

/**
 * Main Analyzer class that orchestrates the entire system
 */
export class BigQueryGA4Analyzer {
  private client: Anthropic;
  private config: ReturnType<typeof getEnvConfig>;
  private appConfig: ReturnType<typeof getAppConfig>;
  private masker: DataMasker;
  private modelRouter: ModelRouter;
  private bigqueryClient: BigQueryMCPClient;
  private ga4Client: GA4MCPClient;
  private queryValidator: QueryValidator;
  private coordinator: CoordinatorAgent;
  private analyst: AnalystAgent;
  private reportGenerator: ReportGeneratorAgent;
  private currentSessionId: string;

  constructor(customConfig?: AnalyzerConfig) {
    // Load configuration
    this.config = getEnvConfig();
    this.appConfig = getAppConfig();

    // Override with custom config if provided
    if (customConfig?.anthropicApiKey) {
      this.config.anthropicApiKey = customConfig.anthropicApiKey;
    }
    if (customConfig?.gcpProjectId) {
      this.config.gcpProjectId = customConfig.gcpProjectId;
    }
    if (customConfig?.bigqueryDataset) {
      this.config.bigqueryDataset = customConfig.bigqueryDataset;
    }
    if (customConfig?.ga4PropertyId) {
      this.config.ga4PropertyId = customConfig.ga4PropertyId;
    }

    // Initialize Anthropic client
    this.client = new Anthropic({
      apiKey: this.config.anthropicApiKey,
    });

    // Initialize components
    this.currentSessionId = this.generateSessionId();
    this.masker = new DataMasker();
    this.modelRouter = createModelRouter(true);

    // Initialize MCP clients
    this.bigqueryClient = new BigQueryMCPClient({
      projectId: this.config.gcpProjectId,
      location: this.config.bigqueryLocation,
    });

    this.ga4Client = new GA4MCPClient({
      defaultPropertyId: this.config.ga4PropertyId,
    });

    // Initialize query validator
    this.queryValidator = new QueryValidator({
      allowedDatasets: this.appConfig.security.queryRestrictions.allowedDatasets,
      restrictedColumns: [
        { table: 'ads_reporting.campaign_performance', columns: ['cost', 'budget'] },
      ],
      forbiddenOperations: this.appConfig.security.queryRestrictions.forbiddenOperations,
    });

    // Initialize agents
    this.coordinator = createCoordinator(this.client, this.modelRouter);
    this.analyst = createAnalyst(
      this.client,
      this.modelRouter.getModel('complex')
    );
    this.reportGenerator = createReportGenerator(
      this.client,
      this.modelRouter.getModel('simple'),
      this.masker,
      this.currentSessionId
    );

    logger.info('BigQuery/GA4 Analyzer initialized', {
      sessionId: this.currentSessionId,
      projectId: this.config.gcpProjectId,
    });
  }

  /**
   * Initialize MCP connections
   */
  async initialize(): Promise<void> {
    logger.info('Initializing MCP connections...');

    try {
      await this.bigqueryClient.connect();
      await this.ga4Client.connect();

      // Create and add tools to agents
      const bigqueryTools = createBigQueryTools(
        this.bigqueryClient,
        this.queryValidator,
        this.masker,
        this.currentSessionId
      );

      const ga4Tools = createGA4Tools(
        this.ga4Client,
        this.masker,
        this.config.ga4PropertyId,
        this.currentSessionId
      );

      // Add tools to coordinator
      this.coordinator.addTools([...bigqueryTools, ...ga4Tools]);
      this.analyst.addTools([...bigqueryTools, ...ga4Tools]);

      logger.info('MCP connections initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize MCP connections', { error: String(error) });
      throw error;
    }
  }

  /**
   * Run an analysis query
   */
  async analyze(query: string): Promise<AnalysisSession> {
    const session: AnalysisSession = {
      id: this.currentSessionId,
      createdAt: new Date(),
      status: 'active',
    };

    logger.info('Starting analysis', { sessionId: session.id, query: query.substring(0, 100) });

    try {
      // Run coordinator
      const coordinatorResult = await this.coordinator.analyze({
        query,
        dataSources: ['bigquery', 'ga4'],
      });

      if (!coordinatorResult.success) {
        throw new Error(coordinatorResult.error ?? 'Coordinator failed');
      }

      // Run analyst for deeper analysis
      const analystResult = await this.analyst.run(
        `Based on this analysis plan, provide detailed insights:\n\n${coordinatorResult.response}`
      );

      if (!analystResult.success) {
        throw new Error(analystResult.error ?? 'Analyst failed');
      }

      // Generate final report
      const reportResult = await this.reportGenerator.generateReport({
        title: 'Analysis Report',
        analysisResults: `${coordinatorResult.response}\n\n${analystResult.response}`,
        insights: [],
        recommendations: [],
      });

      if (!reportResult.success) {
        throw new Error(reportResult.error ?? 'Report generation failed');
      }

      session.status = 'completed';
      session.results = reportResult.response;

      logger.info('Analysis completed successfully', { sessionId: session.id });

      return session;
    } catch (error) {
      session.status = 'error';
      session.results = String(error);
      logger.error('Analysis failed', { sessionId: session.id, error: String(error) });
      return session;
    }
  }

  /**
   * Execute a BigQuery query directly
   */
  async queryBigQuery(sql: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const validation = this.queryValidator.validate(sql);
      if (!validation.valid) {
        return { success: false, error: validation.errors.join(', ') };
      }

      const result = await this.bigqueryClient.executeSQL(sql);
      const maskedRows = result.rows.map((row) =>
        this.masker.maskObject(row as Record<string, unknown>, this.currentSessionId)
      );

      return {
        success: true,
        data: {
          rows: maskedRows,
          totalRows: result.totalRows,
          bytesProcessed: result.bytesProcessed,
          warnings: validation.warnings,
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Execute a GA4 report directly
   */
  async reportGA4(
    metrics: string[],
    dimensions?: string[],
    startDate = '30daysAgo',
    endDate = 'today'
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const { ga4Report } = await import('./mcp/ga4ReportBuilder.js');
      const builder = ga4Report(this.config.ga4PropertyId)
        .dateRange(startDate, endDate)
        .metrics(...metrics);

      if (dimensions) {
        builder.dimensions(...dimensions);
      }

      const result = await this.ga4Client.runReport(builder.limit(1000).build());

      return {
        success: true,
        data: {
          rows: result.rows,
          rowCount: result.rowCount,
          metadata: result.metadata,
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.currentSessionId;
  }

  /**
   * Create a new session
   */
  newSession(): string {
    this.masker.clearSession(this.currentSessionId);
    this.currentSessionId = this.generateSessionId();
    this.coordinator.reset();
    this.analyst.reset();
    this.reportGenerator = createReportGenerator(
      this.client,
      this.modelRouter.getModel('simple'),
      this.masker,
      this.currentSessionId
    );
    return this.currentSessionId;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up resources...');
    this.masker.clearSession(this.currentSessionId);
    await this.bigqueryClient.disconnect();
    await this.ga4Client.disconnect();
    logger.info('Cleanup completed');
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}

// Export all modules for library use
export { logger } from './utils/logger.js';
export { DataMasker } from './utils/masking.js';
export { BigQueryMCPClient } from './mcp/bigqueryClient.js';
export { GA4MCPClient } from './mcp/ga4Client.js';
export { ga4Report, reportTemplates } from './mcp/ga4ReportBuilder.js';
export { QueryValidator } from './mcp/queryValidator.js';
export { ModelRouter, createModelRouter } from './router/modelRouter.js';
export { BaseAgent } from './agents/baseAgent.js';
export { CoordinatorAgent, createCoordinator } from './agents/coordinator.js';
export { AnalystAgent, createAnalyst } from './agents/analyst.js';
export { ReportGeneratorAgent, createReportGenerator } from './agents/reportGenerator.js';
export { createBigQueryTools } from './agents/tools/bigqueryTools.js';
export { createGA4Tools } from './agents/tools/ga4Tools.js';
export { getEnvConfig, getAppConfig } from './config/index.js';

/**
 * Main entry point when run directly
 */
async function main() {
  console.log('BigQuery/GA4 Autonomous Analysis Agent');
  console.log('======================================\n');

  // Create analyzer
  const analyzer = new BigQueryGA4Analyzer();

  try {
    // Initialize connections
    await analyzer.initialize();

    // Example analysis
    const query = process.argv[2] || 'Show me the traffic overview for the last 30 days';
    console.log(`\nRunning analysis: "${query}"\n`);

    const session = await analyzer.analyze(query);

    if (session.status === 'completed') {
      console.log('\n=== Analysis Results ===\n');
      console.log(session.results);
    } else {
      console.error('\nAnalysis failed:', session.results);
    }

    // Cleanup
    await analyzer.cleanup();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(console.error);
}
