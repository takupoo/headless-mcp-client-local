# セキュリティ設計書

## 1. セキュリティ要件

### 1.1 脅威モデル

| 脅威 | 影響度 | 発生可能性 | 対策優先度 |
|------|-------|-----------|-----------|
| LLM学習へのデータ漏洩 | 高 | 中 | 最高 |
| API通信の傍受 | 高 | 低 | 高 |
| 認証情報の漏洩 | 高 | 低 | 高 |
| 不正なクエリ実行 | 中 | 中 | 中 |
| プロンプトインジェクション | 中 | 中 | 中 |
| ログからのデータ漏洩 | 中 | 低 | 中 |

### 1.2 保護対象データ

```yaml
sensitive_data:
  critical:
    - 広告費用の詳細 (CPM, CPC, 予算)
    - クライアント識別情報
    - 競合分析データ
    - 収益・利益率情報

  high:
    - キャンペーン名・ID
    - ターゲティング設定
    - クリエイティブ情報
    - コンバージョンデータ

  medium:
    - トラフィックデータ
    - デバイス分布
    - 地域分布
    - ユーザー行動パターン
```

---

## 2. LLMプライバシー対策

### 2.1 Claude API 学習オプトアウト

Anthropic APIではデフォルトで学習に使用されないが、明示的に設定。

```typescript
// Anthropic API クライアント設定
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // ヘッダーで明示的にオプトアウト
  defaultHeaders: {
    'anthropic-beta': 'prompt-caching-2024-07-31',
  },
});

// リクエスト時のメタデータ
const requestMetadata = {
  // ユーザー識別を行わない
  user_id: 'anonymous',
  // セッションIDはハッシュ化
  session_id: hashSessionId(sessionId),
};
```

**Anthropic APIの学習ポリシー:**

- API経由のデータはデフォルトでモデル学習に使用されない
- 30日間のログ保持（Trust & Safetyのため）
- Enterprise契約でログ保持期間のカスタマイズ可能

### 2.2 データマスキング

LLMに送信する前にセンシティブデータをマスキング。

```typescript
interface MaskingRule {
  pattern: RegExp;
  replacement: string;
  category: 'pii' | 'financial' | 'business' | 'custom';
}

const maskingRules: MaskingRule[] = [
  // 金額・コスト
  {
    pattern: /¥[\d,]+|[$€£][\d,]+\.?\d*/g,
    replacement: '[AMOUNT_MASKED]',
    category: 'financial',
  },
  // クライアント名（辞書ベース）
  {
    pattern: new RegExp(clientNamePatterns.join('|'), 'gi'),
    replacement: '[CLIENT_MASKED]',
    category: 'business',
  },
  // キャンペーンID
  {
    pattern: /campaign[_-]?id[:\s]*\d+/gi,
    replacement: 'campaign_id:[ID_MASKED]',
    category: 'business',
  },
  // 広告アカウントID
  {
    pattern: /ad[_-]?account[_-]?id[:\s]*\d+/gi,
    replacement: 'ad_account_id:[ID_MASKED]',
    category: 'business',
  },
  // メールアドレス
  {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL_MASKED]',
    category: 'pii',
  },
  // 電話番号
  {
    pattern: /(\+?81|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}/g,
    replacement: '[PHONE_MASKED]',
    category: 'pii',
  },
];

class DataMasker {
  private rules: MaskingRule[];
  private maskMap: Map<string, string> = new Map();

  mask(data: string): { masked: string; mappings: Map<string, string> } {
    let masked = data;
    const mappings = new Map<string, string>();

    for (const rule of this.rules) {
      masked = masked.replace(rule.pattern, (match) => {
        const token = `${rule.replacement}_${this.generateToken()}`;
        mappings.set(token, match);
        return token;
      });
    }

    return { masked, mappings };
  }

  unmask(data: string, mappings: Map<string, string>): string {
    let unmasked = data;
    for (const [token, original] of mappings) {
      unmasked = unmasked.replace(new RegExp(token, 'g'), original);
    }
    return unmasked;
  }

  private generateToken(): string {
    return crypto.randomBytes(4).toString('hex');
  }
}
```

