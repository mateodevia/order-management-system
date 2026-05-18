import { PaymentClient, withCircuitBreaker } from '@oms/payments';
import { paymentBreaker } from '@oms/shared/util-circuit-breaker';
import { runReconciliationCycle, type ReconciliationWorkerConfig } from './reconciliation-worker';

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_CONFIG: Omit<ReconciliationWorkerConfig, 'paymentClient'> = {
  batchSize: 50,
  maxRetries: 5,
  baseDelayMs: 60_000,
};

export function startReconciliationScheduler(intervalMs = DEFAULT_INTERVAL_MS): {
  stop: () => void;
} {
  const config: ReconciliationWorkerConfig = {
    paymentClient: withCircuitBreaker(new PaymentClient(), paymentBreaker),
    ...DEFAULT_CONFIG,
  };

  let running = true;

  async function tick() {
    if (!running) return;
    try {
      console.log('Running reconciliation cycle');
      const processed = await runReconciliationCycle(config);
      if (processed > 0) {
        console.log(`Reconciliation cycle processed ${processed} orders`);
      }
    } catch (err) {
      console.error('Reconciliation cycle failed:', err);
    }
    if (running) {
      setTimeout(tick, intervalMs);
    }
  }

  setTimeout(tick, intervalMs);
  console.log(`Reconciliation scheduler started (interval: ${intervalMs}ms)`);

  return {
    stop() {
      running = false;
    },
  };
}
