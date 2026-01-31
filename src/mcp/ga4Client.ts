/**
 * GA4 MCP Client
 *
 * Provides interface to Google Analytics 4 data through MCP protocol
 */

import { logger } from '../utils/logger.js';

export interface GA4DateRange {
  startDate: string;
  endDate: string;
}

export interface GA4ReportRequest {
  propertyId: string;
  dateRanges: GA4DateRange[];
  dimensions?: string[];
  metrics: string[];
  dimensionFilter?: GA4Filter;
  metricFilter?: GA4Filter;
  orderBys?: GA4OrderBy[];
  limit?: number;
  offset?: number;
}

export interface GA4Filter {
  filter?: {
    fieldName: string;
    stringFilter?: {
      matchType: 'EXACT' | 'BEGINS_WITH' | 'ENDS_WITH' | 'CONTAINS' | 'REGEXP';
      value: string;
      caseSensitive?: boolean;
    };
    inListFilter?: {
      values: string[];
      caseSensitive?: boolean;
    };
    numericFilter?: {
      operation: 'EQUAL' | 'LESS_THAN' | 'GREATER_THAN';
      value: { int64Value?: string; doubleValue?: number };
    };
  };
  andGroup?: { expressions: GA4Filter[] };
  orGroup?: { expressions: GA4Filter[] };
  notExpression?: GA4Filter;
}

export interface GA4OrderBy {
  dimension?: { dimensionName: string };
  metric?: { metricName: string };
  desc?: boolean;
}

export interface GA4ReportRow {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

export interface GA4ReportResult {
  rows: GA4ReportRow[];
  rowCount: number;
  metadata: {
    currencyCode: string;
    timeZone: string;
  };
}

export interface GA4Dimension {
  apiName: string;
  uiName: string;
  description: string;
  category: string;
}

export interface GA4Metric {
  apiName: string;
  uiName: string;
  description: string;
  category: string;
  type: 'TYPE_INTEGER' | 'TYPE_FLOAT' | 'TYPE_CURRENCY' | 'TYPE_SECONDS';
}

export interface GA4ClientConfig {
  defaultPropertyId?: string;
  credentials?: string;
  timeout?: number;
}

export class GA4MCPClient {
  private connected: boolean = false;
  private defaultPropertyId: string;

