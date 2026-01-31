# BigQuery MCP 統合実装

## 1. 概要

MCP Toolbox for Databases を使用してBigQueryに接続し、エージェントからSQLクエリを実行できるようにする。

---

## 2. MCP Toolbox 設定

### 2.1 設定ファイル

```yaml
# config/bigquery-mcp.yaml
version: "1.0"

# データソース定義
sources:
  analytics:
    kind: bigquery
    project: ${GCP_PROJECT_ID}
    location: asia-northeast1
    credentials:
      type: service_account_json
      # 環境変数から読み込み、またはSecret Managerから取得
      json: ${BIGQUERY_SA_KEY_JSON}

# ツール定義
tools:
  # テーブル一覧取得
  - name: list_tables
    kind: bigquery-list-tables
    source: analytics
    description: |
      利用可能なテーブルの一覧を取得します。
      データセットを指定しない場合、アクセス可能な全テーブルを返します。
    parameters:
      dataset:
        type: string
        required: false
        description: データセット名（省略可）

  # テーブルスキーマ取得
  - name: describe_table
    kind: bigquery-describe-table
    source: analytics
    description: |
      指定したテーブルのスキーマ（カラム定義）を取得します。
      パーティション設定やクラスタリング設定も含みます。
    parameters:
      table:
        type: string
        required: true
        description: テーブル名（dataset.table 形式）

  # SQLクエリ実行
  - name: execute_sql
    kind: bigquery-execute
    source: analytics
    description: |
      BigQueryに対してSQLクエリを実行します。
      SELECT文のみ許可されています。
    parameters:
      query:
        type: string
        required: true
        description: 実行するSQLクエリ
      max_rows:
        type: integer
        required: false
        default: 1000
        description: 最大取得行数
      dry_run:
        type: boolean
        required: false
        default: false
        description: trueの場合、コスト見積もりのみ実行

    # セキュリティ制約
    constraints:
      read_only: true
      allowed_datasets:
        - analytics
        - ads_reporting
        - conversions
      max_bytes_billed: 10737418240  # 10GB
      timeout_ms: 120000  # 2分

  # サンプルデータ取得（デバッグ用）
  - name: sample_data
    kind: bigquery-execute
    source: analytics
    description: テーブルからサンプルデータを取得
    parameters:
      table:
        type: string
        required: true
      limit:
        type: integer
        required: false
        default: 10
    template: |
      SELECT * FROM `{{ table }}` LIMIT {{ limit }}
    constraints:
      read_only: true
      max_bytes_billed: 1073741824  # 1GB
```

### 2.2 許可テーブルリスト

```yaml
# config/allowed-tables.yaml
datasets:
  analytics:
    tables:
      - events_*
      - sessions_*
      - users
    description: GA4エクスポートデータ

  ads_reporting:
    tables:
      - campaign_performance
      - ad_group_performance
      - keyword_performance
    description: 広告パフォーマンスデータ
    sensitive_columns:
      - cost
      - spend
      - budget

  conversions:
    tables:
      - conversion_events
      - attribution_data
    description: コンバージョンデータ
```

---

## 3. TypeScript実装

### 3.1 BigQuery MCP クライアント

```typescript
// src/mcp/bigqueryClient.ts
import { MCPClient } from '@modelcontextprotocol/sdk';
import { spawn } from 'child_process';
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

export class BigQueryMCPClient {
  private client: MCPClient | null = null;
  private process: ReturnType<typeof spawn> | null = null;

  constructor(private config: { configPath: string }) {}

  async connect(): Promise<void> {
    logger.info('BigQuery MCPサーバーに接続中...');

    // MCPサーバープロセスを起動
    this.process = spawn('npx', ['@google/mcp-toolbox', '--config', this.config.configPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        BIGQUERY_SA_KEY_JSON: process.env.BIGQUERY_SA_KEY_JSON,
      },
    });

    // MCPクライアントを初期化
    this.client = new MCPClient({
      transport: {
        stdin: this.process.stdin!,
        stdout: this.process.stdout!,
      },
    });

    await this.client.connect();
    logger.info('BigQuery MCPサーバーに接続完了');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
    if (this.process) {
      this.process.kill();
    }
  }

  async listTables(dataset?: string): Promise<BigQueryTable[]> {
    if (!this.client) throw new Error('Not connected');

    const result = await this.client.callTool('list_tables', {
      dataset,
    });

    return result.tables as BigQueryTable[];
  }

  async describeTable(tableName: string): Promise<{
    schema: BigQuerySchema[];
    partitioning?: { type: string; field: string };
    clustering?: { fields: string[] };
  }> {
    if (!this.client) throw new Error('Not connected');

    const result = await this.client.callTool('describe_table', {
      table: tableName,
    });

    return result as {
      schema: BigQuerySchema[];
      partitioning?: { type: string; field: string };
      clustering?: { fields: string[] };
    };
  }

  async executeSQL(
    query: string,
    options: { maxRows?: number; dryRun?: boolean } = {}
  ): Promise<BigQueryResult> {
    if (!this.client) throw new Error('Not connected');

    logger.debug('SQLクエリ実行', { query: query.substring(0, 100) + '...' });

    const result = await this.client.callTool('execute_sql', {
      query,
      max_rows: options.maxRows ?? 1000,
      dry_run: options.dryRun ?? false,
    });

    logger.info('クエリ完了', {
      rowCount: result.totalRows,
      bytesProcessed: result.bytesProcessed,
      cacheHit: result.cacheHit,
    });

    return result as BigQueryResult;
  }

  async estimateCost(query: string): Promise<{ bytesProcessed: number; estimatedCost: number }> {
    const result = await this.executeSQL(query, { dryRun: true });

    // BigQueryの料金: $5 per TB
    const costPerTB = 5;
    const bytesProcessed = result.bytesProcessed;
    const estimatedCost = (bytesProcessed / 1e12) * costPerTB;

    return {
      bytesProcessed,
      estimatedCost,
    };
  }
}
```

