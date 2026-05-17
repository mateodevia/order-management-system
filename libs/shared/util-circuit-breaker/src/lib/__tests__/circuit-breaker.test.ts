import { createCircuitBreaker, CircuitState, CircuitBreaker } from '../circuit-breaker';
import { AppError } from '@oms/shared/util-errors';

describe('Circuit Breaker', () => {
  /**
   * Simulates consecutive failures to trip the provided circuit breaker.
   * This helper will invoke the breaker with a function that always throws,
   * enough times to exceed the configured failure threshold and open the circuit.
   *
   * @param breaker The CircuitBreaker instance under test.
   * @param failures The number of failure attempts to trigger.
   */
  async function tripCircuit(breaker: CircuitBreaker, failures: number) {
    for (let i = 0; i < failures; i++) {
      await breaker
        .execute(() => {
          throw new Error('downstream failure');
        })
        .catch(() => { /* expected rejection */ });
    }
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('When consecutive failures exceed the threshold, then the circuit opens and starts rejecting requests', async () => {
    // ARRANGE
    const failureThreshold = 3;
    const breaker = createCircuitBreaker({
      failureThreshold,
      cooldownPeriod: 10_000,
      requestTimeout: 5_000,
    });
    // ACT
    await tripCircuit(breaker, failureThreshold);

    // ASSERT
    expect(breaker.state).toBe(CircuitState.Open);
  });

  test('When the circuit is open, then it throws a 503 AppError without invoking the underlying function', async () => {
    // ARRANGE
    const failureThreshold = 3;
    const breaker = createCircuitBreaker({
      failureThreshold,
      cooldownPeriod: 10_000,
      requestTimeout: 5_000,
    });
    await tripCircuit(breaker, failureThreshold);
    const spy = jest.fn().mockResolvedValue('should not be called');

    // ACT
    const error = await breaker.execute(spy).catch((e: unknown) => e);

    // ASSERT
    expect(spy).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      statusCode: 503,
      message: 'Service temporarily unavailable: circuit breaker is open',
    });
  });

  test('When the cooldown expires and a canary succeeds, then the circuit closes', async () => {
    // ARRANGE
    const failureThreshold = 3;
    const cooldownPeriod = 5_000;
    const breaker = createCircuitBreaker({
      failureThreshold,
      cooldownPeriod,
      requestTimeout: 5_000,
    });
    await tripCircuit(breaker, failureThreshold);
    // The circuit is now open
    await jest.advanceTimersByTimeAsync(cooldownPeriod + 1);

    // ACT
    const result = await breaker.execute(() => Promise.resolve('recovered'));

    // ASSERT
    expect(result).toBe('recovered');
    expect(breaker.state).toBe(CircuitState.Closed);
  });

  test('When a request exceeds the timeout, then it throws a 503 AppError', async () => {
    // ARRANGE
    const breaker = createCircuitBreaker({
      failureThreshold: 5,
      cooldownPeriod: 10_000,
      requestTimeout: 5,
    });
    const slowFn = () =>
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('too late'), 6);
      });

    // ACT
    const promise = breaker.execute(slowFn).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(1_001);
    const error = await promise;

    // ASSERT
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      statusCode: 503,
      message: 'Service temporarily unavailable: request timed out',
    });
  });

  test('When the underlying function succeeds, then it returns the result transparently', async () => {
    // ARRANGE
    const breaker = createCircuitBreaker({
      failureThreshold: 3,
      cooldownPeriod: 10_000,
      requestTimeout: 5_000,
    });

    // ACT
    const result = await breaker.execute(() => Promise.resolve(42));

    // ASSERT
    expect(result).toBe(42);
    expect(breaker.state).toBe(CircuitState.Closed);
  });

  test('When the underlying function throws a non-circuit error, then it propagates without wrapping', async () => {
    // ARRANGE
    const breaker = createCircuitBreaker({
      failureThreshold: 5,
      cooldownPeriod: 10_000,
      requestTimeout: 5_000,
    });
    const customError = new Error('application-level error');

    // ACT
    const promise = breaker.execute(() => {
      throw customError;
    });

    // ASSERT
    await expect(promise).rejects.toThrow(customError);
  });
});
