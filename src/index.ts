import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "./config.js";
import { runAgent, type MessageHandler } from "./agent.js";

const BANNER = `
╔══════════════════════════════════════════════╗
║  Headless MCP Client - Data Analysis Agent   ║
║  BigQuery / GA4 自律分析エージェント           ║
╚══════════════════════════════════════════════╝
`;

function createMessageHandler(): MessageHandler {
  return (message) => {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          console.log(`[init] model=${message.model}, tools=${message.tools.length}`);
          if (message.mcp_servers.length > 0) {
            console.log(
              `[mcp] servers: ${message.mcp_servers.map((s) => `${s.name}(${s.status})`).join(", ")}`
            );
          }
        }
        break;
      case "assistant":
        for (const block of message.message.content) {
          if (block.type === "text") {
            process.stdout.write(block.text);
          } else if (block.type === "tool_use") {
            console.log(`\n[tool] ${block.name}`);
          }
        }
        break;
      case "result":
        console.log(`\n[done] cost=$${message.total_cost_usd.toFixed(4)}, turns=${message.num_turns}`);
        break;
    }
  };
}

async function main() {
  console.log(BANNER);

  let config;
  try {
    config = loadConfig();
    console.log("設定を読み込みました。");
    console.log(`  GCP Project: ${config.gcpProjectId}`);
    console.log(`  GA4 Property: ${config.ga4PropertyId || "(未設定)"}`);
    console.log(`  Model: ${config.model}`);
    console.log();
  } catch (error) {
    if (error instanceof Error) {
      console.error(`設定エラー: ${error.message}`);
    }
    console.error("必要な環境変数を .env ファイルに設定してください。");
    console.error("  ANTHROPIC_API_KEY, GCP_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS");
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });
  const onMessage = createMessageHandler();

  console.log('分析したい内容を入力してください。("exit" で終了)\n');

  while (true) {
    const prompt = await rl.question("you> ");

    if (!prompt.trim()) continue;
    if (prompt.trim().toLowerCase() === "exit") {
      console.log("終了します。");
      break;
    }

    console.log();

    try {
      const result = await runAgent({ config, prompt, onMessage });

      if (!result.success) {
        console.error(`\n[error] ${result.error}`);
        if (result.errors.length > 0) {
          result.errors.forEach((e) => console.error(`  - ${e}`));
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`\nエラー: ${error.message}`);
      } else {
        console.error("\n予期しないエラーが発生しました。");
      }
    }

    console.log();
  }

  rl.close();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
