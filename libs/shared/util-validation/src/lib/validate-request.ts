import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodTypeAny } from 'zod';

/** Zod schemas applied to an Express request before the route handler runs. */
interface RequestSchemas<TBody extends ZodTypeAny, THeaders extends ZodTypeAny> {
  body?: TBody;
  headers?: THeaders;
}

/** Express request with body and headers narrowed to validated Zod output types. */
type TypedRequest<TBody, THeaders> = Omit<Request, 'body' | 'headers'> & {
  body: TBody;
  headers: Request['headers'] & THeaders;
};

/** Route handler receiving a {@link TypedRequest} after successful validation. */
type TypedHandler<TBody, THeaders> = (
  req: TypedRequest<TBody, THeaders>,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

/**
 * Returns Express middleware that validates headers/body with Zod, then runs the handler.
 *
 * Validation failures are passed to `next(error)` as a {@link ZodError} for the global handler.
 *
 * @param schemas - Optional Zod schemas for `headers` and/or `body`.
 * @param handler - Typed route handler executed only when parsing succeeds.
 * @returns Tuple `[validateMiddleware, handler]` suitable for spread in route definitions.
 */
export function validateRequest<TBody extends ZodTypeAny, THeaders extends ZodTypeAny>(
  schemas: RequestSchemas<TBody, THeaders>,
  handler: TypedHandler<z.infer<TBody>, z.infer<THeaders>>,
): RequestHandler[] {
  const validate: RequestHandler = (req, _res, next) => {
    if (schemas.headers) {
      const result = schemas.headers.safeParse(req.headers);
      if (!result.success) {
        next(result.error);
        return;
      }
      Object.assign(req.headers, result.data);
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        next(result.error);
        return;
      }
      req.body = result.data;
    }

    next();
  };

  return [validate, handler as RequestHandler];
}
