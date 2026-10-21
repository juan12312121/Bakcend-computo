import type { Encuesta } from '../../infrastructure/database/models';
import type { EncuestaVista } from '../publicaciones/publicacion-extras';

/** ¿Ya pasó la fecha de cierre? */
export function estaCerrada(encuesta: Pick<Encuesta, 'cierra_en'>, ahora = new Date()): boolean {
  return !!encuesta.cierra_en && new Date(encuesta.cierra_en).getTime() <= ahora.getTime();
}

/**
 * Encuesta lista para el frontend. `total_votos` cuenta personas que votaron y el porcentaje de cada opción
 * es sobre esas personas (en una de opción múltiple las opciones pueden sumar más de 100).
 */
export function vistaEncuesta(encuesta: Encuesta, misVotos: number[] = [], ahora = new Date()): EncuestaVista {
  const votantes = encuesta.total_votos;
  return {
    id: encuesta.id,
    multiple: encuesta.multiple,
    cierra_en: encuesta.cierra_en ?? null,
    cerrada: estaCerrada(encuesta, ahora),
    total_votos: votantes,
    opciones: (encuesta.opciones ?? []).map((o) => ({
      id: o.id,
      texto: o.texto,
      total_votos: o.total_votos,
      porcentaje: votantes > 0 ? Math.round((o.total_votos * 100) / votantes) : 0,
    })),
    mis_votos: misVotos,
  };
}