### 2.3 マスキングフロー

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Raw Data    │────▶│  Masking    │────▶│ Masked Data │
│ from BQ/GA4 │     │   Engine    │     │             │
└─────────────┘     └──────┬──────┘     └──────┬──────┘
                           │                    │
                           ▼                    ▼
                    ┌─────────────┐     ┌─────────────┐
                    │  Mapping    │     │   LLM API   │
                    │   Store     │     │   Request   │
                    │  (Local)    │     │             │
                    └──────┬──────┘     └──────┬──────┘
                           │                    │
                           │                    ▼
                           │            ┌─────────────┐
                           │            │   LLM       │
                           │            │  Response   │
                           │            └──────┬──────┘
                           │                    │
                           ▼                    ▼
                    ┌─────────────┐     ┌─────────────┐
                    │  Unmasking  │◀────│  Masked     │
                    │   Engine    │     │  Response   │
                    └──────┬──────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Final      │
                    │  Report     │
                    └─────────────┘
```

---

## 3. 認証・認可

### 3.1 サービスアカウント管理

```typescript
interface ServiceAccountConfig {
  bigquery: {
    // サービスアカウントキーはSecret Managerから取得
    keySource: 'gcp_secret_manager';
    secretName: 'bigquery-analysis-sa-key';
    // 最小権限の原則
    roles: [
      'roles/bigquery.dataViewer',    // データ閲覧のみ
      'roles/bigquery.jobUser',       // クエリ実行
    ];
    // 許可するデータセット
    allowedDatasets: [
      'project.analytics_dataset',
      'project.ads_dataset',
    ];
  };

  ga4: {
    keySource: 'gcp_secret_manager';
    secretName: 'ga4-analysis-sa-key';
    roles: [
      'roles/analytics.viewer',
    ];
    allowedProperties: [
      'properties/123456789',
    ];
  };

  anthropic: {
    keySource: 'environment' | 'gcp_secret_manager';
    secretName: 'anthropic-api-key';
  };
}
```

### 3.2 クエリ制限

BigQueryへの不正なクエリを防止。

```typescript
interface QueryRestrictions {
  // 許可されたテーブルのみ
  allowedTables: string[];

  // 禁止されたカラム（取得不可）
  restrictedColumns: {
    table: string;
    columns: string[];
  }[];

  // クエリサイズ制限
  limits: {
    maxBytesProcessed: 10 * 1024 * 1024 * 1024;  // 10GB
    maxRowsReturned: 100000;
    timeoutMs: 120000;
  };

  // 禁止されたSQL操作
  forbiddenOperations: [
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'CREATE',
    'ALTER',
    'TRUNCATE',
  ];
}

