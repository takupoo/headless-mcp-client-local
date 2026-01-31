# 分析エージェント設計書

## 1. エージェント概要

### 1.1 エージェント構成

```
┌─────────────────────────────────────────────────────────────────┐
│                    Analysis Agent System                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐│
│  │                  Coordinator Agent                          ││
│  │  役割: 全体のオーケストレーション、タスク分配                  ││
│  │  モデル: Claude Sonnet                                      ││
│  └──────────────────────────┬─────────────────────────────────┘│
│                              │                                   │
│    ┌─────────────────────────┼─────────────────────────────┐   │
│    │                         │                             │   │
│    ▼                         ▼                             ▼   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    │
│  │Query Gen     │    │Data Fetcher  │    │Validator     │    │
│  │Agent         │    │Agent         │    │Agent         │    │
│  │(Sonnet)      │    │(Haiku)       │    │(Haiku)       │    │
│  └──────────────┘    └──────────────┘    └──────────────┘    │
│                                                                  │
│    ┌─────────────────────────┼─────────────────────────────┐   │
│    │                         │                             │   │
│    ▼                         ▼                             ▼   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    │
│  │Analyst       │    │Insight       │    │Report Gen    │    │
│  │Agent         │    │Extractor     │    │Agent         │    │
│  │(Sonnet)      │    │(Opus)        │    │(Haiku)       │    │
│  └──────────────┘    └──────────────┘    └──────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 エージェント一覧

| エージェント | 役割 | 推奨モデル | 学習有効 |
|------------|------|-----------|---------|
| Coordinator | 全体オーケストレーション | Sonnet | ✓ |
| Query Generator | SQL/GA4クエリ生成 | Sonnet | ✓ |
| Data Fetcher | MCP経由データ取得 | Haiku | - |
| Validator | データ/クエリ検証 | Haiku | - |
| Analyst | 統計分析・トレンド検出 | Sonnet | ✓ |
| Insight Extractor | 高度な洞察抽出 | Opus | ✓ |
| Report Generator | レポート生成 | Haiku | - |

---

## 2. Coordinator Agent

### 2.1 役割

- 分析リクエストの解釈
- サブタスクへの分解
- エージェント間のタスク分配
- 結果の集約・整合性確認

### 2.2 定義

```typescript
const coordinatorAgent: AgentDefinition = {
  name: 'coordinator',
  description: '分析リクエストを解釈し、適切なエージェントにタスクを分配する',

  systemPrompt: `あなたは分析オーケストレーションの専門家です。
ユーザーの分析リクエストを受け取り、以下を行います：

1. リクエストの解釈
   - 何を分析したいのか
   - どのデータソースが必要か（BigQuery/GA4）
   - どの期間のデータが必要か
   - 求められる出力形式

2. タスク分解
   - 必要なクエリの特定
   - 分析ステップの設計
   - 洞察抽出の要否判断

3. エージェント調整
   - Query Generator: クエリ生成
   - Data Fetcher: データ取得
   - Analyst: 分析実行
   - Insight Extractor: 高度な洞察（必要な場合のみ）
   - Report Generator: レポート生成

4. 結果集約
   - 各エージェントの結果を統合
   - 整合性の確認
   - 最終レポートの構成`,

  tools: ['dispatch_agent', 'aggregate_results', 'validate_output'],

  preferredModel: 'claude-3-5-sonnet',

  learningConfig: {
    enabled: true,
    patterns: ['task_decomposition', 'agent_routing', 'result_aggregation'],
  },
};
```

### 2.3 ディスパッチロジック

```typescript
interface DispatchDecision {
  agent: string;
  task: string;
  priority: 'high' | 'normal' | 'low';
  dependencies: string[];
  estimatedComplexity: number;
}

class CoordinatorDispatcher {
  async dispatch(request: AnalysisRequest): Promise<ExecutionPlan> {
    const intent = await this.parseIntent(request);
    const tasks = await this.decomposeTasks(intent);
    const plan = this.createExecutionPlan(tasks);

    return plan;
  }

