import { createCircuitBreaker } from './circuit-breaker';
import type { CircuitBreakerConfig } from './circuit-breaker';

/** Default breaker settings for outbound HTTP-style dependencies (payment, geocoding). */
export const externalClientBreakerConfig = {
  failureThreshold: 3,
  cooldownPeriod: 10_000,
  requestTimeout: 5_000,
} as const satisfies CircuitBreakerConfig;

/** Shared payment-gateway breaker (one instance per process). */
export const paymentBreaker = createCircuitBreaker(externalClientBreakerConfig);

/** Shared geocoding breaker (one instance per process). */
export const geocodingBreaker = createCircuitBreaker(externalClientBreakerConfig);
