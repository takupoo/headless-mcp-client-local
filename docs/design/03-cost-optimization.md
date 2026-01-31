# コスト最適化設計書

## 1. コスト構造

### 1.1 コスト要素

```
┌─────────────────────────────────────────────────────────────┐
│                     総運用コスト                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │   LLM API       │  │   BigQuery      │  │ インフラ     │ │
│  │   コスト        │  │   コスト        │  │ コスト       │ │
│  │   (変動費)      │  │   (変動費)      │  │ (固定費)    │ │
│  │                 │  │                 │  │             │ │
│  │  約70%          │  │  約20%          │  │ 約10%       │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 LLM API 料金表（2026年1月時点）

| モデル | 入力 ($/1M tokens) | 出力 ($/1M tokens) | 特徴 |
|--------|-------------------|-------------------|------|
| Claude Opus 4.5 | $15.00 | $75.00 | 最高精度、複雑な推論 |
| Claude Sonnet 3.5 | $3.00 | $15.00 | バランス型 |
| Claude Haiku 3.5 | $0.25 | $1.25 | 高速・低コスト |
| Gemini 1.5 Flash | $0.00 (Free Tier) | $0.00 | シンプルタスク |
| Gemini 1.5 Pro | $1.25 | $5.00 | 大規模コンテキスト |

### 1.3 BigQuery 料金

| 項目 | 料金 | 備考 |
|------|------|------|
| クエリ処理 | $5.00/TB | オンデマンド |
| ストレージ | $0.02/GB/月 | アクティブ |
| ストリーミング挿入 | $0.01/200MB | 該当なし |

---

## 2. Multi-Model Router 最適化

### 2.1 ルーティング戦略

```typescript
interface RoutingStrategy {
  // タスク複雑性に基づくルーティング
  complexityBasedRouting: {
    tiers: {
      simple: {
        range: [0.0, 0.3];
        primaryModel: 'gemini-1.5-flash';
        fallbackModel: 'claude-3-5-haiku';
        expectedCost: '$0.00';
        useCases: [
          'データフォーマット変換',
          'シンプルな集計クエリ生成',
          'レポートテンプレート適用',
        ];
      };
      moderate: {
        range: [0.3, 0.6];
        primaryModel: 'claude-3-5-haiku';
        fallbackModel: 'claude-3-5-sonnet';
        expectedCost: '$0.25-0.50/request';
        useCases: [
          '基本的なSQL生成',
          'データサマリー作成',
          'シンプルなトレンド分析',
        ];
      };
      complex: {
        range: [0.6, 0.8];
        primaryModel: 'claude-3-5-sonnet';
        fallbackModel: 'claude-opus-4-5';
        expectedCost: '$1-3/request';
        useCases: [
          '複合条件のSQL生成',
          'クロスデータソース分析',
          '詳細なトレンド解析',
        ];
      };
      expert: {
        range: [0.8, 1.0];
        primaryModel: 'claude-opus-4-5';
        fallbackModel: null;
        expectedCost: '$5-15/request';
        useCases: [
          '高度な洞察抽出',
          '予測分析・予測モデリング',
          '戦略的提案の生成',
        ];
      };
    };
  };
}
```

### 2.2 複雑性判定ロジック

```typescript
class ComplexityAnalyzer {
  private weights = {
    dataSourceCount: 0.15,
    dateRangeLength: 0.10,
    aggregationCount: 0.10,
    filterComplexity: 0.10,
    joinRequirement: 0.15,
    predictionRequired: 0.20,
    insightDepth: 0.10,
    outputComplexity: 0.10,
  };

