/**
 * Query Validator for BigQuery
 *
 * Validates SQL queries before execution to ensure security
 */

import { logger } from '../utils/logger.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface QueryValidatorConfig {
  allowedDatasets: string[];
  restrictedColumns?: { table: string; columns: string[] }[];
  forbiddenOperations?: string[];
  maxBytesProcessed?: number;
}

export class QueryValidator {
  private allowedDatasets: string[];
  private restrictedColumns: Map<string, string[]>;
  private forbiddenOperations: string[];
  private maxBytesProcessed: number;

  constructor(config: QueryValidatorConfig) {
    this.allowedDatasets = config.allowedDatasets;
    this.restrictedColumns = new Map(
      (config.restrictedColumns ?? []).map((r) => [r.table, r.columns])
    );
    this.forbiddenOperations = config.forbiddenOperations ?? [
      'INSERT',
      'UPDATE',
      'DELETE',
      'DROP',
      'CREATE',
      'ALTER',
      'TRUNCATE',
      'MERGE',
    ];
    this.maxBytesProcessed = config.maxBytesProcessed ?? 10 * 1024 * 1024 * 1024; // 10GB
  }

  validate(query: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for forbidden operations
    for (const op of this.forbiddenOperations) {
      const regex = new RegExp(`\\b${op}\\b`, 'i');
      if (regex.test(query)) {
        errors.push(`Forbidden operation: ${op}`);
      }
    }

    // Check table references
    const tableRefs = this.extractTableReferences(query);
    for (const table of tableRefs) {
      const parts = table.split('.');
      const dataset = parts.length > 1 ? parts[0] : 'default';

      // Remove backticks and project prefix if present
      const cleanDataset = dataset.replace(/`/g, '').split('.').pop() ?? dataset;

      if (
        this.allowedDatasets.length > 0 &&
        !this.allowedDatasets.some((d) => cleanDataset.includes(d))
      ) {
        errors.push(`Access denied to dataset: ${cleanDataset}`);
      }
    }

    // Check for restricted columns
    for (const [table, columns] of this.restrictedColumns) {
      for (const column of columns) {
        if (query.toLowerCase().includes(column.toLowerCase())) {
          warnings.push(`Sensitive column detected: ${table}.${column}`);
        }
      }
    }

    // Check for SELECT *
    if (/SELECT\s+\*/i.test(query)) {
      warnings.push('SELECT * is not recommended. Please specify required columns.');
    }

    // Check for partition filter
    if (!this.hasPartitionFilter(query)) {
      warnings.push('Recommend using partition filter (e.g., event_date) for cost optimization.');
    }

    // Check for LIMIT clause
    if (!/\bLIMIT\b/i.test(query)) {
      warnings.push('Consider adding LIMIT clause to control result size.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private extractTableReferences(query: string): string[] {
    const tables: string[] = [];

    // FROM clause
    const fromRegex = /FROM\s+`?([a-zA-Z0-9_.-]+)`?/gi;
    let match;

    while ((match = fromRegex.exec(query)) !== null) {
      tables.push(match[1]);
    }

    // JOIN clause
    const joinRegex = /JOIN\s+`?([a-zA-Z0-9_.-]+)`?/gi;
    while ((match = joinRegex.exec(query)) !== null) {
      tables.push(match[1]);
    }

    return [...new Set(tables)];
  }

  private hasPartitionFilter(query: string): boolean {
    const partitionColumns = [
      'event_date',
      '_PARTITIONTIME',
      '_PARTITIONDATE',
      'date',
      'partition_date',
    ];
    const queryLower = query.toLowerCase();

    // Check if query has WHERE clause with partition column
    if (!queryLower.includes('where')) {
      return false;
    }

    return partitionColumns.some((col) => queryLower.includes(col.toLowerCase()));
  }

  addAllowedDataset(dataset: string): void {
    if (!this.allowedDatasets.includes(dataset)) {
      this.allowedDatasets.push(dataset);
    }
  }

  removeAllowedDataset(dataset: string): void {
    const index = this.allowedDatasets.indexOf(dataset);
    if (index > -1) {
      this.allowedDatasets.splice(index, 1);
    }
  }

  addRestrictedColumn(table: string, column: string): void {
    const columns = this.restrictedColumns.get(table) ?? [];
    if (!columns.includes(column)) {
      columns.push(column);
      this.restrictedColumns.set(table, columns);
    }
  }
}
