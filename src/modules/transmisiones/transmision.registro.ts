import type { UsuarioPublico } from '../llamadas/llamada.service';

/** Un espectador conectado: con qué socket ve la transmisión. */
export interface Espectador {
  socketId: string;
  usuario: UsuarioPublico;
}

/** Estado en memoria de una transmisión en vivo (quién la ve ahora, picos y reacciones). */
export interface EnVivo {
  id: number;
  anfitrionId: number;
  /** Socket con el que el anfitrión manda el video (null mientras no se conecta o se reconecta). */
  anfitrionSocket: string | null;
  espectadores: Map<number, Espectador>;
  /** Personas distintas que la vieron. */
  vistos: Set<number>;
  maximo: number;
  reacciones: number;
  /** Último comentario de cada persona (para frenar el spam). */
  ultimoComentario: Map<number, number>;
  /** Espera a que el anfitrión se conecte o vuelva; al vencer, la transmisión termina. */
  espera: NodeJS.Timeout | null;
}

/** Lo que el servicio necesita saber de lo que pasa en vivo (sin depender de Socket.IO). */
export interface ContadorEspectadores {
  espectadores(transmisionId: number): number;
}

/**
 * Registro en memoria de las transmisiones en vivo de este proceso.
 * (Con varias instancias del servidor haría falta compartirlo, p. ej. en Redis.)
 */
export class RegistroTransmisiones implements ContadorEspectadores {
  private readonly enVivo = new Map<number, EnVivo>();

  obtener(id: number): EnVivo | undefined {
    return this.enVivo.get(id);
  }

  obtenerOCrear(id: number, anfitrionId: number): EnVivo {
    let actual = this.enVivo.get(id);
    if (!actual) {
      actual = {
        id,
        anfitrionId,
        anfitrionSocket: null,
        espectadores: new Map(),
        vistos: new Set(),
        maximo: 0,
        reacciones: 0,
        ultimoComentario: new Map(),
        espera: null,
      };
      this.enVivo.set(id, actual);
    }
    return actual;
  }

  /** Agrega (o reemplaza el socket de) un espectador y actualiza el pico. Devuelve cuántos hay. */
  agregar(enVivo: EnVivo, espectador: Espectador): number {
    enVivo.espectadores.set(espectador.usuario.id, espectador);
    enVivo.vistos.add(espectador.usuario.id);
    enVivo.maximo = Math.max(enVivo.maximo, enVivo.espectadores.size);
    return enVivo.espectadores.size;
  }

  espectadores(id: number): number {
    return this.enVivo.get(id)?.espectadores.size ?? 0;
  }

  /** Lo olvida y devuelve su estado final (para guardar los totales). */
  cerrar(id: number): EnVivo | undefined {
    const actual = this.enVivo.get(id);
    if (actual?.espera) clearTimeout(actual.espera);
    this.enVivo.delete(id);
    return actual;
  }

  todas(): EnVivo[] {
    return [...this.enVivo.values()];
  }

  /** Para pruebas. */
  reiniciar(): void {
    for (const t of this.enVivo.values()) if (t.espera) clearTimeout(t.espera);
    this.enVivo.clear();
  }
}

export const registroTransmisiones = new RegistroTransmisiones();
