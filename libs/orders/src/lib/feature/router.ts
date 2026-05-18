import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '@oms/shared/util-validation';

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
          shippingAddress: z.object({
            street: z.string().min(1).max(255),
            city: z.string().min(1).max(255),
            country: z.string().min(1).max(255),
            zipCode: z.string().min(1).max(255),
          }),
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
    (req, res) => {
      res.status(501).json({ message: 'Not implemented' });
    },
  ),
);

function uniqueByProductId(items: { productId: string; quantity: number }[]): boolean {
  return new Set(items.map((item) => item.productId)).size === items.length;
}
