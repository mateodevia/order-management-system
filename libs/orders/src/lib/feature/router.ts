import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '@oms/shared/util-validation';
import { createOrder } from './create-order';
import { PaymentClient } from '@oms/payments';
import { GeocodingClient } from '@oms/shared/geocoding';
import { createOrderService } from '../data-access/order-service';

export const ordersRouter = Router();

ordersRouter.post(
  '/',
  ...validateRequest(
    {
      headers: z.object({
        'x-idempotency-key': z.uuid(),
      }),
      body: z
        .object({
          customerId: z.uuid(),
          shippingAddress: z.string().min(1).max(255),
          items: z
            .array(
              z.object({
                productId: z.uuid(),
                quantity: z.number().int().min(1),
              }),
            )
            .refine(uniqueByProductId, {
              message: 'items must not contain duplicate productId values',
            })
            .nonempty(),
        })
        .strict(),
    },
    async (req, res) => {
      const idempotencyKey = req.headers['x-idempotency-key'] as string;
      const result = await createOrder(req.body, idempotencyKey);
      res.status(result.status).json(result.data);
    },
  ),
);

function uniqueByProductId(items: { productId: string; quantity: number }[]): boolean {
  return new Set(items.map((item) => item.productId)).size === items.length;
}
