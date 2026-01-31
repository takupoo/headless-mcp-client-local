# BigQuery/GA4 自律分析エージェント

MCPを経由してAIエージェントがBigQueryおよびGA4のデータを自律的・探索的に分析する仕組み。

## 概要

このプロジェクトは、[agentic-flow](https://github.com/ruvnet/agentic-flow)をベースに、BigQueryとGoogle Analytics 4のデータを安全かつ効率的に分析するAIエージェントシステムです。

### 主な特徴

- **🔐 セキュリティ優先**: データマスキング、学習オプトアウトAPI、最小権限の原則
- **🎯 高精度分析**: SONA自己学習、GNNクエリ最適化による+12.4%の精度向上
- **💰 コスト最適化**: Multi-Model Routerによる最大92%のコスト削減
- **🤖 自律的エージェント**: 6種の専門エージェントによる協調分析

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                    agentic-flow v2.0.0-alpha                     │
├─────────────────────────────────────────────────────────────────┤
│  Multi-Model Router (自動コスト最適化)                           │
│  SONA 自己学習エンジン (+55% 品質向上)                           │
│  分析エージェント群 (6種)                                        │
├─────────────────────────────────────────────────────────────────┤
│  MCP Protocol                                                    │
│  ├── BigQuery (MCP Toolbox)                                     │
│  ├── GA4 (Google公式MCP)                                        │
│  └── Data Masking (カスタムMCP)                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 要件

### ソフトウェア

- Node.js 18.x以上
- npm 9.x以上
- gcloud CLI
- Git

### GCPリソース

- BigQueryへのアクセス権（`bigquery.dataViewer`, `bigquery.jobUser`）
- GA4プロパティへの閲覧権限
- Secret Managerへのアクセス権

### APIキー

- Anthropic API Key（必須）
- Gemini API Key（オプション、コスト最適化用）

## クイックスタート

詳細なセットアップ手順は [docs/implementation/01-setup.md](docs/implementation/01-setup.md) を参照してください。

### 1. インストール

```bash
npm install
```

### 2. 環境変数設定

```bash
cp .env.example .env
# .env を編集してAPIキー等を設定
```

### 3. GCP認証

```bash
# サービスアカウント作成
gcloud iam service-accounts create bigquery-ga4-analyzer

# 権限付与
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:bigquery-ga4-analyzer@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer"
```

### 4. 起動

```bash
npm run dev
```

## ドキュメント

### 設計ドキュメント

- [00-overview.md](docs/design/00-overview.md) - プロジェクト概要
- [01-architecture.md](docs/design/01-architecture.md) - システムアーキテクチャ
- [02-security.md](docs/design/02-security.md) - セキュリティ設計
- [03-cost-optimization.md](docs/design/03-cost-optimization.md) - コスト最適化
- [04-mcp-integration.md](docs/design/04-mcp-integration.md) - MCP統合
- [05-analysis-agents.md](docs/design/05-analysis-agents.md) - 分析エージェント

### 実装ドキュメント

- [01-setup.md](docs/implementation/01-setup.md) - 環境セットアップ
- [02-bigquery-mcp.md](docs/implementation/02-bigquery-mcp.md) - BigQuery MCP統合
- [03-ga4-mcp.md](docs/implementation/03-ga4-mcp.md) - GA4 MCP統合
- [04-data-masking.md](docs/implementation/04-data-masking.md) - データマスキング

### 設定サンプル

- [agentic-flow.config.ts](docs/config-samples/agentic-flow.config.ts) - agentic-flow設定
- [mcp-servers.json](docs/config-samples/mcp-servers.json) - MCPサーバー設定
- [masking-rules.yaml](docs/config-samples/masking-rules.yaml) - マスキングルール

## コスト試算

| シナリオ | 従来（Opus固定） | agentic-flow | 削減率 |
|---------|----------------|--------------|--------|
| 軽い分析 1000回/月 | $15,000 | ~$250 | 98% |
| 中程度 200回/月 | $3,000 | ~$600 | 80% |
| 複雑分析 50回/月 | $750 | ~$750 | - |
| **合計** | **$18,750** | **~$1,600** | **91%** |

## セキュリティ

### データ保護

- ✅ Claude API学習オプトアウト
- ✅ センシティブデータの自動マスキング
- ✅ 読み取り専用クエリ制限
- ✅ 監査ログ記録

### マスキング例

**入力:**
```json
{
  "campaign": "summer_sale_2026",
  "cost": "¥1,234,567",
  "client": "ABC株式会社"
}
```

**LLMへの送信（マスキング後）:**
```json
{
  "campaign": "[CAMPAIGN_a1b2]",
  "cost": "[AMOUNT_c3d4]",
  "client": "[CLIENT_e5f6]"
}
```

## ライセンス

MIT License

## 謝辞

- [agentic-flow](https://github.com/ruvnet/agentic-flow) - ベースフレームワーク
- [MCP Toolbox](https://github.com/googleapis/genai-toolbox) - BigQuery MCP
- [Anthropic Claude](https://www.anthropic.com) - LLM API

## 関連リソース

- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [Claude Agent SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [agentic-flow Documentation](https://github.com/ruvnet/agentic-flow/tree/main/docs)