### 3.2 クエリバリデーター

```typescript
// src/mcp/queryValidator.ts
import { logger } from '../utils/logger.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class QueryValidator {
  private allowedDatasets: string[];
  private restrictedColumns: Map<string, string[]>;
  private forbiddenOperations: string[];

  constructor(config: {
    allowedDatasets: string[];
    restrictedColumns: { table: string; columns: string[] }[];
    forbiddenOperations?: string[];
  }) {
    this.allowedDatasets = config.allowedDatasets;
    this.restrictedColumns = new Map(
      config.restrictedColumns.map((r) => [r.table, r.columns])
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
  }

  validate(query: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 禁止操作のチェック
    for (const op of this.forbiddenOperations) {
      const regex = new RegExp(`\\b${op}\\b`, 'i');
      if (regex.test(query)) {
        errors.push(`禁止されている操作です: ${op}`);
      }
    }

    // テーブル参照のチェック
    const tableRefs = this.extractTableReferences(query);
    for (const table of tableRefs) {
      const dataset = table.split('.')[0];
      if (!this.allowedDatasets.includes(dataset)) {
        errors.push(`アクセス権限のないデータセットです: ${dataset}`);
      }
    }

    // 制限カラムのチェック
    for (const [table, columns] of this.restrictedColumns) {
      for (const column of columns) {
        // シンプルなチェック（より厳密にはSQLパーサーを使用）
        if (query.toLowerCase().includes(column.toLowerCase())) {
          warnings.push(`センシティブなカラムが含まれています: ${table}.${column}`);
        }
      }
    }

    // SELECT * のチェック
    if (/SELECT\s+\*/i.test(query)) {
      warnings.push('SELECT * は非推奨です。必要なカラムのみ指定してください。');
    }

    // パーティションフィルターのチェック
    if (!this.hasPartitionFilter(query)) {
      warnings.push('パーティションフィルター（event_date等）の使用を推奨します。');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private extractTableReferences(query: string): string[] {
    // シンプルな正規表現によるテーブル参照抽出
    // 実際にはSQLパーサーを使用するのが望ましい
    const fromRegex = /FROM\s+`?([a-zA-Z0-9_.-]+)`?/gi;
    const joinRegex = /JOIN\s+`?([a-zA-Z0-9_.-]+)`?/gi;

    const tables: string[] = [];
    let match;

    while ((match = fromRegex.exec(query)) !== null) {
      tables.push(match[1]);
    }
    while ((match = joinRegex.exec(query)) !== null) {
      tables.push(match[1]);
    }

    return tables;
  }

  private hasPartitionFilter(query: string): boolean {
    const partitionColumns = ['event_date', '_PARTITIONTIME', '_PARTITIONDATE'];
    const queryLower = query.toLowerCase();

    return partitionColumns.some(
      (col) => queryLower.includes(col.toLowerCase()) && queryLower.includes('where')
    );
  }
}
```

### 3.3 BigQueryエージェントツール

