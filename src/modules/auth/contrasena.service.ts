import { createHash, randomBytes } from 'crypto';
import { env } from '../../config/env';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ValidationError } from '../../core/errors';
import type { ContextoPeticion } from '../../core/http/ContextoPeticion';
import { sequelize, type RestablecimientoContrasena, type Usuario } from '../../infrastructure/database/models';
import { correoRestablecerContrasena, mailService, type MailService } from '../../infrastructure/mail';
import { passwordHasher, type PasswordHasher } from '../../infrastructure/security/PasswordHasher';
import { tokenService, type TokenService } from '../../infrastructure/security/TokenService';
import { logSeguridadRepository, type LogSeguridadRepository } from '../seguridad/log-seguridad.repository';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import type { CambiarContrasenaDto, OlvideContrasenaDto, RestablecerContrasenaDto } from './auth.schemas';
import { restablecimientoRepository, type RestablecimientoRepository } from './restablecimiento.repository';

export interface OpcionesRestablecimiento {
  /** Base del enlace del correo (la página del frontend). */
  frontendUrl: string;
  minutosVigencia: number;
  maxSolicitudesPorHora: number;
}

const OPCIONES_POR_DEFECTO: OpcionesRestablecimiento = {
  frontendUrl: env.FRONTEND_URL,
  minutosVigencia: 60,
  maxSolicitudesPorHora: 3,
};

export const TOKEN_INVALIDO = 'El enlace para restablecer la contraseña no es válido o ya venció. Solicita uno nuevo.';

/** Hash con el que se guarda y se busca el token (nunca se guarda en claro). */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Recuperar contraseña por correo y cambiarla con sesión.
 * El correo se inyecta por constructor (MailService), así las pruebas usan uno falso.
 */
export class ContrasenaService extends BaseService<RestablecimientoContrasena, RestablecimientoRepository> {
  private readonly opciones: OpcionesRestablecimiento;

  constructor(
    restablecimientos: RestablecimientoRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly hasher: PasswordHasher,
    private readonly correo: MailService,
    private readonly bitacora: LogSeguridadRepository,
    private readonly tokens: TokenService,
    opciones: Partial<OpcionesRestablecimiento> = {},
  ) {
    super(restablecimientos);
    this.opciones = { ...OPCIONES_POR_DEFECTO, ...opciones };
  }

  /**
   * Nunca revela si el email existe: el controlador responde lo mismo pase lo que pase.
   * Solo cuentas activas reciben correo, y como máximo `maxSolicitudesPorHora` por hora.
   */
  async solicitar({ email }: OlvideContrasenaDto, contexto: ContextoPeticion = {}): Promise<void> {
    const usuario = await this.usuarios.buscarPorEmail(email);
    if (!usuario || !usuario.activo) {
      await this.bitacora.registrar(null, 'restablecimiento_email_desconocido', '', contexto);
      return;
    }

    const haceUnaHora = new Date(Date.now() - 60 * 60_000);
    if ((await this.repository.solicitudesDesde(usuario.id, haceUnaHora)) >= this.opciones.maxSolicitudesPorHora) {
      await this.bitacora.registrar(usuario.id, 'restablecimiento_limite', `Más de ${this.opciones.maxSolicitudesPorHora} por hora`, contexto);
      return;
    }

    const token = randomBytes(32).toString('base64url');
    await sequelize.transaction(async (t) => {
      await this.repository.invalidarPendientes(usuario.id, t);
      await this.repository.create(
        {
          usuario_id: usuario.id,
          token_hash: hashToken(token),
          expira_en: new Date(Date.now() + this.opciones.minutosVigencia * 60_000),
          ip: contexto.ip ?? null,
        },
        t,
      );
      await this.bitacora.registrar(usuario.id, 'restablecimiento_solicitado', '', contexto, t);
    });

    this.enviarEnlace(usuario, token);
  }

  /** Para que la página avise antes de pedir la contraseña nueva. */
  async validar(token: string): Promise<boolean> {
    return (await this.vigente(token)) !== null;
  }

