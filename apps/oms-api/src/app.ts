import express from 'express';
import { ordersRouter } from '@oms/orders';
import { requestLogger } from '@oms/shared/request-logger';
import { globalErrorHandler } from '@oms/shared/util-errors';

/** Configured Express application (JSON parsing, logging, routes, global error handler). */
export const app = express();

app.use(express.json({ limit: '100kb' }));
app.use(requestLogger);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/orders', ordersRouter);

app.use(globalErrorHandler);
