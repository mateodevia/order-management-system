import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '@oms/shared/util-validation';
import { createOrder } from './create-order';

/** Express router mounting order creation routes under `/orders`. */
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
          creditCardNumber: z.string().min(13).max(19),
          shippingAddress: z.string().min(1).max(255),
          items: z
            .array(
              z.object({
                productId: z.uuid(),
                quantity: z.number().int().min(1),
              }),
            )
            .nonempty()
            .refine(uniqueByProductId, {
              message: 'items must not contain duplicate productId values',
            }),
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

/**
 * Zod refine predicate ensuring order line items do not repeat the same product.
 *
 * @param items - Parsed order line items from the request body.
 * @returns `true` when every `productId` appears at most once.
 */
function uniqueByProductId(items: { productId: string; quantity: number }[]): boolean {
  return new Set(items.map((item) => item.productId)).size === items.length;
}
