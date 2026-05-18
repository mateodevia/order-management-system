/** Supported log levels for {@link customLogger}. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  return 'info';
}

/** Runtime configuration read from environment variables. */
export const monitoringConfig = {
  serviceName: process.env['SERVICE_NAME'] ?? 'oms-api',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  logLevel: parseLogLevel(process.env['LOG_LEVEL']),
  metricsEnabled: process.env['METRICS_ENABLED'] !== 'false',
  alertsEnabled: process.env['ALERTS_ENABLED'] !== 'false',
} as const;

/**
 * Returns whether a message at `level` should be emitted given the configured minimum level.
 */
export function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[monitoringConfig.logLevel];
}

/** True when structured JSON logs should be written (production-style). */
export function useStructuredLogs(): boolean {
  return monitoringConfig.nodeEnv === 'production';
}
