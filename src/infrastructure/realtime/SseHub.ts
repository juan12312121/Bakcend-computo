import type { Response } from 'express';

/**
 * Conexiones Server-Sent Events por usuario (una persona puede tener varias pestañas).
 * Lo usa el módulo de notificaciones para empujar avisos en tiempo real.
 */
export class SseHub {
  private readonly conexiones = new Map<number, Set<Response>>();

  conectar(usuarioId: number, res: Response): () => void {
    res.set({
      'Content-Type': 'text/event-stream',
      // no-transform: que compression() no meta el stream en un buffer gzip
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const set = this.conexiones.get(usuarioId) ?? new Set<Response>();
    set.add(res);
    this.conexiones.set(usuarioId, set);

    this.escribir(res, 'conectado', { usuarioId, timestamp: new Date().toISOString() });
    const latido = setInterval(() => res.write(': ping\n\n'), 30_000);

    return () => {
      clearInterval(latido);
      set.delete(res);
      if (set.size === 0) this.conexiones.delete(usuarioId);
    };
  }

  /** Envía un evento a todas las conexiones del usuario. Devuelve si había alguien escuchando. */
  enviar(usuarioId: number, evento: string, data: unknown): boolean {
    const set = this.conexiones.get(usuarioId);
    if (!set?.size) return false;
    set.forEach((res) => this.escribir(res, evento, data));
    return true;
  }

  estadisticas(): { usuariosConectados: number; conexionesTotales: number } {
    let conexionesTotales = 0;
    this.conexiones.forEach((set) => (conexionesTotales += set.size));
    return { usuariosConectados: this.conexiones.size, conexionesTotales };
  }

  private escribir(res: Response, evento: string, data: unknown): void {
    try {
      res.write(`event: ${evento}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // La conexión se cerró: la limpia el callback de desconexión.
    }
  }
}

export const sseHub = new SseHub();
