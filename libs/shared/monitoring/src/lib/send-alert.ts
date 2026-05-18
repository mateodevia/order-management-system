import type { AlertPayload } from './alerts-client';
import { mockAlertsClient } from './mock-alerts-client';

export type { AlertPayload, AlertSeverity } from './alerts-client';

/**
 * Delivers a critical alert via the mock alerts client.
 *
 * In production this would delegate to a vendor-specific {@link IAlertsClient}
 * implementation configured at startup.
 *
 * @param payload - Alert title, message, optional severity and context.
 */
export function sendAlert(payload: AlertPayload): void {
  mockAlertsClient.notify(payload);
}
