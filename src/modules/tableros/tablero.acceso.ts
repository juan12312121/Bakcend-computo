import { ForbiddenError } from '../../core/errors';
import type { Tablero } from '../../infrastructure/database/models';
import { realtime, salas, type RealtimeGateway } from '../../infrastructure/realtime/RealtimeGateway';
import { MENSAJES_ACCESO, type AccesoTablero, type NivelAcceso } from './tablero.permisos';
import { tableroRepository, type TableroRepository } from './tablero.repository';

export interface TableroConAcceso {
  tablero: Tablero;
  acceso: AccesoTablero;
}

/** Guardia compartida por los servicios del módulo: carga el tablero y exige un nivel de permiso. */
export class AccesoTableros {
  constructor(private readonly tableros: TableroRepository) {}

  /** 404 si no existe; 403 si no llega al nivel pedido. */
  exigir(tableroId: number, usuarioId: number, nivel: NivelAcceso): Promise<TableroConAcceso>;
  exigir(tablero: Tablero, usuarioId: number, nivel: NivelAcceso): Promise<TableroConAcceso>;
  async exigir(objetivo: number | Tablero, usuarioId: number, nivel: NivelAcceso): Promise<TableroConAcceso> {
    const tablero = typeof objetivo === 'number' ? await this.tableros.findByIdOrFail(objetivo) : objetivo;
    const acceso = await this.tableros.acceso(tablero, usuarioId);
    if (!acceso.ver) throw new ForbiddenError(MENSAJES_ACCESO.ver);
    if (!acceso[nivel]) throw new ForbiddenError(MENSAJES_ACCESO[nivel]);
    return { tablero, acceso };
  }
}

/** Eventos de Socket.IO que se emiten a la sala del tablero (`salas.tablero(id)`). */
export const EVENTOS_TABLERO = {
  tareaCreada: 'tarea_creada',
  tareaActualizada: 'tarea_actualizada',
  tareaMovida: 'tarea_movida',
  tareaEliminada: 'tarea_eliminada',
  columnas: 'columnas_actualizadas',
  tablero: 'tablero_actualizado',
} as const;

export type EventoTablero = (typeof EVENTOS_TABLERO)[keyof typeof EVENTOS_TABLERO];

/** Emite a la sala del tablero agregando siempre `por_usuario_id` (el cliente ignora lo que él mismo hizo). */
export class AvisosTablero {
  constructor(private readonly tiempoReal: RealtimeGateway) {}

  emitir(tableroId: number, evento: EventoTablero, data: object, porUsuarioId: number): void {
    this.tiempoReal.aSala(salas.tablero(tableroId), evento, { ...data, tablero_id: tableroId, por_usuario_id: porUsuarioId });
  }
}

export const accesoTableros = new AccesoTableros(tableroRepository);
export const avisosTablero = new AvisosTablero(realtime);
