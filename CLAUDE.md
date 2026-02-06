# Headless MCP Client - 実装計画

## 概要

BigQuery/GA4のデータをMCP経由で取得し、AIエージェントが自律的に分析するシステム。

## 技術調査結果

### 依存パッケージの実在性

| パッケージ | 状態 | 備考 |
|-----------|------|------|
| `agentic-flow` (v2.0.6) | 存在する | ReasoningBank, Router エクスポートあり。MCP Client機能は内部で claude-agent-sdk に委譲 |
| `@anthropic-ai/claude-agent-sdk` (v0.2.34) | 存在する | `query()` が外部stdio MCPサーバー接続をネイティブサポート |
| `@modelcontextprotocol/sdk` (v1.26.0) | 存在する | 今回は不要（claude-agent-sdkが内部処理） |
| `@google/mcp-toolbox` | **存在しない** | 設計書の記載は誤り |
| `@google/ga4-mcp-server` | **存在しない** | 設計書の記載は誤り |

### 実際に使用するMCPサーバー

| サーバー | コマンド | 提供ツール |
|---------|---------|-----------|
| BigQuery (Google genai-toolbox v0.26.0) | `./toolbox --prebuilt bigquery --stdio` | `execute_sql`, `list_dataset_ids`, `list_table_ids`, `get_table_info`, `get_dataset_info`, `search_catalog`, `forecast`, `ask_data_insights`, `analyze_contribution` |
| GA4 (Google analytics-mcp) | `pipx run analytics-mcp` | `run_report`, `run_realtime_report`, `get_account_summaries`, `get_property_details`, `list_google_ads_links`, `get_custom_dimensions_and_metrics` |

### agentic-flowの実態

- 内部で `@anthropic-ai/claude-agent-sdk` の `query()` に `mcpServers` オプションを渡している
- claude-agent-sdk がMCPサーバーのsubprocess spawn + stdio JSON-RPC通信を自動処理
- エクスポート: `agentic-flow/reasoningbank`, `agentic-flow/router`, `agentic-flow/agent-booster`
- `AgenticFlowConfig` 型は存在しない（設計書の記載は誤り）

## アーキテクチャ

```
src/index.ts (CLI REPL)
    |
    v
src/agent.ts
    |  claude-agent-sdk の query() を呼び出し
    |  - mcpServers: { bigquery: stdio, ga4: stdio }
    |  - allowedTools: ["mcp__bigquery__*", "mcp__ga4__*"]
    |  - systemPrompt: 分析エージェント用プロンプト
    |
    |  query() が内部で自動的に:
    |  - toolbox プロセスを spawn -> stdio で MCP 通信
    |  - analytics-mcp プロセスを spawn -> stdio で MCP 通信
    |  - Claude API の tool_use loop を実行
    |
    v
src/config.ts (設定管理)
    - MCPサーバー設定
    - 環境変数読み込み
    - モデル設定
```

## 依存パッケージ

- `@anthropic-ai/claude-agent-sdk` - MCPクライアント + Claudeエージェントループ
- `agentic-flow` - ReasoningBank / Router (後続で活用)
- `dotenv` - 環境変数
- `zod` - バリデーション
- devDeps: `typescript`, `@types/node`, `tsx`

## 環境変数

- `ANTHROPIC_API_KEY` - Claude API キー (必須)
- `GCP_PROJECT_ID` - GCPプロジェクトID (必須)
- `GOOGLE_APPLICATION_CREDENTIALS` - GCP認証JSONパス (必須)
- `TOOLBOX_PATH` - toolboxバイナリのパス (デフォルト: `./toolbox`)
- `GA4_PROPERTY_ID` - GA4プロパティID (オプション)

## 前提ツールのセットアップ

```bash
# toolbox バイナリ (macOS ARM)
curl -O https://storage.googleapis.com/genai-toolbox/v0.26.0/darwin/arm64/toolbox
chmod +x toolbox

# pipx + analytics-mcp
brew install pipx && pipx ensurepath
pipx install analytics-mcp

# GCP認証
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/bigquery,https://www.googleapis.com/auth/analytics.readonly
```

## 方針

- マスキングはしない
- agentic-flow を依存に含める
- まず動くものを作り、Router/ReasoningBank は後から統合
