import { Response } from 'express';

/**
 * Creates a minimal chained Jest mock of Express `Response` for unit tests.
 *
 * @returns Mock with `status` returning itself and a spyable `json` method.
 */
export function mockRes(): jest.Mocked<Pick<Response, 'status' | 'json'>> {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res as unknown as Response);
  return res;
}
