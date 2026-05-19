import { sharedPaymentClient, withCircuitBreaker as paymentCircuitBreaker } from '@oms/payments';
import {
  sharedGeocodingClient,
  withCircuitBreaker as geocodingCircuitBreaker,
} from '@oms/shared/geocoding';
import { geocodingBreaker, paymentBreaker } from '@oms/shared/util-circuit-breaker';
import { createOrderService } from '../data-access/order-service';
import type { OrderPayload } from '../data-access/order-service';

const paymentClient = paymentCircuitBreaker(sharedPaymentClient, paymentBreaker);
const geocodingClient = geocodingCircuitBreaker(sharedGeocodingClient, geocodingBreaker);

/**
 * HTTP entry point for order creation.
 *
 * Wires singleton payment and geocoding clients (with circuit breakers) into
 * {@link createOrderService}.
 *
 * @param payload - Validated order request body.
 * @param idempotencyKey - Client-supplied idempotency key from `x-idempotency-key`.
 * @returns HTTP status and response body for the created or recovered order.
 */
export const createOrder = (payload: OrderPayload, idempotencyKey: string) => {
  return createOrderService(payload, idempotencyKey, {
    paymentClient,
    geocodingClient,
  });
};

export type { OrderPayload };
