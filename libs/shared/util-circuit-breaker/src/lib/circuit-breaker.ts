import {
  circuitBreaker,
  ConsecutiveBreaker,
  handleAll,
  timeout,
  wrap,
  TimeoutStrategy,
  BrokenCircuitError,
  TaskCancelledError,
} from 'cockatiel';
import { AppError } from '@oms/shared/util-errors';

/**
 * Configuration for {@link createCircuitBreaker}.
 *
 * All time-based values are in milliseconds.
 */
export interface CircuitBreakerConfig {
  /** Consecutive failures required before the circuit opens. */
  failureThreshold: number;
  /** Duration the circuit stays open before allowing a half-open canary probe. */
  cooldownPeriod: number;
  /** Maximum time allowed for a single wrapped request before it is cancelled. */
  requestTimeout: number;
}

/** Numeric states exposed by the underlying cockatiel breaker policy. */
export const CircuitState = {
  Closed: 0,
  Open: 1,
  HalfOpen: 2,
  Isolated: 3,
} as const;

/** Union of all {@link CircuitState} constant values. */
export type CircuitState = (typeof CircuitState)[keyof typeof CircuitState];

/** Subscription handle returned by circuit breaker event hooks. */
export type EventListener<T> = (listener: (data: T) => void) => { dispose(): void };

/*
 * Architectural note: Localized, in-memory circuit breakers
 *
 * This system intentionally uses decentralized, localized in-memory circuit
 * breakers to eliminate fast-path network latency penalties. On every healthy
 * call the breaker check is a single in-process boolean read — no blocking
 * round-trip to an external data store like Redis is required. This keeps the
 * hot path as fast as possible and removes an additional point of failure.
 *
 * In a production deployment spanning 100+ instances, each node maintains its
 * own breaker state. When a downstream dependency degrades, individual nodes
 * trip independently as they each observe their own failure threshold. This
 * creates a brief convergence window during which some nodes are still Open
 * while others continue forwarding requests ("request leakage"). To prevent
 * a thundering-herd effect — where all nodes simultaneously recover and
 * overwhelm the recovering dependency — this local architecture would be
 * augmented with an asynchronous, event-driven synchronization layer:
 *
 *   1. Redis Pub/Sub broadcast: When any node trips its breaker, it publishes
 *      a circuit-open event. Subscribers force-open their local breakers
 *      immediately, collapsing the convergence window to sub-second latency.
 *
 *   2. Lease-based manual isolation override: A shared Redis key acts as a
 *      cluster-wide "force-open" lease. While the lease is held, all nodes
 *      reject requests to that dependency regardless of local state. The lease
 *      has a TTL so it self-heals if the issuing node crashes.
 *
 *   3. Randomized jitter on the recovery timeline: When transitioning from
 *      Open to Half-Open, each node adds randomized jitter to its cooldown
 *      period. This staggers canary probes across the cluster so the
 *      recovering dependency receives a gradual ramp-up rather than a
 *      synchronized burst of test requests.
 *
 * This design preserves zero-overhead local execution on the fast path while
 * providing cluster-wide failure containment through asynchronous coordination.
 */

/** Facade over cockatiel policies with operational HTTP errors on open/timeout. */
export interface CircuitBreaker {
  readonly state: CircuitState;
  readonly onBreak: EventListener<unknown>;
  readonly onReset: EventListener<void>;
  readonly onHalfOpen: EventListener<void>;
  /**
   * Runs `fn` through consecutive-failure and request-timeout policies.
   *
   * @param fn - Async or sync operation to protect (e.g. outbound HTTP call).
   * @returns Result of `fn` when the circuit is closed and the call completes in time.
   * @throws {@link AppError} with 503 when the circuit is open or the request times out.
   */
  execute<T>(fn: () => Promise<T> | T): Promise<T>;
}

/**
 * Creates an in-process circuit breaker with consecutive-failure and per-request timeout policies.
 *
 * @param config - Failure threshold, cooldown, and timeout settings (milliseconds).
 * @returns {@link CircuitBreaker} instance for wrapping external client calls.
 */
export function createCircuitBreaker(config: CircuitBreakerConfig): CircuitBreaker {
  const timeoutPolicy = timeout(
    config.requestTimeout,
    TimeoutStrategy.Aggressive,
  );

  const breakerPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: config.cooldownPeriod,
    breaker: new ConsecutiveBreaker(config.failureThreshold),
  });

  const policy = wrap(breakerPolicy, timeoutPolicy);

  return {
    get state(): CircuitState {
      return breakerPolicy.state as CircuitState;
    },
    onBreak: breakerPolicy.onBreak,
    onReset: breakerPolicy.onReset,
    onHalfOpen: breakerPolicy.onHalfOpen,
    async execute<T>(fn: () => Promise<T> | T): Promise<T> {
      try {
        return await policy.execute(fn);
      } catch (error) {
        if (error instanceof BrokenCircuitError) {
          throw new AppError(
            503,
            'Service temporarily unavailable: circuit breaker is open',
          );
        }
        if (error instanceof TaskCancelledError) {
          throw new AppError(
            503,
            'Service temporarily unavailable: request timed out',
          );
        }
        throw error;
      }
    },
  };
}
