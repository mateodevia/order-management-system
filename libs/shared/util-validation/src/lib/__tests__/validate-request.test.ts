import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { validateRequest } from '../validate-request';

/** Creates a minimal Express {@link Request} stub for middleware unit tests. */
function makeReq(overrides: Partial<Request> = {}): Request {
  return { headers: {}, body: {}, ...overrides } as Request;
}

describe('validateRequest', () => {
  describe('body validation', () => {
    test('When the body is valid, then it calls next() with no args', () => {
      // ARRANGE
      const schema = z.object({ name: z.string() });
      const [middleware] = validateRequest({ body: schema }, jest.fn());
      const next = jest.fn();
      const res = {} as Response;

      // ACT
      middleware(makeReq({ body: { name: 'Alice' } }), res, next);

      // ASSERT
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    test('When the body is valid, then it replaces req.body with the parsed result', () => {
      // ARRANGE
      const schema = z.object({ name: z.string() });
      const [middleware] = validateRequest({ body: schema }, jest.fn());
      const next = jest.fn();
      const res = {} as Response;
      const req = makeReq({ body: { name: 'Alice', extra: 'stripped' } });

      // ACT
      middleware(req, res, next);

      // ASSERT
      expect(req.body).toEqual({ name: 'Alice' });
    });

    test('When the body contains an invalid field type, then it forwards a ZodError to the error handler', () => {
      // ARRANGE
      const schema = z.object({ name: z.string() });
      const [middleware] = validateRequest({ body: schema }, jest.fn());
      const next = jest.fn();
      const res = {} as Response;

      // ACT
      middleware(makeReq({ body: { name: 42 } }), res, next);

      // ASSERT
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ZodError);
    });

    test('When a required body field is missing, then it forwards a ZodError to the error handler', () => {
      // ARRANGE
      const schema = z.object({ name: z.string() });
      const [middleware] = validateRequest({ body: schema }, jest.fn());
      const next = jest.fn();
      const res = {} as Response;

      // ACT
      middleware(makeReq({ body: {} }), res, next);

      // ASSERT
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ZodError);
    });
  });

  describe('headers validation', () => {
    test('When the headers are valid, then it calls next() with no args', () => {
      // ARRANGE
      const schema = z.object({ 'x-request-id': z.string() });
      const [middleware] = validateRequest({ headers: schema }, jest.fn());
      const next = jest.fn();
      const res = {} as Response;

      // ACT
      middleware(makeReq({ headers: { 'x-request-id': 'abc-123' } }), res, next);

      // ASSERT
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    test('When the headers are valid, then it merges the parsed result into req.headers preserving system headers', () => {
      // ARRANGE
      const schema = z.object({ 'x-request-id': z.string() });
      const [middleware] = validateRequest({ headers: schema }, jest.fn());
      const next = jest.fn();
      const res = {} as Response;
      const req = makeReq({ headers: { 'x-request-id': 'abc-123', host: 'localhost' } });

      // ACT
      middleware(req, res, next);

      // ASSERT
      expect(req.headers['x-request-id']).toBe('abc-123');
      expect(req.headers['host']).toBe('localhost');
    });

    test('When a required header is missing, then it forwards a ZodError to the error handler', () => {
      // ARRANGE
      const schema = z.object({ 'x-request-id': z.string() });
      const [middleware] = validateRequest({ headers: schema }, jest.fn());
      const next = jest.fn();
      const res = {} as Response;

      // ACT
      middleware(makeReq({ headers: {} }), res, next);

      // ASSERT
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ZodError);
    });
  });

  describe('combined body + headers validation', () => {
    test('When both headers and body are valid, then it calls next() with no args', () => {
      // ARRANGE
      const [middleware] = validateRequest(
        {
          headers: z.object({ 'x-request-id': z.string() }),
          body: z.object({ amount: z.number() }),
        },
        jest.fn(),
      );
      const next = jest.fn();
      const res = {} as Response;

      // ACT
      middleware(makeReq({ headers: { 'x-request-id': 'abc' }, body: { amount: 10 } }), res, next);

      // ASSERT
      expect(next).toHaveBeenCalledWith();
    });

    test('When headers fail validation, then it forwards a ZodError without validating the body', () => {
      // ARRANGE
      const [middleware] = validateRequest(
        {
          headers: z.object({ 'x-request-id': z.string() }),
          body: z.object({ amount: z.number() }),
        },
        jest.fn(),
      );
      const next = jest.fn();
      const res = {} as Response;

      // ACT
      middleware(makeReq({ headers: {}, body: { amount: 10 } }), res, next);

      // ASSERT
      const error = next.mock.calls[0][0] as unknown as ZodError;
      expect(error).toBeInstanceOf(ZodError);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('no schemas provided', () => {
    test('When no schemas are provided, then it calls next() unconditionally', () => {
      // ARRANGE
      const [middleware] = validateRequest({}, jest.fn());
      const next = jest.fn();
      const res = {} as Response;

      // ACT
      middleware(makeReq(), res, next);

      // ASSERT
      expect(next).toHaveBeenCalledWith();
    });
  });
});
