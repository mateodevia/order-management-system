import { createCircuitBreaker } from './circuit-breaker';
import type { CircuitBreakerConfig } from './circuit-breaker';

/**
 * Default breaker settings for outbound HTTP-style dependencies (payment, geocoding).
 *
 * Opens after 3 consecutive failures, cools down for 10s, and times out individual calls at 5s.
 */
export const externalClientBreakerConfig = {
  failureThreshold: 3,
  cooldownPeriod: 10_000,
  requestTimeout: 5_000,
} as const satisfies CircuitBreakerConfig;

/**
 * Shared payment-gateway breaker (one instance per process).
 *
 * @see {@link externalClientBreakerConfig}
 */
export const paymentBreaker = createCircuitBreaker(externalClientBreakerConfig);

/**
 * Shared geocoding breaker (one instance per process).
 *
 * @see {@link externalClientBreakerConfig}
 */
export const geocodingBreaker = createCircuitBreaker(externalClientBreakerConfig);
