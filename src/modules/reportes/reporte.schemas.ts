import { z } from 'zod';
import { idSchema, paginacionQuery, paramsDe, textoOpcional } from '../../core/validation/common.schemas';
import { MOTIVOS_REPORTE } from '../../infrastructure/database/models';

/** Acepta `publicacion_id` y, por compatibilidad con el frontend anterior, `publicacionId`. */
const conAliasPublicacion = (valor: unknown): unknown => {
  if (!valor || typeof valor !== 'object') return valor;
  const body = valor as Record<string, unknown>;
  return body.publicacion_id === undefined && body.publicacionId !== undefined ? { ...body, publicacion_id: body.publicacionId } : body;
};

export const publicacionBodySchema = z.preprocess(conAliasPublicacion, z.object({ publicacion_id: idSchema }));

export const crearReporteSchema = z.preprocess(
  conAliasPublicacion,
  z.object({
    publicacion_id: idSchema,
    motivo: z.enum(MOTIVOS_REPORTE, {
      errorMap: () => ({ message: `El motivo es requerido y debe ser uno de: ${MOTIVOS_REPORTE.join(', ')}` }),
    }),
    descripcion: textoOpcional(500),
  }),
);

export const publicacionParams = paramsDe('publicacionId');

export const listarQuery = paginacionQuery;

export type PublicacionBodyDto = z.infer<typeof publicacionBodySchema>;
export type CrearReporteDto = z.infer<typeof crearReporteSchema>;
