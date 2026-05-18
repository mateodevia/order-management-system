import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './app-error';

/**
 * Express error middleware: maps {@link AppError}, {@link ZodError}, and unknown errors to HTTP responses.
 *
 * @param err - Error passed from upstream middleware or route handlers.
 * @param _req - Express request (unused).
 * @param res - Express response used to send the error payload.
 * @param _next - Express next function (required 4-arg signature; unused).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function globalErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (err instanceof ZodError) {
    console.error('[input validation error]', JSON.stringify(err.issues));
    res.status(400).json({ error: 'Invalid payload structure' });
    return;
  }

  console.error('[unhandled exception]', err instanceof Error ? err.stack : err);
  res.status(500).json({ error: 'Internal Server Error' });
}
