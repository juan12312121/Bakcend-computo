import type { Response } from 'express';
import { BaseService } from '../../core/domain/BaseService';
import { NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import type { EntidadNotificacion, Notificacion, TipoNotificacion } from '../../infrastructure/database/models';
import type { AvisadorPush, MensajePush } from '../../infrastructure/push';
import { sseHub, type SseHub } from '../../infrastructure/realtime/SseHub';
import { dispositivoService } from '../dispositivos/dispositivo.service';
import { notificacionRepository, type NotificacionRepository } from './notificacion.repository';

export interface NuevaNotificacion {
  /** Destinatario. */
  usuario_id: number;
  /** Quien la provoca. */
  de_usuario_id: number;
  tipo: TipoNotificacion;
  publicacion_id?: number | null;
  mensaje?: string | null;
  /** Para lo que no es una publicación: { entidad_tipo: 'tarea', entidad_id: 12 }. */
  entidad_tipo?: EntidadNotificacion | null;
  entidad_id?: number | null;
}

/** Eventos SSE que escucha el frontend. */
export const EVENTOS_SSE = {
  nueva: 'nueva_notificacion',
  contador: 'actualizar_contador',
} as const;

export interface FiltroNotificaciones {
  soloNoLeidas?: boolean;
}

export class NotificacionService extends BaseService<Notificacion, NotificacionRepository> {
  constructor(
    repository: NotificacionRepository,
    private readonly sse: SseHub,
    private readonly push: AvisadorPush,
  ) {
    super(repository);
  }

  /**
   * Punto único para crear notificaciones desde cualquier módulo (likes, comentarios, seguidores, grupos).
   * No notifica acciones sobre uno mismo, avisa en tiempo real por SSE y manda push al teléfono.
   */
  async notificar(datos: NuevaNotificacion): Promise<Notificacion | null> {
    if (datos.usuario_id === datos.de_usuario_id) return null;

    const creada = await this.repository.create({
      usuario_id: datos.usuario_id,
      de_usuario_id: datos.de_usuario_id,
      tipo: datos.tipo,
      publicacion_id: datos.publicacion_id ?? null,
      mensaje: datos.mensaje ?? null,
      entidad_tipo: datos.entidad_tipo ?? null,
      entidad_id: datos.entidad_id ?? null,
    });
    const completa = await this.repository.findById(creada.id);
    this.sse.enviar(datos.usuario_id, EVENTOS_SSE.nueva, completa);
    await this.emitirContador(datos.usuario_id);
    if (completa) await this.push.avisar(datos.usuario_id, mensajePush(completa));
    return completa;
  }

  /** Quita la notificación de una acción que se deshizo (p. ej. quitar like, dejar de seguir). */
  async retirar(datos: Omit<NuevaNotificacion, 'mensaje'>): Promise<void> {
    await this.repository.delete({
      usuario_id: datos.usuario_id,
      de_usuario_id: datos.de_usuario_id,
      tipo: datos.tipo,
      ...(datos.publicacion_id ? { publicacion_id: datos.publicacion_id } : {}),
      ...(datos.entidad_tipo && datos.entidad_id ? { entidad_tipo: datos.entidad_tipo, entidad_id: datos.entidad_id } : {}),
    });
    await this.emitirContador(datos.usuario_id);
  }

  async emitirContador(usuarioId: number): Promise<number> {
    const total = await this.repository.contarNoLeidas(usuarioId);
    this.sse.enviar(usuarioId, EVENTOS_SSE.contador, { total });
    return total;
  }

  // ---------- Bandeja del usuario autenticado ----------

  /** Notificaciones del usuario, más recientes primero: listar(id, pag) o listar(id, pag, { soloNoLeidas: true }). */
  listar(usuarioId: number, paginacion: Paginacion): Promise<Page<Notificacion>>;
  listar(usuarioId: number, paginacion: Paginacion, filtro: FiltroNotificaciones): Promise<Page<Notificacion>>;
  listar(usuarioId: number, paginacion: Paginacion, { soloNoLeidas = false }: FiltroNotificaciones = {}): Promise<Page<Notificacion>> {
    return this.repository.paginate({ usuario_id: usuarioId, ...(soloNoLeidas ? { leida: false } : {}) }, paginacion);
  }

  contador(usuarioId: number): Promise<number> {
    return this.repository.contarNoLeidas(usuarioId);
  }

  async marcarLeida(id: number, usuarioId: number): Promise<Notificacion> {
    const notificacion = await this.repository.findDelUsuarioOrFail(id, usuarioId);
    if (!notificacion.leida) await this.repository.update(notificacion, { leida: true });
    await this.emitirContador(usuarioId);
    return notificacion;
  }

  async marcarTodasLeidas(usuarioId: number): Promise<number> {
    const actualizadas = await this.repository.marcarTodasLeidas(usuarioId);
    await this.emitirContador(usuarioId);
    return actualizadas;
  }

  async eliminar(id: number, usuarioId: number): Promise<void> {
    const borradas = await this.repository.delete({ id, usuario_id: usuarioId });
    if (!borradas) throw new NotFoundError('Notificación', 'Notificación no encontrada');
    await this.emitirContador(usuarioId);
  }

  /** Limpia las leídas del propio usuario con más de `dias` días (no cambia el contador de no leídas). */
  limpiarAntiguas(usuarioId: number, dias: number): Promise<number> {
    return this.repository.eliminarLeidasAntiguas(usuarioId, dias);
  }

  // ---------- Stream SSE ----------

  /** Registra la conexión SSE; devuelve la función que la libera al cerrarse. */
  conectarStream(usuarioId: number, res: Response): () => void {
    return this.sse.conectar(usuarioId, res);
  }

  estadisticasStream(): { usuariosConectados: number; conexionesTotales: number } {
    return this.sse.estadisticas();
  }
}

/**
 * "Ana Pérez le gustó tu publicación". En `datos` va lo necesario para que la app
 * abra lo mismo que al tocar la notificación en la bandeja (todo como texto, así lo pide Firebase).
 */
export function mensajePush(notificacion: Notificacion): MensajePush {
  const quien = notificacion.emisor?.nombre_completo ?? 'Alguien';
  return {
    titulo: 'TrinoFlow',
    cuerpo: `${quien} ${notificacion.mensaje ?? ''}`.trim(),
    datos: {
      tipo: notificacion.tipo,
      notificacion_id: String(notificacion.id),
      de_usuario_id: String(notificacion.de_usuario_id ?? ''),
      publicacion_id: String(notificacion.publicacion_id ?? ''),
      entidad_tipo: notificacion.entidad_tipo ?? '',
      entidad_id: String(notificacion.entidad_id ?? ''),
    },
  };
}

export const notificacionService = new NotificacionService(notificacionRepository, sseHub, dispositivoService);
