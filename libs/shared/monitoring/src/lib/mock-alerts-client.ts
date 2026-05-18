import { customLogger } from './custom-logger';
import { monitoringConfig } from './monitoring-config';
import type { AlertPayload, AlertRecord, IAlertsClient } from './alerts-client';

/**
 * In-memory alerts client for development and tests.
 *
 * Persists delivered alerts so integration tests can assert on notifications
 * without calling a real paging or chat integration.
 */
export class MockAlertsClient implements IAlertsClient {
  private readonly records: AlertRecord[] = [];

  /**
   * Test-only controls for inspecting or resetting delivered alerts.
   *
   * @remarks Do not call from production code.
   */
  readonly testables = {
    /** Returns a copy of all alerts delivered on this client instance. */
    getAll: (): AlertRecord[] => [...this.records],
    /** Clears the in-memory alert buffer. */
    clear: (): void => {
      this.records.length = 0;
    },
  };

  /**
   * @inheritdoc
   */
  notify(payload: AlertPayload): void {
    if (!monitoringConfig.alertsEnabled) {
      return;
    }

    const severity = payload.severity ?? 'critical';
    const entry: AlertRecord = {
      title: payload.title,
      message: payload.message,
      severity,
      context: payload.context,
      service: monitoringConfig.serviceName,
      deliveredAt: new Date().toISOString(),
    };

    this.records.push(entry);

    const logContext = {
      title: entry.title,
      message: entry.message,
      severity: entry.severity,
      ...entry.context,
    };

    if (severity === 'critical') {
      customLogger.error('alert delivered', logContext);
    } else if (severity === 'warning') {
      customLogger.warn('alert delivered', logContext);
    } else {
      customLogger.info('alert delivered', logContext);
    }
  }
}

/** Default alerts client used by {@link sendAlert}. */
export const mockAlertsClient = new MockAlertsClient();
