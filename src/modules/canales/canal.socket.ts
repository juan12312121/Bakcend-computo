import type { ManejadorSocket } from '../../infrastructure/realtime/RealtimeGateway';
import { canalService } from './canal.service';

/** Sala Socket.IO de un canal: ahí llegan sus publicaciones, borrados y reacciones en vivo. */
export const salaCanal = (canalId: number): string => `canal_${canalId}`;

/** Eventos que emite el módulo a la sala del canal. */
export const EVENTOS_CANAL = {
  /** Publicación nueva (PublicacionCanalVista con `reacciones` sin `mia`). */
  publicacion: 'canal_publicacion',
  /** { canal_id, publicacion_id } */
  eliminada: 'canal_publicacion_eliminada',
  /** { canal_id, publicacion_id, usuario_id, emoji | null, reacciones: [{ emoji, total }] } */
  reaccion: 'canal_reaccion',
} as const;

/** Lo que el cliente manda: `join_canal` / `leave_canal` con el id del canal. */
export const EVENTOS_CLIENTE_CANAL = { entrar: 'join_canal', salir: 'leave_canal' } as const;

/** Respuesta (acuse) de `join_canal`. */
export interface RespuestaEntrarCanal {
  ok: boolean;
}

type Responder = (respuesta: RespuestaEntrarCanal) => void;

/**
 * Manejador de Socket.IO del módulo de canales (el coordinador lo registra con `realtime.usar(manejadorCanales)`).
 * - `join_canal` (id[, acuse]): entra a la sala si puede ver el canal (públicos: cualquiera; privados: sus miembros).
 *   Responde por acuse `{ ok }`; si no puede, además emite `sala_denegada` { sala: 'canal', id }.
 * - `leave_canal` (id): sale de la sala.
 */
export function crearManejadorCanales(puedeVer: (canalId: number, usuarioId?: number) => Promise<boolean>): ManejadorSocket {
  return (socket, { usuarioId }) => {
    socket.on(EVENTOS_CLIENTE_CANAL.entrar, async (id: unknown, responder?: unknown) => {
      const canalId = Number(id);
      let permitido = false;
      try {
        permitido = Number.isInteger(canalId) && canalId > 0 && (await puedeVer(canalId, usuarioId));
      } catch {
        permitido = false;
      }
      if (permitido) await socket.join(salaCanal(canalId));
      else socket.emit('sala_denegada', { sala: 'canal', id: canalId });
      if (typeof responder === 'function') (responder as Responder)({ ok: permitido });
    });
    socket.on(EVENTOS_CLIENTE_CANAL.salir, (id: unknown) => void socket.leave(salaCanal(Number(id))));
  };
}

/** Instancia lista para server.ts: `realtime.usar(manejadorCanales)`. */
export const manejadorCanales: ManejadorSocket = crearManejadorCanales((canalId, usuarioId) => canalService.puedeVer(canalId, usuarioId));
