/** Severity for on-call routing and display. */
export type AlertSeverity = 'critical' | 'warning' | 'info';

/** Payload for a critical alert to the development team. */
export interface AlertPayload {
  title: string;
  message: string;
  severity?: AlertSeverity;
  context?: Record<string, unknown>;
}

/** A single alert delivered to the team. */
export interface AlertRecord {
  title: string;
  message: string;
  severity: AlertSeverity;
  context?: Record<string, unknown>;
  service: string;
  deliveredAt: string;
}

/**
 * Contract for an external alerting backend.
 *
 * Production would swap {@link MockAlertsClient} for PagerDuty, Opsgenie, etc.;
 * call-sites depend on this interface, not the mock.
 */
export interface IAlertsClient {
  /**
   * Notifies the development team of a critical condition.
   *
   * @param payload - Alert title, message, optional severity and context.
   */
  notify(payload: AlertPayload): void;
}
