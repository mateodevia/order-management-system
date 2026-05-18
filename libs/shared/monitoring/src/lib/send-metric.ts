import type { MetricOptions } from './metrics-client';
import { mockMetricsClient } from './mock-metrics-client';

export type { MetricOptions, MetricType } from './metrics-client';

/**
 * Records a metric via the mock metrics client.
 *
 * In production this would delegate to a vendor-specific {@link IMetricsClient}
 * implementation configured at startup.
 *
 * @param name - Metric name (e.g. `order.create.latency_ms`).
 * @param value - Numeric sample value.
 * @param options - Optional type and tags.
 */
export function sendMetric(name: string, value: number, options?: MetricOptions): void {
  mockMetricsClient.record(name, value, options);
}
