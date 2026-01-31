/**
 * GA4 Report Builder
 *
 * Fluent builder for constructing GA4 report requests
 */

import {
  GA4ReportRequest,
  GA4DateRange,
  GA4Filter,
  GA4OrderBy,
} from './ga4Client.js';

export class GA4ReportBuilder {
  private request: Partial<GA4ReportRequest> = {};

  constructor(propertyId: string) {
    this.request.propertyId = propertyId;
    this.request.metrics = [];
    this.request.dimensions = [];
    this.request.dateRanges = [];
  }

  /**
   * Add a date range
   */
  dateRange(startDate: string, endDate: string): this {
    this.request.dateRanges!.push({ startDate, endDate });
    return this;
  }

  /**
   * Last 7 days shortcut
   */
  last7Days(): this {
    return this.dateRange('7daysAgo', 'today');
  }

  /**
   * Last 30 days shortcut
   */
  last30Days(): this {
    return this.dateRange('30daysAgo', 'today');
  }

  /**
   * Last 90 days shortcut
   */
  last90Days(): this {
    return this.dateRange('90daysAgo', 'today');
  }

  /**
   * Yesterday shortcut
   */
  yesterday(): this {
    return this.dateRange('yesterday', 'yesterday');
  }

  /**
   * This month shortcut
   */
  thisMonth(): this {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDate = firstDay.toISOString().split('T')[0];
    return this.dateRange(startDate, 'today');
  }

  /**
   * Last month shortcut
   */
  lastMonth(): this {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    const startDate = firstDay.toISOString().split('T')[0];
    const endDate = lastDay.toISOString().split('T')[0];
    return this.dateRange(startDate, endDate);
  }

  /**
   * Add a single dimension
   */
  dimension(name: string): this {
    this.request.dimensions!.push(name);
    return this;
  }

  /**
   * Add multiple dimensions
   */
  dimensions(...names: string[]): this {
    this.request.dimensions!.push(...names);
    return this;
  }

  /**
   * Add a single metric
   */
  metric(name: string): this {
    this.request.metrics!.push(name);
    return this;
  }

  /**
   * Add multiple metrics
   */
  metrics(...names: string[]): this {
    this.request.metrics!.push(...names);
    return this;
  }

  /**
   * Filter by dimension with string matching
   */
  filterDimension(
    fieldName: string,
    matchType: 'EXACT' | 'CONTAINS' | 'BEGINS_WITH' | 'ENDS_WITH' | 'REGEXP',
    value: string,
    caseSensitive = false
  ): this {
    this.request.dimensionFilter = {
      filter: {
        fieldName,
        stringFilter: {
          matchType,
          value,
          caseSensitive,
        },
      },
    };
    return this;
  }

  /**
   * Filter by dimension with list matching
   */
  filterDimensionInList(fieldName: string, values: string[], caseSensitive = false): this {
    this.request.dimensionFilter = {
      filter: {
        fieldName,
        inListFilter: { values, caseSensitive },
      },
    };
    return this;
  }

  /**
   * Filter by metric with numeric comparison
   */
  filterMetric(
    fieldName: string,
    operation: 'EQUAL' | 'LESS_THAN' | 'GREATER_THAN',
    value: number
  ): this {
    this.request.metricFilter = {
      filter: {
        fieldName,
        numericFilter: {
          operation,
          value: { doubleValue: value },
        },
      },
    };
    return this;
  }

  /**
   * Add ordering by metric
   */
  orderByMetric(metricName: string, desc = true): this {
    if (!this.request.orderBys) {
      this.request.orderBys = [];
    }
    this.request.orderBys.push({
      metric: { metricName },
      desc,
    });
    return this;
  }

  /**
   * Add ordering by dimension
   */
  orderByDimension(dimensionName: string, desc = false): this {
    if (!this.request.orderBys) {
      this.request.orderBys = [];
    }
    this.request.orderBys.push({
      dimension: { dimensionName },
      desc,
    });
    return this;
  }

