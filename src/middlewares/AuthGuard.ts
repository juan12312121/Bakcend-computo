import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../core/errors';
import { Usuario } from '../infrastructure/database/models';
import { tokenService, type TokenService } from '../infrastructure/security/TokenService';

/**
 * Guardas de autenticación reutilizables:
 *  - proteger: exige token en "Authorization: Bearer ..."
 *  - opcional: si hay token lo usa, si no sigue como anónimo
 *  - porQuery: para EventSource (SSE), que no puede mandar headers → ?token=
 *  - soloAdmin: después de proteger
 */
export class AuthGuard {
  constructor(private readonly tokens: TokenService) {}

  /**
   * Además del token, revisa que la cuenta siga habilitada (una suspensión surte efecto de inmediato)
   * y que el token sea de la versión vigente de las credenciales (cambiar la contraseña cierra las demás sesiones).
   */
  readonly proteger = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = this.extraer(req);
    if (!token) return next(new UnauthorizedError('No hay token'));
    const usuario = this.tokens.verificar(token);
    const cuenta = await Usuario.findByPk(usuario.id, { attributes: ['activo', 'suspendido', 'rol', 'token_version'] });
    if (!cuenta || !cuenta.activo) return next(new UnauthorizedError('La cuenta ya no existe'));
    if ((cuenta.token_version ?? 0) !== (usuario.version ?? 0)) {
      return next(new UnauthorizedError('Tu sesión ya no es válida, vuelve a iniciar sesión'));
    }
    if (cuenta.suspendido) return next(new ForbiddenError('Tu cuenta está suspendida'));
    req.usuario = { ...usuario, rol: cuenta.rol };
    next();
  };

  readonly opcional = (req: Request, _res: Response, next: NextFunction): void => {
    const token = this.extraer(req);
    if (token) {
      try {
        req.usuario = this.tokens.verificar(token);
      } catch {
        // Token vencido en una ruta pública: se atiende como anónimo.
      }
    }
    next();
  };

  readonly porQuery = (req: Request, _res: Response, next: NextFunction): void => {
    const token = typeof req.query.token === 'string' ? req.query.token : this.extraer(req);
    if (!token) return next(new UnauthorizedError('No se proporcionó token de autenticación'));
    req.usuario = this.tokens.verificar(token);
    next();
  };

  readonly soloAdmin = (req: Request, _res: Response, next: NextFunction): void => {
    if (req.usuario?.rol !== 'admin') return next(new ForbiddenError('Acceso solo para administradores'));
    next();
  };

  private extraer(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (!header) return undefined;
    return header.startsWith('Bearer ') ? header.slice(7) : header;
  }
}

export const auth = new AuthGuard(tokenService);
