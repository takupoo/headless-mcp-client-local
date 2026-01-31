/**
 * Report Generator Agent
 *
 * Generates formatted reports from analysis results
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent, AgentConfig, AgentResult } from './baseAgent.js';
import { DataMasker } from '../utils/masking.js';
import { logger } from '../utils/logger.js';

const REPORT_GENERATOR_SYSTEM_PROMPT = `You are a report generator that creates clear, professional analysis reports. Your role is to:

1. Structure analysis results into readable reports
2. Create executive summaries
3. Visualize key metrics
4. Format data for presentation
5. Highlight actionable insights

Report format guidelines:
- Start with an executive summary
- Use clear headings and sections
- Include key metrics and data points
- Use bullet points for readability
- End with recommendations

Output format: Markdown`;

export interface ReportData {
  title: string;
  analysisResults: string;
  data?: Record<string, unknown>[];
  insights?: string[];
  recommendations?: string[];
}

export interface ReportOptions {
  format: 'markdown' | 'json' | 'text';
  includeData?: boolean;
  includeCharts?: boolean;
  language?: string;
}

export class ReportGeneratorAgent extends BaseAgent {
  private masker: DataMasker;
  private sessionId: string;

  constructor(
    client: Anthropic,
    model: string,
    masker: DataMasker,
    sessionId: string
  ) {
    const config: AgentConfig = {
      name: 'report-generator',
      description: 'Generates formatted analysis reports',
      model,
      systemPrompt: REPORT_GENERATOR_SYSTEM_PROMPT,
      maxTokens: 4096,
    };

    super(client, config);
    this.masker = masker;
    this.sessionId = sessionId;
  }

  /**
   * Generate a full analysis report
   */
  async generateReport(reportData: ReportData, options: ReportOptions = { format: 'markdown' }): Promise<AgentResult> {
    logger.info('Generating report', { title: reportData.title, format: options.format });

    const message = `
Please generate a ${options.format} report with the following information:

Title: ${reportData.title}

Analysis Results:
${reportData.analysisResults}

${reportData.data ? `Data Summary:\n${JSON.stringify(reportData.data.slice(0, 10), null, 2)}` : ''}

${reportData.insights ? `Key Insights:\n${reportData.insights.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}` : ''}

${reportData.recommendations ? `Recommendations:\n${reportData.recommendations.map((r, idx) => `${idx + 1}. ${r}`).join('\n')}` : ''}

Please create a professional report that includes:
1. Executive Summary
2. Key Findings
3. Detailed Analysis
4. Recommendations
5. Next Steps
`;

    const result = await this.run(message);

    // Unmask the report if needed
    if (result.success && result.response) {
      const { unmasked } = this.masker.unmask(this.sessionId, result.response);
      result.response = unmasked;
    }

    return result;
  }

  /**
   * Generate an executive summary
   */
  async generateSummary(analysisResults: string): Promise<AgentResult> {
    logger.info('Generating executive summary');

    const message = `
Please create a concise executive summary (3-5 bullet points) from these analysis results:

${analysisResults}

Format: Bullet points, each starting with a key insight or metric.
`;

    const result = await this.run(message);

    if (result.success && result.response) {
      const { unmasked } = this.masker.unmask(this.sessionId, result.response);
      result.response = unmasked;
    }

    return result;
  }

  /**
   * Generate a comparison report
   */
  async generateComparisonReport(
    currentPeriod: string,
    previousPeriod: string,
    comparisonResults: string
  ): Promise<AgentResult> {
    logger.info('Generating comparison report');

    const message = `
Please create a period comparison report:

Current Period: ${currentPeriod}
Previous Period: ${previousPeriod}

Comparison Results:
${comparisonResults}

Include:
1. Performance comparison table
2. Key changes (positive and negative)
3. Trend analysis
4. Recommendations for improvement
`;

    const result = await this.run(message);

    if (result.success && result.response) {
      const { unmasked } = this.masker.unmask(this.sessionId, result.response);
      result.response = unmasked;
    }

    return result;
  }

  /**
   * Format data as a table
   */
  formatAsTable(data: Record<string, unknown>[], maxRows = 20): string {
    if (data.length === 0) return 'No data available';

    const headers = Object.keys(data[0]);
    const rows = data.slice(0, maxRows);

    // Calculate column widths
    const widths = headers.map((h) =>
      Math.max(
        h.length,
        ...rows.map((r) => String(r[h] ?? '').length)
      )
    );

    // Build table
    const headerRow = headers.map((h, i) => h.padEnd(widths[i])).join(' | ');
    const separator = widths.map((w) => '-'.repeat(w)).join('-|-');
    const dataRows = rows.map((row) =>
      headers.map((h, i) => String(row[h] ?? '').padEnd(widths[i])).join(' | ')
    );

    return [headerRow, separator, ...dataRows].join('\n');
  }

  /**
   * Format number for display
   */
  formatNumber(value: number, type: 'number' | 'currency' | 'percent' = 'number'): string {
    switch (type) {
      case 'currency':
        return `¥${value.toLocaleString()}`;
      case 'percent':
        return `${(value * 100).toFixed(1)}%`;
      default:
        return value.toLocaleString();
    }
  }

  /**
   * Generate metric cards text
   */
  generateMetricCards(metrics: { label: string; value: number; change?: number; type?: 'number' | 'currency' | 'percent' }[]): string {
    return metrics.map((m) => {
      const formattedValue = this.formatNumber(m.value, m.type);
      const changeStr = m.change !== undefined
        ? ` (${m.change >= 0 ? '+' : ''}${(m.change * 100).toFixed(1)}%)`
        : '';
      return `**${m.label}**: ${formattedValue}${changeStr}`;
    }).join('\n');
  }
}

/**
 * Create a report generator agent
 */
export function createReportGenerator(
  client: Anthropic,
  model: string,
  masker: DataMasker,
  sessionId: string
): ReportGeneratorAgent {
  return new ReportGeneratorAgent(client, model, masker, sessionId);
}
