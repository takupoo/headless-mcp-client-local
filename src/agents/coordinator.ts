/**
 * Coordinator Agent
 *
 * Orchestrates analysis tasks across multiple specialized agents
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent, AgentConfig, AgentResult } from './baseAgent.js';
import { logger } from '../utils/logger.js';
import { ModelRouter, AnalysisTask } from '../router/modelRouter.js';

const COORDINATOR_SYSTEM_PROMPT = `You are a data analysis coordinator. Your role is to:

1. Understand the user's analysis request
2. Break down complex requests into smaller tasks
3. Determine which data sources are needed (BigQuery, GA4)
4. Coordinate the analysis workflow
5. Synthesize results into actionable insights

When analyzing requests, consider:
- What specific data is needed?
- What time period should be analyzed?
- What metrics and dimensions are relevant?
- Are there any cross-analysis requirements?
- What level of insight is expected?

Always structure your response with:
1. Understanding of the request
2. Proposed analysis plan
3. Data requirements
4. Expected insights

Be concise but thorough. Focus on actionable analysis.`;

export interface AnalysisRequest {
  query: string;
  dataSources?: string[];
  dateRange?: {
    start: string;
    end: string;
  };
  priority?: 'low' | 'medium' | 'high';
}

export interface AnalysisPlan {
  steps: AnalysisStep[];
  estimatedComplexity: number;
  requiredAgents: string[];
  dataSources: string[];
}

export interface AnalysisStep {
  id: number;
  description: string;
  agent: string;
  dependencies: number[];
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export class CoordinatorAgent extends BaseAgent {
  private modelRouter: ModelRouter;
  private subAgents: Map<string, BaseAgent> = new Map();

  constructor(client: Anthropic, modelRouter: ModelRouter) {
    const config: AgentConfig = {
      name: 'coordinator',
      description: 'Coordinates analysis tasks across specialized agents',
      model: modelRouter.getModel('complex'),
      systemPrompt: COORDINATOR_SYSTEM_PROMPT,
      maxTokens: 4096,
    };

    super(client, config);
    this.modelRouter = modelRouter;
  }

  /**
   * Register a sub-agent
   */
  registerAgent(name: string, agent: BaseAgent): void {
    this.subAgents.set(name, agent);
    logger.info('Sub-agent registered', { agentName: name });
  }

  /**
   * Analyze a request and create an execution plan
   */
  async planAnalysis(request: AnalysisRequest): Promise<AnalysisPlan> {
    logger.info('Planning analysis', { query: request.query.substring(0, 100) });

    // Determine complexity
    const task: AnalysisTask = {
      query: request.query,
      dataSources: request.dataSources ?? ['bigquery', 'ga4'],
      dateRange: request.dateRange
        ? {
            days: this.calculateDays(request.dateRange.start, request.dateRange.end),
          }
        : undefined,
    };

    const routingResult = this.modelRouter.route(task);

    // Create analysis plan based on complexity
    const steps: AnalysisStep[] = [];
    let stepId = 1;

    // Step 1: Data exploration (if needed)
    if (routingResult.complexity >= 0.3) {
      steps.push({
        id: stepId++,
        description: 'Explore available data and schema',
        agent: 'query-generator',
        dependencies: [],
        status: 'pending',
      });
    }

    // Step 2: Data fetching
    steps.push({
      id: stepId++,
      description: 'Fetch required data from sources',
      agent: 'data-fetcher',
      dependencies: steps.length > 0 ? [1] : [],
      status: 'pending',
    });

    // Step 3: Analysis
    steps.push({
      id: stepId++,
      description: 'Analyze data and detect patterns',
      agent: 'analyst',
      dependencies: [stepId - 1],
      status: 'pending',
    });

    // Step 4: Insight extraction (for complex tasks)
    if (routingResult.complexity >= 0.6) {
      steps.push({
        id: stepId++,
        description: 'Extract deep insights and recommendations',
        agent: 'insight-extractor',
        dependencies: [stepId - 1],
        status: 'pending',
      });
    }

    // Step 5: Report generation
    steps.push({
      id: stepId++,
      description: 'Generate final report',
      agent: 'report-generator',
      dependencies: [stepId - 1],
      status: 'pending',
    });

    return {
      steps,
      estimatedComplexity: routingResult.complexity,
      requiredAgents: [...new Set(steps.map((s) => s.agent))],
      dataSources: task.dataSources,
    };
  }

  /**
   * Execute a single analysis request
   */
  async analyze(request: AnalysisRequest): Promise<AgentResult> {
    logger.info('Starting analysis', { query: request.query.substring(0, 100) });

    // Plan the analysis
    const plan = await this.planAnalysis(request);

    // Build context for the agent
    const contextMessage = `
Analysis Request: ${request.query}

Analysis Plan:
${plan.steps.map((s) => `${s.id}. ${s.description} (${s.agent})`).join('\n')}

Complexity: ${(plan.estimatedComplexity * 100).toFixed(0)}%
Data Sources: ${plan.dataSources.join(', ')}

Please analyze this request and provide:
1. Your understanding of what the user wants
2. The key questions to answer
3. Recommended approach
4. Any clarifying questions if needed
`;

    // Run the coordinator
    return this.run(contextMessage);
  }

  /**
   * Execute analysis with tool access
   */
  async executeWithTools(request: AnalysisRequest): Promise<AgentResult> {
    logger.info('Executing analysis with tools');

    const result = await this.analyze(request);

    if (!result.success) {
      return result;
    }

    // If we have tool calls, process them
    if (result.toolCalls && result.toolCalls.length > 0) {
      const toolSummary = result.toolCalls
        .map((tc) => `- ${tc.name}: ${JSON.stringify(tc.result).substring(0, 200)}...`)
        .join('\n');

      result.response += `\n\nTool Execution Summary:\n${toolSummary}`;
    }

    return result;
  }

  /**
   * Calculate days between two dates
   */
  private calculateDays(start: string, end: string): number {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
}

/**
 * Create a coordinator agent with default configuration
 */
export function createCoordinator(client: Anthropic, modelRouter: ModelRouter): CoordinatorAgent {
  return new CoordinatorAgent(client, modelRouter);
}
