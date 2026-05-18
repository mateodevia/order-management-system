/** Metric kinds supported by {@link IMetricsClient}. */
export type MetricType = 'gauge' | 'count' | 'rate';

/** Options when emitting a metric data point. */
export interface MetricOptions {
  /** Metric kind; defaults to `gauge`. */
  type?: MetricType;
  /** Dimensions attached to the series (e.g. `{ env: 'prod' }`). */
  tags?: Record<string, string>;
}

/** A single recorded metric sample. */
export interface MetricRecord {
  name: string;
  value: number;
  type: MetricType;
  tags?: Record<string, string>;
  recordedAt: string;
}

/**
 * Contract for an external metrics backend.
 *
 * Production would swap {@link MockMetricsClient} for a vendor-specific client;
 * call-sites depend on this interface, not the mock.
 */
export interface IMetricsClient {
  /**
   * Records a metric data point.
   *
   * @param name - Metric name (e.g. `order.create.latency_ms`).
   * @param value - Numeric sample value.
   * @param options - Optional type and tags.
   */
  record(name: string, value: number, options?: MetricOptions): void;
}
