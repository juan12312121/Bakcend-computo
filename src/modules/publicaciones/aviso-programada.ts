import type { Publicacion } from '../../infrastructure/database/models';
import type { AvisadorPush } from '../../infrastructure/push';
import { sseHub, type SseHub } from '../../infrastructure/realtime/SseHub';
import { dispositivoService } from '../dispositivos/dispositivo.service';
import { notificacionRepository, type NotificacionRepository } from '../notificaciones/notificacion.repository';
import { EVENTOS_SSE, mensajePush, notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';

/** Avisa al autor que su publicación programada ya salió. */
export interface AvisoPublicacionProgramada {
  publicada(publicacion: Publicacion): Promise<void>;
}

export const MENSAJE_PROGRAMADA = 'tu publicación programada ya está publicada';

/**
 * `notificacionService.notificar()` no avisa acciones sobre uno mismo (y aquí autor y destinatario son la misma
 * persona), así que se arma igual que allá: notificación en la bandeja, aviso SSE, contador y push al teléfono.
 */
export class AvisoProgramadaNotificacion implements AvisoPublicacionProgramada {
  constructor(
    private readonly notificaciones: NotificacionRepository,
    private readonly servicio: NotificacionService,
    private readonly sse: SseHub,
    private readonly push: AvisadorPush,
  ) {}

  async publicada(publicacion: Publicacion): Promise<void> {
    const creada = await this.notificaciones.create({
      usuario_id: publicacion.usuario_id,
      de_usuario_id: publicacion.usuario_id,
      tipo: 'publicacion_programada',
      publicacion_id: publicacion.id,
      mensaje: MENSAJE_PROGRAMADA,
      entidad_tipo: 'publicacion',
      entidad_id: publicacion.id,
    });
    const completa = await this.notificaciones.findById(creada.id);
    if (!completa) return;
    this.sse.enviar(publicacion.usuario_id, EVENTOS_SSE.nueva, completa);
    await this.servicio.emitirContador(publicacion.usuario_id);
    const { datos } = mensajePush(completa);
    await this.push.avisar(publicacion.usuario_id, { titulo: 'TrinoFlow', cuerpo: 'Tu publicación programada ya está publicada', datos });
  }
}

export const avisoProgramada: AvisoPublicacionProgramada = new AvisoProgramadaNotificacion(
  notificacionRepository,
  notificacionService,
  sseHub,
  dispositivoService,
);
