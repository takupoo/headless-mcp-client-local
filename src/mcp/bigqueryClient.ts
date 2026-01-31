/**
 * BigQuery MCP Client
 *
 * Provides interface to BigQuery data through MCP protocol
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, ChildProcess } from 'child_process';
import { logger } from '../utils/logger.js';

export interface BigQueryTable {
  dataset: string;
  table: string;
  type: 'TABLE' | 'VIEW';
  rowCount: number;
  lastModified: string;
}

export interface BigQuerySchema {
  name: string;
  type: string;
  mode: 'NULLABLE' | 'REQUIRED' | 'REPEATED';
  description?: string;
}

export interface BigQueryResult {
  rows: Record<string, unknown>[];
  schema: BigQuerySchema[];
  totalRows: number;
  bytesProcessed: number;
  cacheHit: boolean;
}

export interface BigQueryClientConfig {
  projectId: string;
  location?: string;
  credentials?: string;
  maxBytesProcessed?: number;
  timeout?: number;
}

export class BigQueryMCPClient {
  private client: Client | null = null;
  private process: ChildProcess | null = null;
  private connected: boolean = false;

  constructor(private config: BigQueryClientConfig) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    logger.info('Connecting to BigQuery MCP server...');

    try {
      // For actual MCP server connection
      // This is a placeholder that simulates MCP connection
      // In production, you would use actual MCP server
      this.connected = true;
      logger.info('BigQuery MCP client ready (simulation mode)');
    } catch (error) {
      logger.error('Failed to connect to BigQuery MCP', { error: String(error) });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
      if (this.process) {
        this.process.kill();
        this.process = null;
      }
      this.connected = false;
      logger.info('BigQuery MCP client disconnected');
    } catch (error) {
      logger.error('Error disconnecting BigQuery MCP', { error: String(error) });
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async listTables(dataset?: string): Promise<BigQueryTable[]> {
    this.ensureConnected();

    logger.debug('Listing BigQuery tables', { dataset });

    // Simulation: return sample tables
    // In production, this would call the MCP server
    const tables: BigQueryTable[] = [
      {
        dataset: dataset ?? 'analytics',
        table: 'events',
        type: 'TABLE',
        rowCount: 1000000,
        lastModified: new Date().toISOString(),
      },
      {
        dataset: dataset ?? 'analytics',
        table: 'sessions',
        type: 'TABLE',
        rowCount: 500000,
        lastModified: new Date().toISOString(),
      },
      {
        dataset: dataset ?? 'analytics',
        table: 'users',
        type: 'TABLE',
        rowCount: 100000,
        lastModified: new Date().toISOString(),
      },
    ];

    return tables;
  }

  async describeTable(tableName: string): Promise<{
    schema: BigQuerySchema[];
    partitioning?: { type: string; field: string };
    clustering?: { fields: string[] };
  }> {
    this.ensureConnected();

    logger.debug('Describing BigQuery table', { tableName });

    // Simulation: return sample schema
    const schema: BigQuerySchema[] = [
      { name: 'event_date', type: 'DATE', mode: 'NULLABLE' },
      { name: 'event_name', type: 'STRING', mode: 'NULLABLE' },
      { name: 'user_id', type: 'STRING', mode: 'NULLABLE' },
      { name: 'session_id', type: 'STRING', mode: 'NULLABLE' },
      { name: 'event_timestamp', type: 'TIMESTAMP', mode: 'NULLABLE' },
      { name: 'event_value', type: 'FLOAT', mode: 'NULLABLE' },
    ];

    return {
      schema,
      partitioning: { type: 'DAY', field: 'event_date' },
    };
  }

  async executeSQL(
    query: string,
    options: { maxRows?: number; dryRun?: boolean } = {}
  ): Promise<BigQueryResult> {
    this.ensureConnected();

    logger.debug('Executing BigQuery SQL', { query: query.substring(0, 100) + '...' });

    // Validate query doesn't contain forbidden operations
    const forbiddenOps = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];
    for (const op of forbiddenOps) {
      if (new RegExp(`\\b${op}\\b`, 'i').test(query)) {
        throw new Error(`Forbidden operation: ${op}`);
      }
    }

    // Simulation: return sample result
    // In production, this would execute the query via MCP
    const result: BigQueryResult = {
      rows: [
        { event_date: '2026-01-30', event_count: 15000, unique_users: 5000 },
        { event_date: '2026-01-29', event_count: 14500, unique_users: 4800 },
        { event_date: '2026-01-28', event_count: 14200, unique_users: 4700 },
      ],
      schema: [
        { name: 'event_date', type: 'DATE', mode: 'NULLABLE' },
        { name: 'event_count', type: 'INTEGER', mode: 'NULLABLE' },
        { name: 'unique_users', type: 'INTEGER', mode: 'NULLABLE' },
      ],
      totalRows: 3,
      bytesProcessed: 1024 * 1024 * 10, // 10MB
      cacheHit: false,
    };

    logger.info('BigQuery query completed', {
      rowCount: result.totalRows,
      bytesProcessed: result.bytesProcessed,
    });

    return result;
  }

  async estimateCost(query: string): Promise<{ bytesProcessed: number; estimatedCost: number }> {
    const result = await this.executeSQL(query, { dryRun: true });

    // BigQuery pricing: $5 per TB
    const costPerTB = 5;
    const bytesProcessed = result.bytesProcessed;
    const estimatedCost = (bytesProcessed / 1e12) * costPerTB;

    return {
      bytesProcessed,
      estimatedCost,
    };
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('BigQuery MCP client not connected');
    }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
