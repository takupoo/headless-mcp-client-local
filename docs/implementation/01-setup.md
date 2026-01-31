# 環境セットアップ手順

## 1. 前提条件

### 1.1 必要なソフトウェア

| ソフトウェア | バージョン | 用途 |
|------------|-----------|------|
| Node.js | 18.x 以上 | ランタイム |
| npm | 9.x 以上 | パッケージ管理 |
| Git | 2.x 以上 | バージョン管理 |
| gcloud CLI | 最新 | GCP認証・設定 |

### 1.2 GCPリソース

| リソース | 必要な権限 |
|---------|-----------|
| BigQuery | `bigquery.dataViewer`, `bigquery.jobUser` |
| GA4 Property | `analytics.viewer` |
| Secret Manager | `secretmanager.secretAccessor` |

### 1.3 APIキー

| サービス | 取得方法 |
|---------|---------|
| Anthropic API | https://console.anthropic.com |
| (オプション) Gemini API | https://ai.google.dev |

---

## 2. プロジェクト初期化

### 2.1 リポジトリのクローン・セットアップ

```bash
# プロジェクトディレクトリ作成
mkdir bigquery-ga4-analyzer
cd bigquery-ga4-analyzer

# package.json の初期化
npm init -y

# TypeScript設定
npm install -D typescript @types/node ts-node
npx tsc --init
```

### 2.2 agentic-flow のインストール

```bash
# agentic-flow パッケージのインストール
npm install agentic-flow

# Claude Agent SDK
npm install @anthropic-ai/claude-agent-sdk

# 依存パッケージ
npm install zod dotenv
```

### 2.3 MCP関連パッケージ

```bash
# MCP Toolbox for BigQuery
npm install @google/mcp-toolbox

# GA4 MCP Server
npm install @google/ga4-mcp-server

# MCP SDK
npm install @modelcontextprotocol/sdk
```

---

## 3. GCP認証設定

### 3.1 サービスアカウントの作成

```bash
# プロジェクトIDの設定
export PROJECT_ID="your-gcp-project-id"

# サービスアカウント作成
gcloud iam service-accounts create bigquery-ga4-analyzer \
  --display-name="BigQuery GA4 Analyzer" \
  --project=${PROJECT_ID}

# サービスアカウントのメールアドレス
export SA_EMAIL="bigquery-ga4-analyzer@${PROJECT_ID}.iam.gserviceaccount.com"
```

### 3.2 権限の付与

```bash
# BigQuery権限
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/bigquery.dataViewer"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/bigquery.jobUser"

# Secret Manager権限（APIキー取得用）
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

### 3.3 GA4プロパティへのアクセス権付与

GA4管理画面で以下を設定:

1. GA4管理 → プロパティ → アクセス管理
2. 「+」→ ユーザーを追加
3. サービスアカウントのメールアドレスを入力
4. 「閲覧者」ロールを付与

### 3.4 サービスアカウントキーの生成・保存

```bash
# キーの生成
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=${SA_EMAIL}

# Secret Managerに保存（推奨）
gcloud secrets create bigquery-ga4-sa-key \
  --data-file=sa-key.json \
  --project=${PROJECT_ID}

# ローカルキーは削除
rm sa-key.json
```

---

## 4. 環境変数の設定

### 4.1 .env ファイルの作成

```bash
# .env
# GCP設定
GCP_PROJECT_ID=your-gcp-project-id
GCP_SA_KEY_SECRET=projects/your-project/secrets/bigquery-ga4-sa-key/versions/latest

# BigQuery設定
BIGQUERY_DATASET=your_dataset
BIGQUERY_LOCATION=asia-northeast1

# GA4設定
GA4_PROPERTY_ID=properties/123456789

# Anthropic API
ANTHROPIC_API_KEY=sk-ant-xxxxx

# オプション: Gemini API（コスト最適化用）
GEMINI_API_KEY=AIzaxxx

# アプリケーション設定
NODE_ENV=development
LOG_LEVEL=info
```

### 4.2 .env.example（コミット用）

```bash
# .env.example
GCP_PROJECT_ID=
GCP_SA_KEY_SECRET=
BIGQUERY_DATASET=
BIGQUERY_LOCATION=
GA4_PROPERTY_ID=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
NODE_ENV=development
LOG_LEVEL=info
```

### 4.3 .gitignore

```gitignore
# .gitignore
node_modules/
.env
*.log
dist/
sa-key.json
*.pem
*.key
```

---

## 5. プロジェクト構造

```
bigquery-ga4-analyzer/
├── package.json
├── tsconfig.json
├── .env
├── .env.example
├── .gitignore
├── config/
│   ├── bigquery-mcp.yaml       # BigQuery MCP設定
│   ├── ga4-mcp.yaml            # GA4 MCP設定
│   └── masking-rules.yaml      # マスキングルール
├── src/
│   ├── index.ts                # エントリーポイント
│   ├── config/
│   │   └── index.ts            # 設定読み込み
│   ├── agents/
│   │   ├── coordinator.ts
│   │   ├── queryGenerator.ts
│   │   ├── dataFetcher.ts
│   │   ├── analyst.ts
│   │   ├── insightExtractor.ts
│   │   └── reportGenerator.ts
│   ├── mcp/
│   │   ├── bigqueryServer.ts
│   │   ├── ga4Server.ts
│   │   └── dataMaskingServer.ts
│   ├── router/
│   │   └── modelRouter.ts
│   ├── learning/
│   │   └── sona.ts
│   └── utils/
│       ├── logger.ts
│       └── masking.ts
├── docs/
│   ├── design/
│   └── implementation/
└── tests/
    ├── agents/
    └── mcp/
```

---

## 6. 初期設定ファイル

### 6.1 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### 6.2 package.json（scripts追加）

```json
{
  "name": "bigquery-ga4-analyzer",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node --esm src/index.ts",
    "test": "jest",
    "lint": "eslint src/**/*.ts"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^1.0.0",
    "@google/mcp-toolbox": "^1.0.0",
    "@google/ga4-mcp-server": "^1.0.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "agentic-flow": "^2.0.0",
    "dotenv": "^16.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.0",
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0"
  }
}
```

---

## 7. 動作確認

### 7.1 GCP認証の確認

```bash
# 認証情報の確認
gcloud auth application-default print-access-token

# BigQueryへの接続テスト
bq query --project_id=${PROJECT_ID} "SELECT 1"
```

### 7.2 Anthropic API の確認

```typescript
// test-anthropic.ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function test() {
  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'Hello!' }],
  });
  console.log('API接続成功:', response.content);
}

test();
```

```bash
# 実行
npx ts-node --esm test-anthropic.ts
```

### 7.3 起動確認

```bash
# 開発モードで起動
npm run dev
```

---

## 8. トラブルシューティング

### 8.1 よくあるエラー

| エラー | 原因 | 解決策 |
|--------|------|--------|
| `PERMISSION_DENIED` | BigQuery権限不足 | IAMロールを確認 |
| `UNAUTHENTICATED` | 認証情報が無効 | サービスアカウントキーを再生成 |
| `QUOTA_EXCEEDED` | APIクォータ超過 | 待機またはクォータ増加申請 |
| `invalid_api_key` | Anthropic APIキー無効 | APIキーを再確認 |

### 8.2 ログの確認

```bash
# 詳細ログを有効化
LOG_LEVEL=debug npm run dev
```

### 8.3 サポート

- agentic-flow: https://github.com/ruvnet/agentic-flow/issues
- MCP Toolbox: https://github.com/googleapis/genai-toolbox/issues
- Claude SDK: https://github.com/anthropics/anthropic-sdk-typescript/issues
