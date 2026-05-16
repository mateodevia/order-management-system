import express from 'express';
import { ordersRouter } from '@oms/orders';
import { requestLogger } from '@oms/shared/request-logger';

const app = express();

app.use(express.json());
app.use(requestLogger);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/orders', ordersRouter);

const PORT = process.env['PORT'] ?? 3000;

app.listen(PORT, () => {
  console.log(`OMS API listening on port ${PORT}`);
});
