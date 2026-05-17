import { AppError } from '@oms/shared/util-errors';
import { PaymentClient, PaymentStatus } from '../payment-client';
import type { IPaymentClient } from '../payment-client';

describe('PaymentClient', () => {
  describe('charge', () => {
    test('When charge is called with a new idempotency key, then it returns a success receipt', async () => {
      // ARRANGE
      const client = new PaymentClient();
      const params = {
        creditCardNumber: '4111111111111111',
        amount: 5000,
        description: 'Order #123',
        idempotencyKey: 'key-001',
      };

      // ACT
      const receipt = await client.charge(params);

      // ASSERT
      expect(receipt.status).toBe('success');
      expect(receipt.httpStatusCode).toBe(201);
      expect(receipt.amount).toBe(5000);
      expect(receipt.idempotencyKey).toBe('key-001');
      expect(typeof receipt.transactionId).toBe('string');
    });

    test('When charge is called twice with the same idempotency key, then it returns the identical original receipt', async () => {
      // ARRANGE
      const client = new PaymentClient();
      const params = {
        creditCardNumber: '4111111111111111',
        amount: 9900,
        description: 'Order #456',
        idempotencyKey: 'key-idempotent',
      };
      const firstReceipt = await client.charge(params);

      // ACT
      const secondReceipt = await client.charge(params);

      // ASSERT
      expect(firstReceipt.httpStatusCode).toBe(201);
      expect(secondReceipt.httpStatusCode).toBe(200);
      expect(secondReceipt.transactionId).toBe(firstReceipt.transactionId);
    });

    test('When forceFailure is called, then subsequent charge calls throw the injected error', async () => {
      // ARRANGE
      const client = new PaymentClient();
      const injectedError = new AppError(502, 'Gateway down');
      client.testables.forceFailure(injectedError);

      // ACT
      const promise = client.charge({
        creditCardNumber: '4111111111111111',
        amount: 1000,
        description: 'Test',
        idempotencyKey: 'key-fail',
      });

      // ASSERT
      await expect(promise).rejects.toThrow(injectedError);
    });

    test('When forceSuccess is called after forceFailure, then charge succeeds again', async () => {
      // ARRANGE
      const client = new PaymentClient();
      client.testables.forceFailure();
      client.testables.forceSuccess();

      // ACT
      const receipt = await client.charge({
        creditCardNumber: '4111111111111111',
        amount: 2500,
        description: 'Post-recovery order',
        idempotencyKey: 'key-after-recovery',
      });

      // ASSERT
      expect(receipt.status).toBe('success');
    });

    test('When forcePending is set for an idempotency key, then charge throws a 409 AppError', async () => {
      // ARRANGE
      const client = new PaymentClient();
      client.testables.forcePending('key-pending');

      // ACT
      const promise = client.charge({
        creditCardNumber: '4111111111111111',
        amount: 3000,
        description: 'Pending order',
        idempotencyKey: 'key-pending',
      });

      // ASSERT
      await expect(promise).rejects.toMatchObject({
        statusCode: 409,
        message: 'Conflict',
      });
    });

    test('When releasePending is called after forcePending, then charge succeeds for that idempotency key', async () => {
      // ARRANGE
      const client = new PaymentClient();
      client.testables.forcePending('key-release');
      client.testables.releasePending('key-release');

      // ACT
      const receipt = await client.charge({
        creditCardNumber: '4111111111111111',
        amount: 4200,
        description: 'Released order',
        idempotencyKey: 'key-release',
      });

      // ASSERT
      expect(receipt.httpStatusCode).toBe(201);
    });
  });

  describe('getStatus', () => {
    test('When getStatus is called after a successful charge, then it returns SUCCESS', async () => {
      // ARRANGE
      const client = new PaymentClient();
      await client.charge({
        creditCardNumber: '4111111111111111',
        amount: 1000,
        description: 'Completed order',
        idempotencyKey: 'key-status-success',
      });

      // ACT
      const status: PaymentStatus = await client.getStatus('key-status-success');

      // ASSERT
      expect(status).toBe<PaymentStatus>('SUCCESS');
    });

    test('When getStatus is called for an in-flight key, then it returns PENDING', async () => {
      // ARRANGE
      const client = new PaymentClient();
      client.testables.forcePending('key-status-pending');

      // ACT
      const status: PaymentStatus = await client.getStatus('key-status-pending');

      // ASSERT
      expect(status).toBe<PaymentStatus>('PENDING');
    });

    test('When getStatus is called for an unknown key, then it returns NOT_FOUND', async () => {
      // ARRANGE
      const client = new PaymentClient();

      // ACT
      const status: PaymentStatus = await client.getStatus('key-status-unknown');

      // ASSERT
      expect(status).toBe<PaymentStatus>('NOT_FOUND');
    });

    test('When forceStatus pins DECLINED for a key, then getStatus returns DECLINED regardless of receipt state', async () => {
      // ARRANGE
      const client = new PaymentClient();
      client.testables.forceStatus('key-status-declined', 'DECLINED');

      // ACT
      const status: PaymentStatus = await client.getStatus('key-status-declined');

      // ASSERT
      expect(status).toBe<PaymentStatus>('DECLINED');
    });

    test('When forceFailure is active, then getStatus throws the same error as charge', async () => {
      // ARRANGE
      const client = new PaymentClient();
      const injectedError = new AppError(502, 'Gateway down');
      client.testables.forceFailure(injectedError);

      // ACT & ASSERT
      await expect(client.getStatus('key-status-fail')).rejects.toThrow(injectedError);
    });
  });
});
