import { Request, Response, NextFunction } from 'express';

/**
 * Express middleware that logs incoming requests and response status with duration.
 *
 * @param req - Incoming HTTP request (body logged when non-empty).
 * @param res - HTTP response; `finish` event records status and latency.
 * @param next - Calls the next middleware in the chain.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  if (Object.keys(req.body ?? {}).length > 0) {
    console.log(`${req.method} ${req.originalUrl}`, JSON.stringify(req.body, null, 2));
  } else {
    console.log(`${req.method} ${req.originalUrl}`);
  }

  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
  });

  next();
}
