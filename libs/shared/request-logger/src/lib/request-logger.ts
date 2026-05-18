import { customLogger } from '@oms/shared/monitoring';
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
    customLogger.info('incoming request', {
      method: req.method,
      url: req.originalUrl,
      body: req.body,
    });
  } else {
    customLogger.info('incoming request', { method: req.method, url: req.originalUrl });
  }

  res.on('finish', () => {
    customLogger.info('request completed', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    });
  });

  next();
}
