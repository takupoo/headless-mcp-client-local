# GA4 MCP 統合実装

## 1. 概要

Google Analytics Data API v1 を使用したMCPサーバーを統合し、GA4のデータをエージェントから取得できるようにする。

---

## 2. GA4 MCP 設定

### 2.1 設定ファイル

```yaml
# config/ga4-mcp.yaml
version: "1.0"

server:
  name: "ga4-mcp-server"
  version: "1.0.0"

# 認証設定
credentials:
  type: service_account_json
  json: ${GA4_SA_KEY_JSON}

# プロパティ設定
properties:
  - id: "properties/123456789"
    name: "Main Website"
    allowed: true
  - id: "properties/987654321"
    name: "Mobile App"
    allowed: true

# ツール設定
tools:
  # レポート実行
  - name: run_report
    description: |
      GA4プロパティに対してレポートを実行します。
      ディメンションとメトリクスを指定してデータを取得できます。
    parameters:
      property_id:
        type: string
        required: true
        description: GA4プロパティID（properties/123456形式）
      date_ranges:
        type: array
        required: true
        description: 日付範囲の配列
        items:
          type: object
          properties:
            start_date:
              type: string
              description: 開始日（YYYY-MM-DD、today、yesterday、NdaysAgo）
            end_date:
              type: string
              description: 終了日
      dimensions:
        type: array
        description: ディメンション名の配列
        items:
          type: string
      metrics:
        type: array
        required: true
        description: メトリクス名の配列
        items:
          type: string
      dimension_filter:
        type: object
        description: ディメンションフィルター
      metric_filter:
        type: object
        description: メトリクスフィルター
      order_bys:
        type: array
        description: ソート順
      limit:
        type: integer
        default: 10000
        description: 取得行数上限

  # リアルタイムレポート
  - name: get_realtime
    description: リアルタイムデータを取得します
    parameters:
      property_id:
        type: string
        required: true
      dimensions:
        type: array
        items:
          type: string
      metrics:
        type: array
        required: true
        items:
          type: string
      limit:
        type: integer
        default: 100

  # メタデータ取得
  - name: list_dimensions
    description: 利用可能なディメンションの一覧を取得
    parameters: {}

  - name: list_metrics
    description: 利用可能なメトリクスの一覧を取得
    parameters: {}

# レート制限
rate_limits:
  requests_per_minute: 60
  requests_per_day: 50000
```

---

## 3. TypeScript実装

### 3.1 GA4 MCP クライアント

