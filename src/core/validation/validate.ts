import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { ValidationError, type CampoError } from '../errors';

export interface RequestSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

const aCampos = (error: z.ZodError, origen: string): CampoError[] =>
  error.issues.map((issue) => ({
    campo: issue.path.length ? issue.path.join('.') : origen,
    mensaje: issue.message,
  }));

/**
 * Middleware de validación reutilizable.
 * Uso: router.post('/', validate({ body: crearSchema }), controller.crear)
 * Los datos ya validados y transformados reemplazan a req.body / req.params; los de
 * query quedan en res.locals.query (en Express 5 req.query es de solo lectura).
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const errores: CampoError[] = [];

    for (const origen of ['params', 'query', 'body'] as const) {
      const schema = schemas[origen];
      if (!schema) continue;

      const resultado = schema.safeParse(req[origen] ?? {});
      if (!resultado.success) {
        errores.push(...aCampos(resultado.error, origen));
        continue;
      }
      if (origen === 'query') res.locals.query = resultado.data;
      else req[origen] = resultado.data;
    }

    if (errores.length) return next(new ValidationError(errores));
    next();
  };
}

/** Lee la query ya validada por validate({ query }). */
export function validatedQuery<T>(res: Response): T {
  return res.locals.query as T;
}
