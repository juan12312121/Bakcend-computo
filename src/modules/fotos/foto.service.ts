import { BaseService } from '../../core/domain/BaseService';
import type { PageMeta } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import type { Publicacion, Usuario } from '../../infrastructure/database/models';
import { publicacionRepository, type PublicacionRepository } from '../publicaciones/publicacion.repository';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { fotoRepository, type FotoRepository } from './foto.repository';
import { urlPublica } from './foto.url';

export interface FotoActual {
  url: string;
  tipo: 'perfil' | 'portada';
  es_actual: true;
  fecha: Date;
}

export interface FotoPublicacion {
  id: number;
  url: string | null;
  descripcion: string;
  fecha: Date;
  tipo: 'publicacion';
}

export interface Galeria {
  usuario: { id: number; nombre_completo: string; nombre_usuario: string };
  fotos: {
    perfil_actual: FotoActual | null;
    portada_actual: FotoActual | null;
    perfil_historial: FotoActual[];
    portada_historial: FotoActual[];
    publicaciones: FotoPublicacion[];
  };
  estadisticas: {
    total_fotos: number;
    fotos_perfil_total: number;
    fotos_portada_total: number;
    fotos_publicaciones: number;
  };
  /** Paginación de `fotos.publicaciones`. */
  paginacion: PageMeta;
}

export interface FotoPerfilSimple {
  id: number;
  nombre_completo: string;
  nombre_usuario: string;
  foto_perfil_url: string | null;
}

export class FotoService extends BaseService<Publicacion, FotoRepository> {
  constructor(
    repository: FotoRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly publicaciones: PublicacionRepository,
  ) {
    super(repository);
  }

  /** Galería de un usuario: perfil, portada y fotos de las publicaciones que quien mira puede ver. */
  async galeria(duenoId: number, usuarioId: number | undefined, paginacion: Paginacion): Promise<Galeria> {
    const usuario = await this.usuarios.findByIdOrFail(duenoId);
    const visibles = await this.publicaciones.filtroVisibles(usuarioId);
    const pagina = await this.repository.deUsuario(duenoId, visibles, paginacion);

    const perfil = FotoService.actual(usuario, 'perfil');
    const portada = FotoService.actual(usuario, 'portada');
    const publicaciones = pagina.items.map<FotoPublicacion>((p) => ({
      id: p.id,
      url: urlPublica(p.imagen_url, 'publicacion'),
      descripcion: (p.contenido ?? '').substring(0, 100),
      fecha: p.fecha_creacion,
      tipo: 'publicacion',
    }));
    const perfiles = perfil ? [perfil] : [];
    const portadas = portada ? [portada] : [];

    return {
      usuario: { id: usuario.id, nombre_completo: usuario.nombre_completo, nombre_usuario: usuario.nombre_usuario },
      fotos: {
        perfil_actual: perfil,
        portada_actual: portada,
        perfil_historial: perfiles,
        portada_historial: portadas,
        publicaciones,
      },
      estadisticas: {
        total_fotos: perfiles.length + portadas.length + pagina.total,
        fotos_perfil_total: perfiles.length,
        fotos_portada_total: portadas.length,
        fotos_publicaciones: pagina.total,
      },
      paginacion: {
        total: pagina.total,
        limit: pagina.limit,
        offset: pagina.offset,
        hayMas: pagina.offset + pagina.items.length < pagina.total,
      },
    };
  }

  async fotoPerfil(usuarioId: number): Promise<FotoPerfilSimple> {
    return FotoService.simple(await this.usuarios.findByIdOrFail(usuarioId));
  }

  /** Fotos de perfil de varios usuarios a la vez (cuentas deshabilitadas se omiten). */
  async fotosPerfil(ids: number[]): Promise<FotoPerfilSimple[]> {
    const usuarios = await this.usuarios.findAll(
      { id: ids, activo: true },
      { attributes: ['id', 'nombre_completo', 'nombre_usuario', 'foto_perfil_url'] },
    );
    return usuarios.map(FotoService.simple);
  }

  private static simple(u: Usuario): FotoPerfilSimple {
    return {
      id: u.id,
      nombre_completo: u.nombre_completo,
      nombre_usuario: u.nombre_usuario,
      foto_perfil_url: urlPublica(u.foto_perfil_url, 'perfil'),
    };
  }

  private static actual(usuario: Usuario, tipo: FotoActual['tipo']): FotoActual | null {
    const url = urlPublica(tipo === 'perfil' ? usuario.foto_perfil_url : usuario.foto_portada_url, tipo);
    return url ? { url, tipo, es_actual: true, fecha: usuario.fecha_actualizacion } : null;
  }
}

export const fotoService = new FotoService(fotoRepository, usuarioRepository, publicacionRepository);
