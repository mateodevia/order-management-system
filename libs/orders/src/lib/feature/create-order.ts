import { PaymentClient, withCircuitBreaker as paymentCircuitBreaker } from '@oms/payments';
import {
  GeocodingClient,
  withCircuitBreaker as geocodingCircuitBreaker,
} from '@oms/shared/geocoding';
import { geocodingBreaker, paymentBreaker } from '@oms/shared/util-circuit-breaker';
import { createOrderService } from '../data-access/order-service';
import type { OrderPayload } from '../data-access/order-service';

export const createOrder = (payload: OrderPayload, idempotencyKey: string) => {
  return createOrderService(payload, idempotencyKey, {
    paymentClient: paymentCircuitBreaker(new PaymentClient(), paymentBreaker),
    geocodingClient: geocodingCircuitBreaker(new GeocodingClient(), geocodingBreaker),
  });
};

export type { OrderPayload };