  constructor(private config: GA4ClientConfig) {
    this.defaultPropertyId = config.defaultPropertyId ?? '';
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    logger.info('Connecting to GA4 MCP server...');

    try {
      // Simulation mode - in production would connect to actual MCP server
      this.connected = true;
      logger.info('GA4 MCP client ready (simulation mode)');
    } catch (error) {
      logger.error('Failed to connect to GA4 MCP', { error: String(error) });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    this.connected = false;
    logger.info('GA4 MCP client disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  async runReport(request: GA4ReportRequest): Promise<GA4ReportResult> {
    this.ensureConnected();

    logger.debug('Running GA4 report', {
      propertyId: request.propertyId,
      dimensions: request.dimensions,
      metrics: request.metrics,
    });

    // Simulation: return sample data
    const rows: GA4ReportRow[] = [];
    const numRows = Math.min(request.limit ?? 100, 30);

    for (let i = 0; i < numRows; i++) {
      const dimensionValues: { value: string }[] = [];
      const metricValues: { value: string }[] = [];

      // Generate dimension values
      for (const dim of request.dimensions ?? []) {
        if (dim === 'date') {
          const date = new Date();
          date.setDate(date.getDate() - i);
          dimensionValues.push({ value: date.toISOString().split('T')[0].replace(/-/g, '') });
        } else if (dim === 'sessionDefaultChannelGroup') {
          const channels = ['Organic Search', 'Direct', 'Referral', 'Paid Search', 'Social'];
          dimensionValues.push({ value: channels[i % channels.length] });
        } else if (dim === 'country') {
          const countries = ['Japan', 'United States', 'United Kingdom', 'Germany', 'France'];
          dimensionValues.push({ value: countries[i % countries.length] });
        } else {
          dimensionValues.push({ value: `${dim}_value_${i}` });
        }
      }

      // Generate metric values
      for (const metric of request.metrics) {
        if (metric === 'sessions') {
          metricValues.push({ value: String(Math.floor(Math.random() * 10000) + 1000) });
        } else if (metric === 'totalUsers') {
          metricValues.push({ value: String(Math.floor(Math.random() * 5000) + 500) });
        } else if (metric === 'newUsers') {
          metricValues.push({ value: String(Math.floor(Math.random() * 2000) + 200) });
        } else if (metric === 'screenPageViews') {
          metricValues.push({ value: String(Math.floor(Math.random() * 30000) + 3000) });
        } else if (metric === 'conversions') {
          metricValues.push({ value: String(Math.floor(Math.random() * 500) + 50) });
        } else if (metric === 'totalRevenue') {
          metricValues.push({ value: String(Math.floor(Math.random() * 1000000) + 100000) });
        } else {
          metricValues.push({ value: String(Math.floor(Math.random() * 1000)) });
        }
      }

      rows.push({ dimensionValues, metricValues });
    }

    logger.info('GA4 report completed', { rowCount: rows.length });

    return {
      rows,
      rowCount: rows.length,
      metadata: {
        currencyCode: 'JPY',
        timeZone: 'Asia/Tokyo',
      },
    };
  }

  async getRealtime(
    propertyId: string,
    options: {
      dimensions?: string[];
      metrics: string[];
      limit?: number;
    }
  ): Promise<GA4ReportResult> {
    this.ensureConnected();

    logger.debug('Getting GA4 realtime data', { propertyId });

    // Simulation: return sample realtime data
    const rows: GA4ReportRow[] = [];
    const numRows = Math.min(options.limit ?? 10, 10);

    for (let i = 0; i < numRows; i++) {
      const dimensionValues: { value: string }[] = [];
      const metricValues: { value: string }[] = [];

      for (const dim of options.dimensions ?? []) {
        if (dim === 'unifiedScreenName') {
          const screens = ['Home', 'Product', 'Cart', 'Checkout', 'Confirmation'];
          dimensionValues.push({ value: screens[i % screens.length] });
        } else {
          dimensionValues.push({ value: `${dim}_rt_${i}` });
        }
      }

      for (const metric of options.metrics) {
        if (metric === 'activeUsers') {
          metricValues.push({ value: String(Math.floor(Math.random() * 100) + 10) });
        } else {
          metricValues.push({ value: String(Math.floor(Math.random() * 50)) });
        }
      }

      rows.push({ dimensionValues, metricValues });
    }

    return {
      rows,
      rowCount: rows.length,
      metadata: {
        currencyCode: 'JPY',
        timeZone: 'Asia/Tokyo',
      },
    };
  }

  async listDimensions(): Promise<GA4Dimension[]> {
    this.ensureConnected();

    // Return common GA4 dimensions
    return [
      { apiName: 'date', uiName: 'Date', description: 'The date of the event', category: 'Time' },
      {
        apiName: 'dateHour',
        uiName: 'Date + Hour',
        description: 'Date and hour combined',
        category: 'Time',
      },
      { apiName: 'country', uiName: 'Country', description: 'User country', category: 'Geography' },
      { apiName: 'city', uiName: 'City', description: 'User city', category: 'Geography' },
      {
        apiName: 'sessionDefaultChannelGroup',
        uiName: 'Session Default Channel Group',
        description: 'Marketing channel',
        category: 'Traffic Source',
      },
      {
        apiName: 'sessionSource',
        uiName: 'Session Source',
        description: 'Traffic source',
        category: 'Traffic Source',
      },
      {
        apiName: 'sessionMedium',
        uiName: 'Session Medium',
        description: 'Traffic medium',
        category: 'Traffic Source',
      },
      {
        apiName: 'sessionCampaignName',
        uiName: 'Session Campaign',
        description: 'Campaign name',
        category: 'Traffic Source',
      },
      {
        apiName: 'deviceCategory',
        uiName: 'Device Category',
        description: 'Device type',
        category: 'Platform / Device',
      },
      {
        apiName: 'operatingSystem',
        uiName: 'Operating System',
        description: 'OS name',
        category: 'Platform / Device',
      },
      {
        apiName: 'pagePath',
        uiName: 'Page Path',
        description: 'Page URL path',
        category: 'Page / Screen',
      },
      {
        apiName: 'landingPage',
        uiName: 'Landing Page',
        description: 'Session landing page',
        category: 'Page / Screen',
      },
    ];
  }

  async listMetrics(): Promise<GA4Metric[]> {
    this.ensureConnected();

    // Return common GA4 metrics
    return [
      {
        apiName: 'sessions',
        uiName: 'Sessions',
        description: 'Number of sessions',
        category: 'Session',
        type: 'TYPE_INTEGER',
      },
      {
        apiName: 'totalUsers',
        uiName: 'Total Users',
        description: 'Total unique users',
        category: 'User',
        type: 'TYPE_INTEGER',
      },
      {
        apiName: 'newUsers',
        uiName: 'New Users',
        description: 'Number of new users',
        category: 'User',
        type: 'TYPE_INTEGER',
      },
      {
        apiName: 'activeUsers',
        uiName: 'Active Users',
        description: 'Active users',
        category: 'User',
        type: 'TYPE_INTEGER',
      },
      {
        apiName: 'screenPageViews',
        uiName: 'Views',
        description: 'Page/screen views',
        category: 'Page / Screen',
        type: 'TYPE_INTEGER',
      },
      {
        apiName: 'engagementRate',
        uiName: 'Engagement Rate',
        description: 'Engaged sessions / sessions',
        category: 'Session',
        type: 'TYPE_FLOAT',
      },
      {
        apiName: 'averageSessionDuration',
        uiName: 'Average Session Duration',
        description: 'Avg session length in seconds',
        category: 'Session',
        type: 'TYPE_SECONDS',
      },
      {
        apiName: 'bounceRate',
        uiName: 'Bounce Rate',
        description: 'Non-engaged sessions / sessions',
        category: 'Session',
        type: 'TYPE_FLOAT',
      },
      {
        apiName: 'conversions',
        uiName: 'Conversions',
        description: 'Number of conversions',
        category: 'Event',
        type: 'TYPE_INTEGER',
      },
      {
        apiName: 'totalRevenue',
        uiName: 'Total Revenue',
        description: 'Total revenue',
        category: 'Revenue',
        type: 'TYPE_CURRENCY',
      },
      {
        apiName: 'purchaseRevenue',
        uiName: 'Purchase Revenue',
        description: 'Revenue from purchases',
        category: 'Revenue',
        type: 'TYPE_CURRENCY',
      },
    ];
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('GA4 MCP client not connected');
    }
  }
}
