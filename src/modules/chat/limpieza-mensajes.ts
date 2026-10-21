import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { FileStorage } from '../../infrastructure/storage/FileStorage';
import { mensajeGrupoRepository, type MensajeGrupoRepository } from '../chat-grupo/mensaje-grupo.repository';
import { mensajeChatRepository, type MensajeChatRepository } from './mensaje-chat.repository';

/** Cada cuánto se borran los mensajes temporales vencidos. */
export const MINUTOS_LIMPIEZA_MENSAJES = 10;
/** Cuántos mensajes se borran por vuelta (para no bloquear la base con un DELETE enorme). */
const LOTE = 500;

/** Lo que tiene que saber borrar cada tabla de mensajes. */
interface FuenteVencidos {
  vencidos(ahora: Date, limite: number): Promise<{ id: number; archivo_url: string | null }[]>;
  delete(where: { id: number[] }): Promise<number>;
}

export interface ResultadoLimpieza {
  chat: number;
  grupo: number;
}

/**
 * Borra los mensajes temporales vencidos (chat directo y de grupo) con sus archivos de Cloudinary.
 * Las reacciones se van solas (ON DELETE CASCADE). Los clientes ya los ocultan al vencer; esto libera espacio.
 */
export class LimpiezaMensajesTemporales {
  constructor(
    private readonly mensajesChat: MensajeChatRepository,
    private readonly mensajesGrupo: MensajeGrupoRepository,
    private readonly storage: FileStorage,
  ) {}

  async limpiarVencidos(ahora: Date = new Date()): Promise<ResultadoLimpieza> {
    return {
      chat: await this.vaciar(this.mensajesChat, ahora),
      grupo: await this.vaciar(this.mensajesGrupo, ahora),
    };
  }

  private async vaciar(fuente: FuenteVencidos, ahora: Date): Promise<number> {
    let borrados = 0;
    for (;;) {
      const lote = await fuente.vencidos(ahora, LOTE);
      if (!lote.length) return borrados;
      borrados += await fuente.delete({ id: lote.map((m) => m.id) });
      // Un archivo que no se pudo borrar no detiene la limpieza (fileStorage ya lo registra)
      await Promise.all(lote.filter((m) => m.archivo_url).map((m) => this.storage.eliminar(m.archivo_url)));
      if (lote.length < LOTE) return borrados;
    }
  }
}

export const limpiezaMensajesTemporales = new LimpiezaMensajesTemporales(mensajeChatRepository, mensajeGrupoRepository, fileStorage);

/**
 * Programa la limpieza de mensajes temporales vencidos (cada 10 min por defecto). `unref()` evita que el
 * temporizador mantenga vivo el proceso. Se llama una vez desde server.ts.
 */
export function programarLimpiezaMensajes(): NodeJS.Timeout;
export function programarLimpiezaMensajes(intervaloMs: number): NodeJS.Timeout;
export function programarLimpiezaMensajes(intervaloMs: number = MINUTOS_LIMPIEZA_MENSAJES * 60_000): NodeJS.Timeout {
  const temporizador = setInterval(() => {
    limpiezaMensajesTemporales
      .limpiarVencidos()
      .catch((error: Error) => console.warn('No se pudieron limpiar los mensajes temporales vencidos:', error.message));
  }, intervaloMs);
  temporizador.unref();
  return temporizador;
}
