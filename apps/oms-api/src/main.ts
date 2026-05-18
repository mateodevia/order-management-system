import 'express-async-errors';
import { startReconciliationScheduler } from '@oms/orders';
import { customLogger } from '@oms/shared/monitoring';
import { app } from './app';

const PORT = process.env['PORT'] ?? 3000;

app.listen(PORT, () => {
  customLogger.info('OMS API listening', { port: PORT });
  startReconciliationScheduler();
});