  private async parseIntent(request: AnalysisRequest): Promise<AnalysisIntent> {
    // リクエストから意図を抽出
    return {
      type: 'comparison' | 'trend' | 'breakdown' | 'prediction' | 'exploration',
      dataSources: ['bigquery', 'ga4'],
      metrics: ['revenue', 'sessions', 'conversions'],
      dimensions: ['date', 'campaign', 'channel'],
      dateRange: { start: '2026-01-01', end: '2026-01-31' },
      outputFormat: 'detailed_report',
    };
  }

  private async decomposeTasks(intent: AnalysisIntent): Promise<Task[]> {
    const tasks: Task[] = [];

    // クエリ生成タスク
    for (const source of intent.dataSources) {
      tasks.push({
        id: `query_${source}`,
        agent: 'query-generator',
        input: { source, metrics: intent.metrics, dimensions: intent.dimensions },
        dependencies: [],
      });
    }

    // データ取得タスク
    for (const source of intent.dataSources) {
      tasks.push({
        id: `fetch_${source}`,
        agent: 'data-fetcher',
        input: { source },
        dependencies: [`query_${source}`],
      });
    }

    // 分析タスク
    tasks.push({
      id: 'analyze',
      agent: 'analyst',
      input: { type: intent.type },
      dependencies: intent.dataSources.map((s) => `fetch_${s}`),
    });

    // 洞察抽出（複雑な分析の場合のみ）
    if (this.requiresDeepInsight(intent)) {
      tasks.push({
        id: 'insight',
        agent: 'insight-extractor',
        input: {},
        dependencies: ['analyze'],
      });
    }

    // レポート生成
    tasks.push({
      id: 'report',
      agent: 'report-generator',
      input: { format: intent.outputFormat },
      dependencies: this.requiresDeepInsight(intent) ? ['insight'] : ['analyze'],
    });

    return tasks;
  }

  private requiresDeepInsight(intent: AnalysisIntent): boolean {
    return (
      intent.type === 'prediction' ||
      intent.outputFormat === 'detailed_report' ||
      intent.metrics.length > 5
    );
  }
}
```

---

## 3. Query Generator Agent

### 3.1 役割

- BigQuery SQLクエリの生成
- GA4 APIリクエストの構築
- クエリの最適化（コスト削減）

### 3.2 定義

```typescript
const queryGeneratorAgent: AgentDefinition = {
  name: 'query-generator',
  description: 'BigQuery/GA4用の最適なクエリを生成する',

  systemPrompt: `あなたはデータクエリの専門家です。
BigQueryとGA4に対する最適なクエリを生成します。

## BigQuery クエリ生成ルール
1. 必要なカラムのみSELECT（SELECT * 禁止）
2. パーティションフィルター必須（event_dateなど）
3. クラスタリングカラムを活用
4. 適切な集計関数の使用
5. コメントでクエリの意図を説明

## GA4 クエリ生成ルール
1. 適切なディメンション・メトリクスの選択
2. 日付範囲の指定
3. 必要に応じたフィルター設定
4. サンプリングを避けるためのリミット設定

## コスト最適化
- スキャンデータ量を最小化
- 不要なJOINを避ける
- サブクエリの効率化`,

  tools: ['bigquery_schema', 'ga4_metadata', 'query_cost_estimate'],

  preferredModel: 'claude-3-5-sonnet',

  learningConfig: {
    enabled: true,
    patterns: ['query_optimization', 'schema_understanding'],
  },
};
```

### 3.3 クエリ生成例

```typescript
class QueryGenerator {
  async generateBigQuerySQL(spec: QuerySpec): Promise<string> {
    // スキーマ取得
    const schema = await this.mcpClient.call('bigquery', 'describe_table', {
      table_name: spec.table,
    });

    // クエリ生成
    const query = await this.llmClient.generate({
      prompt: this.buildPrompt(spec, schema),
      model: 'claude-3-5-sonnet',
    });

    // コスト見積もり
    const estimate = await this.mcpClient.call('bigquery', 'execute_sql', {
      query,
      dry_run: true,
    });

    // 高コストの場合は最適化を試みる
    if (estimate.bytes_processed > 1e10) {
      // 10GB超
      return this.optimizeQuery(query, spec, schema);
    }

    return query;
  }

