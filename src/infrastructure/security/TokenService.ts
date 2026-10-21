import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';
import { UnauthorizedError } from '../../core/errors';
import type { UsuarioAutenticado } from '../../core/http/BaseController';

export class TokenService {
  constructor(
    private readonly secreto: string = env.JWT_SECRET,
    private readonly expiracion: string = env.JWT_EXPIRE,
  ) {}

  firmar(usuario: UsuarioAutenticado): string {
    const payload: UsuarioAutenticado = {
      id: usuario.id,
      email: usuario.email,
      nombre_usuario: usuario.nombre_usuario,
      rol: usuario.rol,
      version: usuario.version ?? 0,
    };
    return jwt.sign(payload, this.secreto, { expiresIn: this.expiracion } as SignOptions);
  }

  verificar(token: string): UsuarioAutenticado {
    try {
      const datos = jwt.verify(token, this.secreto) as UsuarioAutenticado;
      return {
        id: Number(datos.id),
        email: datos.email,
        nombre_usuario: datos.nombre_usuario,
        rol: datos.rol ?? 'usuario',
        version: Number(datos.version ?? 0),
      };
    } catch {
      throw new UnauthorizedError('Token inválido o expirado');
    }
  }
}

export const tokenService = new TokenService();