```typescript
// src/mcp/ga4Client.ts
import { MCPClient } from '@modelcontextprotocol/sdk';
import { spawn } from 'child_process';
import { logger } from '../utils/logger.js';

export interface GA4DateRange {
  startDate: string;
  endDate: string;
}

export interface GA4ReportRequest {
  propertyId: string;
  dateRanges: GA4DateRange[];
  dimensions?: string[];
  metrics: string[];
  dimensionFilter?: GA4Filter;
  metricFilter?: GA4Filter;
  orderBys?: GA4OrderBy[];
  limit?: number;
  offset?: number;
}

export interface GA4Filter {
  filter?: {
    fieldName: string;
    stringFilter?: {
      matchType: 'EXACT' | 'BEGINS_WITH' | 'ENDS_WITH' | 'CONTAINS' | 'REGEXP';
      value: string;
      caseSensitive?: boolean;
    };
    inListFilter?: {
      values: string[];
      caseSensitive?: boolean;
    };
    numericFilter?: {
      operation: 'EQUAL' | 'LESS_THAN' | 'GREATER_THAN';
      value: { int64Value?: string; doubleValue?: number };
    };
  };
  andGroup?: { expressions: GA4Filter[] };
  orGroup?: { expressions: GA4Filter[] };
  notExpression?: GA4Filter;
}

export interface GA4OrderBy {
  dimension?: { dimensionName: string };
  metric?: { metricName: string };
  desc?: boolean;
}

export interface GA4ReportRow {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

export interface GA4ReportResult {
  rows: GA4ReportRow[];
  rowCount: number;
  metadata: {
    currencyCode: string;
    timeZone: string;
  };
}

export interface GA4Dimension {
  apiName: string;
  uiName: string;
  description: string;
  category: string;
}

export interface GA4Metric {
  apiName: string;
  uiName: string;
  description: string;
  category: string;
  type: 'TYPE_INTEGER' | 'TYPE_FLOAT' | 'TYPE_CURRENCY' | 'TYPE_SECONDS';
}

export class GA4MCPClient {
  private client: MCPClient | null = null;
  private process: ReturnType<typeof spawn> | null = null;

  constructor(
    private config: {
      configPath: string;
      defaultPropertyId?: string;
    }
  ) {}

  async connect(): Promise<void> {
    logger.info('GA4 MCPサーバーに接続中...');

    // MCPサーバープロセスを起動
    this.process = spawn('npx', ['@google/ga4-mcp-server', '--config', this.config.configPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GA4_SA_KEY_JSON: process.env.GA4_SA_KEY_JSON,
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
    logger.info('GA4 MCPサーバーに接続完了');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
    if (this.process) {
      this.process.kill();
    }
  }

  async runReport(request: GA4ReportRequest): Promise<GA4ReportResult> {
    if (!this.client) throw new Error('Not connected');

    logger.debug('GA4レポート実行', {
      propertyId: request.propertyId,
      dimensions: request.dimensions,
      metrics: request.metrics,
    });

    const result = await this.client.callTool('run_report', {
      property_id: request.propertyId,
      date_ranges: request.dateRanges.map((dr) => ({
        start_date: dr.startDate,
        end_date: dr.endDate,
      })),
      dimensions: request.dimensions,
      metrics: request.metrics,
      dimension_filter: request.dimensionFilter,
      metric_filter: request.metricFilter,
      order_bys: request.orderBys,
      limit: request.limit ?? 10000,
      offset: request.offset,
    });

    logger.info('GA4レポート完了', { rowCount: result.row_count });

    return {
      rows: result.rows,
      rowCount: result.row_count,
      metadata: result.metadata,
    };
  }

  async getRealtime(
    propertyId: string,
    options: {
      dimensions?: string[];
      metrics: string[];
      limit?: number;
    }
  ): Promise<GA4ReportResult> {
    if (!this.client) throw new Error('Not connected');

    const result = await this.client.callTool('get_realtime', {
      property_id: propertyId,
      dimensions: options.dimensions,
      metrics: options.metrics,
      limit: options.limit ?? 100,
    });

    return {
      rows: result.rows,
      rowCount: result.row_count,
      metadata: { currencyCode: 'JPY', timeZone: 'Asia/Tokyo' },
    };
  }

  async listDimensions(): Promise<GA4Dimension[]> {
    if (!this.client) throw new Error('Not connected');

    const result = await this.client.callTool('list_dimensions', {});
    return result.dimensions;
  }

  async listMetrics(): Promise<GA4Metric[]> {
    if (!this.client) throw new Error('Not connected');

    const result = await this.client.callTool('list_metrics', {});
    return result.metrics;
  }
}
```

### 3.2 GA4 レポートビルダー

```typescript
// src/mcp/ga4ReportBuilder.ts
import {
  GA4ReportRequest,
  GA4DateRange,
  GA4Filter,
  GA4OrderBy,
} from './ga4Client.js';

export class GA4ReportBuilder {
  private request: Partial<GA4ReportRequest> = {};

  constructor(propertyId: string) {
    this.request.propertyId = propertyId;
    this.request.metrics = [];
    this.request.dimensions = [];
  }

  dateRange(startDate: string, endDate: string): this {
    if (!this.request.dateRanges) {
      this.request.dateRanges = [];
    }
    this.request.dateRanges.push({ startDate, endDate });
    return this;
  }

  // よく使う日付範囲のショートカット
  last7Days(): this {
    return this.dateRange('7daysAgo', 'today');
  }

  last30Days(): this {
    return this.dateRange('30daysAgo', 'today');
  }

  lastMonth(): this {
    return this.dateRange('30daysAgo', 'today');
  }

  thisMonth(): this {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.dateRange(
      firstDay.toISOString().split('T')[0],
      'today'
    );
  }

  dimension(name: string): this {
    this.request.dimensions!.push(name);
    return this;
  }

  dimensions(...names: string[]): this {
    this.request.dimensions!.push(...names);
    return this;
  }

  metric(name: string): this {
    this.request.metrics!.push(name);
    return this;
  }

  metrics(...names: string[]): this {
    this.request.metrics!.push(...names);
    return this;
  }

  filterDimension(
    fieldName: string,
    matchType: 'EXACT' | 'CONTAINS' | 'BEGINS_WITH' | 'ENDS_WITH' | 'REGEXP',
    value: string
  ): this {
    this.request.dimensionFilter = {
      filter: {
        fieldName,
        stringFilter: {
          matchType,
          value,
        },
      },
    };
    return this;
  }

  filterDimensionInList(fieldName: string, values: string[]): this {
    this.request.dimensionFilter = {
      filter: {
        fieldName,
        inListFilter: { values },
      },
    };
    return this;
  }

  orderBy(field: string, desc = true, isMetric = true): this {
    if (!this.request.orderBys) {
      this.request.orderBys = [];
    }
    if (isMetric) {
      this.request.orderBys.push({ metric: { metricName: field }, desc });
    } else {
      this.request.orderBys.push({ dimension: { dimensionName: field }, desc });
    }
    return this;
  }

  limit(n: number): this {
    this.request.limit = n;
    return this;
  }

  build(): GA4ReportRequest {
    if (!this.request.propertyId) {
      throw new Error('Property ID is required');
    }
    if (!this.request.metrics || this.request.metrics.length === 0) {
      throw new Error('At least one metric is required');
    }
    if (!this.request.dateRanges || this.request.dateRanges.length === 0) {
      throw new Error('At least one date range is required');
    }

    return this.request as GA4ReportRequest;
  }
}

// ファクトリー関数
export function ga4Report(propertyId: string): GA4ReportBuilder {
  return new GA4ReportBuilder(propertyId);
}
```

