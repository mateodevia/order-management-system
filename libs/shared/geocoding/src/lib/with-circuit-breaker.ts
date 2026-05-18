import type { CircuitBreaker } from '@oms/shared/util-circuit-breaker';
import type { IGeocodingClient } from './geocoding-client';

/** Wraps a geocoding client so every call runs through the given circuit breaker. */
export function withCircuitBreaker(
  client: IGeocodingClient,
  breaker: CircuitBreaker,
): IGeocodingClient {
  return {
    geocode: (address) => breaker.execute(() => client.geocode(address)),
  };
}
