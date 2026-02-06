import { query, type SDKMessage, type Options } from "@anthropic-ai/claude-agent-sdk";
import { type Config, buildMcpServersConfig, SYSTEM_PROMPT } from "./config.js";

export type MessageHandler = (message: SDKMessage) => void;

export interface RunAgentOptions {
  config: Config;
  prompt: string;
  onMessage?: MessageHandler;
}

export async function runAgent({ config, prompt, onMessage }: RunAgentOptions) {
  const mcpServers = buildMcpServersConfig(config);

  const allowedTools = [
    "mcp__bigquery__*",
    ...(config.ga4PropertyId ? ["mcp__ga4__*"] : []),
  ];

  const options: Options = {
    model: config.model,
    mcpServers,
    allowedTools,
    systemPrompt: SYSTEM_PROMPT,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: 30,
  };

  const conversation = query({ prompt, options });

  let resultText = "";

  for await (const message of conversation) {
    if (onMessage) {
      onMessage(message);
    }

    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          resultText = block.text;
        }
      }
    }

    if (message.type === "result") {
      if (message.subtype === "success") {
        return {
          success: true as const,
          result: message.result,
          cost: message.total_cost_usd,
          turns: message.num_turns,
        };
      } else {
        return {
          success: false as const,
          error: message.subtype,
          errors: "errors" in message ? message.errors : [],
          cost: message.total_cost_usd,
          turns: message.num_turns,
        };
      }
    }
  }

  return {
    success: true as const,
    result: resultText,
    cost: 0,
    turns: 0,
  };
}
