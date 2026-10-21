import type { InferAttributes, Sequelize } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { sequelize, type EstadoSeguimiento, type Seguidor, type Usuario } from '../../infrastructure/database/models';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { privacidadService, type PrivacidadService } from '../privacidad/privacidad.service';
import { ATRIBUTOS_USUARIO_PUBLICO, usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { seguidorRepository, type LadoRelacion, type SeguidorRepository } from './seguidor.repository';

/** Respuesta de seguir / dejar de seguir / toggle. */
export interface ResultadoSeguimiento {
  /** true solo si la relación quedó aceptada. */
  siguiendo: boolean;
  /** Estado final: 'aceptado', 'pendiente' (solicitud a una cuenta privada) o null (sin relación). */
  estado: EstadoSeguimiento | null;
  /** Seguidores del usuario seguido tras la operación. */
  total_seguidores: number;
}

/** Usuario dentro de un listado de seguidores o seguidos. */
export type UsuarioEnLista = Pick<InferAttributes<Usuario>, (typeof ATRIBUTOS_USUARIO_PUBLICO)[number]> & {
  siguiendo_desde: Date;
  /** Si el usuario autenticado lo sigue (aceptado). */
  lo_sigo: boolean;
  /** Si el usuario autenticado le pidió seguirlo y aún no responde. */
  solicitud_pendiente: boolean;
};

/** Solicitud de seguimiento recibida (quién la mandó y cuándo). */
export type SolicitudSeguimiento = Pick<InferAttributes<Usuario>, (typeof ATRIBUTOS_USUARIO_PUBLICO)[number]> & {
  solicitado_en: Date;
};

/** Respuesta de aceptar una solicitud. */
export interface SolicitudAceptada {
  seguidor_id: number;
  estado: 'aceptado';
  /** Mis seguidores después de aceptar. */
  total_seguidores: number;
}

export class SeguidorService extends BaseService<Seguidor, SeguidorRepository> {
  constructor(
    repository: SeguidorRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly notificaciones: NotificacionService,
    private readonly privacidad: PrivacidadService,
    private readonly db: Sequelize,
  ) {
    super(repository);
  }

  /** Cuenta pública → 'aceptado' y notificación 'follow'; privada → 'pendiente' y 'solicitud_seguimiento'. */
  async seguir(seguidorId: number, seguidoId: number): Promise<ResultadoSeguimiento> {
    const seguido = await this.validarDestino(seguidorId, seguidoId);
    const estado: EstadoSeguimiento = seguido.cuenta_privada ? 'pendiente' : 'aceptado';

    await this.db.transaction(async (t) => {
      const existente = await this.repository.relacion(seguidorId, seguidoId, t);
      if (existente) {
        throw new ConflictError(existente.estado === 'pendiente' ? 'Ya le enviaste una solicitud a este usuario' : 'Ya sigues a este usuario');
      }
      await this.repository.create({ seguidor_id: seguidorId, siguiendo_id: seguidoId, estado }, t);
      if (estado === 'aceptado') await this.repository.ajustarContadores(seguidorId, seguidoId, 1, t);
    });

    await this.notificaciones.notificar(
      estado === 'aceptado'
        ? { usuario_id: seguidoId, de_usuario_id: seguidorId, tipo: 'follow', mensaje: 'comenzó a seguirte' }
        : {
            usuario_id: seguidoId,
            de_usuario_id: seguidorId,
            tipo: 'solicitud_seguimiento',
            mensaje: 'quiere seguirte',
            entidad_tipo: 'usuario',
            entidad_id: seguidorId,
          },
    );
    return this.resultado(seguidoId, estado);
  }

  /** Deja de seguir o cancela la solicitud pendiente (y retira su notificación). */
  async dejarDeSeguir(seguidorId: number, seguidoId: number): Promise<ResultadoSeguimiento> {
    const quitada = await this.db.transaction(async (t) => {
      const relacion = await this.repository.quitar(seguidorId, seguidoId, t);
      if (!relacion) throw new NotFoundError('Seguimiento', 'No sigues a este usuario');
      return relacion;
    });

    await this.notificaciones.retirar({
      usuario_id: seguidoId,
      de_usuario_id: seguidorId,
      tipo: quitada.estado === 'pendiente' ? 'solicitud_seguimiento' : 'follow',
    });
    return this.resultado(seguidoId, null);
  }

  /** Sigue (o pide seguir) si no había relación; si la había (aceptada o pendiente), la quita. */
  async toggle(seguidorId: number, seguidoId: number): Promise<ResultadoSeguimiento> {
    if (seguidorId === seguidoId) throw new BadRequestError('No puedes seguirte a ti mismo');
    return (await this.repository.relacion(seguidorId, seguidoId))
      ? this.dejarDeSeguir(seguidorId, seguidoId)
      : this.seguir(seguidorId, seguidoId);
  }

  async verificar(seguidorId: number, seguidoId: number): Promise<{ siguiendo: boolean; solicitud_pendiente: boolean }> {
    const relacion = await this.repository.relacion(seguidorId, seguidoId);
    return { siguiendo: relacion?.estado === 'aceptado', solicitud_pendiente: relacion?.estado === 'pendiente' };
  }

  async estadisticas(usuarioId: number): Promise<{ seguidores: number; seguidos: number }> {
    await this.usuarios.findByIdOrFail(usuarioId);
    return this.repository.contar(usuarioId);
  }

  /**
   * Listado paginado de seguidores o seguidos (solo aceptados); con observador se marca `lo_sigo`.
   * Con bloqueo entre ambos → 404; cuenta privada que el observador no sigue → 403.
   * Los bloqueados del observador no aparecen en la lista.
   */
  listar(usuarioId: number, lado: LadoRelacion, paginacion: Paginacion): Promise<Page<UsuarioEnLista>>;
  listar(usuarioId: number, lado: LadoRelacion, paginacion: Paginacion, observadorId: number): Promise<Page<UsuarioEnLista>>;
  async listar(usuarioId: number, lado: LadoRelacion, paginacion: Paginacion, observadorId?: number): Promise<Page<UsuarioEnLista>> {
    let excluir: number[] = [];
    if (observadorId !== undefined) {
      if (await this.privacidad.hayBloqueo(usuarioId, observadorId)) throw new NotFoundError('Usuario');
      if (!(await this.privacidad.puedeVerPublicacionesDe(usuarioId, observadorId))) {
        await this.usuarios.findByIdOrFail(usuarioId);
        throw new ForbiddenError('Esta cuenta es privada');
      }
      excluir = await this.privacidad.idsOcultosPara(observadorId);
    }

    const page = await this.repository.paginarUsuarios(usuarioId, lado, paginacion, { excluir });
    const ids = page.items.map(({ usuario }) => usuario.id);
    const [losSigo, pendientes] = observadorId
      ? await Promise.all([this.repository.seguidosEntre(observadorId, ids), this.repository.seguidosEntre(observadorId, ids, 'pendiente')])
      : [new Set<number>(), new Set<number>()];

    return {
      ...page,
      items: page.items.map(({ usuario, desde }) => ({
        ...(usuario.toJSON() as UsuarioEnLista),
        siguiendo_desde: desde,
        lo_sigo: losSigo.has(usuario.id),
        solicitud_pendiente: pendientes.has(usuario.id),
      })),
    };
  }

  // ---------- Solicitudes (cuenta privada) ----------

  /** Solicitudes pendientes que recibí, más recientes primero (sin bloqueados). */
  async solicitudes(usuarioId: number, paginacion: Paginacion): Promise<Page<SolicitudSeguimiento>> {
    const excluir = await this.privacidad.idsOcultosPara(usuarioId);
    const page = await this.repository.paginarUsuarios(usuarioId, 'seguidores', paginacion, { estado: 'pendiente', excluir });
    return {
      ...page,
      items: page.items.map(({ usuario, desde }) => ({ ...(usuario.toJSON() as SolicitudSeguimiento), solicitado_en: desde })),
    };
  }

  /** Acepta la solicitud de `seguidorId`: cuenta en los contadores y le avisa con 'seguimiento_aceptado'. */
  async aceptarSolicitud(usuarioId: number, seguidorId: number): Promise<SolicitudAceptada> {
    await this.db.transaction(async (t) => {
      const relacion = await this.repository.relacion(seguidorId, usuarioId, t);
      if (!relacion || relacion.estado !== 'pendiente') throw new NotFoundError('Solicitud', 'No hay una solicitud pendiente de este usuario');
      await this.repository.update(relacion, { estado: 'aceptado' }, t);
      await this.repository.ajustarContadores(seguidorId, usuarioId, 1, t);
    });

    await this.avisarAceptada(usuarioId, seguidorId);
    const yo = await this.usuarios.findById(usuarioId, { attributes: ['id', 'total_seguidores'] });
    return { seguidor_id: seguidorId, estado: 'aceptado', total_seguidores: yo?.total_seguidores ?? 0 };
  }

  /** Rechaza (borra) la solicitud pendiente de `seguidorId`. */
  async rechazarSolicitud(usuarioId: number, seguidorId: number): Promise<void> {
    const borradas = await this.repository.delete({ seguidor_id: seguidorId, siguiendo_id: usuarioId, estado: 'pendiente' });
    if (!borradas) throw new NotFoundError('Solicitud', 'No hay una solicitud pendiente de este usuario');
    await this.notificaciones.retirar({ usuario_id: usuarioId, de_usuario_id: seguidorId, tipo: 'solicitud_seguimiento' });
  }

  /** Al volver pública la cuenta: acepta todas las solicitudes pendientes (con su notificación). Devuelve cuántas. */
  async aceptarPendientes(usuarioId: number): Promise<number> {
    const aceptados = await this.db.transaction(async (t) => {
      const pendientes = await this.repository.pendientesDe(usuarioId, t);
      for (const relacion of pendientes) {
        await this.repository.update(relacion, { estado: 'aceptado' }, t);
        await this.repository.ajustarContadores(relacion.seguidor_id, usuarioId, 1, t);
      }
      return pendientes.map((r) => r.seguidor_id);
    });
    for (const seguidorId of aceptados) await this.avisarAceptada(usuarioId, seguidorId);
    return aceptados.length;
  }

  // ---------- Internos ----------

  /** Cambia la solicitud de mi bandeja por el aviso al otro de que ya me sigue. */
  private async avisarAceptada(usuarioId: number, seguidorId: number): Promise<void> {
    await this.notificaciones.retirar({ usuario_id: usuarioId, de_usuario_id: seguidorId, tipo: 'solicitud_seguimiento' });
    await this.notificaciones.notificar({
      usuario_id: seguidorId,
      de_usuario_id: usuarioId,
      tipo: 'seguimiento_aceptado',
      mensaje: 'aceptó tu solicitud de seguimiento',
      entidad_tipo: 'usuario',
      entidad_id: usuarioId,
    });
  }

  /** No a uno mismo; el seguido debe existir y estar activo (findById ya filtra activos) y sin bloqueo de por medio. */
  private async validarDestino(seguidorId: number, seguidoId: number): Promise<Usuario> {
    if (seguidorId === seguidoId) throw new BadRequestError('No puedes seguirte a ti mismo');
    const seguido = await this.usuarios.findByIdOrFail(seguidoId);
    if (await this.privacidad.hayBloqueo(seguidorId, seguidoId)) throw new ForbiddenError('No puedes seguir a este usuario');
    return seguido;
  }

  private async resultado(seguidoId: number, estado: EstadoSeguimiento | null): Promise<ResultadoSeguimiento> {
    const seguido = await this.usuarios.findById(seguidoId, { attributes: ['id', 'total_seguidores'] });
    return { siguiendo: estado === 'aceptado', estado, total_seguidores: seguido?.total_seguidores ?? 0 };
  }
}

export const seguidorService = new SeguidorService(seguidorRepository, usuarioRepository, notificacionService, privacidadService, sequelize);