  async restablecer({ token, contrasena }: RestablecerContrasenaDto, contexto: ContextoPeticion = {}): Promise<void> {
    const encontrado = await this.vigente(token);
    if (!encontrado) {
      await this.bitacora.registrar(null, 'restablecimiento_invalido', '', contexto);
      throw new BadRequestError(TOKEN_INVALIDO);
    }
    const { registro, usuario } = encontrado;
    const hash = await this.hasher.encriptar(contrasena);

    await sequelize.transaction(async (t) => {
      await this.repository.marcarUsado(registro, t);
      await this.repository.invalidarPendientes(usuario.id, t);
      // Restablecer también quita el bloqueo por intentos fallidos.
      await this.usuarios.update(
        usuario,
        { contrasena: hash, intentos_fallidos: 0, bloqueo_hasta: null, token_version: (usuario.token_version ?? 0) + 1 },
        t,
      );
      await this.bitacora.registrar(usuario.id, 'contrasena_restablecida', '', contexto, t);
    });
  }

  /**
   * Cambio con sesión: exige la contraseña actual. Cierra las demás sesiones (sube token_version)
   * y devuelve un token nuevo para que quien la cambió siga dentro.
   */
  async cambiar(usuarioId: number, { actual, nueva }: CambiarContrasenaDto, contexto: ContextoPeticion = {}): Promise<{ token: string }> {
    const usuario = await this.usuarios.findByIdOrFail(usuarioId);

    if (!(await this.hasher.comparar(actual, usuario.contrasena))) {
      await this.bitacora.registrar(usuario.id, 'cambio_contrasena_fallido', 'Contraseña actual incorrecta', contexto);
      throw new ValidationError([{ campo: 'actual', mensaje: 'La contraseña actual es incorrecta' }], 'La contraseña actual es incorrecta');
    }
    if (nueva === actual) throw new BadRequestError('La nueva contraseña debe ser distinta de la actual');

    const hash = await this.hasher.encriptar(nueva);
    await sequelize.transaction(async (t) => {
      await this.usuarios.update(usuario, { contrasena: hash, token_version: (usuario.token_version ?? 0) + 1 }, t);
      await this.repository.invalidarPendientes(usuario.id, t);
      await this.bitacora.registrar(usuario.id, 'contrasena_cambiada', '', contexto, t);
    });
    const token = this.tokens.firmar({
      id: usuario.id,
      email: usuario.email,
      nombre_usuario: usuario.nombre_usuario,
      rol: usuario.rol ?? 'usuario',
      version: usuario.token_version,
    });
    return { token };
  }

  // ---------- Internos ----------

  /** Registro vigente + su usuario (activo); null si el token no sirve. */
  private async vigente(token: string): Promise<{ registro: RestablecimientoContrasena; usuario: Usuario } | null> {
    const registro = await this.repository.buscarVigente(hashToken(token));
    if (!registro) return null;
    const usuario = await this.usuarios.findById(registro.usuario_id);
    return usuario ? { registro, usuario } : null;
  }

  /** No se espera el envío: la respuesta no se retrasa ni falla si el SMTP tarda o cae. */
  private enviarEnlace(usuario: Usuario, token: string): void {
    const enlace = `${this.opciones.frontendUrl.replace(/\/+$/, '')}/restablecer-contrasena?token=${encodeURIComponent(token)}`;
    const mensaje = correoRestablecerContrasena({
      para: usuario.email,
      nombre: usuario.nombre_completo || usuario.nombre_usuario,
      enlace,
      minutosVigencia: this.opciones.minutosVigencia,
    });
    this.correo.enviar(mensaje).catch((error: unknown) => {
      console.error(`[correo] No se pudo enviar el restablecimiento a ${usuario.email}:`, error instanceof Error ? error.message : error);
    });
  }
}

export const contrasenaService = new ContrasenaService(
  restablecimientoRepository,
  usuarioRepository,
  passwordHasher,
  mailService,
  logSeguridadRepository,
  tokenService,
);
