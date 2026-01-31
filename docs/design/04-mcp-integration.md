# MCP統合設計書

## 1. MCP概要

### 1.1 Model Context Protocol (MCP)

MCPはAnthropicが策定したプロトコルで、LLMとデータソース/ツール間の標準化されたインターフェースを提供する。

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Architecture                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐                      ┌─────────────────┐  │
│  │   LLM /     │◀═══ MCP Protocol ═══▶│   MCP Server    │  │
│  │   Agent     │                      │                 │  │
│  └─────────────┘                      └────────┬────────┘  │
│                                                 │           │
│                                                 ▼           │
│                                        ┌─────────────────┐  │
│                                        │  Data Source /  │  │
│                                        │     Tool        │  │
│                                        └─────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 使用するMCPサーバー

| MCPサーバー | 提供元 | 用途 |
|------------|--------|------|
| MCP Toolbox for Databases | Google | BigQuery接続 |
| Google Analytics MCP | Google | GA4接続 |
| Custom Data Masking MCP | 自作 | データマスキング |

---

## 2. BigQuery MCP (MCP Toolbox)

### 2.1 概要

Google提供の「MCP Toolbox for Databases」を使用してBigQueryに接続。

**リポジトリ:** https://github.com/googleapis/genai-toolbox

### 2.2 アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                  agentic-flow                                │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    Agent                                 ││
│  │  "売上データを先月と比較して分析して"                       ││
│  └────────────────────────┬────────────────────────────────┘│
│                           │                                  │
│                    MCP Protocol                              │
│                           │                                  │
│  ┌────────────────────────▼────────────────────────────────┐│
│  │              MCP Toolbox for Databases                   ││
│  │  ┌─────────────────────────────────────────────────────┐││
│  │  │ Tools:                                              │││
│  │  │  - list_tables: テーブル一覧取得                     │││
│  │  │  - describe_table: スキーマ取得                      │││
│  │  │  - execute_sql: SQLクエリ実行                        │││
│  │  │  - get_table_stats: テーブル統計取得                 │││
│  │  └─────────────────────────────────────────────────────┘││
│  └────────────────────────┬────────────────────────────────┘│
└───────────────────────────┼──────────────────────────────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │     BigQuery        │
                 │  ┌───────────────┐  │
                 │  │ analytics     │  │
                 │  │ ads_data      │  │
                 │  │ conversions   │  │
                 │  └───────────────┘  │
                 └─────────────────────┘
```

### 2.3 設定

```yaml
# mcp-toolbox-config.yaml
version: "1.0"
sources:
  bigquery-analytics:
    kind: bigquery
    project: your-gcp-project
    credentials:
      type: service_account
      # Secret Managerから取得
      secret_id: projects/your-project/secrets/bigquery-sa-key/versions/latest

tools:
  # テーブル一覧
  - name: list_tables
    kind: bigquery
    source: bigquery-analytics
    description: "利用可能なテーブルの一覧を取得"

  # スキーマ取得
  - name: describe_table
    kind: bigquery
    source: bigquery-analytics
    description: "テーブルのスキーマ（カラム定義）を取得"
    parameters:
      - name: table_name
        type: string
        required: true
        description: "テーブル名（dataset.table形式）"

  # SQLクエリ実行
  - name: execute_sql
    kind: bigquery
    source: bigquery-analytics
    description: "SQLクエリを実行してデータを取得"
    parameters:
      - name: query
        type: string
        required: true
        description: "実行するSQLクエリ"
      - name: max_rows
        type: integer
        default: 1000
        description: "最大取得行数"

    # セキュリティ制約
    constraints:
      # 読み取り専用
      read_only: true
      # 許可されたデータセット
      allowed_datasets:
        - "analytics"
        - "ads_reporting"
      # 最大スキャンサイズ
      max_bytes_billed: 10737418240  # 10GB
```

### 2.4 ツール仕様

```typescript
// BigQuery MCP ツール定義
interface BigQueryMCPTools {
  // テーブル一覧
  list_tables: {
    input: {
      dataset?: string;  // 指定しない場合は全データセット
    };
    output: {
      tables: Array<{
        dataset: string;
        table: string;
        type: 'TABLE' | 'VIEW';
        rowCount: number;
        lastModified: string;
      }>;
    };
  };