### 3.3 GA4エージェントツール

```typescript
// src/agents/tools/ga4Tools.ts
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { GA4MCPClient } from '../../mcp/ga4Client.js';
import { ga4Report } from '../../mcp/ga4ReportBuilder.js';
import { DataMasker } from '../../utils/masking.js';
import { logger } from '../../utils/logger.js';

export function createGA4Tools(
  mcpClient: GA4MCPClient,
  masker: DataMasker,
  defaultPropertyId: string
) {
  return [
    // レポート実行
    tool(
      'ga4_run_report',
      'GA4プロパティに対してレポートを実行します',
      {
        property_id: z.string().optional().describe('GA4プロパティID（省略時はデフォルト）'),
        start_date: z.string().describe('開始日（YYYY-MM-DD または today, yesterday, NdaysAgo）'),
        end_date: z.string().describe('終了日'),
        dimensions: z.array(z.string()).optional().describe('ディメンション名の配列'),
        metrics: z.array(z.string()).describe('メトリクス名の配列'),
        dimension_filter: z
          .object({
            field: z.string(),
            match_type: z.enum(['EXACT', 'CONTAINS', 'BEGINS_WITH', 'ENDS_WITH']),
            value: z.string(),
          })
          .optional()
          .describe('ディメンションフィルター'),
        order_by: z
          .object({
            field: z.string(),
            desc: z.boolean().default(true),
          })
          .optional()
          .describe('ソート順'),
        limit: z.number().optional().default(1000).describe('取得行数上限'),
        mask_sensitive: z.boolean().optional().default(true).describe('マスキングの有無'),
      },
      async ({
        property_id,
        start_date,
        end_date,
        dimensions,
        metrics,
        dimension_filter,
        order_by,
        limit,
        mask_sensitive,
      }) => {
        logger.info('GA4レポート実行', { start_date, end_date, metrics });

        const propertyId = property_id ?? defaultPropertyId;

        // リクエストビルド
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
            dimension_filter.match_type,
            dimension_filter.value
          );
        }

        if (order_by) {
          builder.orderBy(order_by.field, order_by.desc);
        }

        // レポート実行
        const result = await mcpClient.runReport(builder.build());

        // 結果を整形
        const formattedRows = result.rows.map((row) => {
          const obj: Record<string, string | number> = {};

          // ディメンション
          (dimensions ?? []).forEach((dim, i) => {
            obj[dim] = row.dimensionValues[i]?.value ?? '';
          });

          // メトリクス
          metrics.forEach((metric, i) => {
            const value = row.metricValues[i]?.value ?? '0';
            // 数値に変換を試みる
            const numValue = parseFloat(value);
            obj[metric] = isNaN(numValue) ? value : numValue;
          });

          return obj;
        });

        // マスキング
        const rows = mask_sensitive
          ? formattedRows.map((row) => masker.maskObject(row))
          : formattedRows;

        return {
          success: true,
          rows,
          rowCount: result.rowCount,
          metadata: result.metadata,
        };
      }
    ),

    // リアルタイムデータ取得
    tool(
      'ga4_realtime',
      'GA4のリアルタイムデータを取得します',
      {
        property_id: z.string().optional().describe('GA4プロパティID'),
        dimensions: z.array(z.string()).optional().describe('ディメンション'),
        metrics: z.array(z.string()).describe('メトリクス'),
        limit: z.number().optional().default(100).describe('取得行数'),
      },
      async ({ property_id, dimensions, metrics, limit }) => {
        const propertyId = property_id ?? defaultPropertyId;

        const result = await mcpClient.getRealtime(propertyId, {
          dimensions,
          metrics,
          limit,
        });

        // 結果を整形
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
      }
    ),

    // ディメンション一覧
    tool(
      'ga4_list_dimensions',
      '利用可能なGA4ディメンションの一覧を取得します',
      {
        category: z.string().optional().describe('カテゴリでフィルター'),
      },
      async ({ category }) => {
        const dimensions = await mcpClient.listDimensions();

        const filtered = category
          ? dimensions.filter((d) => d.category === category)
          : dimensions;

        return {
          dimensions: filtered.map((d) => ({
            name: d.apiName,
            displayName: d.uiName,
            description: d.description,
            category: d.category,
          })),
        };
      }
    ),

    // メトリクス一覧
    tool(
      'ga4_list_metrics',
      '利用可能なGA4メトリクスの一覧を取得します',
      {
        category: z.string().optional().describe('カテゴリでフィルター'),
      },
      async ({ category }) => {
        const metrics = await mcpClient.listMetrics();

        const filtered = category
          ? metrics.filter((m) => m.category === category)
          : metrics;

        return {
          metrics: filtered.map((m) => ({
            name: m.apiName,
            displayName: m.uiName,
            description: m.description,
            category: m.category,
            type: m.type,
          })),
        };
      }
    ),
  ];
}
```