class QueryValidator {
  validate(query: string): ValidationResult {
    const errors: string[] = [];

    // 禁止操作のチェック
    for (const op of this.restrictions.forbiddenOperations) {
      if (new RegExp(`\\b${op}\\b`, 'i').test(query)) {
        errors.push(`Forbidden operation: ${op}`);
      }
    }

    // テーブル参照のチェック
    const referencedTables = this.extractTableReferences(query);
    for (const table of referencedTables) {
      if (!this.restrictions.allowedTables.includes(table)) {
        errors.push(`Access denied to table: ${table}`);
      }
    }

    // カラム参照のチェック
    for (const restriction of this.restrictions.restrictedColumns) {
      for (const column of restriction.columns) {
        if (query.includes(column)) {
          errors.push(`Access denied to column: ${restriction.table}.${column}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
```

---

## 4. 通信セキュリティ

### 4.1 暗号化

```yaml
encryption:
  in_transit:
    # 全てのAPI通信はTLS 1.3
    protocol: TLS 1.3
    cipher_suites:
      - TLS_AES_256_GCM_SHA384
      - TLS_CHACHA20_POLY1305_SHA256

  at_rest:
    # ローカルキャッシュの暗号化
    algorithm: AES-256-GCM
    key_management: 'local_keychain'

  secrets:
    # APIキー等の暗号化
    storage: 'gcp_secret_manager'
    rotation: '90d'
```

### 4.2 ネットワーク分離

```
┌────────────────────────────────────────────────────────────┐
│                      VPC / Private Network                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                   Application Subnet                 │  │
│  │  ┌─────────────┐                                    │  │
│  │  │agentic-flow │                                    │  │
│  │  │   Instance  │                                    │  │
│  │  └──────┬──────┘                                    │  │
│  │         │                                            │  │
│  └─────────┼────────────────────────────────────────────┘  │
│            │                                                │
│  ┌─────────┼────────────────────────────────────────────┐  │
│  │         │            Egress Rules                    │  │
│  │         │                                            │  │
│  │         ├───▶ api.anthropic.com (443)  ✓            │  │
│  │         ├───▶ bigquery.googleapis.com (443)  ✓       │  │
│  │         ├───▶ analyticsdata.googleapis.com (443)  ✓  │  │
│  │         └───▶ * (Other)  ✗                           │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

---

## 5. 監査・ログ

### 5.1 監査ログ

```typescript
interface AuditLog {
  timestamp: string;
  eventType:
    | 'query_executed'
    | 'data_accessed'
    | 'llm_request'
    | 'report_generated'
    | 'error_occurred';
  sessionId: string;
  userId: string;
  action: string;
  resource: {
    type: 'bigquery' | 'ga4' | 'llm';
    identifier: string;
  };
  metadata: {
    // クエリの場合
    query?: string;  // マスキング済み
    bytesProcessed?: number;
    // LLMの場合
    model?: string;
    tokensUsed?: number;
    // 共通
    ipAddress?: string;
    userAgent?: string;
  };
  result: 'success' | 'failure';
  errorMessage?: string;
}
```

### 5.2 ログのセキュリティ

```typescript
interface LogSecurityConfig {
  // センシティブ情報のログ出力禁止
  redaction: {
    patterns: [
      /api[_-]?key[:\s]*\S+/gi,
      /password[:\s]*\S+/gi,
      /token[:\s]*\S+/gi,
    ];
    replacement: '[REDACTED]';
  };

  // ログ保持期間
  retention: {
    audit: '365d';
    application: '90d';
    debug: '7d';
  };

  // ログアクセス制御
  access: {
    audit: ['security-team', 'compliance-team'];
    application: ['engineering-team'];
  };
}
```

---

## 6. インシデント対応

### 6.1 セキュリティアラート

```typescript
interface SecurityAlerts {
  rules: [
    {
      name: 'unusual_query_volume';
      condition: 'queries_per_minute > 100';
      severity: 'warning';
      action: 'notify_slack';
    },
    {
      name: 'large_data_export';
      condition: 'bytes_processed > 50GB';
      severity: 'critical';
      action: 'block_and_notify';
    },
    {
      name: 'forbidden_table_access';
      condition: 'access_denied_count > 0';
      severity: 'critical';
      action: 'block_and_notify';
    },
    {
      name: 'api_key_exposure';
      condition: 'log_contains_api_key';
      severity: 'critical';
      action: 'rotate_key_and_notify';
    },
  ];
}
```

### 6.2 インシデント対応手順

```yaml
incident_response:
  data_breach_suspected:
    1. "即座にサービスを停止"
    2. "APIキーをローテーション"
    3. "監査ログを保全"
    4. "影響範囲を特定"
    5. "セキュリティチームに報告"
    6. "必要に応じて関係者に通知"

  api_key_compromised:
    1. "該当キーを即座に無効化"
    2. "新しいキーを生成"
    3. "不正使用の有無を確認"
    4. "アクセスログを分析"

  unauthorized_access_attempt:
    1. "送信元IPをブロック"
    2. "アクセスパターンを分析"
    3. "追加の防御策を検討"
```

---

## 7. コンプライアンス

### 7.1 データ取り扱い規約

```yaml
data_handling:
  # 個人情報保護
  pii:
    - "個人を特定できるデータは取得・分析しない"
    - "集計データのみを使用"
    - "必要に応じてサンプリングを適用"

  # 広告データ
  advertising:
    - "クライアント固有情報はマスキング"
    - "競合情報は社外への持ち出し禁止"
    - "詳細なコストデータはマスキング"

  # 保持期間
  retention:
    - "分析セッションデータ: 24時間"
    - "レポート: 7日間"
    - "監査ログ: 1年間"
```

### 7.2 定期レビュー

```yaml
security_reviews:
  weekly:
    - "アクセスログのレビュー"
    - "異常検知アラートの確認"

  monthly:
    - "APIキーのローテーション検討"
    - "アクセス権限の棚卸し"
    - "セキュリティパッチの適用"

  quarterly:
    - "脅威モデルの見直し"
    - "ペネトレーションテスト"
    - "コンプライアンス監査"
```
