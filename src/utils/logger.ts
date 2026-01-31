/**
 * Logger utility for the BigQuery/GA4 analyzer
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
  sessionId?: string;
  agentName?: string;
}

class Logger {
  private level: LogLevel;
  private static instance: Logger;

  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  private constructor() {
    this.level = (process.env.LOG_LEVEL as LogLevel) ?? 'info';
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.level];
  }

  private formatEntry(entry: LogEntry): string {
    const base = {
      timestamp: entry.timestamp,
      level: entry.level.toUpperCase(),
      message: entry.message,
      ...(entry.sessionId && { sessionId: entry.sessionId }),
      ...(entry.agentName && { agentName: entry.agentName }),
      ...(entry.metadata && Object.keys(entry.metadata).length > 0 && { ...entry.metadata }),
    };

    return JSON.stringify(base);
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata,
    };

    const formatted = this.formatEntry(entry);

    switch (level) {
      case 'debug':
        console.debug(formatted);
        break;
      case 'info':
        console.info(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log('debug', message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.log('info', message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log('warn', message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.log('error', message, metadata);
  }

  child(context: { sessionId?: string; agentName?: string }): ChildLogger {
    return new ChildLogger(this, context);
  }
}

class ChildLogger {
  constructor(
    private parent: Logger,
    private context: { sessionId?: string; agentName?: string }
  ) {}

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.parent.debug(message, { ...this.context, ...metadata });
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.parent.info(message, { ...this.context, ...metadata });
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.parent.warn(message, { ...this.context, ...metadata });
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.parent.error(message, { ...this.context, ...metadata });
  }
}

export const logger = Logger.getInstance();
export { Logger, ChildLogger };
