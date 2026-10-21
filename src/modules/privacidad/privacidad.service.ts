import { BaseService } from '../../core/domain/BaseService';
import type { Bloqueo } from '../../infrastructure/database/models';
import { bloqueoRepository, type BloqueoRepository } from '../bloqueos/bloqueo.repository';
import { seguidorRepository, type SeguidorRepository } from '../seguidores/seguidor.repository';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';

/** Cómo se relaciona quien consulta con otro usuario (va en el perfil público). */
export interface RelacionUsuario {
  /** Lo sigo y la relación está aceptada. */
  lo_sigo: boolean;
  /** Le pedí seguirlo (cuenta privada) y aún no responde. */
  solicitud_pendiente: boolean;
  /** Me sigue (aceptado). */
  me_sigue: boolean;
  /** Yo lo bloqueé. */
  bloqueado_por_mi: boolean;
}

/**
 * Reglas de privacidad que comparten varios módulos (perfil, seguidores, feed, búsqueda, chat):
 * bloqueos en ambos sentidos y cuentas privadas. Solo lee; las acciones viven en `bloqueos` y `seguidores`.
 */
export class PrivacidadService extends BaseService<Bloqueo, BloqueoRepository> {
  constructor(
    repository: BloqueoRepository,
    private readonly seguidores: SeguidorRepository,
    private readonly usuarios: UsuarioRepository,
  ) {
    super(repository);
  }

  /** Ids que el usuario no debe ver ni lo deben ver: a quienes bloqueó y quienes lo bloquearon. */
  idsOcultosPara(usuarioId: number): Promise<number[]> {
    return this.repository.idsRelacionados(usuarioId);
  }

  /** true si alguno de los dos bloqueó al otro (uno mismo nunca cuenta). */
  async hayBloqueo(a: number, b: number): Promise<boolean> {
    if (a === b) return false;
    return this.repository.hayEntre(a, b);
  }

  /** true si `bloqueadorId` bloqueó a `bloqueadoId` (solo ese sentido). */
  async bloqueo(bloqueadorId: number, bloqueadoId: number): Promise<boolean> {
    if (bloqueadorId === bloqueadoId) return false;
    return (await this.repository.buscar(bloqueadorId, bloqueadoId)) !== null;
  }

  /**
   * Quién puede ver las publicaciones (y fotos, listas de seguidores...) de `autorId`:
   * el propio autor; cualquiera si la cuenta es pública y no hay bloqueo; si es privada,
   * solo quien la sigue con estado 'aceptado'. Sin sesión, solo cuentas públicas.
   */
  async puedeVerPublicacionesDe(autorId: number, viewerId?: number): Promise<boolean> {
    if (viewerId !== undefined && viewerId === autorId) return true;
    const autor = await this.usuarios.findById(autorId, { attributes: ['id', 'cuenta_privada'] });
    if (!autor) return false;
    if (viewerId !== undefined && (await this.hayBloqueo(autorId, viewerId))) return false;
    if (!autor.cuenta_privada) return true;
    if (viewerId === undefined) return false;
    const relacion = await this.seguidores.relacion(viewerId, autorId);
    return relacion?.estado === 'aceptado';
  }

  /** Relación de `viewerId` con `otroId` (seguimiento en ambos sentidos y bloqueo propio). */
  async relacion(viewerId: number, otroId: number): Promise<RelacionUsuario> {
    const [yoAEl, elAMi, bloqueadoPorMi] = await Promise.all([
      this.seguidores.relacion(viewerId, otroId),
      this.seguidores.relacion(otroId, viewerId),
      this.bloqueo(viewerId, otroId),
    ]);
    return {
      lo_sigo: yoAEl?.estado === 'aceptado',
      solicitud_pendiente: yoAEl?.estado === 'pendiente',
      me_sigue: elAMi?.estado === 'aceptado',
      bloqueado_por_mi: bloqueadoPorMi,
    };
  }
}

export const privacidadService = new PrivacidadService(bloqueoRepository, seguidorRepository, usuarioRepository);
