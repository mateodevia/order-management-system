import { Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { mockRes } from '@oms/shared/testing-utils';
import { AppError } from '../app-error';
import { globalErrorHandler } from '../error-handler';

describe('globalErrorHandler', () => {
  test('When an AppError is thrown, then it responds with the appropriate status code and message', () => {
    // ARRANGE
    const req = {} as Request;
    const res = mockRes();
    const err = new AppError(403, 'Forbidden');

    // ACT
    globalErrorHandler(err, req, res as unknown as Response, jest.fn());

    // ASSERT
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  test('When a ZodError is thrown, then it responds with 400 and sanitized message', () => {
    // ARRANGE
    const req = {} as Request;
    const res = mockRes();
    const err = z.object({ customerId: z.string() }).safeParse({ customerId: 42 })
      .error as ZodError;

    // ACT
    globalErrorHandler(err, req, res as unknown as Response, jest.fn());

    // ASSERT
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid payload structure' });
  });

  test('When an unknown error is thrown, then it responds with 500 and generic message', () => {
    // ARRANGE
    const req = {} as Request;
    const res = mockRes();
    const err = new Error('DB connection lost');

    // ACT
    globalErrorHandler(err, req, res as unknown as Response, jest.fn());

    // ASSERT
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
  });

  test('When a non-Error value is thrown, then it responds with 500 and generic message', () => {
    // ARRANGE
    const req = {} as Request;
    const res = mockRes();

    // ACT
    globalErrorHandler('something went wrong', req, res as unknown as Response, jest.fn());

    // ASSERT
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
  });
});
