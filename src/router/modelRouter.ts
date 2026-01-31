/**
 * Multi-Model Router
 *
 * Routes tasks to appropriate LLM models based on complexity analysis
 */

import { logger } from '../utils/logger.js';

export type ModelTier = 'simple' | 'moderate' | 'complex' | 'expert';

export interface ModelConfig {
  model: string;
  costPer1MTokens: number;
  maxTokens: number;
  fallback?: string;
}

export interface TierConfig {
  complexityRange: [number, number];
  model: string;
  fallback: string | null;
  costPer1MTokens: number;
}

export interface AnalysisTask {
  query: string;
  dataSources: string[];
  dateRange?: { days: number };
  aggregations?: string[];
  requiresCrossAnalysis?: boolean;
  requiresPrediction?: boolean;
  insightDepth?: number;
}

export interface RoutingResult {
  tier: ModelTier;
  model: string;
  complexity: number;
  estimatedCost: number;
  fallbackModel?: string;
}

const DEFAULT_TIERS: Record<ModelTier, TierConfig> = {
  simple: {
    complexityRange: [0, 0.3],
    model: 'claude-3-5-haiku-20241022',
    fallback: 'claude-3-5-haiku-20241022',
    costPer1MTokens: 0.25,
  },
  moderate: {
    complexityRange: [0.3, 0.6],
    model: 'claude-3-5-haiku-20241022',
    fallback: 'claude-sonnet-4-20250514',
    costPer1MTokens: 0.25,
  },
  complex: {
    complexityRange: [0.6, 0.8],
    model: 'claude-sonnet-4-20250514',
    fallback: 'claude-opus-4-5-20251101',
    costPer1MTokens: 3,
  },
  expert: {
    complexityRange: [0.8, 1.0],
    model: 'claude-opus-4-5-20251101',
    fallback: null,
    costPer1MTokens: 15,
  },
};

export class ModelRouter {
  private tiers: Record<ModelTier, TierConfig>;
  private enabled: boolean;

  constructor(
    config?: {
      enabled?: boolean;
      tiers?: Partial<Record<ModelTier, Partial<TierConfig>>>;
    }
  ) {
    this.enabled = config?.enabled ?? true;

    // Merge custom tiers with defaults
    this.tiers = { ...DEFAULT_TIERS };
    if (config?.tiers) {
      for (const [tier, tierConfig] of Object.entries(config.tiers)) {
        this.tiers[tier as ModelTier] = {
          ...this.tiers[tier as ModelTier],
          ...tierConfig,
        };
      }
    }
  }

  /**
   * Analyze task complexity and route to appropriate model
   */
  route(task: AnalysisTask, estimatedTokens = 1000): RoutingResult {
    if (!this.enabled) {
      // Return default model when router is disabled
      return {
        tier: 'moderate',
        model: this.tiers.moderate.model,
        complexity: 0.5,
        estimatedCost: this.estimateCost('moderate', estimatedTokens),
      };
    }

    const complexity = this.analyzeComplexity(task);
    const tier = this.getTierForComplexity(complexity);
    const tierConfig = this.tiers[tier];

    logger.debug('Task routed', {
      tier,
      model: tierConfig.model,
      complexity: complexity.toFixed(2),
    });

    return {
      tier,
      model: tierConfig.model,
      complexity,
      estimatedCost: this.estimateCost(tier, estimatedTokens),
      fallbackModel: tierConfig.fallback ?? undefined,
    };
  }

  /**
   * Route by explicit tier
   */
  routeByTier(tier: ModelTier, estimatedTokens = 1000): RoutingResult {
    const tierConfig = this.tiers[tier];

    return {
      tier,
      model: tierConfig.model,
      complexity: (tierConfig.complexityRange[0] + tierConfig.complexityRange[1]) / 2,
      estimatedCost: this.estimateCost(tier, estimatedTokens),
      fallbackModel: tierConfig.fallback ?? undefined,
    };
  }

  /**
   * Get model for a specific tier
   */
  getModel(tier: ModelTier): string {
    return this.tiers[tier].model;
  }

  /**
   * Get fallback model for a tier
   */
  getFallback(tier: ModelTier): string | null {
    return this.tiers[tier].fallback;
  }

  /**
   * Analyze task complexity (0.0 - 1.0)
   */
  analyzeComplexity(task: AnalysisTask): number {
    let score = 0;

    // Data sources count (more sources = more complex)
    score += Math.min(task.dataSources.length * 0.1, 0.3);

    // Date range length (longer = more complex)
    if (task.dateRange) {
      score += Math.min(task.dateRange.days / 365, 0.2);
    }

    // Aggregation complexity
    if (task.aggregations) {
      score += Math.min(task.aggregations.length * 0.05, 0.15);
    }

    // Cross-analysis requirement
    if (task.requiresCrossAnalysis) {
      score += 0.15;
    }

    // Prediction requirement
    if (task.requiresPrediction) {
      score += 0.2;
    }

    // Insight depth (0-10 scale)
    if (task.insightDepth !== undefined) {
      score += (task.insightDepth / 10) * 0.2;
    }

    // Query complexity heuristics
    const queryLength = task.query.length;
    if (queryLength > 500) score += 0.05;
    if (queryLength > 1000) score += 0.05;

    // Check for complex keywords
    const complexKeywords = [
      'predict',
      'forecast',
      'trend',
      'correlation',
      'regression',
      'statistical',
      'anomaly',
      'pattern',
      'insight',
      'recommendation',
      'strategy',
      'compare',
      'benchmark',
    ];

    const queryLower = task.query.toLowerCase();
    for (const keyword of complexKeywords) {
      if (queryLower.includes(keyword)) {
        score += 0.03;
      }
    }

    return Math.min(score, 1.0);
  }

  /**
   * Get tier for complexity score
   */
  private getTierForComplexity(complexity: number): ModelTier {
    for (const [tier, config] of Object.entries(this.tiers)) {
      const [min, max] = config.complexityRange;
      if (complexity >= min && complexity < max) {
        return tier as ModelTier;
      }
    }
    // Default to expert for highest complexity
    return 'expert';
  }

  /**
   * Estimate cost for a tier
   */
  private estimateCost(tier: ModelTier, estimatedTokens: number): number {
    const tierConfig = this.tiers[tier];
    return (estimatedTokens / 1_000_000) * tierConfig.costPer1MTokens;
  }

  /**
   * Get all available models
   */
  getAvailableModels(): string[] {
    return Object.values(this.tiers)
      .map((t) => [t.model, t.fallback])
      .flat()
      .filter((m): m is string => m !== null);
  }

  /**
   * Get tier configuration
   */
  getTierConfig(tier: ModelTier): TierConfig {
    return this.tiers[tier];
  }
}

/**
 * Create a model router with default configuration
 */
export function createModelRouter(enabled = true): ModelRouter {
  return new ModelRouter({ enabled });
}