  /**
   * Generic order by (auto-detects if metric or dimension)
   */
  orderBy(field: string, desc = true, isMetric = true): this {
    if (isMetric) {
      return this.orderByMetric(field, desc);
    } else {
      return this.orderByDimension(field, desc);
    }
  }

  /**
   * Set result limit
   */
  limit(n: number): this {
    this.request.limit = n;
    return this;
  }

  /**
   * Set result offset (for pagination)
   */
  offset(n: number): this {
    this.request.offset = n;
    return this;
  }

  /**
   * Build the final request object
   */
  build(): GA4ReportRequest {
    if (!this.request.propertyId) {
      throw new Error('Property ID is required');
    }
    if (!this.request.metrics || this.request.metrics.length === 0) {
      throw new Error('At least one metric is required');
    }
    if (!this.request.dateRanges || this.request.dateRanges.length === 0) {
      throw new Error('At least one date range is required');
    }

    return this.request as GA4ReportRequest;
  }
}

/**
 * Factory function for creating GA4 report builder
 */
export function ga4Report(propertyId: string): GA4ReportBuilder {
  return new GA4ReportBuilder(propertyId);
}

/**
 * Pre-built report templates
 */
export const reportTemplates = {
  /**
   * Traffic overview report
   */
  trafficOverview(propertyId: string, days = 30): GA4ReportRequest {
    return ga4Report(propertyId)
      .dateRange(`${days}daysAgo`, 'today')
      .dimensions('date')
      .metrics('sessions', 'totalUsers', 'newUsers', 'screenPageViews')
      .orderByDimension('date', false)
      .build();
  },

  /**
   * Channel performance report
   */
  channelPerformance(propertyId: string, days = 30): GA4ReportRequest {
    return ga4Report(propertyId)
      .dateRange(`${days}daysAgo`, 'today')
      .dimensions('sessionDefaultChannelGroup')
      .metrics('sessions', 'totalUsers', 'conversions', 'totalRevenue')
      .orderByMetric('sessions', true)
      .limit(20)
      .build();
  },

  /**
   * Geographic report
   */
  geographicReport(propertyId: string, days = 30): GA4ReportRequest {
    return ga4Report(propertyId)
      .dateRange(`${days}daysAgo`, 'today')
      .dimensions('country', 'city')
      .metrics('sessions', 'totalUsers', 'conversions')
      .orderByMetric('sessions', true)
      .limit(50)
      .build();
  },

  /**
   * Device report
   */
  deviceReport(propertyId: string, days = 30): GA4ReportRequest {
    return ga4Report(propertyId)
      .dateRange(`${days}daysAgo`, 'today')
      .dimensions('deviceCategory', 'operatingSystem')
      .metrics('sessions', 'totalUsers', 'engagementRate', 'conversions')
      .orderByMetric('sessions', true)
      .limit(20)
      .build();
  },

  /**
   * Landing page report
   */
  landingPageReport(propertyId: string, days = 30): GA4ReportRequest {
    return ga4Report(propertyId)
      .dateRange(`${days}daysAgo`, 'today')
      .dimensions('landingPage')
      .metrics('sessions', 'totalUsers', 'bounceRate', 'conversions', 'totalRevenue')
      .orderByMetric('sessions', true)
      .limit(50)
      .build();
  },

  /**
   * Campaign performance report
   */
  campaignPerformance(propertyId: string, days = 30): GA4ReportRequest {
    return ga4Report(propertyId)
      .dateRange(`${days}daysAgo`, 'today')
      .dimensions('sessionCampaignName', 'sessionSource', 'sessionMedium')
      .metrics('sessions', 'totalUsers', 'conversions', 'totalRevenue')
      .orderByMetric('sessions', true)
      .limit(100)
      .build();
  },

  /**
   * Conversion report
   */
  conversionReport(propertyId: string, days = 30): GA4ReportRequest {
    return ga4Report(propertyId)
      .dateRange(`${days}daysAgo`, 'today')
      .dimensions('date')
      .metrics('conversions', 'totalRevenue', 'purchaseRevenue')
      .orderByDimension('date', false)
      .build();
  },
};
