import type { TipoReaccion } from '../../infrastructure/database/models';
import { encuestaRepository, type EncuestaRepository } from '../encuestas/encuesta.repository';
import { vistaEncuesta } from '../encuestas/encuesta.vista';
import { guardadoRepository, type GuardadoRepository } from '../guardados/guardado.repository';
import { likeRepository, type LikeRepository } from '../likes/like.repository';

/** Cuántas personas reaccionaron de cada forma (solo los tipos con al menos una, de más a menos). */
export interface ResumenReaccion {
  tipo: TipoReaccion;
  total: number;
}

export interface OpcionEncuestaVista {
  id: number;
  texto: string;
  total_votos: number;
  /** 0-100, redondeado. */
  porcentaje: number;
}

export interface EncuestaVista {
  id: number;
  multiple: boolean;
  cierra_en: Date | null;
  /** true si ya pasó `cierra_en`. */
  cerrada: boolean;
  total_votos: number;
  opciones: OpcionEncuestaVista[];
  /** Ids de las opciones que votó el usuario actual (vacío sin sesión o si no votó). */
  mis_votos: number[];
}

/** Lo que cada publicación trae además de sus columnas (según quién la mira). */
export interface ExtrasDePublicacion {
  mi_reaccion: TipoReaccion | null;
  reacciones: ResumenReaccion[];
  guardada: boolean;
  encuesta: EncuestaVista | null;
}

export const SIN_EXTRAS: Readonly<ExtrasDePublicacion> = Object.freeze({ mi_reaccion: null, reacciones: [], guardada: false, encuesta: null });

/**
 * Punto de conexión entre publicaciones y los módulos de interacción (reacciones, guardados, encuestas):
 * `PublicacionService.vista()` lo llama una vez por página con todos los ids.
 * Debe resolver todo en pocas consultas (nunca una por publicación).
 */
export interface FuenteExtrasPublicacion {
  para(publicacionIds: number[], usuarioId?: number): Promise<Map<number, ExtrasDePublicacion>>;
}

/**
 * Implementación real: 5 consultas como máximo para cualquier cantidad de publicaciones
 * (resumen de reacciones, mis reacciones, mis guardadas, encuestas con opciones y mis votos).
 * Sin sesión solo hace las 2 que no dependen del usuario.
 */
export class ExtrasPublicacion implements FuenteExtrasPublicacion {
  constructor(
    private readonly likes: LikeRepository,
    private readonly guardados: GuardadoRepository,
    private readonly encuestas: EncuestaRepository,
  ) {}

  async para(publicacionIds: number[], usuarioId?: number): Promise<Map<number, ExtrasDePublicacion>> {
    const ids = [...new Set(publicacionIds)];
    if (!ids.length) return new Map();

    const [resumen, mias, guardadas, encuestas] = await Promise.all([
      this.likes.resumen(ids),
      usuarioId ? this.likes.misReacciones(usuarioId, ids) : Promise.resolve(new Map<number, TipoReaccion>()),
      usuarioId ? this.guardados.guardadasDe(usuarioId, ids) : Promise.resolve(new Set<number>()),
      this.encuestas.dePublicaciones(ids),
    ]);
    const votos = usuarioId ? await this.encuestas.misVotos(encuestas.map((e) => e.id), usuarioId) : new Map<number, number[]>();
    const ahora = new Date();
    const encuestaDe = new Map(encuestas.map((e) => [e.publicacion_id, vistaEncuesta(e, votos.get(e.id) ?? [], ahora)]));

    return new Map(
      ids.map((id) => [
        id,
        {
          mi_reaccion: mias.get(id) ?? null,
          reacciones: resumen.get(id) ?? [],
          guardada: guardadas.has(id),
          encuesta: encuestaDe.get(id) ?? null,
        },
      ]),
    );
  }
}

export const publicacionExtras: FuenteExtrasPublicacion = new ExtrasPublicacion(likeRepository, guardadoRepository, encuestaRepository);
