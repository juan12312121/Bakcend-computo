import { z } from 'zod';
import { paginacionQuery } from '../../core/validation/common.schemas';
import { esHashtagValido, normalizarHashtag } from './extraer-hashtags';

/** Nombre de tema en la ruta: acepta "#Fútbol" o "fútbol" y lo deja normalizado ("fútbol"). */
const nombreHashtag = z
  .string({ required_error: 'El hashtag es requerido' })
  .transform(normalizarHashtag)
  .refine(esHashtagValido, 'Hashtag inválido: 2-50 letras, números o _');

export const hashtagParams = z.object({ nombre: nombreHashtag });

/** Autocompletado de #: `q` puede venir vacío (devuelve los más usados). */
export const buscarHashtagsQuery = z.object({
  q: z
    .string()
    .max(51, 'Máximo 50 caracteres')
    .optional()
    .transform((v) => normalizarHashtag(v ?? '')),
});

export const publicacionesHashtagQuery = paginacionQuery;

export type BuscarHashtagsQuery = z.infer<typeof buscarHashtagsQuery>;