  // スキーマ取得
  describe_table: {
    input: {
      table_name: string;  // 'dataset.table' 形式
    };
    output: {
      schema: Array<{
        name: string;
        type: string;
        mode: 'NULLABLE' | 'REQUIRED' | 'REPEATED';
        description?: string;
      }>;
      partitioning?: {
        type: string;
        field: string;
      };
      clustering?: {
        fields: string[];
      };
    };
  };

  // SQL実行
  execute_sql: {
    input: {
      query: string;
      max_rows?: number;
      dry_run?: boolean;  // コスト見積もりのみ
    };
    output: {
      rows: Record<string, unknown>[];
      schema: Array<{ name: string; type: string }>;
      total_rows: number;
      bytes_processed: number;
      cache_hit: boolean;
    };
  };
}
```

---

## 3. GA4 MCP

### 3.1 概要

Google Analytics Data API v1を使用したMCPサーバー。

**公式MCP:** Google Analytics MCP Server (googleapis)

### 3.2 アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                  agentic-flow                                │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    Agent                                 ││
│  │  "直近30日のセッション数とコンバージョン率を分析して"       ││
│  └────────────────────────┬────────────────────────────────┘│
│                           │                                  │
│                    MCP Protocol                              │
│                           │                                  │
│  ┌────────────────────────▼────────────────────────────────┐│
│  │              GA4 MCP Server                              ││
│  │  ┌─────────────────────────────────────────────────────┐││
│  │  │ Tools:                                              │││
│  │  │  - run_report: レポート実行                          │││
│  │  │  - get_realtime: リアルタイムデータ取得              │││
│  │  │  - list_dimensions: ディメンション一覧               │││
│  │  │  - list_metrics: メトリクス一覧                      │││
│  │  └─────────────────────────────────────────────────────┘││
│  └────────────────────────┬────────────────────────────────┘│
└───────────────────────────┼──────────────────────────────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │   GA4 Property      │
                 │   (123456789)       │
                 └─────────────────────┘
```

### 3.3 設定

```yaml
# ga4-mcp-config.yaml
version: "1.0"
server:
  name: "ga4-mcp-server"
  version: "1.0.0"

credentials:
  type: service_account
  # Secret Managerから取得
  secret_id: projects/your-project/secrets/ga4-sa-key/versions/latest

properties:
  - id: "properties/123456789"
    name: "Main Website"
    allowed: true
  - id: "properties/987654321"
    name: "App Property"
    allowed: true

tools:
  - name: run_report
    description: "GA4レポートを実行"
    parameters:
      property_id:
        type: string
        required: true
      date_ranges:
        type: array
        items:
          type: object
          properties:
            start_date: { type: string }
            end_date: { type: string }
      dimensions:
        type: array
        items: { type: string }
      metrics:
        type: array
        items: { type: string }
      dimension_filter:
        type: object
      metric_filter:
        type: object
      limit:
        type: integer
        default: 10000

  - name: get_realtime
    description: "リアルタイムデータを取得"
    parameters:
      property_id:
        type: string
        required: true
      dimensions:
        type: array
        items: { type: string }
      metrics:
        type: array
        items: { type: string }

  - name: list_dimensions
    description: "利用可能なディメンション一覧"

  - name: list_metrics
    description: "利用可能なメトリクス一覧"
```

### 3.4 ツール仕様

