/**
 * Data masking utility for sensitive data protection
 */

import crypto from 'crypto';
import * as fs from 'fs';
import * as yaml from 'yaml';
import { logger } from './logger.js';

export interface MaskingRule {
  name: string;
  category: string;
  pattern: RegExp;
  replacementPrefix?: string;
  replacement?: string;
  reversible: boolean;
  enabled?: boolean;
}

export interface MaskMapping {
  original: string;
  masked: string;
  category: string;
  rule: string;
  createdAt: Date;
}

export interface MaskingConfig {
  rules: MaskingRule[];
  dictionaries: Map<string, string[]>;
}

export class DataMasker {
  private rules: MaskingRule[] = [];
  private dictionaries: Map<string, { terms: string[]; prefix: string; category: string }> =
    new Map();
  private sessionMappings: Map<string, Map<string, MaskMapping>> = new Map();

  constructor(configPath?: string) {
    if (configPath && fs.existsSync(configPath)) {
      this.loadConfig(configPath);
    } else {
      this.loadDefaultRules();
    }
  }

  private loadConfig(configPath: string): void {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = yaml.parse(configContent);

      // Load rules
      for (const rule of config.rules ?? []) {
        if (rule.enabled === false) continue;

        this.rules.push({
          name: rule.name,
          category: rule.category,
          pattern: new RegExp(rule.pattern, 'gi'),
          replacementPrefix: rule.replacement_prefix,
          replacement: rule.replacement,
          reversible: rule.reversible ?? true,
        });
      }

      // Load dictionaries
      for (const [name, dictConfig] of Object.entries(config.dictionaries ?? {})) {
        const dc = dictConfig as { source: string; replacement_prefix: string; category: string };
        if (fs.existsSync(dc.source)) {
          const terms = fs
            .readFileSync(dc.source, 'utf-8')
            .split('\n')
            .filter((t: string) => t.trim());
          this.dictionaries.set(name, {
            terms,
            prefix: dc.replacement_prefix,
            category: dc.category,
          });
        }
      }

      logger.info('Masking config loaded', {
        rulesCount: this.rules.length,
        dictionariesCount: this.dictionaries.size,
      });
    } catch (error) {
      logger.warn('Failed to load masking config, using defaults', { error: String(error) });
      this.loadDefaultRules();
    }
  }

  private loadDefaultRules(): void {
    this.rules = [
      {
        name: 'currency_jpy',
        category: 'financial',
        pattern: /¥[\d,]+(?:\.\d{2})?/g,
        replacementPrefix: '[AMOUNT_',
        reversible: true,
      },
      {
        name: 'currency_usd',
        category: 'financial',
        pattern: /\$[\d,]+(?:\.\d{2})?/g,
        replacementPrefix: '[AMOUNT_USD_',
        reversible: true,
      },
      {
        name: 'email',
        category: 'pii',
        pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        replacement: '[EMAIL_MASKED]',
        reversible: false,
      },
      {
        name: 'phone_jp',
        category: 'pii',
        pattern: /(?:\+?81|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}/g,
        replacement: '[PHONE_MASKED]',
        reversible: false,
      },
      {
        name: 'campaign_name',
        category: 'identifier',
        pattern: /campaign[_-]?(?:name)?[:\s]*["']?([a-zA-Z0-9_-]+)["']?/gi,
        replacementPrefix: '[CAMPAIGN_',
        reversible: true,
      },
      {
        name: 'ip_address',
        category: 'pii',
        pattern: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g,
        replacement: '[IP_MASKED]',
        reversible: false,
      },
    ];
  }

  /**
   * Mask text data
   */
  mask(sessionId: string, data: string): { masked: string; maskCount: number } {
    // Initialize session mapping
    if (!this.sessionMappings.has(sessionId)) {
      this.sessionMappings.set(sessionId, new Map());
    }
    const mappings = this.sessionMappings.get(sessionId)!;

    let masked = data;
    let maskCount = 0;

    // Apply pattern rules
    for (const rule of this.rules) {
      // Reset regex state
      rule.pattern.lastIndex = 0;

      masked = masked.replace(rule.pattern, (match) => {
        maskCount++;

        if (!rule.reversible) {
          // Non-reversible masking
          return rule.replacement ?? '[MASKED]';
        }

        // Reversible masking (generate token)
        const token = this.generateToken(rule.replacementPrefix ?? '[MASKED_');
        mappings.set(token, {
          original: match,
          masked: token,
          category: rule.category,
          rule: rule.name,
          createdAt: new Date(),
        });

        return token;
      });
    }

    // Dictionary-based masking
    for (const [dictName, dictConfig] of this.dictionaries) {
      for (const term of dictConfig.terms) {
        const regex = new RegExp(this.escapeRegex(term), 'gi');
        masked = masked.replace(regex, (match) => {
          maskCount++;
          const token = this.generateToken(dictConfig.prefix);
          mappings.set(token, {
            original: match,
            masked: token,
            category: dictConfig.category,
            rule: `dictionary:${dictName}`,
            createdAt: new Date(),
          });
          return token;
        });
      }
    }

    logger.debug('Data masked', { sessionId, maskCount });

    return { masked, maskCount };
  }

  /**
   * Mask object recursively
   */
  maskObject<T extends Record<string, unknown>>(obj: T, sessionId?: string): T {
    const sid = sessionId ?? this.generateSessionId();

    const maskValue = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return this.mask(sid, value).masked;
      }
      if (typeof value === 'number') {
        // Convert number to string for masking check
        const strValue = value.toString();
        const { masked } = this.mask(sid, strValue);
        // Return masked string if changed, otherwise return original number
        return masked !== strValue ? masked : value;
      }
      if (Array.isArray(value)) {
        return value.map(maskValue);
      }
      if (value && typeof value === 'object') {
        return this.maskObject(value as Record<string, unknown>, sid);
      }
      return value;
    };

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = maskValue(value);
    }

    return result as T;
  }

  /**
   * Unmask text data
   */
  unmask(sessionId: string, data: string): { unmasked: string; unmaskCount: number } {
    const mappings = this.sessionMappings.get(sessionId);
    if (!mappings) {
      logger.warn('Session mappings not found', { sessionId });
      return { unmasked: data, unmaskCount: 0 };
    }

    let unmasked = data;
    let unmaskCount = 0;

    for (const [token, mapping] of mappings) {
      const escapedToken = this.escapeRegex(token);
      const regex = new RegExp(escapedToken, 'g');
      const count = (unmasked.match(regex) || []).length;
      if (count > 0) {
        unmasked = unmasked.replace(regex, mapping.original);
        unmaskCount += count;
      }
    }

    logger.debug('Data unmasked', { sessionId, unmaskCount });

    return { unmasked, unmaskCount };
  }

  /**
   * Clear session mappings
   */
  clearSession(sessionId: string): void {
    this.sessionMappings.delete(sessionId);
    logger.debug('Session mappings cleared', { sessionId });
  }

  /**
   * Get session masking statistics
   */
  getSessionStats(sessionId: string): {
    totalMappings: number;
    byCategory: Record<string, number>;
    byRule: Record<string, number>;
  } {
    const mappings = this.sessionMappings.get(sessionId);
    if (!mappings) {
      return { totalMappings: 0, byCategory: {}, byRule: {} };
    }

    const byCategory: Record<string, number> = {};
    const byRule: Record<string, number> = {};

    for (const mapping of mappings.values()) {
      byCategory[mapping.category] = (byCategory[mapping.category] ?? 0) + 1;
      byRule[mapping.rule] = (byRule[mapping.rule] ?? 0) + 1;
    }

    return {
      totalMappings: mappings.size,
      byCategory,
      byRule,
    };
  }

  private generateToken(prefix: string): string {
    const randomPart = crypto.randomBytes(4).toString('hex');
    return `${prefix}${randomPart}]`;
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
