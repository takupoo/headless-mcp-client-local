/**
 * Analyst Agent
 *
 * Performs data analysis, pattern detection, and statistical analysis
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent, AgentConfig, AgentResult } from './baseAgent.js';
import { ToolDefinition } from './tools/bigqueryTools.js';
import { logger } from '../utils/logger.js';

const ANALYST_SYSTEM_PROMPT = `You are a data analyst specializing in digital marketing and web analytics. Your role is to:

1. Analyze data from BigQuery and GA4
2. Identify trends, patterns, and anomalies
3. Calculate key metrics and KPIs
4. Provide statistical insights
5. Make data-driven recommendations

When analyzing data:
- Look for trends over time
- Compare metrics across segments
- Identify outliers and anomalies
- Calculate growth rates and changes
- Consider seasonality and external factors

Always provide:
1. Summary of key findings
2. Supporting data and metrics
3. Statistical significance when applicable
4. Actionable recommendations

Be precise with numbers and cite specific data points.`;

export interface AnalysisData {
  rows: Record<string, unknown>[];
  schema?: { name: string; type: string }[];
  metadata?: Record<string, unknown>;
}

export interface AnalysisInsight {
  type: 'trend' | 'anomaly' | 'pattern' | 'comparison' | 'recommendation';
  title: string;
  description: string;
  metrics?: Record<string, number>;
  confidence?: number;
}

export class AnalystAgent extends BaseAgent {
  constructor(client: Anthropic, model: string, tools: ToolDefinition[] = []) {
    const config: AgentConfig = {
      name: 'analyst',
      description: 'Data analysis and insight extraction',
      model,
      systemPrompt: ANALYST_SYSTEM_PROMPT,
      maxTokens: 4096,
    };

    super(client, config, tools);
  }

  /**
   * Analyze provided data
   */
  async analyzeData(data: AnalysisData, context: string): Promise<AgentResult> {
    logger.info('Analyzing data', { rowCount: data.rows.length });

    // Prepare analysis message
    const dataPreview = data.rows.slice(0, 20);
    const message = `
Context: ${context}

Data to analyze (${data.rows.length} rows total, showing first 20):
${JSON.stringify(dataPreview, null, 2)}

Schema: ${data.schema ? JSON.stringify(data.schema) : 'Not provided'}

Please analyze this data and provide:
1. Key metrics and their values
2. Trends or patterns observed
3. Any anomalies or outliers
4. Insights and recommendations
`;

    return this.run(message);
  }

  /**
   * Compare two datasets
   */
  async compareData(
    current: AnalysisData,
    previous: AnalysisData,
    context: string
  ): Promise<AgentResult> {
    logger.info('Comparing datasets');

    const message = `
Context: ${context}

Current Period Data (${current.rows.length} rows):
${JSON.stringify(current.rows.slice(0, 15), null, 2)}

Previous Period Data (${previous.rows.length} rows):
${JSON.stringify(previous.rows.slice(0, 15), null, 2)}

Please compare these two periods and provide:
1. Key metric changes (absolute and percentage)
2. Performance improvements or declines
3. Notable differences in patterns
4. Recommendations based on the comparison
`;

    return this.run(message);
  }

  /**
   * Detect anomalies in data
   */
  async detectAnomalies(data: AnalysisData, metricName: string): Promise<AgentResult> {
    logger.info('Detecting anomalies', { metric: metricName });

    const message = `
Please analyze this data for anomalies in the metric "${metricName}":

Data (${data.rows.length} rows):
${JSON.stringify(data.rows.slice(0, 30), null, 2)}

Identify:
1. Any outliers or unusual values
2. Sudden spikes or drops
3. Unexpected patterns
4. Possible explanations for anomalies
`;

    return this.run(message);
  }

  /**
   * Calculate and analyze trends
   */
  async analyzeTrends(data: AnalysisData, metrics: string[]): Promise<AgentResult> {
    logger.info('Analyzing trends', { metrics });

    const message = `
Please analyze trends in these metrics: ${metrics.join(', ')}

Data (${data.rows.length} rows, ordered by date):
${JSON.stringify(data.rows, null, 2)}

Provide:
1. Overall trend direction for each metric
2. Growth/decline rates
3. Seasonality patterns if visible
4. Trend projections and recommendations
`;

    return this.run(message);
  }

  /**
   * Generate statistical summary
   */
  async generateStatsSummary(data: AnalysisData): Promise<AgentResult> {
    logger.info('Generating statistical summary');

    // Calculate basic stats
    const numericColumns = this.identifyNumericColumns(data);
    const stats: Record<string, { min: number; max: number; avg: number; sum: number }> = {};

    for (const col of numericColumns) {
      const values = data.rows
        .map((r) => Number(r[col]))
        .filter((v) => !isNaN(v));

      if (values.length > 0) {
        stats[col] = {
          min: Math.min(...values),
          max: Math.max(...values),
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          sum: values.reduce((a, b) => a + b, 0),
        };
      }
    }

    const message = `
Please provide a comprehensive statistical summary of this data:

Pre-calculated statistics:
${JSON.stringify(stats, null, 2)}

Raw data sample (first 20 rows):
${JSON.stringify(data.rows.slice(0, 20), null, 2)}

Provide:
1. Summary of each metric
2. Distribution characteristics
3. Notable statistics
4. Data quality observations
`;

    return this.run(message);
  }

  /**
   * Identify numeric columns in data
   */
  private identifyNumericColumns(data: AnalysisData): string[] {
    if (data.rows.length === 0) return [];

    const firstRow = data.rows[0];
    return Object.entries(firstRow)
      .filter(([_, value]) => typeof value === 'number' || !isNaN(Number(value)))
      .map(([key]) => key);
  }
}

/**
 * Create an analyst agent
 */
export function createAnalyst(
  client: Anthropic,
  model: string,
  tools: ToolDefinition[] = []
): AnalystAgent {
  return new AnalystAgent(client, model, tools);
}
