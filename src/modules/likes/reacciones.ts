import { TIPOS_REACCION, type TipoReaccion } from '../../infrastructure/database/models';
import type { ResumenReaccion } from '../publicaciones/publicacion-extras';

/** Emoji de cada reacción (para el texto de las notificaciones). */
export const EMOJI_REACCION: Record<TipoReaccion, string> = {
  me_gusta: '👍',
  me_encanta: '❤️',
  jaja: '😂',
  asombro: '😮',
  triste: '😢',
  enojo: '😡',
  aplauso: '👏',
};

/** Texto que sigue al nombre en la notificación: "le gustó tu publicación" / "reaccionó 😂 a tu publicación". */
export function mensajeReaccion(tipo: TipoReaccion): string {
  return tipo === 'me_gusta' ? 'le gustó tu publicación' : `reaccionó ${EMOJI_REACCION[tipo]} a tu publicación`;
}

/** Solo tipos con al menos una reacción, de más a menos (empates en el orden del catálogo). */
export function ordenarResumen(conteos: Partial<Record<TipoReaccion, number>>): ResumenReaccion[] {
  return TIPOS_REACCION.map((tipo) => ({ tipo, total: conteos[tipo] ?? 0 }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || TIPOS_REACCION.indexOf(a.tipo) - TIPOS_REACCION.indexOf(b.tipo));
}