```typescript
// src/agents/tools/bigqueryTools.ts
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { BigQueryMCPClient } from '../../mcp/bigqueryClient.js';
import { QueryValidator } from '../../mcp/queryValidator.js';
import { DataMasker } from '../../utils/masking.js';
import { logger } from '../../utils/logger.js';

export function createBigQueryTools(
  mcpClient: BigQueryMCPClient,
  validator: QueryValidator,
  masker: DataMasker
) {
  return [
    // テーブル一覧取得
    tool(
      'bigquery_list_tables',
      '利用可能なBigQueryテーブルの一覧を取得します',
      {
        dataset: z.string().optional().describe('データセット名（省略時は全データセット）'),
      },
      async ({ dataset }) => {
        logger.info('テーブル一覧を取得', { dataset });
        const tables = await mcpClient.listTables(dataset);
        return { tables };
      }
    ),

    // スキーマ取得
    tool(
      'bigquery_describe_table',
      'テーブルのスキーマ（カラム定義）を取得します',
      {
        table: z.string().describe('テーブル名（dataset.table形式）'),
      },
      async ({ table }) => {
        logger.info('テーブルスキーマを取得', { table });
        const schema = await mcpClient.describeTable(table);
        return schema;
      }
    ),

    // SQLクエリ実行
    tool(
      'bigquery_execute_sql',
      'BigQueryに対してSQLクエリを実行します（SELECT文のみ）',
      {
        query: z.string().describe('実行するSQLクエリ'),
        max_rows: z.number().optional().default(1000).describe('最大取得行数'),
        mask_sensitive: z
          .boolean()
          .optional()
          .default(true)
          .describe('センシティブデータをマスキングするか'),
      },
      async ({ query, max_rows, mask_sensitive }) => {
        // バリデーション
        const validation = validator.validate(query);
        if (!validation.valid) {
          return {
            success: false,
            errors: validation.errors,
          };
        }

        // 警告があれば記録
        if (validation.warnings.length > 0) {
          logger.warn('クエリ警告', { warnings: validation.warnings });
        }

        // クエリ実行
        const result = await mcpClient.executeSQL(query, { maxRows: max_rows });

        // マスキング
        let rows = result.rows;
        if (mask_sensitive) {
          rows = rows.map((row) => masker.maskObject(row));
        }

        return {
          success: true,
          rows,
          schema: result.schema,
          totalRows: result.totalRows,
          bytesProcessed: result.bytesProcessed,
          cacheHit: result.cacheHit,
          warnings: validation.warnings,
        };
      }
    ),

    // コスト見積もり
    tool(
      'bigquery_estimate_cost',
      'クエリの実行コストを事前に見積もります',
      {
        query: z.string().describe('見積もるSQLクエリ'),
      },
      async ({ query }) => {
        const validation = validator.validate(query);
        if (!validation.valid) {
          return {
            success: false,
            errors: validation.errors,
          };
        }

        const estimate = await mcpClient.estimateCost(query);
        return {
          success: true,
          bytesProcessed: estimate.bytesProcessed,
          bytesProcessedFormatted: formatBytes(estimate.bytesProcessed),
          estimatedCostUSD: estimate.estimatedCost.toFixed(4),
        };
      }
    ),
  ];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
```

---

## 4. 使用例

### 4.1 基本的な使用方法

```typescript
// 使用例
import { BigQueryMCPClient } from './mcp/bigqueryClient.js';
import { QueryValidator } from './mcp/queryValidator.js';
import { createBigQueryTools } from './agents/tools/bigqueryTools.js';
import { DataMasker } from './utils/masking.js';

async function main() {
  // MCPクライアントの初期化
  const mcpClient = new BigQueryMCPClient({
    configPath: './config/bigquery-mcp.yaml',
  });

  // バリデーターの初期化
  const validator = new QueryValidator({
    allowedDatasets: ['analytics', 'ads_reporting'],
    restrictedColumns: [
      { table: 'ads_reporting.campaign_performance', columns: ['cost', 'budget'] },
    ],
  });

  // マスカーの初期化
  const masker = new DataMasker();

  // 接続
  await mcpClient.connect();

  try {
    // テーブル一覧取得
    const tables = await mcpClient.listTables('analytics');
    console.log('利用可能なテーブル:', tables);

    // スキーマ取得
    const schema = await mcpClient.describeTable('analytics.events_20260101');
    console.log('スキーマ:', schema);

    // クエリ実行
    const result = await mcpClient.executeSQL(`
      SELECT
        event_date,
        COUNT(*) as event_count
      FROM \`analytics.events_*\`
      WHERE event_date BETWEEN '20260101' AND '20260131'
      GROUP BY event_date
      ORDER BY event_date
    `);
    console.log('結果:', result.rows);
  } finally {
    await mcpClient.disconnect();
  }
}

main().catch(console.error);
```

### 4.2 エージェントでの使用

```typescript
// エージェント内での使用
const agent = createAgent({
  name: 'data-analyst',
  tools: [
    ...createBigQueryTools(mcpClient, validator, masker),
    // 他のツール
  ],
  systemPrompt: `あなたはデータ分析の専門家です。
BigQueryを使用してデータを取得し、分析を行います。

利用可能なツール:
- bigquery_list_tables: テーブル一覧取得
- bigquery_describe_table: スキーマ取得
- bigquery_execute_sql: SQLクエリ実行
- bigquery_estimate_cost: コスト見積もり

クエリ実行前に必ずコスト見積もりを行ってください。`,
});
```

---

## 5. エラーハンドリング

### 5.1 リトライ設定

```typescript
// src/mcp/retryConfig.ts
export const bigqueryRetryConfig = {
  maxRetries: 3,
  retryableErrors: [
    'RATE_LIMIT_EXCEEDED',
    'BACKEND_ERROR',
    'TIMEOUT',
    'SERVICE_UNAVAILABLE',
  ],
  backoff: {
    initial: 1000,
    multiplier: 2,
    max: 30000,
  },
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  config = bigqueryRetryConfig
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      const isRetryable = config.retryableErrors.some((e) =>
        error.message?.includes(e)
      );

      if (!isRetryable || attempt === config.maxRetries) {
        throw error;
      }

      const delay = Math.min(
        config.backoff.initial * Math.pow(config.backoff.multiplier, attempt),
        config.backoff.max
      );

      logger.warn(`リトライ ${attempt + 1}/${config.maxRetries}`, {
        error: error.message,
        delay,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```
