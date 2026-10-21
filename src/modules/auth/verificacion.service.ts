import { randomBytes } from 'crypto';
import { env } from '../../config/env';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, TooManyRequestsError } from '../../core/errors';
import { sequelize, type Usuario, type VerificacionEmail } from '../../infrastructure/database/models';
import { correoVerificarEmail, mailService, type MailService } from '../../infrastructure/mail';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { hashToken } from './contrasena.service';
import { verificacionRepository, type VerificacionRepository } from './verificacion.repository';

export interface OpcionesVerificacion {
  /** Base del enlace del correo (la página del frontend). */
  frontendUrl: string;
  horasVigencia: number;
  /** Tiempo mínimo entre dos correos de verificación del mismo usuario. */
  segundosEntreEnvios: number;
}

const OPCIONES_POR_DEFECTO: OpcionesVerificacion = {
  frontendUrl: env.FRONTEND_URL,
  horasVigencia: 24,
  segundosEntreEnvios: 60,
};

export const TOKEN_VERIFICACION_INVALIDO = 'El enlace para verificar tu correo no es válido o ya venció. Pide uno nuevo desde tu cuenta.';
export const CORREO_YA_VERIFICADO = 'Tu correo ya está verificado';
export const ESPERA_REENVIO = 'Ya te enviamos un correo hace menos de un minuto. Revisa tu bandeja (y la de spam) o espera un poco.';

export interface CorreoVerificado {
  usuario_id: number;
  email_verificado: true;
}

/**
 * Verificación del correo: mismo patrón que "olvidé mi contraseña" (token aleatorio de un solo uso,
 * solo se guarda su sha256). No bloquea el login: solo marca `usuarios.email_verificado`.
 */
export class VerificacionService extends BaseService<VerificacionEmail, VerificacionRepository> {
  private readonly opciones: OpcionesVerificacion;

  constructor(
    verificaciones: VerificacionRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly correo: MailService,
    opciones: Partial<OpcionesVerificacion> = {},
  ) {
    super(verificaciones);
    this.opciones = { ...OPCIONES_POR_DEFECTO, ...opciones };
  }

  /**
   * Crea un enlace nuevo (invalida los anteriores) y manda el correo sin esperar al SMTP.
   * Sin transacción a propósito: corre dentro del registro y en SQLite (pruebas) no se pueden
   * abrir transacciones en paralelo; si fallara la creación, el enlace viejo ya vencido no hace daño.
   */
  async enviar(usuario: Usuario): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    await this.repository.invalidarPendientes(usuario.id);
    await this.repository.create({
      usuario_id: usuario.id,
      token_hash: hashToken(token),
      expira_en: new Date(Date.now() + this.opciones.horasVigencia * 60 * 60_000),
    });
    this.enviarEnlace(usuario, token);
  }

  /** Con sesión: 400 si ya está verificado, 429 si pidió otro hace menos de un minuto. */
  async reenviar(usuarioId: number): Promise<void> {
    const usuario = await this.usuarios.findByIdOrFail(usuarioId);
    if (usuario.email_verificado) throw new BadRequestError(CORREO_YA_VERIFICADO);
    const desde = new Date(Date.now() - this.opciones.segundosEntreEnvios * 1000);
    if (await this.repository.pidioDesde(usuario.id, desde)) throw new TooManyRequestsError(ESPERA_REENVIO);
    await this.enviar(usuario);
  }

  /** Marca el correo como verificado; token usado, vencido o inventado → 400. */
  async verificar(token: string): Promise<CorreoVerificado> {
    const registro = await this.repository.buscarVigente(hashToken(token));
    const usuario = registro ? await this.usuarios.findById(registro.usuario_id) : null;
    if (!registro || !usuario) throw new BadRequestError(TOKEN_VERIFICACION_INVALIDO);

    await sequelize.transaction(async (t) => {
      await this.repository.marcarUsado(registro, t);
      await this.repository.invalidarPendientes(usuario.id, t);
      await this.usuarios.update(usuario, { email_verificado: true }, t);
    });
    return { usuario_id: usuario.id, email_verificado: true };
  }

  /** No se espera el envío: la respuesta no se retrasa ni falla si el SMTP tarda o cae. */
  private enviarEnlace(usuario: Usuario, token: string): void {
    const enlace = `${this.opciones.frontendUrl.replace(/\/+$/, '')}/verificar-correo?token=${encodeURIComponent(token)}`;
    const mensaje = correoVerificarEmail({
      para: usuario.email,
      nombre: usuario.nombre_completo || usuario.nombre_usuario,
      enlace,
      horasVigencia: this.opciones.horasVigencia,
    });
    this.correo.enviar(mensaje).catch((error: unknown) => {
      console.error(`[correo] No se pudo enviar la verificación a ${usuario.email}:`, error instanceof Error ? error.message : error);
    });
  }
}

export const verificacionService = new VerificacionService(verificacionRepository, usuarioRepository, mailService);
