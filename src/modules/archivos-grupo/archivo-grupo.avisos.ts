/** Reloj intercambiable (las pruebas usan uno falso). */
export interface RelojAvisos {
  ahora(): number;
  programar(tarea: () => void, ms: number): void;
}

export const relojReal: RelojAvisos = {
  ahora: () => Date.now(),
  programar: (tarea, ms) => {
    setTimeout(tarea, ms).unref?.();
  },
};

/** Lo que se avisa a un miembro: uno o varios archivos nuevos en su grupo. */
export interface AvisoArchivos {
  destinatarioId: number;
  /** Quien subió el último. */
  deUsuarioId: number;
  grupoId: number;
  grupoNombre: string;
  /** El último subido (la notificación abre ese). */
  archivoId: number;
  nombreArchivo: string;
  cantidad: number;
  /** Cuántas personas distintas subieron los archivos agrupados. */
  autores: number;
}

export type NuevoArchivo = Omit<AvisoArchivos, 'cantidad' | 'autores'>;

export type EnviarAviso = (aviso: AvisoArchivos) => Promise<void>;

interface Pendiente {
  aviso: AvisoArchivos;
  autores: Set<number>;
}

const DIEZ_MINUTOS = 10 * 60_000;
/** A partir de cuántas claves se limpian las viejas. */
const MAX_CLAVES = 5_000;

/**
 * Evita saturar con avisos de archivos: como mucho uno por persona y grupo cada `ventanaMs`.
 * El primero sale al instante; los que llegan dentro de la ventana se juntan y salen en un solo aviso
 * ("subió 4 archivos") cuando la ventana termina.
 */
export class AgrupadorAvisos {
  private readonly ultimos = new Map<string, number>();
  private readonly pendientes = new Map<string, Pendiente>();

  constructor(
    private readonly enviar: EnviarAviso,
    private readonly ventanaMs = DIEZ_MINUTOS,
    private readonly reloj: RelojAvisos = relojReal,
  ) {}

  async registrar(nuevo: NuevoArchivo): Promise<void> {
    const clave = `${nuevo.grupoId}:${nuevo.destinatarioId}`;
    const ahora = this.reloj.ahora();
    const ultimo = this.ultimos.get(clave);
    const pendiente = this.pendientes.get(clave);

    if (ultimo === undefined || ahora - ultimo >= this.ventanaMs) {
      // Ventana libre: sale ya (sumando lo que hubiera quedado pendiente)
      this.pendientes.delete(clave);
      this.ultimos.set(clave, ahora);
      const autores = new Set([...(pendiente?.autores ?? []), nuevo.deUsuarioId]);
      await this.mandar({ ...nuevo, cantidad: (pendiente?.aviso.cantidad ?? 0) + 1, autores: autores.size });
      return;
    }

    if (pendiente) {
      pendiente.autores.add(nuevo.deUsuarioId);
      pendiente.aviso = { ...nuevo, cantidad: pendiente.aviso.cantidad + 1, autores: pendiente.autores.size };
      return;
    }
    this.pendientes.set(clave, { aviso: { ...nuevo, cantidad: 1, autores: 1 }, autores: new Set([nuevo.deUsuarioId]) });
    this.reloj.programar(() => void this.vaciar(clave), ultimo + this.ventanaMs - ahora);
  }

  /** Olvida todo (pruebas). */
  reiniciar(): void {
    this.ultimos.clear();
    this.pendientes.clear();
  }

  private async vaciar(clave: string): Promise<void> {
    const pendiente = this.pendientes.get(clave);
    if (!pendiente) return;
    this.pendientes.delete(clave);
    this.ultimos.set(clave, this.reloj.ahora());
    await this.mandar(pendiente.aviso);
    this.podar();
  }

  private async mandar(aviso: AvisoArchivos): Promise<void> {
    try {
      await this.enviar(aviso);
    } catch (error) {
      console.warn('No se pudo avisar del archivo nuevo:', (error as Error).message);
    }
  }

  private podar(): void {
    if (this.ultimos.size < MAX_CLAVES) return;
    const limite = this.reloj.ahora() - this.ventanaMs;
    for (const [clave, fecha] of this.ultimos) if (fecha < limite && !this.pendientes.has(clave)) this.ultimos.delete(clave);
  }
}

/** Texto de la notificación (va después del nombre de quien subió). */
export function mensajeAviso({ cantidad, autores, nombreArchivo, grupoNombre }: AvisoArchivos): string {
  if (cantidad === 1) return `subió «${nombreArchivo}» a los archivos de «${grupoNombre}»`;
  if (autores > 1) return `y otras personas subieron ${cantidad} archivos a «${grupoNombre}»`;
  return `subió ${cantidad} archivos a «${grupoNombre}»`;
}
