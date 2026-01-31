# データマスキング実装

## 1. 概要

センシティブなビジネスデータをLLMに送信する前にマスキングし、レスポンス後にアンマスキングする仕組みを実装する。

---

## 2. マスキング戦略

### 2.1 マスキング対象データ

| カテゴリ | 対象データ | マスキング方法 | 例 |
|---------|-----------|--------------|-----|
| 金額 | 広告費用、売上、予算 | トークン置換 | ¥1,234,567 → [AMOUNT_a1b2] |
| 識別子 | キャンペーンID、アカウントID | トークン置換 | campaign_123 → [CAMPAIGN_ID_c3d4] |
| 個人情報 | メール、電話番号 | 完全マスキング | test@example.com → [EMAIL_MASKED] |
| ビジネス情報 | クライアント名、競合名 | 辞書ベースマスキング | 〇〇株式会社 → [CLIENT_e5f6] |

### 2.2 マスキングフロー

```
┌────────────────────────────────────────────────────────────────────┐
│                        データフロー                                 │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  BigQuery/GA4                                                      │
│       │                                                            │
│       ▼                                                            │
│  ┌─────────────────┐                                              │
│  │  Raw Data       │  キャンペーン: summer_sale_2026              │
│  │                 │  売上: ¥12,345,678                          │
│  │                 │  クライアント: ABC株式会社                    │
│  └────────┬────────┘                                              │
│           │                                                        │
│           ▼                                                        │
│  ┌─────────────────┐     ┌─────────────────┐                     │
│  │  Masking Engine │────▶│  Mapping Store  │                     │
│  └────────┬────────┘     │  (Session-local)│                     │
│           │              └─────────────────┘                     │
│           ▼                                                        │
│  ┌─────────────────┐                                              │
│  │  Masked Data    │  キャンペーン: [CAMPAIGN_a1b2]               │
│  │                 │  売上: [AMOUNT_c3d4]                        │
│  │                 │  クライアント: [CLIENT_e5f6]                 │
│  └────────┬────────┘                                              │
│           │                                                        │
│           ▼                                                        │
│  ┌─────────────────┐                                              │
│  │  LLM Analysis   │  "[CAMPAIGN_a1b2]の[AMOUNT_c3d4]は前月比20%増" │
│  └────────┬────────┘                                              │
│           │                                                        │
│           ▼                                                        │
│  ┌─────────────────┐     ┌─────────────────┐                     │
│  │ Unmask Engine   │◀────│  Mapping Store  │                     │
│  └────────┬────────┘     └─────────────────┘                     │
│           │                                                        │
│           ▼                                                        │
│  ┌─────────────────┐                                              │
│  │  Final Report   │  "summer_sale_2026の¥12,345,678は前月比20%増" │
│  └─────────────────┘                                              │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3. 実装

### 3.1 マスキングルール定義

```yaml
# config/masking-rules.yaml
version: "1.0"

rules:
  # 金額パターン
  - name: currency_jpy
    category: financial
    pattern: '¥[\d,]+(?:\.\d{2})?'
    replacement_prefix: "[AMOUNT_"
    reversible: true

  - name: currency_usd
    category: financial
    pattern: '\$[\d,]+(?:\.\d{2})?'
    replacement_prefix: "[AMOUNT_USD_"
    reversible: true

  # パーセンテージ（オプション）
  - name: percentage
    category: financial
    pattern: '\d+(?:\.\d+)?%'
    replacement_prefix: "[PCT_"
    reversible: true
    enabled: false  # 必要に応じて有効化

  # 識別子パターン
  - name: campaign_id
    category: identifier
    pattern: 'campaign[_-]?(?:id)?[:\s]*(\d+)'
    replacement_prefix: "[CAMPAIGN_ID_"
    reversible: true

  - name: ad_group_id
    category: identifier
    pattern: 'ad[_-]?group[_-]?(?:id)?[:\s]*(\d+)'
    replacement_prefix: "[ADGROUP_ID_"
    reversible: true

  - name: account_id
    category: identifier
    pattern: 'account[_-]?(?:id)?[:\s]*(\d+)'
    replacement_prefix: "[ACCOUNT_ID_"
    reversible: true

  # 個人情報パターン
  - name: email
    category: pii
    pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
    replacement: "[EMAIL_MASKED]"
    reversible: false  # 完全マスキング、復元不可

  - name: phone_jp
    category: pii
    pattern: '(?:\+?81|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}'
    replacement: "[PHONE_MASKED]"
    reversible: false

  # IPアドレス
  - name: ip_address
    category: pii
    pattern: '\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}'
    replacement: "[IP_MASKED]"
    reversible: false

