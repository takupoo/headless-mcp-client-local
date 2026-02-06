import { z } from "zod";
import "dotenv/config";

const ConfigSchema = z.object({
  anthropicApiKey: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  gcpProjectId: z.string().min(1, "GCP_PROJECT_ID is required"),
  googleApplicationCredentials: z
    .string()
    .min(1, "GOOGLE_APPLICATION_CREDENTIALS is required"),
  toolboxPath: z.string().default("./toolbox"),
  ga4PropertyId: z.string().optional(),
  model: z.string().default("claude-sonnet-4-5-20250929"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    gcpProjectId: process.env.GCP_PROJECT_ID,
    googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    toolboxPath: process.env.TOOLBOX_PATH || "./toolbox",
    ga4PropertyId: process.env.GA4_PROPERTY_ID,
    model: process.env.MODEL || "claude-sonnet-4-5-20250929",
  });
}

export function buildMcpServersConfig(config: Config) {
  const servers: Record<
    string,
    { type?: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  > = {
    bigquery: {
      command: config.toolboxPath,
      args: ["--prebuilt", "bigquery", "--stdio"],
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: config.googleApplicationCredentials,
        GCP_PROJECT_ID: config.gcpProjectId,
      },
    },
  };

  if (config.ga4PropertyId) {
    servers.ga4 = {
      command: "pipx",
      args: ["run", "analytics-mcp"],
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: config.googleApplicationCredentials,
        GA4_PROPERTY_ID: config.ga4PropertyId,
      },
    };
  }

  return servers;
}

export const SYSTEM_PROMPT = `あなたはBigQueryとGA4のデータを分析する専門AIエージェントです。

## 利用可能なツール

### BigQuery (mcp__bigquery__*)
- execute_sql: SQLクエリを実行
- list_dataset_ids: データセット一覧を取得
- list_table_ids: テーブル一覧を取得
- get_table_info: テーブルのスキーマ情報を取得
- get_dataset_info: データセットの詳細情報を取得
- search_catalog: データカタログを検索
- forecast: 時系列予測を実行
- ask_data_insights: データインサイトを取得
- analyze_contribution: 要因分析を実行

### GA4 (mcp__ga4__*)
- run_report: レポートを実行
- run_realtime_report: リアルタイムレポートを実行
- get_account_summaries: アカウントサマリーを取得
- get_property_details: プロパティ詳細を取得
- list_google_ads_links: Google Ads連携を一覧
- get_custom_dimensions_and_metrics: カスタムディメンション/メトリクスを取得

## 分析方針
1. まずデータ構造を理解する（スキーマ確認）
2. 適切なクエリを組み立てて実行
3. 結果を解釈し、インサイトを提供
4. 必要に応じて追加分析を提案

日本語で応答してください。`;