```typescript
// GA4 MCP ツール定義
interface GA4MCPTools {
  // レポート実行
  run_report: {
    input: {
      property_id: string;
      date_ranges: Array<{
        start_date: string;  // 'YYYY-MM-DD' or 'today', 'yesterday', 'NdaysAgo'
        end_date: string;
      }>;
      dimensions?: string[];  // e.g., ['date', 'sessionSource', 'deviceCategory']
      metrics: string[];      // e.g., ['sessions', 'conversions', 'totalRevenue']
      dimension_filter?: {
        filter: {
          field_name: string;
          string_filter?: { match_type: string; value: string };
          in_list_filter?: { values: string[] };
        };
      };
      metric_filter?: {
        filter: {
          field_name: string;
          numeric_filter: {
            operation: 'GREATER_THAN' | 'LESS_THAN' | 'EQUAL';
            value: { int64_value?: number; double_value?: number };
          };
        };
      };
      limit?: number;
      offset?: number;
      order_bys?: Array<{
        dimension?: { dimension_name: string };
        metric?: { metric_name: string };
        desc?: boolean;
      }>;
    };
    output: {
      rows: Array<{
        dimension_values: Array<{ value: string }>;
        metric_values: Array<{ value: string }>;
      }>;
      row_count: number;
      metadata: {
        currency_code: string;
        time_zone: string;
      };
    };
  };

  // リアルタイムデータ
  get_realtime: {
    input: {
      property_id: string;
      dimensions?: string[];
      metrics: string[];
      limit?: number;
    };
    output: {
      rows: Array<{
        dimension_values: Array<{ value: string }>;
        metric_values: Array<{ value: string }>;
      }>;
      row_count: number;
    };
  };

  // ディメンション一覧
  list_dimensions: {
    input: {};
    output: {
      dimensions: Array<{
        api_name: string;
        ui_name: string;
        description: string;
        category: string;
      }>;
    };
  };

  // メトリクス一覧
  list_metrics: {
    input: {};
    output: {
      metrics: Array<{
        api_name: string;
        ui_name: string;
        description: string;
        category: string;
        type: 'TYPE_INTEGER' | 'TYPE_FLOAT' | 'TYPE_CURRENCY';
      }>;
    };
  };
}
```

---

## 4. Custom Data Masking MCP

### 4.1 概要

センシティブデータのマスキング/アンマスキングを行うカスタムMCPサーバー。

### 4.2 アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                  agentic-flow                                │
│                                                              │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐  │
│  │ Raw Data    │────▶│ Masking MCP │────▶│ Masked Data │  │
│  │ from BQ/GA4 │     │   Server    │     │ (to LLM)    │  │
│  └─────────────┘     └──────┬──────┘     └─────────────┘  │
│                             │                               │
│                      ┌──────┴──────┐                       │
│                      │  Mapping    │                       │
│                      │   Store     │                       │
│                      │ (In-Memory) │                       │
│                      └─────────────┘                       │
│                                                              │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐  │
│  │ LLM Output  │────▶│ Unmask MCP  │────▶│ Final       │  │
│  │ (Masked)    │     │   Server    │     │ Report      │  │
│  └─────────────┘     └─────────────┘     └─────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 実装

