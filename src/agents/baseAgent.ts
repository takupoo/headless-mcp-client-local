/**
 * Base Agent
 *
 * Foundation for all analysis agents
 */

import Anthropic from '@anthropic-ai/sdk';
import { ToolDefinition } from './tools/bigqueryTools.js';
import { logger } from '../utils/logger.js';

export interface AgentConfig {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentResult {
  success: boolean;
  response: string;
  toolCalls?: Array<{
    name: string;
    input: any;
    result: any;
  }>;
  tokensUsed?: {
    input: number;
    output: number;
  };
  error?: string;
}

export class BaseAgent {
  protected client: Anthropic;
  protected config: AgentConfig;
  protected tools: ToolDefinition[];
  protected conversationHistory: AgentMessage[] = [];
  private agentLogger;

  constructor(client: Anthropic, config: AgentConfig, tools: ToolDefinition[] = []) {
    this.client = client;
    this.config = config;
    this.tools = tools;
    this.agentLogger = logger.child({ agentName: config.name });
  }

  /**
   * Run the agent with a user message
   */
  async run(userMessage: string): Promise<AgentResult> {
    this.agentLogger.info('Agent run started', { messageLength: userMessage.length });

    try {
      // Add user message to history
      this.conversationHistory.push({
        role: 'user',
        content: userMessage,
      });

      // Prepare messages for API
      const messages = this.conversationHistory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // Prepare tools for API
      const anthropicTools = this.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: this.zodToJsonSchema(tool.inputSchema) as Anthropic.Tool['input_schema'],
      }));

      // Make API call
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens ?? 4096,
        system: this.config.systemPrompt,
        messages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      });

      // Process response (ensure it's a Message, not a Stream)
      const message = response as Anthropic.Message;
      const toolCalls: Array<{ name: string; input: any; result: any }> = [];
      let finalResponse = '';

      // Handle tool use
      for (const block of message.content) {
        if (block.type === 'text') {
          finalResponse += block.text;
        } else if (block.type === 'tool_use') {
          const tool = this.tools.find((t) => t.name === block.name);
          if (tool) {
            this.agentLogger.debug('Executing tool', { tool: block.name });
            const result = await tool.execute(block.input);
            toolCalls.push({
              name: block.name,
              input: block.input,
              result,
            });
          }
        }
      }

      // If we had tool calls, continue the conversation
      if (toolCalls.length > 0) {
        // Add assistant response to history
        this.conversationHistory.push({
          role: 'assistant',
          content: JSON.stringify({
            thinking: finalResponse,
            toolCalls: toolCalls.map((tc) => ({ name: tc.name, input: tc.input })),
          }),
        });

        // Add tool results
        const toolResultsMessage = toolCalls
          .map((tc) => `Tool ${tc.name} result: ${JSON.stringify(tc.result)}`)
          .join('\n\n');

        this.conversationHistory.push({
          role: 'user',
          content: `Tool execution results:\n${toolResultsMessage}`,
        });

        // Get final response
        const finalMessages = this.conversationHistory.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

        const finalApiResponse = await this.client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens ?? 4096,
          system: this.config.systemPrompt,
          messages: finalMessages,
        });

        for (const block of finalApiResponse.content) {
          if (block.type === 'text') {
            finalResponse = block.text;
          }
        }
      }

      // Add final response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: finalResponse,
      });

      this.agentLogger.info('Agent run completed', {
        toolCallCount: toolCalls.length,
        responseLength: finalResponse.length,
      });

      return {
        success: true,
        response: finalResponse,
        toolCalls,
        tokensUsed: {
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
        },
      };
    } catch (error) {
      this.agentLogger.error('Agent run failed', { error: String(error) });
      return {
        success: false,
        response: '',
        error: String(error),
      };
    }
  }

  /**
   * Reset conversation history
   */
  reset(): void {
    this.conversationHistory = [];
  }

  /**
   * Get conversation history
   */
  getHistory(): AgentMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * Add tools dynamically
   */
  addTools(tools: ToolDefinition[]): void {
    this.tools.push(...tools);
  }

  /**
   * Convert Zod schema to JSON Schema
   */
  protected zodToJsonSchema(schema: any): object {
    try {
      const shape = schema.shape;
      const properties: Record<string, object> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        const zodValue = value as any;
        const isOptional = zodValue.isOptional?.() ?? false;

        if (!isOptional) {
          required.push(key);
        }

        const innerType = isOptional ? zodValue._def?.innerType : zodValue;

        properties[key] = this.getJsonSchemaType(innerType);
      }

      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      };
    } catch {
      return { type: 'object', properties: {} };
    }
  }

  private getJsonSchemaType(zodType: any): object {
    if (!zodType?._def) {
      return { type: 'string' };
    }

    const typeName = zodType._def.typeName;

    switch (typeName) {
      case 'ZodString':
        return {
          type: 'string',
          description: zodType._def.description,
        };
      case 'ZodNumber':
        return {
          type: 'number',
          description: zodType._def.description,
        };
      case 'ZodBoolean':
        return {
          type: 'boolean',
          description: zodType._def.description,
        };
      case 'ZodArray':
        return {
          type: 'array',
          items: this.getJsonSchemaType(zodType._def.type),
          description: zodType._def.description,
        };
      case 'ZodEnum':
        return {
          type: 'string',
          enum: zodType._def.values,
          description: zodType._def.description,
        };
      case 'ZodDefault':
        return {
          ...this.getJsonSchemaType(zodType._def.innerType),
          default: zodType._def.defaultValue(),
        };
      case 'ZodObject':
        return this.zodToJsonSchema(zodType);
      default:
        return { type: 'string' };
    }
  }
}
