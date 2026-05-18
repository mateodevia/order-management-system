import { PaymentClient, withCircuitBreaker as paymentCircuitBreaker } from '@oms/payments';
import {
  GeocodingClient,
  withCircuitBreaker as geocodingCircuitBreaker,
} from '@oms/shared/geocoding';
import { geocodingBreaker, paymentBreaker } from '@oms/shared/util-circuit-breaker';
import { createOrderService } from '../data-access/order-service';
import type { OrderPayload } from '../data-access/order-service';

/**
 * HTTP entry point for order creation.
 *
 * Wires default payment and geocoding clients (with circuit breakers) into
 * {@link createOrderService}.
 *
 * @param payload - Validated order request body.
 * @param idempotencyKey - Client-supplied idempotency key from `x-idempotency-key`.
 * @returns HTTP status and response body for the created or recovered order.
 */
export const createOrder = (payload: OrderPayload, idempotencyKey: string) => {
  return createOrderService(payload, idempotencyKey, {
    paymentClient: paymentCircuitBreaker(new PaymentClient(), paymentBreaker),
    geocodingClient: geocodingCircuitBreaker(new GeocodingClient(), geocodingBreaker),
  });
};

export type { OrderPayload };
