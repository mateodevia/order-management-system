import { customLogger } from './custom-logger';
import { monitoringConfig } from './monitoring-config';
import type { IMetricsClient, MetricOptions, MetricRecord } from './metrics-client';

/**
 * In-memory metrics client for development and tests.
 *
 * Persists recorded samples so integration tests can assert on emitted metrics
 * without calling a real observability vendor.
 */
export class MockMetricsClient implements IMetricsClient {
  private readonly records: MetricRecord[] = [];

  /**
   * Test-only controls for inspecting or resetting recorded metrics.
   *
   * @remarks Do not call from production code.
   */
  readonly testables = {
    /** Returns a copy of all metrics recorded on this client instance. */
    getAll: (): MetricRecord[] => [...this.records],
    /** Clears the in-memory metric buffer. */
    clear: (): void => {
      this.records.length = 0;
    },
  };

  /**
   * @inheritdoc
   */
  record(name: string, value: number, options?: MetricOptions): void {
    if (!monitoringConfig.metricsEnabled) {
      return;
    }

    const entry: MetricRecord = {
      name,
      value,
      type: options?.type ?? 'gauge',
      tags: options?.tags,
      recordedAt: new Date().toISOString(),
    };

    this.records.push(entry);
    customLogger.debug('metric recorded', {
      metric: entry.name,
      value: entry.value,
      type: entry.type,
      tags: entry.tags,
    });
  }
}

/** Default metrics client used by {@link sendMetric}. */
export const mockMetricsClient = new MockMetricsClient();
