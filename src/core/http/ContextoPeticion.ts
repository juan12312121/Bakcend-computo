import type { Request } from 'express';

/** Datos de quién hizo la petición, para la bitácora de seguridad. */
export interface ContextoPeticion {
  ip?: string;
  userAgent?: string;
}

export function contextoDe(req: Request): ContextoPeticion {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}