```typescript
// src/mcp/dataMaskingServer.ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import crypto from 'crypto';

interface MaskMapping {
  original: string;
  masked: string;
  category: string;
  createdAt: Date;
}

// セッションごとのマッピング保存
const sessionMappings = new Map<string, Map<string, MaskMapping>>();

// マスキングルール
const maskingRules = [
  {
    name: 'currency',
    pattern: /[¥$€£][\d,]+\.?\d*/g,
    category: 'financial',
  },
  {
    name: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    category: 'pii',
  },
  {
    name: 'phone_jp',
    pattern: /(\+?81|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}/g,
    category: 'pii',
  },
  {
    name: 'campaign_id',
    pattern: /campaign[_-]?id[:\s]*\d+/gi,
    category: 'business',
  },
  {
    name: 'account_id',
    pattern: /account[_-]?id[:\s]*\d+/gi,
    category: 'business',
  },
];

export const dataMaskingServer = createSdkMcpServer({
  name: 'data-masking-server',
  version: '1.0.0',

  tools: [
    // データマスキング
    tool(
      'mask_data',
      'センシティブデータをマスキングする',
      {
        session_id: z.string().describe('セッションID'),
        data: z.string().describe('マスキングするデータ'),
        additional_patterns: z
          .array(
            z.object({
              pattern: z.string(),
              category: z.string(),
            })
          )
          .optional()
          .describe('追加のマスキングパターン'),
      },
      async ({ session_id, data, additional_patterns }) => {
        // セッション用のマッピングを初期化
        if (!sessionMappings.has(session_id)) {
          sessionMappings.set(session_id, new Map());
        }
        const mappings = sessionMappings.get(session_id)!;

        let maskedData = data;

        // 標準ルールの適用
        for (const rule of maskingRules) {
          maskedData = maskedData.replace(rule.pattern, (match) => {
            const token = `[${rule.category.toUpperCase()}_${crypto
              .randomBytes(4)
              .toString('hex')}]`;
            mappings.set(token, {
              original: match,
              masked: token,
              category: rule.category,
              createdAt: new Date(),
            });
            return token;
          });
        }

        // 追加パターンの適用
        if (additional_patterns) {
          for (const ap of additional_patterns) {
            const regex = new RegExp(ap.pattern, 'gi');
            maskedData = maskedData.replace(regex, (match) => {
              const token = `[${ap.category.toUpperCase()}_${crypto
                .randomBytes(4)
                .toString('hex')}]`;
              mappings.set(token, {
                original: match,
                masked: token,
                category: ap.category,
                createdAt: new Date(),
              });
              return token;
            });
          }
        }

        return {
          masked_data: maskedData,
          masks_applied: mappings.size,
          categories: [...new Set([...mappings.values()].map((m) => m.category))],
        };
      }
    ),

    // データアンマスキング
    tool(
      'unmask_data',
      'マスキングされたデータを元に戻す',
      {
        session_id: z.string().describe('セッションID'),
        data: z.string().describe('アンマスキングするデータ'),
      },
      async ({ session_id, data }) => {
        const mappings = sessionMappings.get(session_id);
        if (!mappings) {
          return {
            unmasked_data: data,
            warning: 'No mappings found for session',
          };
        }

        let unmaskedData = data;
        for (const [token, mapping] of mappings) {
          unmaskedData = unmaskedData.replace(
            new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
            mapping.original
          );
        }

        return {
          unmasked_data: unmaskedData,
          masks_removed: mappings.size,
        };
      }
    ),

    // セッションクリア
    tool(
      'clear_session',
      'セッションのマスキングマッピングをクリアする',
      {
        session_id: z.string().describe('セッションID'),
      },
      async ({ session_id }) => {
        const existed = sessionMappings.has(session_id);
        sessionMappings.delete(session_id);
        return {
          success: true,
          session_existed: existed,
        };
      }
    ),
  ],
});
```

---

## 5. MCP統合設定

### 5.1 agentic-flow MCPサーバー設定

```json
{
  "mcpServers": {
    "bigquery": {
      "type": "stdio",
      "command": "npx",
      "args": ["@google/mcp-toolbox", "--config", "./config/bigquery-mcp.yaml"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "${GCP_SA_KEY_PATH}"
      }
    },
    "ga4": {
      "type": "stdio",
      "command": "npx",
      "args": ["@google/ga4-mcp-server"],
      "env": {
        "GA4_PROPERTY_ID": "${GA4_PROPERTY_ID}",
        "GOOGLE_APPLICATION_CREDENTIALS": "${GCP_SA_KEY_PATH}"
      }
    },
    "data-masking": {
      "type": "in-sdk",
      "module": "./src/mcp/dataMaskingServer.ts"
    }
  }
}
```

### 5.2 エージェントからのMCP利用フロー

```typescript
// エージェントでのMCPツール利用例
async function analyzeWithMasking(sessionId: string, query: string) {
  // 1. BigQueryからデータ取得
  const rawData = await mcpClient.call('bigquery', 'execute_sql', {
    query,
    max_rows: 10000,
  });

  // 2. データをマスキング
  const maskedResult = await mcpClient.call('data-masking', 'mask_data', {
    session_id: sessionId,
    data: JSON.stringify(rawData.rows),
  });

  // 3. LLMで分析（マスキングされたデータ）
  const analysis = await llmClient.analyze(maskedResult.masked_data);

  // 4. 結果をアンマスキング
  const finalResult = await mcpClient.call('data-masking', 'unmask_data', {
    session_id: sessionId,
    data: analysis,
  });

  // 5. セッションクリア
  await mcpClient.call('data-masking', 'clear_session', {
    session_id: sessionId,
  });

  return finalResult.unmasked_data;
}
```
