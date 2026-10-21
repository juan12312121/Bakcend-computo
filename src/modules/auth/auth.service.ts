import { ConflictError, ForbiddenError, TooManyRequestsError, UnauthorizedError } from '../../core/errors';
import type { ContextoPeticion } from '../../core/http/ContextoPeticion';
import type { Usuario } from '../../infrastructure/database/models';
import { passwordHasher, type PasswordHasher } from '../../infrastructure/security/PasswordHasher';
import { tokenService, type TokenService } from '../../infrastructure/security/TokenService';
import { logSeguridadRepository, type LogSeguridadRepository } from '../seguridad/log-seguridad.repository';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import type { LoginDto, RegistroDto } from './auth.schemas';
import { verificacionService, type VerificacionService } from './verificacion.service';
import { asegurarTextoPermitido } from '../moderacion/palabras.service';

export interface Sesion {
  usuario: Usuario;
  token: string;
}

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;

export class AuthService {
  constructor(
    private readonly usuarios: UsuarioRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly bitacora: LogSeguridadRepository,
    private readonly verificaciones: VerificacionService,
  ) {}

  async registrar(datos: RegistroDto): Promise<Sesion> {
    datos = { ...datos, nombre_usuario: await asegurarTextoPermitido(datos.nombre_usuario, 'nombre'), nombre_completo: await asegurarTextoPermitido(datos.nombre_completo, 'nombre') };
    const duplicado = await this.usuarios.existeEmailOUsuario(datos.email, datos.nombre_usuario);
    if (duplicado === 'email') throw new ConflictError('El email ya está registrado');
    if (duplicado === 'nombre_usuario') throw new ConflictError('El nombre de usuario ya está en uso');

    const usuario = await this.usuarios.create({ ...datos, contrasena: await this.hasher.encriptar(datos.contrasena) });
    // Correo de "verifica tu correo" (no bloquea el login: solo marca email_verificado al abrir el enlace).
    await this.verificaciones.enviar(usuario);
    return this.sesionPara(usuario);
  }

  async login({ email, contrasena }: LoginDto, contexto: ContextoPeticion = {}): Promise<Sesion> {
    const usuario = await this.usuarios.buscarPorCredencial(email);
    if (!usuario) throw new UnauthorizedError('Credenciales inválidas');

    if (usuario.bloqueo_hasta && usuario.bloqueo_hasta > new Date()) {
      throw new TooManyRequestsError('Cuenta bloqueada temporalmente por intentos fallidos, intenta más tarde');
    }

    if (!(await this.hasher.comparar(contrasena, usuario.contrasena))) {
      await this.registrarFallo(usuario, contexto);
      throw new UnauthorizedError('Credenciales inválidas');
    }

    if (!usuario.activo) throw new ForbiddenError('Cuenta desactivada');
    if (usuario.suspendido) throw new ForbiddenError('Tu cuenta está suspendida');

    await this.usuarios.update(usuario, { intentos_fallidos: 0, bloqueo_hasta: null, en_linea: true, ultima_actividad: new Date() });
    await this.bitacora.registrar(usuario.id, 'login_exitoso', '', contexto);
    return this.sesionPara(usuario);
  }

  async logout(usuarioId: number): Promise<void> {
    await this.usuarios.marcarPresencia(usuarioId, false);
  }

  verificar(usuarioId: number): Promise<Usuario> {
    return this.usuarios.findByIdOrFail(usuarioId);
  }

  private sesionPara(usuario: Usuario): Sesion {
    const token = this.tokens.firmar({
      id: usuario.id,
      email: usuario.email,
      nombre_usuario: usuario.nombre_usuario,
      rol: usuario.rol ?? 'usuario',
      version: usuario.token_version ?? 0,
    });
    return { usuario, token };
  }

  private async registrarFallo(usuario: Usuario, contexto: ContextoPeticion): Promise<void> {
    const intentos = (usuario.intentos_fallidos ?? 0) + 1;
    const bloqueo = intentos >= MAX_INTENTOS ? new Date(Date.now() + MINUTOS_BLOQUEO * 60_000) : null;
    await this.usuarios.update(usuario, { intentos_fallidos: bloqueo ? 0 : intentos, bloqueo_hasta: bloqueo });
    await this.bitacora.registrar(usuario.id, bloqueo ? 'cuenta_bloqueada' : 'login_fallido', `Intento ${intentos}`, contexto);
  }
}

export const authService = new AuthService(usuarioRepository, passwordHasher, tokenService, logSeguridadRepository, verificacionService);
