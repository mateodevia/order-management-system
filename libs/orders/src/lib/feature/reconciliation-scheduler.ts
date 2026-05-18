import { PaymentClient, withCircuitBreaker } from '@oms/payments';
import { customLogger } from '@oms/shared/monitoring';
import { paymentBreaker } from '@oms/shared/util-circuit-breaker';
import { runReconciliationCycle, type ReconciliationWorkerConfig } from './reconciliation-worker';

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_CONFIG: Omit<ReconciliationWorkerConfig, 'paymentClient'> = {
  batchSize: 50,
  maxRetries: 5,
  baseDelayMs: 60_000,
};

/**
 * Starts a background loop that periodically runs {@link runReconciliationCycle}.
 *
 * @param intervalMs - Milliseconds between reconciliation cycles (default 5s).
 * @returns Handle with a `stop` method to halt future cycles.
 */
export function startReconciliationScheduler(intervalMs = DEFAULT_INTERVAL_MS): {
  /** Stops scheduling further reconciliation cycles after the current tick completes. */
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
      customLogger.info('Running reconciliation cycle');
      const processed = await runReconciliationCycle(config);
      if (processed > 0) {
        customLogger.info('Reconciliation cycle processed orders', { processed });
      }
    } catch (err) {
      customLogger.error('Reconciliation cycle failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (running) {
      setTimeout(tick, intervalMs);
    }
  }

  setTimeout(tick, intervalMs);
  customLogger.info('Reconciliation scheduler started', { intervalMs });

  return {
    stop() {
      running = false;
    },
  };
}