  async generateGA4Request(spec: QuerySpec): Promise<GA4Request> {
    const dimensions = await this.mcpClient.call('ga4', 'list_dimensions', {});
    const metrics = await this.mcpClient.call('ga4', 'list_metrics', {});

    // 適切なディメンション・メトリクスを選択
    const request = await this.llmClient.generate({
      prompt: this.buildGA4Prompt(spec, dimensions, metrics),
      model: 'claude-3-5-sonnet',
    });

    return JSON.parse(request);
  }
}
```

---

## 4. Data Fetcher Agent

### 4.1 役割

- MCPサーバー経由でのデータ取得
- データの基本的な前処理
- エラーハンドリング

### 4.2 定義

```typescript
const dataFetcherAgent: AgentDefinition = {
  name: 'data-fetcher',
  description: 'MCP経由でBigQuery/GA4からデータを取得する',

  systemPrompt: `あなたはデータ取得の専門家です。
MCPサーバーを通じてデータを安全に取得します。

## 取得手順
1. クエリ/リクエストの受け取り
2. MCPサーバーへの接続
3. データ取得の実行
4. 結果の検証（行数、カラム確認）
5. 基本的な前処理（null処理、型変換）

## エラーハンドリング
- タイムアウト: リトライ（最大3回）
- クォータ超過: 待機後リトライ
- 権限エラー: エラーレポート

## データ検証
- 期待される行数との比較
- 必須カラムの存在確認
- データ型の確認`,

  tools: ['mcp_bigquery_execute', 'mcp_ga4_fetch', 'mask_data'],

  preferredModel: 'claude-3-5-haiku',

  learningConfig: {
    enabled: false, // シンプルなタスクのため学習不要
  },
};
```

---

## 5. Analyst Agent

### 5.1 役割

- 統計分析の実行
- トレンド検出
- 比較分析
- 異常値検出

### 5.2 定義

```typescript
const analystAgent: AgentDefinition = {
  name: 'analyst',
  description: '取得したデータに対して統計分析を実行する',

  systemPrompt: `あなたはデータ分析の専門家です。
取得したデータに対して適切な分析を実行します。

## 分析タイプ
1. 比較分析
   - 期間比較（前月比、前年比）
   - セグメント比較（チャネル別、デバイス別）
   - 目標達成度

2. トレンド分析
   - 時系列トレンド
   - 季節性検出
   - 成長率計算

3. 内訳分析
   - 構成比
   - パレート分析
   - クロス分析

4. 異常検出
   - 外れ値検出
   - 急激な変化の検出
   - パターン逸脱

## 出力形式
- 定量的な分析結果
- 統計的な有意性（該当する場合）
- 可視化用のデータ構造`,

  tools: ['statistical_analysis', 'trend_detection', 'anomaly_detection'],

  preferredModel: 'claude-3-5-sonnet',

  learningConfig: {
    enabled: true,
    patterns: ['analysis_methodology', 'insight_generation'],
  },
};
```

### 5.3 分析ロジック

```typescript
class Analyst {
  async analyze(data: AnalysisData, type: AnalysisType): Promise<AnalysisResult> {
    switch (type) {
      case 'comparison':
        return this.performComparison(data);
      case 'trend':
        return this.detectTrends(data);
      case 'breakdown':
        return this.analyzeBreakdown(data);
      case 'anomaly':
        return this.detectAnomalies(data);
      default:
        return this.performGeneralAnalysis(data);
    }
  }

  private async performComparison(data: AnalysisData): Promise<ComparisonResult> {
    const prompt = `
以下のデータを比較分析してください：

現在期間データ:
${JSON.stringify(data.current, null, 2)}

比較期間データ:
${JSON.stringify(data.previous, null, 2)}

以下を含めてください：
1. 各メトリクスの変化率
2. 統計的有意性（サンプルサイズが十分な場合）
3. 変化の要因の推測
4. 注目すべきポイント
`;

    return await this.llmClient.analyze(prompt);
  }

