/**
 * GA4 Tools for Agents
 *
 * Provides tool definitions for Google Analytics 4 operations
 */

import { z } from 'zod';
import { GA4MCPClient } from '../../mcp/ga4Client.js';
import { ga4Report, reportTemplates } from '../../mcp/ga4ReportBuilder.js';
import { DataMasker } from '../../utils/masking.js';
import { logger } from '../../utils/logger.js';
import { ToolDefinition } from './bigqueryTools.js';

/**
 * Create GA4 tools for use with agents
 */
export function createGA4Tools(
  mcpClient: GA4MCPClient,
  masker: DataMasker,
  defaultPropertyId: string,
  sessionId: string
): ToolDefinition[] {
  return [
    // Run report tool
    {
      name: 'ga4_run_report',
      description:
        'Run a GA4 report to get analytics data. Specify dimensions, metrics, and date range.',
      inputSchema: z.object({
        property_id: z
          .string()
          .optional()
          .describe('GA4 property ID (uses default if not specified)'),
        start_date: z
          .string()
          .describe('Start date (YYYY-MM-DD, today, yesterday, or NdaysAgo)'),
        end_date: z.string().describe('End date'),
        dimensions: z.array(z.string()).optional().describe('Dimension names'),
        metrics: z.array(z.string()).describe('Metric names (required)'),
        dimension_filter: z
          .object({
            field: z.string(),
            match_type: z.enum(['EXACT', 'CONTAINS', 'BEGINS_WITH', 'ENDS_WITH']),
            value: z.string(),
          })
          .optional()
          .describe('Filter dimensions'),
        order_by: z
          .object({
            field: z.string(),
            desc: z.boolean().default(true),
          })
          .optional()
          .describe('Sort order'),
        limit: z.number().optional().default(1000).describe('Maximum rows to return'),
        mask_sensitive: z
          .boolean()
          .optional()
          .default(true)
          .describe('Whether to mask sensitive data'),
      }),
      execute: async ({
        property_id,
        start_date,
        end_date,
        dimensions,
        metrics,
        dimension_filter,
        order_by,
        limit = 1000,
        mask_sensitive = true,
      }: {
        property_id?: string;
        start_date: string;
        end_date: string;
        dimensions?: string[];
        metrics: string[];
        dimension_filter?: { field: string; match_type: string; value: string };
        order_by?: { field: string; desc: boolean };
        limit?: number;
        mask_sensitive?: boolean;
      }) => {
        logger.info('Running GA4 report', { start_date, end_date, metrics });

        const propertyId = property_id ?? defaultPropertyId;

        try {
          // Build request
          const builder = ga4Report(propertyId)
            .dateRange(start_date, end_date)
            .metrics(...metrics)
            .limit(limit);

          if (dimensions) {
            builder.dimensions(...dimensions);
          }

          if (dimension_filter) {
            builder.filterDimension(
              dimension_filter.field,
              dimension_filter.match_type as
                | 'EXACT'
                | 'CONTAINS'
                | 'BEGINS_WITH'
                | 'ENDS_WITH'
                | 'REGEXP',
              dimension_filter.value
            );
          }

          if (order_by) {
            builder.orderByMetric(order_by.field, order_by.desc);
          }

          // Execute report
          const result = await mcpClient.runReport(builder.build());

          // Format rows
          const formattedRows = result.rows.map((row) => {
            const obj: Record<string, string | number> = {};

            // Dimensions
            (dimensions ?? []).forEach((dim, i) => {
              obj[dim] = row.dimensionValues[i]?.value ?? '';
            });

            // Metrics
            metrics.forEach((metric, i) => {
              const value = row.metricValues[i]?.value ?? '0';
              const numValue = parseFloat(value);
              obj[metric] = isNaN(numValue) ? value : numValue;
            });

            return obj;
          });

          // Apply masking
          const rows = mask_sensitive
            ? formattedRows.map((row) => masker.maskObject(row, sessionId))
            : formattedRows;

          return {
            success: true,
            rows,
            rowCount: result.rowCount,
            metadata: result.metadata,
          };
        } catch (error) {
          return {
            success: false,
            error: String(error),
          };
        }
      },
    },

    // Get realtime data
    {
      name: 'ga4_realtime',
      description: 'Get realtime GA4 data showing current active users and activity.',
      inputSchema: z.object({
        property_id: z.string().optional().describe('GA4 property ID'),
        dimensions: z.array(z.string()).optional().describe('Realtime dimensions'),
        metrics: z.array(z.string()).describe('Realtime metrics'),
        limit: z.number().optional().default(100).describe('Maximum rows'),
      }),
      execute: async ({
        property_id,
        dimensions,
        metrics,
        limit = 100,
      }: {
        property_id?: string;
        dimensions?: string[];
        metrics: string[];
        limit?: number;
      }) => {
        const propertyId = property_id ?? defaultPropertyId;

        try {
          const result = await mcpClient.getRealtime(propertyId, {
            dimensions,
            metrics,
            limit,
          });

          // Format rows
          const formattedRows = result.rows.map((row) => {
            const obj: Record<string, string | number> = {};

            (dimensions ?? []).forEach((dim, i) => {
              obj[dim] = row.dimensionValues[i]?.value ?? '';
            });

            metrics.forEach((metric, i) => {
              const value = row.metricValues[i]?.value ?? '0';
              obj[metric] = parseFloat(value) || value;
            });

            return obj;
          });

          return {
            success: true,
            rows: formattedRows,
            rowCount: result.rowCount,
          };
        } catch (error) {
          return {
            success: false,
            error: String(error),
          };
        }
      },
    },

    // List dimensions
    {
      name: 'ga4_list_dimensions',
      description: 'List available GA4 dimensions that can be used in reports.',
      inputSchema: z.object({
        category: z.string().optional().describe('Filter by category'),
      }),
      execute: async ({ category }: { category?: string }) => {
        try {
          const dimensions = await mcpClient.listDimensions();

          const filtered = category
            ? dimensions.filter((d) => d.category === category)
            : dimensions;

          return {
            success: true,
            dimensions: filtered.map((d) => ({
              name: d.apiName,
              displayName: d.uiName,
              description: d.description,
              category: d.category,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: String(error),
          };
        }
      },
    },

    // List metrics
    {
      name: 'ga4_list_metrics',
      description: 'List available GA4 metrics that can be used in reports.',
      inputSchema: z.object({
        category: z.string().optional().describe('Filter by category'),
      }),
      execute: async ({ category }: { category?: string }) => {
        try {
          const metrics = await mcpClient.listMetrics();

          const filtered = category ? metrics.filter((m) => m.category === category) : metrics;

          return {
            success: true,
            metrics: filtered.map((m) => ({
              name: m.apiName,
              displayName: m.uiName,
              description: m.description,
              category: m.category,
              type: m.type,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: String(error),
          };
        }
      },
    },

    // Pre-built report templates
    {
      name: 'ga4_traffic_overview',
      description: 'Get a traffic overview report with sessions, users, and page views by date.',
      inputSchema: z.object({
        property_id: z.string().optional().describe('GA4 property ID'),
        days: z.number().optional().default(30).describe('Number of days'),
      }),
      execute: async ({ property_id, days = 30 }: { property_id?: string; days?: number }) => {
        const propertyId = property_id ?? defaultPropertyId;

        try {
          const request = reportTemplates.trafficOverview(propertyId, days);
          const result = await mcpClient.runReport(request);

          const rows = result.rows.map((row) => ({
            date: row.dimensionValues[0]?.value ?? '',
            sessions: parseInt(row.metricValues[0]?.value ?? '0'),
            totalUsers: parseInt(row.metricValues[1]?.value ?? '0'),
            newUsers: parseInt(row.metricValues[2]?.value ?? '0'),
            pageViews: parseInt(row.metricValues[3]?.value ?? '0'),
          }));

          return {
            success: true,
            rows,
            rowCount: result.rowCount,
          };
        } catch (error) {
          return {
            success: false,
            error: String(error),
          };
        }
      },
    },

    // Channel performance
    {
      name: 'ga4_channel_performance',
      description: 'Get performance data by marketing channel.',
      inputSchema: z.object({
        property_id: z.string().optional().describe('GA4 property ID'),
        days: z.number().optional().default(30).describe('Number of days'),
      }),
      execute: async ({ property_id, days = 30 }: { property_id?: string; days?: number }) => {
        const propertyId = property_id ?? defaultPropertyId;

        try {
          const request = reportTemplates.channelPerformance(propertyId, days);
          const result = await mcpClient.runReport(request);

          const rows = result.rows.map((row) => ({
            channel: row.dimensionValues[0]?.value ?? '',
            sessions: parseInt(row.metricValues[0]?.value ?? '0'),
            totalUsers: parseInt(row.metricValues[1]?.value ?? '0'),
            conversions: parseInt(row.metricValues[2]?.value ?? '0'),
            revenue: parseFloat(row.metricValues[3]?.value ?? '0'),
          }));

          return {
            success: true,
            rows,
            rowCount: result.rowCount,
          };
        } catch (error) {
          return {
            success: false,
            error: String(error),
          };
        }
      },
    },
  ];
}
