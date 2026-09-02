/**
 * Structured Logger & Observability Engine (Issue #146).
 *
 * Provides:
 * - Leveled structured logging (debug, info, warn, error)
 * - Request-scoped tracing via x-request-id
 * - Automatic sensitive data sanitization & masking (passwords, tokens, cookies, auth headers)
 * - JSON structured logs in production / readable formatted logs in development
 */
import crypto from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /session/i,
  /authorization/i,
  /cookie/i,
  /auth_header/i,
  /card/i,
  /cvv/i,
  /key/i
];

/**
 * Recursively masks sensitive fields in objects and strings before logging.
 */
export function sanitizeLogData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    // Redact Authorization Bearer tokens in raw strings
    let sanitized = data.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
    sanitized = sanitized.replace(/sessionid=[A-Za-z0-9_\-\.]+/gi, 'sessionid=[REDACTED]');
    sanitized = sanitized.replace(/sim_session=[A-Za-z0-9_\-\.]+/gi, 'sim_session=[REDACTED]');
    return sanitized;
  }
  if (typeof data === 'number' || typeof data === 'boolean') return data;
  if (Array.isArray(data)) return data.map(sanitizeLogData);

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const isSensitive = SENSITIVE_KEY_PATTERNS.some(p => p.test(key));
      if (isSensitive) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitizeLogData(value);
      }
    }
    return result;
  }

  return String(data);
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export class Logger {
  private minLevel: LogLevel;
  private isProduction: boolean;

  constructor() {
    const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
    this.minLevel = LOG_LEVEL_PRIORITY[envLevel] !== undefined ? envLevel : 'info';
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  generateRequestId(): string {
    return `req_${crypto.randomBytes(8).toString('hex')}`;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  private output(entry: LogEntry): void {
    if (this.isProduction) {
      // Production: NDJSON structured format
      const json = JSON.stringify(entry);
      if (entry.level === 'error') {
        process.stderr.write(json + '\n');
      } else {
        process.stdout.write(json + '\n');
      }
    } else {
      // Development: Clean human-readable format
      const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]${entry.requestId ? ` [${entry.requestId}]` : ''}`;
      const msg = `${prefix} ${entry.message}`;
      if (entry.level === 'error') {
        console.error(msg, entry.context ? entry.context : '', entry.error?.stack || '');
      } else if (entry.level === 'warn') {
        console.warn(msg, entry.context ? entry.context : '');
      } else {
        console.log(msg, entry.context ? entry.context : '');
      }
    }
  }

  debug(message: string, context?: Record<string, unknown>, requestId?: string): void {
    if (!this.shouldLog('debug')) return;
    this.output({
      level: 'debug',
      message,
      timestamp: new Date().toISOString(),
      requestId,
      context: context ? (sanitizeLogData(context) as Record<string, unknown>) : undefined
    });
  }

  info(message: string, context?: Record<string, unknown>, requestId?: string): void {
    if (!this.shouldLog('info')) return;
    this.output({
      level: 'info',
      message,
      timestamp: new Date().toISOString(),
      requestId,
      context: context ? (sanitizeLogData(context) as Record<string, unknown>) : undefined
    });
  }

  warn(message: string, context?: Record<string, unknown>, requestId?: string): void {
    if (!this.shouldLog('warn')) return;
    this.output({
      level: 'warn',
      message,
      timestamp: new Date().toISOString(),
      requestId,
      context: context ? (sanitizeLogData(context) as Record<string, unknown>) : undefined
    });
  }

  error(message: string, err?: unknown, context?: Record<string, unknown>, requestId?: string): void {
    if (!this.shouldLog('error')) return;
    let errorObj: LogEntry['error'];
    if (err instanceof Error) {
      errorObj = {
        name: err.name,
        message: err.message,
        stack: this.isProduction ? undefined : err.stack
      };
    } else if (err) {
      errorObj = {
        name: 'Error',
        message: String(err)
      };
    }

    this.output({
      level: 'error',
      message,
      timestamp: new Date().toISOString(),
      requestId,
      context: context ? (sanitizeLogData(context) as Record<string, unknown>) : undefined,
      error: errorObj
    });
  }
}

export const logger = new Logger();