---

## 4. よく使うレポートテンプレート

### 4.1 セッション・ユーザー分析

```typescript
// トラフィック概要
const trafficOverview = ga4Report(propertyId)
  .last30Days()
  .dimensions('date')
  .metrics('sessions', 'totalUsers', 'newUsers', 'screenPageViews')
  .orderBy('date', false, false)
  .build();

// チャネル別分析
const channelReport = ga4Report(propertyId)
  .last30Days()
  .dimensions('sessionDefaultChannelGroup')
  .metrics('sessions', 'totalUsers', 'conversions', 'totalRevenue')
  .orderBy('sessions', true)
  .limit(20)
  .build();
```

### 4.2 コンバージョン分析

```typescript
// コンバージョン概要
const conversionOverview = ga4Report(propertyId)
  .last30Days()
  .dimensions('date')
  .metrics('conversions', 'totalRevenue', 'purchaseRevenue')
  .orderBy('date', false, false)
  .build();

// ランディングページ別コンバージョン
const landingPageConversions = ga4Report(propertyId)
  .last30Days()
  .dimensions('landingPage')
  .metrics('sessions', 'conversions', 'totalRevenue')
  .orderBy('conversions', true)
  .limit(50)
  .build();
```

### 4.3 キャンペーン分析

```typescript
// キャンペーン別パフォーマンス
const campaignReport = ga4Report(propertyId)
  .last30Days()
  .dimensions('sessionCampaignName', 'sessionSource', 'sessionMedium')
  .metrics('sessions', 'totalUsers', 'conversions', 'totalRevenue')
  .filterDimension('sessionMedium', 'EXACT', 'cpc')
  .orderBy('sessions', true)
  .limit(100)
  .build();

// 広告コンテンツ別
const adContentReport = ga4Report(propertyId)
  .last30Days()
  .dimensions('sessionGoogleAdsAdContent', 'sessionGoogleAdsKeyword')
  .metrics('sessions', 'conversions', 'totalRevenue')
  .orderBy('conversions', true)
  .limit(50)
  .build();
```

---

## 5. エラーハンドリング

### 5.1 GA4 API エラーコード

| エラーコード | 説明 | 対処法 |
|------------|------|--------|
| `QUOTA_EXCEEDED` | クォータ超過 | 待機してリトライ |
| `PERMISSION_DENIED` | 権限なし | サービスアカウント権限確認 |
| `INVALID_ARGUMENT` | 不正なパラメータ | リクエスト内容を確認 |
| `INTERNAL` | 内部エラー | リトライ |

### 5.2 リトライ設定

```typescript
// src/mcp/ga4RetryConfig.ts
export const ga4RetryConfig = {
  maxRetries: 3,
  retryableErrors: ['QUOTA_EXCEEDED', 'INTERNAL', 'UNAVAILABLE'],
  backoff: {
    initial: 2000,
    multiplier: 2,
    max: 60000,
  },
};
```
