/**
 * BigQuery Tools for Agents
 *
 * Provides tool definitions for BigQuery operations
 */

import { z } from 'zod';
import { BigQueryMCPClient, formatBytes } from '../../mcp/bigqueryClient.js';
import { QueryValidator } from '../../mcp/queryValidator.js';
import { DataMasker } from '../../utils/masking.js';
import { logger } from '../../utils/logger.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
  execute: (params: any) => Promise<any>;
}

/**
 * Create BigQuery tools for use with agents
 */
export function createBigQueryTools(
  mcpClient: BigQueryMCPClient,
  validator: QueryValidator,
  masker: DataMasker,
  sessionId: string
): ToolDefinition[] {
  return [
    // List tables tool
    {
      name: 'bigquery_list_tables',
      description: 'List available BigQuery tables. Use this to discover what data is available.',
      inputSchema: z.object({
        dataset: z
          .string()
          .optional()
          .describe('Dataset name (optional, lists all if not specified)'),
      }),
      execute: async ({ dataset }: { dataset?: string }) => {
        logger.info('Listing BigQuery tables', { dataset });

        try {
          const tables = await mcpClient.listTables(dataset);
          return {
            success: true,
            tables: tables.map((t) => ({
              name: `${t.dataset}.${t.table}`,
              type: t.type,
              rowCount: t.rowCount,
              lastModified: t.lastModified,
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

    // Describe table tool
    {
      name: 'bigquery_describe_table',
      description: 'Get schema information for a BigQuery table.',
      inputSchema: z.object({
        table: z.string().describe('Table name in format dataset.table'),
      }),
      execute: async ({ table }: { table: string }) => {
        logger.info('Describing BigQuery table', { table });

        try {
          const schema = await mcpClient.describeTable(table);
          return {
            success: true,
            table,
            schema: schema.schema.map((col) => ({
              name: col.name,
              type: col.type,
              mode: col.mode,
              description: col.description,
            })),
            partitioning: schema.partitioning,
            clustering: schema.clustering,
          };
        } catch (error) {
          return {
            success: false,
            error: String(error),
          };
        }
      },
    },

    // Execute SQL tool
    {
      name: 'bigquery_execute_sql',
      description:
        'Execute a SQL query on BigQuery. Only SELECT queries are allowed. Always validate and estimate cost before large queries.',
      inputSchema: z.object({
        query: z.string().describe('SQL query to execute (SELECT only)'),
        max_rows: z.number().optional().default(1000).describe('Maximum rows to return'),
        mask_sensitive: z
          .boolean()
          .optional()
          .default(true)
          .describe('Whether to mask sensitive data'),
      }),
      execute: async ({
        query,
        max_rows = 1000,
        mask_sensitive = true,
      }: {
        query: string;
        max_rows?: number;
        mask_sensitive?: boolean;
      }) => {
        logger.info('Executing BigQuery SQL');

        // Validate query
        const validation = validator.validate(query);
        if (!validation.valid) {
          return {
            success: false,
            errors: validation.errors,
          };
        }

        // Log warnings
        if (validation.warnings.length > 0) {
          logger.warn('Query warnings', { warnings: validation.warnings });
        }

        try {
          const result = await mcpClient.executeSQL(query, { maxRows: max_rows });

          // Apply masking if requested
          let rows = result.rows;
          if (mask_sensitive) {
            rows = rows.map((row) => masker.maskObject(row as Record<string, unknown>, sessionId));
          }

          return {
            success: true,
            rows,
            schema: result.schema,
            totalRows: result.totalRows,
            bytesProcessed: result.bytesProcessed,
            bytesProcessedFormatted: formatBytes(result.bytesProcessed),
            cacheHit: result.cacheHit,
            warnings: validation.warnings,
          };
        } catch (error) {
          return {
            success: false,
            error: String(error),
          };
        }
      },
    },

    // Estimate cost tool
    {
      name: 'bigquery_estimate_cost',
      description: 'Estimate the cost of a query before execution. Use this for large queries.',
      inputSchema: z.object({
        query: z.string().describe('SQL query to estimate'),
      }),
      execute: async ({ query }: { query: string }) => {
        logger.info('Estimating BigQuery cost');

        // Validate query first
        const validation = validator.validate(query);
        if (!validation.valid) {
          return {
            success: false,
            errors: validation.errors,
          };
        }

        try {
          const estimate = await mcpClient.estimateCost(query);
          return {
            success: true,
            bytesProcessed: estimate.bytesProcessed,
            bytesProcessedFormatted: formatBytes(estimate.bytesProcessed),
            estimatedCostUSD: estimate.estimatedCost.toFixed(4),
            warnings: validation.warnings,
          };
        } catch (error) {
          return {
            success: false,
            error: String(error),
          };
        }
      },
    },

    // Validate query tool
    {
      name: 'bigquery_validate_query',
      description: 'Validate a SQL query for security and best practices without executing it.',
      inputSchema: z.object({
        query: z.string().describe('SQL query to validate'),
      }),
      execute: async ({ query }: { query: string }) => {
        const validation = validator.validate(query);
        return {
          valid: validation.valid,
          errors: validation.errors,
          warnings: validation.warnings,
        };
      },
    },
  ];
}

/**
 * Convert tool definitions to Anthropic tool format
 */
export function toAnthropicTools(tools: ToolDefinition[]): Array<{
  name: string;
  description: string;
  input_schema: object;
}> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: zodToJsonSchema(tool.inputSchema),
  }));
}

/**
 * Convert Zod schema to JSON Schema (simplified)
 */
function zodToJsonSchema(schema: z.ZodObject<any>): object {
  const shape = schema.shape;
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const zodValue = value as z.ZodTypeAny;
    const isOptional = zodValue.isOptional();

    if (!isOptional) {
      required.push(key);
    }

    // Get the inner type if optional
    const innerType = isOptional
      ? (zodValue as z.ZodOptional<any>)._def.innerType
      : zodValue;

    properties[key] = getJsonSchemaType(innerType);
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

function getJsonSchemaType(zodType: z.ZodTypeAny): object {
  const typeName = zodType._def.typeName;

  switch (typeName) {
    case 'ZodString':
      return {
        type: 'string',
        description: zodType._def.description,
      };
    case 'ZodNumber':
      return {
        type: 'number',
        description: zodType._def.description,
      };
    case 'ZodBoolean':
      return {
        type: 'boolean',
        description: zodType._def.description,
      };
    case 'ZodArray':
      return {
        type: 'array',
        items: getJsonSchemaType(zodType._def.type),
        description: zodType._def.description,
      };
    case 'ZodDefault':
      return {
        ...getJsonSchemaType(zodType._def.innerType),
        default: zodType._def.defaultValue(),
      };
    default:
      return { type: 'string' };
  }
}