# 辞書ベースマスキング（クライアント名など）
dictionaries:
  clients:
    source: "config/client-names.txt"
    category: business
    replacement_prefix: "[CLIENT_"
    reversible: true

  competitors:
    source: "config/competitor-names.txt"
    category: business
    replacement_prefix: "[COMPETITOR_"
    reversible: true

# カテゴリ別の設定
categories:
  financial:
    description: "金額・コスト関連"
    log_access: true
    require_unmask_permission: true

  identifier:
    description: "キャンペーン・アカウントID"
    log_access: false
    require_unmask_permission: false

  pii:
    description: "個人識別情報"
    log_access: true
    require_unmask_permission: true
    allow_unmask: false  # アンマスキング禁止

  business:
    description: "ビジネス機密情報"
    log_access: true
    require_unmask_permission: true
```

### 3.2 マスキングエンジン

```typescript
// src/utils/masking.ts
import crypto from 'crypto';
import * as yaml from 'yaml';
import * as fs from 'fs';
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
    if (configPath) {
      this.loadConfig(configPath);
    } else {
      this.loadDefaultRules();
    }
  }

  private loadConfig(configPath: string): void {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.parse(configContent);

    // ルールの読み込み
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

    // 辞書の読み込み
    for (const [name, dictConfig] of Object.entries(config.dictionaries ?? {})) {
      const dc = dictConfig as any;
      if (fs.existsSync(dc.source)) {
        const terms = fs
          .readFileSync(dc.source, 'utf-8')
          .split('\n')
          .filter((t) => t.trim());
        this.dictionaries.set(name, {
          terms,
          prefix: dc.replacement_prefix,
          category: dc.category,
        });
      }
    }

    logger.info('マスキング設定を読み込み', {
      rulesCount: this.rules.length,
      dictionariesCount: this.dictionaries.size,
    });
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
        name: 'campaign_id',
        category: 'identifier',
        pattern: /campaign[_-]?(?:id)?[:\s]*\d+/gi,
        replacementPrefix: '[CAMPAIGN_ID_',
        reversible: true,
      },
    ];
  }

  /**
   * テキストデータをマスキング
   */
  mask(sessionId: string, data: string): { masked: string; maskCount: number } {
    // セッション用マッピングを初期化
    if (!this.sessionMappings.has(sessionId)) {
      this.sessionMappings.set(sessionId, new Map());
    }
    const mappings = this.sessionMappings.get(sessionId)!;

    let masked = data;
    let maskCount = 0;

    // パターンルールの適用
    for (const rule of this.rules) {
      masked = masked.replace(rule.pattern, (match) => {
        maskCount++;

        if (!rule.reversible) {
          // 復元不可能なマスキング
          return rule.replacement ?? '[MASKED]';
        }

        // 復元可能なマスキング（トークン生成）
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

    // 辞書ベースマスキング
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

    logger.debug('データをマスキング', { sessionId, maskCount });

    return { masked, maskCount };
  }

  /**
   * オブジェクトをマスキング（再帰的）
   */
  maskObject<T extends Record<string, unknown>>(obj: T, sessionId?: string): T {
    const sid = sessionId ?? this.generateSessionId();

    const maskValue = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return this.mask(sid, value).masked;
      }
      if (typeof value === 'number') {
        // 数値は文字列化してからマスキングチェック
        const strValue = value.toString();
        const { masked } = this.mask(sid, strValue);
        // マスキングされた場合はそのまま、されてない場合は数値に戻す
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
   * マスキングされたテキストを復元
   */
  unmask(sessionId: string, data: string): { unmasked: string; unmaskCount: number } {
    const mappings = this.sessionMappings.get(sessionId);
    if (!mappings) {
      logger.warn('セッションのマッピングが見つかりません', { sessionId });
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

    logger.debug('データをアンマスキング', { sessionId, unmaskCount });

    return { unmasked, unmaskCount };
  }

  /**
   * セッションのマッピングをクリア
   */
  clearSession(sessionId: string): void {
    this.sessionMappings.delete(sessionId);
    logger.debug('セッションマッピングをクリア', { sessionId });
  }

  /**
   * セッションのマッピング統計を取得
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
```

### 3.3 マスキングMCPサーバー

```typescript
// src/mcp/dataMaskingServer.ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { DataMasker } from '../utils/masking.js';
import { logger } from '../utils/logger.js';

// シングルトンのマスカーインスタンス
const masker = new DataMasker('./config/masking-rules.yaml');

export const dataMaskingServer = createSdkMcpServer({
  name: 'data-masking-server',
  version: '1.0.0',

  tools: [
    // テキストマスキング
    tool(
      'mask_text',
      'テキストデータのセンシティブ情報をマスキングします',
      {
        session_id: z.string().describe('セッションID'),
        text: z.string().describe('マスキングするテキスト'),
      },
      async ({ session_id, text }) => {
        const result = masker.mask(session_id, text);
        return {
          masked_text: result.masked,
          mask_count: result.maskCount,
          stats: masker.getSessionStats(session_id),
        };
      }
    ),

    // JSONマスキング
    tool(
      'mask_json',
      'JSONデータのセンシティブ情報をマスキングします',
      {
        session_id: z.string().describe('セッションID'),
        data: z.string().describe('マスキングするJSONデータ（文字列化されたもの）'),
      },
      async ({ session_id, data }) => {
        try {
          const parsed = JSON.parse(data);
          const masked = Array.isArray(parsed)
            ? parsed.map((item) => masker.maskObject(item, session_id))
            : masker.maskObject(parsed, session_id);

          return {
            masked_data: JSON.stringify(masked),
            stats: masker.getSessionStats(session_id),
          };
        } catch (error: any) {
          return {
            error: `JSON解析エラー: ${error.message}`,
          };
        }
      }
    ),

    // アンマスキング
    tool(
      'unmask_text',
      'マスキングされたテキストを元のデータに復元します',
      {
        session_id: z.string().describe('セッションID'),
        text: z.string().describe('アンマスキングするテキスト'),
      },
      async ({ session_id, text }) => {
        const result = masker.unmask(session_id, text);
        return {
          unmasked_text: result.unmasked,
          unmask_count: result.unmaskCount,
        };
      }
    ),

    // セッションクリア
    tool(
      'clear_masking_session',
      'セッションのマスキングマッピングを削除します',
      {
        session_id: z.string().describe('セッションID'),
      },
      async ({ session_id }) => {
        const stats = masker.getSessionStats(session_id);
        masker.clearSession(session_id);
        return {
          success: true,
          cleared_mappings: stats.totalMappings,
        };
      }
    ),

    // セッション統計
    tool(
      'get_masking_stats',
      'セッションのマスキング統計を取得します',
      {
        session_id: z.string().describe('セッションID'),
      },
      async ({ session_id }) => {
        return masker.getSessionStats(session_id);
      }
    ),
  ],
});
```

---

## 4. 使用例

### 4.1 分析フローでの使用

```typescript
// 分析フローでのマスキング統合例
async function analyzeWithMasking(
  sessionId: string,
  bigqueryClient: BigQueryMCPClient,
  llmClient: LLMClient,
  masker: DataMasker
) {
  // 1. BigQueryからデータ取得
  const rawResult = await bigqueryClient.executeSQL(`
    SELECT
      campaign_name,
      SUM(cost) as total_cost,
      SUM(conversions) as total_conversions
    FROM ads_reporting.campaign_performance
    WHERE date BETWEEN '2026-01-01' AND '2026-01-31'
    GROUP BY campaign_name
  `);

  // 2. データをマスキング
  const maskedRows = rawResult.rows.map((row) => masker.maskObject(row, sessionId));

  // 3. LLMで分析（マスキングされたデータを送信）
  const analysisPrompt = `
以下のキャンペーンデータを分析してください：

${JSON.stringify(maskedRows, null, 2)}

各キャンペーンのパフォーマンスを評価し、改善点を提案してください。
`;

  const maskedAnalysis = await llmClient.analyze(analysisPrompt);

  // 4. 結果をアンマスキング
  const { unmasked: finalReport } = masker.unmask(sessionId, maskedAnalysis);

  // 5. セッションクリア
  masker.clearSession(sessionId);

  return finalReport;
}
```

### 4.2 マスキング結果の例

**入力データ:**
```json
{
  "campaign_name": "summer_sale_2026_brand",
  "client": "ABC株式会社",
  "cost": "¥1,234,567",
  "conversions": 456,
  "contact_email": "marketing@abc-corp.co.jp"
}
```

**マスキング後:**
```json
{
  "campaign_name": "[CAMPAIGN_a1b2c3d4]",
  "client": "[CLIENT_e5f6g7h8]",
  "cost": "[AMOUNT_i9j0k1l2]",
  "conversions": 456,
  "contact_email": "[EMAIL_MASKED]"
}
```

**LLM分析結果（マスキング済み）:**
```
[CAMPAIGN_a1b2c3d4]は[AMOUNT_i9j0k1l2]のコストで456件のコンバージョンを
獲得しており、CPAは良好です。[CLIENT_e5f6g7h8]の目標に対して...
```

**アンマスキング後:**
```
summer_sale_2026_brandは¥1,234,567のコストで456件のコンバージョンを
獲得しており、CPAは良好です。ABC株式会社の目標に対して...
```
