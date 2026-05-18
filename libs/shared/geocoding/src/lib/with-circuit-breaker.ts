import type { CircuitBreaker } from '@oms/shared/util-circuit-breaker';
import type { IGeocodingClient } from './geocoding-client';

/**
 * Wraps a geocoding client so every call runs through the given circuit breaker.
 *
 * @param client - Underlying geocoding implementation.
 * @param breaker - Breaker that guards {@link IGeocodingClient.geocode}.
 * @returns Proxy implementing {@link IGeocodingClient} with breaker-protected methods.
 */
export function withCircuitBreaker(
  client: IGeocodingClient,
  breaker: CircuitBreaker,
): IGeocodingClient {
  return {
    geocode: (address) => breaker.execute(() => client.geocode(address)),
  };
}
