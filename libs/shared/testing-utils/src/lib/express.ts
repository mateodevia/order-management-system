import { Response } from 'express';

export function mockRes(): jest.Mocked<Pick<Response, 'status' | 'json'>> {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res as unknown as Response);
  return res;
}