  analyze(task: AnalysisTask): ComplexityScore {
    let score = 0;

    // データソース数
    score += Math.min(task.dataSources.length * 0.05, this.weights.dataSourceCount);

    // 日付範囲（長いほど複雑）
    const days = task.dateRange.days;
    if (days > 365) score += this.weights.dateRangeLength;
    else if (days > 90) score += this.weights.dateRangeLength * 0.7;
    else if (days > 30) score += this.weights.dateRangeLength * 0.4;

    // 集計の複雑性
    score += Math.min(task.aggregations.length * 0.02, this.weights.aggregationCount);

    // フィルター条件
    score += Math.min(task.filters.length * 0.02, this.weights.filterComplexity);

    // JOIN要件
    if (task.requiresJoin) score += this.weights.joinRequirement;

    // 予測要件
    if (task.requiresPrediction) score += this.weights.predictionRequired;

    // 洞察の深さ（0-1）
    score += task.insightDepth * this.weights.insightDepth;

    // 出力の複雑性
    if (task.outputFormat === 'detailed_report') {
      score += this.weights.outputComplexity;
    }

    return {
      score: Math.min(score, 1.0),
      tier: this.getTier(score),
      recommendedModel: this.getRecommendedModel(score),
    };
  }

  private getTier(score: number): string {
    if (score < 0.3) return 'simple';
    if (score < 0.6) return 'moderate';
    if (score < 0.8) return 'complex';
    return 'expert';
  }

  private getRecommendedModel(score: number): string {
    const tier = this.getTier(score);
    const models = {
      simple: 'gemini-1.5-flash',
      moderate: 'claude-3-5-haiku',
      complex: 'claude-3-5-sonnet',
      expert: 'claude-opus-4-5',
    };
    return models[tier];
  }
}
```

### 2.3 コスト試算シミュレーション

```typescript
interface CostSimulation {
  scenario: 'light' | 'standard' | 'heavy';

  // ライトユース（週数回の分析）
  light: {
    monthlyRequests: {
      simple: 50;
      moderate: 30;
      complex: 10;
      expert: 2;
    };
    estimatedCost: {
      withRouter: '$50-80';
      withoutRouter: '$800-1,200';
      savings: '93%';
    };
  };

  // スタンダード（日次分析）
  standard: {
    monthlyRequests: {
      simple: 300;
      moderate: 150;
      complex: 50;
      expert: 10;
    };
    estimatedCost: {
      withRouter: '$200-400';
      withoutRouter: '$5,000-8,000';
      savings: '95%';
    };
  };

  // ヘビーユース（高頻度分析）
  heavy: {
    monthlyRequests: {
      simple: 1000;
      moderate: 500;
      complex: 200;
      expert: 50;
    };
    estimatedCost: {
      withRouter: '$800-1,600';
      withoutRouter: '$25,000-40,000';
      savings: '96%';
    };
  };
}
```

---

## 3. SONA による効率化

### 3.1 学習によるトークン削減

```typescript
interface SONAOptimization {
  // クエリパターン学習
  queryPatternLearning: {
    description: '過去の成功クエリパターンを学習し、再利用';
    tokenReduction: '20-30%';
    mechanism: {
      // 類似リクエストの検出
      similarityThreshold: 0.85;
      // パターンキャッシュ
      patternCache: {
        size: 1000;
        ttl: '7d';
      };
    };
  };

  // プロンプト最適化
  promptOptimization: {
    description: '効果的なプロンプトパターンを学習';
    tokenReduction: '15-25%';
    mechanism: {
      // 冗長性の除去
      redundancyRemoval: true;
      // コンテキスト圧縮
      contextCompression: true;
    };
  };

  // 結果キャッシュ
  resultCaching: {
    description: '同一/類似クエリの結果をキャッシュ';
    apiCallReduction: '30-50%';
    mechanism: {
      // セマンティックキャッシュ
      semanticSimilarity: 0.95;
      cacheTTL: '1h';
    };
  };
}
```

### 3.2 GNN クエリ最適化

```typescript
interface GNNQueryOptimization {
  // クエリ精度向上
  recallImprovement: '+12.4%';

  // 不要なデータ取得の削減
  dataFetchReduction: {
    // より正確なフィルター条件
    filterPrecision: '+15%';
    // 必要カラムの特定精度
    columnSelectionAccuracy: '+20%';
  };

