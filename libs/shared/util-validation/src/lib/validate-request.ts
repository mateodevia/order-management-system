import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodTypeAny } from 'zod';

interface RequestSchemas<TBody extends ZodTypeAny, THeaders extends ZodTypeAny> {
  body?: TBody;
  headers?: THeaders;
}

type TypedRequest<TBody, THeaders> = Omit<Request, 'body' | 'headers'> & {
  body: TBody;
  headers: Request['headers'] & THeaders;
};

type TypedHandler<TBody, THeaders> = (
  req: TypedRequest<TBody, THeaders>,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

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
