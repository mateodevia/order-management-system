import { Router, Request, Response } from 'express';

export const ordersRouter = Router();

ordersRouter.post('/', (_req: Request, res: Response) => {
  res.status(501).json({ message: 'Not implemented' });
});
