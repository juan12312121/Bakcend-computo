import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, NotFoundError } from '../../core/errors';
import type { Usuario } from '../../infrastructure/database/models';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import { privacidadService, type PrivacidadService, type RelacionUsuario } from '../privacidad/privacidad.service';
import { seguidorService } from '../seguidores/seguidor.service';
import { usuarioRepository, type UsuarioRepository } from './usuario.repository';
import type { ActualizarPerfilDto } from './usuario.schemas';
import { asegurarTextoPermitido } from '../moderacion/palabras.service';

export interface FotosPerfil {
  foto_perfil?: ArchivoSubido;
  foto_portada?: ArchivoSubido;
}

/** Perfil de otra persona: datos públicos + `cuenta_privada` + mi relación con ella. */
export type PerfilAjeno = Record<string, unknown> & { cuenta_privada: boolean; relacion: RelacionUsuario };

/** Lo que el perfil necesita de seguidores (acepta las solicitudes al volver pública la cuenta). */
export interface AceptadorSolicitudes {
  aceptarPendientes(usuarioId: number): Promise<number>;
}

export class UsuarioService extends BaseService<Usuario, UsuarioRepository> {
  constructor(
    repository: UsuarioRepository,
    private readonly storage: FileStorage,
    private readonly privacidad: PrivacidadService,
    private readonly solicitudes: AceptadorSolicitudes,
  ) {
    super(repository);
  }

  /**
   * Perfil de `id` visto por `viewerId`. Si `id` bloqueó a quien consulta → 404 (no se revela la cuenta).
   * Si quien consulta lo bloqueó, sí lo ve (con `relacion.bloqueado_por_mi`) para poder desbloquearlo.
   */
  async perfilPara(id: number, viewerId: number): Promise<PerfilAjeno> {
    const usuario = await this.repository.findByIdOrFail(id);
    if (await this.privacidad.bloqueo(id, viewerId)) throw new NotFoundError('Usuario');
    const relacion = await this.privacidad.relacion(viewerId, id);
    const { email_verificado: _e, ...publico } = usuario.perfilPublico() as Record<string, unknown>;
    return { ...publico, cuenta_privada: usuario.cuenta_privada ?? false, relacion };
  }

  async actualizarPerfil(usuarioId: number, datos: ActualizarPerfilDto, fotos: FotosPerfil = {}): Promise<Usuario> {
    datos = {
      ...datos,
      nombre_completo: await asegurarTextoPermitido(datos.nombre_completo, 'nombre'),
      biografia: await asegurarTextoPermitido(datos.biografia, 'publicacion'),
    };
    const usuario = await this.repository.findByIdOrFail(usuarioId);
    const eraPrivada = usuario.cuenta_privada ?? false;
    const cambios: Partial<Usuario> = { ...datos };

    if (fotos.foto_perfil) {
      cambios.foto_perfil_url = fotos.foto_perfil.url;
      cambios.foto_perfil_s3 = fotos.foto_perfil.id;
    }
    if (fotos.foto_portada) {
      cambios.foto_portada_url = fotos.foto_portada.url;
      cambios.foto_portada_s3 = fotos.foto_portada.id;
    }

    if (Object.values(cambios).every((v) => v === undefined)) {
      throw new BadRequestError('No hay datos para actualizar');
    }

    const anteriores = [
      fotos.foto_perfil && usuario.foto_perfil_s3,
      fotos.foto_portada && usuario.foto_portada_s3,
    ];
    const actualizado = await this.repository.update(usuario, cambios);
    await Promise.all(anteriores.map((id) => (id ? this.storage.eliminar(id) : false)));

    // Pasó de privada a pública: las solicitudes pendientes se aceptan (cambian los contadores).
    if (eraPrivada && datos.cuenta_privada === false && (await this.solicitudes.aceptarPendientes(usuarioId)) > 0) {
      return this.repository.findByIdOrFail(usuarioId);
    }
    return actualizado;
  }

  /** Borrado lógico: la cuenta queda deshabilitada y se liberan sus fotos. */
  async eliminarCuenta(usuarioId: number): Promise<void> {
    const usuario = await this.repository.findByIdOrFail(usuarioId);
    await Promise.all([this.storage.eliminar(usuario.foto_perfil_s3), this.storage.eliminar(usuario.foto_portada_s3)]);
    await this.repository.update(usuario, {
      activo: false,
      en_linea: false,
      foto_perfil_url: null,
      foto_perfil_s3: null,
      foto_portada_url: null,
      foto_portada_s3: null,
    });
  }

  /** Búsqueda sin los usuarios con bloqueo de por medio (si hay quien consulta). */
  buscar(termino: string, limite: number): Promise<Usuario[]>;
  buscar(termino: string, limite: number, viewerId: number): Promise<Usuario[]>;
  async buscar(termino: string, limite: number, viewerId?: number): Promise<Usuario[]> {
    const ocultos = viewerId === undefined ? [] : await this.privacidad.idsOcultosPara(viewerId);
    return this.repository.buscar(termino, limite, ocultos);
  }

  async marcarPresencia(usuarioId: number, enLinea: boolean): Promise<{ en_linea: boolean; ultima_actividad: Date }> {
    await this.repository.marcarPresencia(usuarioId, enLinea);
    return { en_linea: enLinea, ultima_actividad: new Date() };
  }

  /** Conectados ahora (sin los usuarios con bloqueo de por medio, si hay quien consulta). */
  usuariosEnLinea(): Promise<Usuario[]>;
  usuariosEnLinea(viewerId: number): Promise<Usuario[]>;
  async usuariosEnLinea(viewerId?: number): Promise<Usuario[]> {
    const ocultos = viewerId === undefined ? [] : await this.privacidad.idsOcultosPara(viewerId);
    return this.repository.enLinea(ocultos);
  }

  seguidoresEnLinea(usuarioId: number): Promise<Usuario[]> {
    return this.repository.seguidoresEnLinea(usuarioId);
  }
}

export const usuarioService = new UsuarioService(usuarioRepository, fileStorage, privacidadService, seguidorService);
