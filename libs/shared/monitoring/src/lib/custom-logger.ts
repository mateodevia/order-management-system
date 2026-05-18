import { monitoringConfig, shouldLog, useStructuredLogs, type LogLevel } from './monitoring-config';

/** Arbitrary structured fields attached to a log entry. */
export type LogContext = Record<string, unknown>;

/**
 * Production-oriented logger that emits structured JSON in production
 * and human-readable lines in development.
 */
export interface CustomLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

function writeLog(level: LogLevel, message: string, context?: LogContext): void {
  if (!shouldLog(level)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const baseFields = {
    timestamp,
    level,
    service: monitoringConfig.serviceName,
    message,
    ...context,
  };

  if (useStructuredLogs()) {
    const output = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    output.write(`${JSON.stringify(baseFields)}\n`);
    return;
  }

  const contextSuffix =
    context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
  const line = `[${timestamp}] ${level.toUpperCase()} ${monitoringConfig.serviceName}: ${message}${contextSuffix}`;

  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

/** Shared application logger for production observability. */
export const customLogger: CustomLogger = {
  debug: (message, context) => writeLog('debug', message, context),
  info: (message, context) => writeLog('info', message, context),
  warn: (message, context) => writeLog('warn', message, context),
  error: (message, context) => writeLog('error', message, context),
};
