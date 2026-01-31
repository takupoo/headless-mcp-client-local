/**
 * Test script for BigQuery/GA4 Analyzer
 *
 * Run: npm test
 */

import { BigQueryGA4Analyzer } from './index.js';
import { DataMasker } from './utils/masking.js';
import { QueryValidator } from './mcp/queryValidator.js';
import { ModelRouter, createModelRouter } from './router/modelRouter.js';
import { ga4Report, reportTemplates } from './mcp/ga4ReportBuilder.js';
import { logger } from './utils/logger.js';

// Test helper
function test(name: string, fn: () => void | Promise<void>) {
  return async () => {
    try {
      await fn();
      console.log(`✓ ${name}`);
      return true;
    } catch (error) {
      console.error(`✗ ${name}`);
      console.error(`  Error: ${error}`);
      return false;
    }
  };
}

// Test cases
const tests = [
  // Test 1: Data Masker
  test('DataMasker - masks currency correctly', () => {
    const masker = new DataMasker();
    const sessionId = 'test-session';
    const input = 'The cost is ¥1,234,567 and $100.00';
    const { masked, maskCount } = masker.mask(sessionId, input);

    if (maskCount !== 2) throw new Error(`Expected 2 masks, got ${maskCount}`);
    if (masked.includes('¥1,234,567')) throw new Error('Currency was not masked');
    if (masked.includes('$100.00')) throw new Error('USD was not masked');
  }),

  // Test 2: Data Masker - PII
  test('DataMasker - masks PII non-reversibly', () => {
    const masker = new DataMasker();
    const sessionId = 'test-session-2';
    const input = 'Contact: test@example.com, Phone: 03-1234-5678';
    const { masked } = masker.mask(sessionId, input);

    if (!masked.includes('[EMAIL_MASKED]')) throw new Error('Email not masked');
    if (!masked.includes('[PHONE_MASKED]')) throw new Error('Phone not masked');

    // Try to unmask - should not restore PII
    const { unmasked } = masker.unmask(sessionId, masked);
    if (unmasked.includes('test@example.com')) throw new Error('Email should not be restored');
  }),

  // Test 3: Data Masker - Object masking
  test('DataMasker - masks objects correctly', () => {
    const masker = new DataMasker();
    const obj = {
      name: 'Test Campaign',
      cost: '¥500,000',
      email: 'user@test.com',
    };
    const masked = masker.maskObject(obj);

    if (masked.cost === '¥500,000') throw new Error('Cost not masked in object');
    if (masked.email !== '[EMAIL_MASKED]') throw new Error('Email not masked in object');
  }),

  // Test 4: Query Validator - allows SELECT
  test('QueryValidator - allows valid SELECT queries', () => {
    const validator = new QueryValidator({
      allowedDatasets: ['analytics'],
    });
    const result = validator.validate('SELECT * FROM analytics.events WHERE event_date = "2026-01-01"');

    if (!result.valid) throw new Error(`Query should be valid: ${result.errors.join(', ')}`);
  }),

  // Test 5: Query Validator - blocks forbidden operations
  test('QueryValidator - blocks forbidden operations', () => {
    const validator = new QueryValidator({
      allowedDatasets: ['analytics'],
    });
    const result = validator.validate('DELETE FROM analytics.events');

    if (result.valid) throw new Error('DELETE should be forbidden');
    if (!result.errors.some((e) => e.includes('DELETE'))) {
      throw new Error('Error should mention DELETE');
    }
  }),

  // Test 6: Query Validator - warns about SELECT *
  test('QueryValidator - warns about SELECT *', () => {
    const validator = new QueryValidator({
      allowedDatasets: ['analytics'],
    });
    const result = validator.validate('SELECT * FROM analytics.events');

    if (!result.warnings.some((w) => w.includes('SELECT *'))) {
      throw new Error('Should warn about SELECT *');
    }
  }),

  // Test 7: Model Router - routes by complexity
  test('ModelRouter - routes simple tasks to cheaper models', () => {
    const router = createModelRouter();
    const result = router.route({
      query: 'Show total users',
      dataSources: ['ga4'],
    });

    if (result.complexity > 0.3) throw new Error('Simple query has high complexity');
    if (result.tier !== 'simple') throw new Error(`Expected simple tier, got ${result.tier}`);
  }),

  // Test 8: Model Router - routes complex tasks to better models
  test('ModelRouter - routes complex tasks appropriately', () => {
    const router = createModelRouter();
    const result = router.route({
      query: 'Analyze trends and predict future conversions with statistical correlation',
      dataSources: ['bigquery', 'ga4'],
      dateRange: { days: 365 },
      requiresCrossAnalysis: true,
      requiresPrediction: true,
      insightDepth: 8,
    });

    if (result.complexity < 0.6) throw new Error('Complex query has low complexity');
    if (result.tier === 'simple') throw new Error('Complex query routed to simple tier');
  }),

  // Test 9: GA4 Report Builder - builds requests correctly
  test('GA4ReportBuilder - builds valid requests', () => {
    const request = ga4Report('properties/123456')
      .last30Days()
      .dimensions('date', 'country')
      .metrics('sessions', 'totalUsers')
      .orderByMetric('sessions', true)
      .limit(100)
      .build();

    if (!request.propertyId) throw new Error('Missing propertyId');
    if (request.metrics.length !== 2) throw new Error('Metrics not set correctly');
    if (request.dimensions?.length !== 2) throw new Error('Dimensions not set correctly');
    if (request.dateRanges.length === 0) throw new Error('Date range not set');
  }),

  // Test 10: GA4 Report Templates
  test('GA4ReportTemplates - generates valid templates', () => {
    const overview = reportTemplates.trafficOverview('properties/123456', 30);

    if (!overview.propertyId) throw new Error('Missing propertyId in template');
    if (!overview.metrics.includes('sessions')) throw new Error('Missing sessions metric');
  }),

  // Test 11: Session stats
  test('DataMasker - tracks session statistics', () => {
    const masker = new DataMasker();
    const sessionId = 'stats-test';

    masker.mask(sessionId, 'Cost: ¥100,000');
    masker.mask(sessionId, 'Budget: ¥200,000');

    const stats = masker.getSessionStats(sessionId);

    if (stats.totalMappings < 2) throw new Error('Stats not tracking correctly');
    if (!stats.byCategory['financial']) throw new Error('Category not tracked');
  }),

  // Test 12: Unmask restores original values
  test('DataMasker - unmask restores values correctly', () => {
    const masker = new DataMasker();
    const sessionId = 'unmask-test';
    const original = 'Revenue: ¥1,000,000';

    const { masked } = masker.mask(sessionId, original);
    const { unmasked } = masker.unmask(sessionId, masked);

    if (unmasked !== original) throw new Error('Unmask did not restore original value');
  }),
];

// Run all tests
async function runTests() {
  console.log('\n=== BigQuery/GA4 Analyzer Tests ===\n');

  let passed = 0;
  let failed = 0;

  for (const testFn of tests) {
    const result = await testFn();
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  // Integration test (optional - requires API key)
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('Running integration test...\n');

    try {
      const analyzer = new BigQueryGA4Analyzer();
      await analyzer.initialize();

      console.log('✓ Analyzer initialized successfully');

      // Quick analysis test
      const session = await analyzer.analyze('Show me total users for the last 7 days');

      if (session.status === 'completed') {
        console.log('✓ Analysis completed successfully');
        console.log('\nSample output (first 500 chars):');
        console.log(session.results?.substring(0, 500) + '...\n');
      } else {
        console.log('✗ Analysis failed:', session.results);
      }

      await analyzer.cleanup();
      console.log('✓ Cleanup completed');
    } catch (error) {
      console.error('Integration test error:', error);
    }
  } else {
    console.log('Skipping integration test (no ANTHROPIC_API_KEY set)\n');
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
