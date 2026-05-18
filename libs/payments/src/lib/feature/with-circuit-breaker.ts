import type { CircuitBreaker } from '@oms/shared/util-circuit-breaker';
import type { IPaymentClient } from './payment-client';

/**
 * Wraps a payment client so every call runs through the given circuit breaker.
 *
 * @param client - Underlying payment gateway implementation.
 * @param breaker - Breaker that guards {@link IPaymentClient.charge} and {@link IPaymentClient.getStatus}.
 * @returns Proxy implementing {@link IPaymentClient} with breaker-protected methods.
 */
export function withCircuitBreaker(
  client: IPaymentClient,
  breaker: CircuitBreaker,
): IPaymentClient {
  return {
    charge: (params) => breaker.execute(() => client.charge(params)),
    getStatus: (idempotencyKey) => breaker.execute(() => client.getStatus(idempotencyKey)),
  };
}
