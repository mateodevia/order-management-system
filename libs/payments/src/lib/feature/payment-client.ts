import { PaymentStatus } from '@oms/shared/types';
import { AppError } from '@oms/shared/util-errors';

/** Parameters for a payment charge request. */
export interface ChargeParams {
  /**
   * Card identifier used for the charge.
   *
   * @remarks Passing raw credit card numbers through backend services violates PCI DSS
   * scope principles. In production, the client side would perform tokenization
   * (e.g., via Stripe.js or Braintree Drop-in UI) and the backend would receive a
   * non-sensitive payment token instead of the raw PAN.
   */
  creditCardNumber: string;
  /** Charge amount in the smallest currency unit (e.g. cents). */
  amount: number;
  /** Human-readable description attached to the charge. */
  description: string;
  /** Client-supplied idempotency key forwarded to the gateway. */
  idempotencyKey: string;
}

/** Successful charge result returned by the payment gateway. */
export interface ChargeReceipt {
  /** Gateway-assigned transaction identifier. */
  transactionId: string;
  /** Outcome of the charge attempt. */
  status: 'success';
  /** Charged amount in the smallest currency unit (e.g. cents). */
  amount: number;
  /** Idempotency key echoed from the original request. */
  idempotencyKey: string;
  /** HTTP status: 201 on first success, 200 when replaying a cached idempotent result. */
  httpStatusCode: 201 | 200;
}

/**
 * Contract for payment gateway clients.
 *
 * Production code must depend on this interface, not the concrete {@link PaymentClient}
 * class. This keeps the swap from mock → real gateway a configuration change, not a
 * refactor, and prevents test-only helpers from leaking into production call-sites.
 */
export interface IPaymentClient {
  /**
   * Charges the payment gateway for the given amount and card token.
   *
   * @param params - Charge request including idempotency key.
   */
  charge(params: ChargeParams): Promise<ChargeReceipt>;
  /**
   * Queries the gateway for the outcome of a previous charge by idempotency key.
   *
   * @param idempotencyKey - Key originally supplied to {@link IPaymentClient.charge}.
   */
  getStatus(idempotencyKey: string): Promise<PaymentStatus>;
}

/**
 * Mock payment gateway client for development and tests.
 *
 * Persists receipts in memory keyed by idempotency key so duplicate charges
 * return the same receipt without re-processing.
 *
 * @remarks Implements {@link IPaymentClient}. The `testables` property is intentionally
 * absent from the interface so production code typed against `IPaymentClient` cannot
 * reach test-only controls.
 */
export class PaymentClient implements IPaymentClient {
  /** In-memory store of successful charges keyed by idempotency key. */
  private readonly receipts = new Map<string, ChargeReceipt>();
  /** Idempotency keys with a charge still pending (no receipt yet). */
  private readonly pendingKeys = new Set<string>();
  /** Per-key overrides for {@link PaymentClient.getStatus}. */
  private readonly forcedStatuses = new Map<string, PaymentStatus>();
  /** When set, both {@link PaymentClient.charge} and {@link PaymentClient.getStatus} throw this error. */
  private forcedError: Error | null = null;

  /**
   * Test-only controls for simulating gateway behavior on this client instance.
   *
   * @remarks Do not call from production code. This property does not appear on
   * {@link IPaymentClient}, so it is unreachable from any call-site that depends
   * on the interface rather than the concrete class.
   */
  readonly testables = {
    /**
     * Forces subsequent {@link PaymentClient.charge} and {@link PaymentClient.getStatus}
     * calls to fail with the given error.
     *
     * @param error - Error to throw; defaults to a 502 gateway-unavailable {@link AppError}.
     */
    forceFailure: (error: Error = new AppError(502, 'Payment gateway unavailable')): void => {
      this.forcedError = error;
    },

    /** Clears a forced failure so {@link PaymentClient.charge} can succeed again. */
    forceSuccess: (): void => {
      this.forcedError = null;
    },

    /**
     * Simulates a pending charge for the given idempotency key.
     *
     * Duplicate {@link PaymentClient.charge} calls receive 409 before a receipt exists.
     * Completed charges (cached receipts) are not affected.
     */
    forcePending: (idempotencyKey: string): void => {
      this.pendingKeys.add(idempotencyKey);
    },

    /** Clears a simulated pending charge without creating a receipt. */
    releasePending: (idempotencyKey: string): void => {
      this.pendingKeys.delete(idempotencyKey);
    },

    /**
     * Pins the value that {@link PaymentClient.getStatus} returns for the given key,
     * overriding the automatic derivation from receipts / pending state.
     *
     * Use this to exercise reconciliation-sweeper paths that require specific gateway
     * outcomes (e.g. `DECLINED`, `NOT_FOUND` for a key that has a pending entry).
     */
    forceStatus: (idempotencyKey: string, status: PaymentStatus): void => {
      this.forcedStatuses.set(idempotencyKey, status);
    },
  };

  /**
   * Charges the given amount using the supplied card details.
   *
   * @param params - Charge request parameters.
   * @returns Receipt for a successful charge.
   * @throws When a test failure has been forced, or when the idempotency key is pending.
   */
  async charge(params: ChargeParams): Promise<ChargeReceipt> {
    if (this.forcedError) {
      throw this.forcedError;
    }

    const cached = this.receipts.get(params.idempotencyKey);
    if (cached) {
      return { ...cached, httpStatusCode: 200 };
    }

    if (this.pendingKeys.has(params.idempotencyKey)) {
      throw new AppError(409, 'Conflict');
    }

    this.pendingKeys.add(params.idempotencyKey);

    const receipt: ChargeReceipt = {
      transactionId: `txn_${Math.random().toString(36).slice(2, 11)}`,
      status: 'success',
      amount: params.amount,
      idempotencyKey: params.idempotencyKey,
      httpStatusCode: 201,
    };

    this.receipts.set(params.idempotencyKey, receipt);
    this.pendingKeys.delete(params.idempotencyKey);
    return receipt;
  }

  /**
   * Queries the gateway for the outcome of a previous charge.
   *
   * Used by the reconciliation sweeper to resolve stale PENDING_PAYMENT orders
   * without risking phantom charges on retry.
   *
   * @param idempotencyKey - Key originally supplied to {@link PaymentClient.charge}.
   * @returns The current status of the charge at the gateway.
   */
  async getStatus(idempotencyKey: string): Promise<PaymentStatus> {
    if (this.forcedError) {
      throw this.forcedError;
    }

    const forced = this.forcedStatuses.get(idempotencyKey);
    if (forced !== undefined) {
      return forced;
    }

    if (this.receipts.has(idempotencyKey)) {
      return PaymentStatus.SUCCESS;
    }

    if (this.pendingKeys.has(idempotencyKey)) {
      return PaymentStatus.PENDING;
    }

    return PaymentStatus.NOT_FOUND;
  }
}
