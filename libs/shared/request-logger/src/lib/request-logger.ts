import { Request, Response, NextFunction } from 'express';

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