  // BigQueryコスト削減効果
  bigqueryCostReduction: {
    // スキャンデータ量の削減
    scanReduction: '20-40%';
    estimatedSavings: '20-40%';
  };
}
```

---

## 4. BigQuery コスト最適化

### 4.1 クエリ最適化

```typescript
interface BigQueryOptimization {
  // パーティショニング活用
  partitioning: {
    strategy: 'DATE partitioning on event_date';
    costReduction: '50-90%';
  };

  // クラスタリング活用
  clustering: {
    columns: ['campaign_id', 'ad_group_id'];
    costReduction: '20-40%';
  };

  // カラム選択の最適化
  columnSelection: {
    strategy: 'SELECT only required columns, avoid SELECT *';
    costReduction: '30-70%';
  };

  // 結果キャッシュ
  queryCache: {
    enabled: true;
    ttl: '24h';
    costReduction: '100% for cached queries';
  };
}
```

### 4.2 クエリパターンガイドライン

```sql
-- 悪い例: 全カラム取得、パーティションフィルターなし
SELECT *
FROM `project.dataset.events`
WHERE event_name = 'purchase';

-- 良い例: 必要カラムのみ、パーティションフィルター、クラスタリング活用
SELECT
  event_date,
  campaign_id,
  SUM(revenue) as total_revenue
FROM `project.dataset.events`
WHERE
  event_date BETWEEN '2026-01-01' AND '2026-01-31'  -- パーティションフィルター
  AND campaign_id IN (123, 456)  -- クラスタリング活用
  AND event_name = 'purchase'
GROUP BY event_date, campaign_id;
```

---

## 5. 予算管理

### 5.1 予算アラート設定

```typescript
interface BudgetConfig {
  // 月次予算
  monthlyBudget: {
    llmApi: 500;      // USD
    bigquery: 100;    // USD
    infrastructure: 50; // USD
    total: 650;       // USD
  };

  // アラート閾値
  alerts: {
    warning: 0.7;    // 70%で警告
    critical: 0.9;   // 90%でクリティカル
    hardLimit: 1.0;  // 100%で停止
  };

  // アクション
  actions: {
    warning: ['slack_notification'];
    critical: ['slack_notification', 'email_alert', 'reduce_expert_usage'];
    hardLimit: ['slack_notification', 'email_alert', 'pause_service'];
  };
}
```

### 5.2 コスト追跡

```typescript
interface CostTracking {
  // リアルタイム追跡
  realtime: {
    // トークン使用量
    tokenUsage: {
      byModel: Map<string, { input: number; output: number }>;
      bySession: Map<string, { input: number; output: number }>;
    };

    // 概算コスト
    estimatedCost: {
      llmApi: number;
      bigquery: number;
      total: number;
    };
  };

  // 日次集計
  daily: {
    date: string;
    requests: number;
    tokens: { input: number; output: number };
    cost: {
      llmApi: number;
      bigquery: number;
      total: number;
    };
    breakdown: {
      byModel: Record<string, number>;
      byAgent: Record<string, number>;
    };
  };
}
```

---

## 6. コスト削減施策サマリー

| 施策 | 削減効果 | 実装難易度 | 優先度 |
|------|---------|-----------|--------|
| Multi-Model Router | 60-95% | 中 | 最高 |
| SONA学習 | 20-30% | 低（自動） | 高 |
| クエリキャッシュ | 30-50% | 低 | 高 |
| BigQueryパーティション | 50-90% | 中 | 高 |
| プロンプト最適化 | 15-25% | 中 | 中 |
| 結果圧縮 | 10-20% | 低 | 低 |

### 期待される総コスト削減

```
┌─────────────────────────────────────────────────────────────┐
│                    コスト削減効果                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  従来方式（Opus固定）    Multi-Model Router適用後            │
│  ┌───────────────────┐  ┌───────────────────┐              │
│  │                   │  │ ████              │              │
│  │ ██████████████████│  │ ████              │              │
│  │ ██████████████████│  │ ████              │              │
│  │ ██████████████████│  │ ████              │              │
│  │ ██████████████████│  │ ████              │              │
│  │     $10,000/月    │  │    $800/月        │              │
│  └───────────────────┘  └───────────────────┘              │
│                                                              │
│                    削減率: 92%                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```
