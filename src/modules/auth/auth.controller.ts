import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { contextoDe } from '../../core/http/ContextoPeticion';
import { validatedQuery } from '../../core/validation/validate';
import { authService, type AuthService } from './auth.service';
import type { ValidarTokenQuery, VerificarCorreoQuery } from './auth.schemas';
import { contrasenaService, type ContrasenaService } from './contrasena.service';
import { verificacionService, type VerificacionService } from './verificacion.service';

/** Mismo texto exista o no el email (no se revela quién tiene cuenta). */
export const MENSAJE_OLVIDE = 'Si el email está registrado, te enviaremos un enlace para restablecer tu contraseña.';

export class AuthController extends BaseController {
  constructor(
    private readonly service: AuthService,
    private readonly contrasenas: ContrasenaService,
    private readonly verificaciones: VerificacionService,
  ) {
    super();
  }

  registro = async (req: Request, res: Response) => {
    const sesion = await this.service.registrar(req.body);
    return this.created(res, sesion, 'Usuario registrado. Completa tu perfil desde la configuración.');
  };

  login = async (req: Request, res: Response) => {
    const sesion = await this.service.login(req.body, contextoDe(req));
    return this.ok(res, sesion, 'Inicio de sesión exitoso');
  };

  logout = async (req: Request, res: Response) => {
    await this.service.logout(this.usuarioId(req));
    return this.message(res, 'Sesión cerrada');
  };

  verificar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.verificar(this.usuarioId(req)), 'Token válido');
  };

  // ---------- Contraseña ----------

  olvideContrasena = async (req: Request, res: Response) => {
    await this.contrasenas.solicitar(req.body, contextoDe(req));
    return this.message(res, MENSAJE_OLVIDE);
  };

  validarRestablecimiento = async (_req: Request, res: Response) => {
    const { token } = validatedQuery<ValidarTokenQuery>(res);
    const valido = await this.contrasenas.validar(token);
    return this.ok(res, { valido }, valido ? 'Enlace válido' : 'El enlace no es válido o ya venció');
  };

  restablecerContrasena = async (req: Request, res: Response) => {
    await this.contrasenas.restablecer(req.body, contextoDe(req));
    return this.message(res, 'Contraseña actualizada. Ya puedes iniciar sesión.');
  };

  cambiarContrasena = async (req: Request, res: Response) => {
    const { token } = await this.contrasenas.cambiar(this.usuarioId(req), req.body, contextoDe(req));
    return this.ok(res, { token }, 'Contraseña actualizada. Se cerraron tus otras sesiones.');
  };

  // ---------- Verificar correo ----------

  verificarCorreo = async (_req: Request, res: Response) => {
    const { token } = validatedQuery<VerificarCorreoQuery>(res);
    return this.ok(res, await this.verificaciones.verificar(token), '¡Listo! Tu correo quedó verificado.');
  };

  reenviarVerificacion = async (req: Request, res: Response) => {
    await this.verificaciones.reenviar(this.usuarioId(req));
    return this.message(res, 'Te enviamos un nuevo enlace para verificar tu correo.');
  };
}

export const authController = new AuthController(authService, contrasenaService, verificacionService);