  private async detectTrends(data: AnalysisData): Promise<TrendResult> {
    // 時系列データの分析
    const timeSeriesPrompt = `
以下の時系列データからトレンドを検出してください：

${JSON.stringify(data.timeSeries, null, 2)}

以下を特定してください：
1. 全体的なトレンド方向（上昇/下降/横ばい）
2. トレンドの強さ
3. 季節性パターン
4. 変曲点
5. 予測（短期）
`;

    return await this.llmClient.analyze(timeSeriesPrompt);
  }
}
```

---

## 6. Insight Extractor Agent

### 6.1 役割

- 高度な洞察の抽出
- ビジネスインパクトの評価
- 戦略的提案の生成

### 6.2 定義

```typescript
const insightExtractorAgent: AgentDefinition = {
  name: 'insight-extractor',
  description: '分析結果から高度な洞察とアクショナブルな提案を抽出する',

  systemPrompt: `あなたは広告・マーケティング分析の専門家です。
分析結果から深い洞察とビジネス価値のある提案を生成します。

## 洞察抽出の観点
1. パフォーマンス評価
   - KPI達成度
   - ベンチマーク比較
   - ROI/ROAS分析

2. 要因分析
   - 成功/失敗の要因特定
   - 外部要因の影響
   - 内部施策の効果

3. 機会特定
   - 成長機会
   - 改善ポイント
   - 未活用リソース

4. リスク評価
   - パフォーマンス低下リスク
   - 市場変化への脆弱性
   - 競合脅威

## 提案生成
- 優先度付きアクションアイテム
- 期待される効果（定量的）
- 実装の難易度
- 必要なリソース`,

  tools: ['insight_synthesis', 'recommendation_engine'],

  preferredModel: 'claude-opus-4-5', // 高度な推論が必要

  learningConfig: {
    enabled: true,
    patterns: ['insight_patterns', 'recommendation_effectiveness'],
  },
};
```

---

## 7. Report Generator Agent

### 7.1 役割

- レポートの構造化
- マークダウン/HTML生成
- チャート仕様の生成

### 7.2 定義

```typescript
const reportGeneratorAgent: AgentDefinition = {
  name: 'report-generator',
  description: '分析結果を整形されたレポートに変換する',

  systemPrompt: `あなたはレポート作成の専門家です。
分析結果を読みやすく、アクショナブルなレポートに変換します。

## レポート構成
1. エグゼクティブサマリー
   - 主要な発見（3点以内）
   - 重要なKPI
   - 推奨アクション

2. 詳細分析
   - データの概要
   - 分析結果
   - 可視化

3. インサイトと提案
   - 発見された洞察
   - 具体的な提案
   - 期待効果

4. 補足情報
   - データソース
   - 分析期間
   - 注意事項

## フォーマット
- マークダウン形式
- 適切な見出し階層
- 表とリストの活用
- チャート仕様（JSON）`,

  tools: ['markdown_generator', 'chart_spec_generator'],

  preferredModel: 'claude-3-5-haiku',

  learningConfig: {
    enabled: false,
  },
};
```

---

## 8. エージェント間通信

### 8.1 メッセージ形式

```typescript
interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: 'task' | 'result' | 'error' | 'status';
  payload: {
    taskId?: string;
    input?: unknown;
    output?: unknown;
    error?: string;
    status?: 'pending' | 'running' | 'completed' | 'failed';
  };
  timestamp: Date;
}
```

### 8.2 実行フロー例

```
User Request: "先月の広告パフォーマンスを分析して、改善点を教えて"

┌─────────────┐
│ Coordinator │
└──────┬──────┘
       │ 1. リクエスト解析
       │ 2. タスク分解
       ▼
┌─────────────┐     ┌─────────────┐
│Query Gen    │────▶│Data Fetcher │
│(BigQuery)   │     │(Execute)    │
└─────────────┘     └──────┬──────┘
                           │
       ┌───────────────────┘
       ▼
┌─────────────┐     ┌─────────────┐
│  Analyst    │────▶│  Insight    │
│             │     │  Extractor  │
└─────────────┘     └──────┬──────┘
                           │
       ┌───────────────────┘
       ▼
┌─────────────┐     ┌─────────────┐
│Report Gen   │────▶│ Final       │
│             │     │ Response    │
└─────────────┘     └─────────────┘
```
