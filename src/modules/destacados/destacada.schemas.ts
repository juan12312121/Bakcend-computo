import { z } from 'zod';
import { idSchema, paramsDe, textoRequerido } from '../../core/validation/common.schemas';

/** Máximo de historias en una destacada y de destacadas por perfil. */
export const MAX_HISTORIAS_DESTACADA = 100;
export const MAX_DESTACADAS = 100;
export const MAX_TITULO_DESTACADA = 40;

const vacioAUndefined = (v: unknown) => (v === '' || v === 'null' || v === null ? undefined : v);

/** En multipart la lista llega como texto: "[3,5]" o "3,5". En JSON, como arreglo. */
const aLista = (v: unknown) => {
  if (typeof v !== 'string') return v;
  const texto = v.trim();
  if (!texto) return undefined;
  if (texto.startsWith('[')) {
    try {
      return JSON.parse(texto);
    } catch {
      return v;
    }
  }
  return texto.split(',').map((x) => x.trim());
};

const listaIds = (campo: string) =>
  z.preprocess(
    aLista,
    z
      .array(idSchema, { invalid_type_error: `${campo} debe ser una lista de ids` })
      .min(1, `Elige al menos una historia`)
      .max(MAX_HISTORIAS_DESTACADA, `Una destacada admite máximo ${MAX_HISTORIAS_DESTACADA} historias`)
      .transform((ids) => [...new Set(ids)]),
  );

const bandera = z.preprocess((v) => (v === 'true' || v === '1' || v === 1 ? true : v === 'false' || v === '0' || v === '' ? false : v), z.boolean().optional());

/** POST / (JSON o multipart con la portada en `portada`). */
export const crearDestacadaSchema = z
  .object({
    titulo: textoRequerido('El título', MAX_TITULO_DESTACADA),
    historia_ids: listaIds('historia_ids'),
    /** Historia (de la lista) que sirve de portada; sin ella, la primera. */
    portada_historia_id: z.preprocess(vacioAUndefined, idSchema.optional()),
  })
  .strip();

/** PUT /:id: todo opcional; `historia_ids` reemplaza el contenido (y su orden). */
export const actualizarDestacadaSchema = z
  .object({
    titulo: z.preprocess(vacioAUndefined, textoRequerido('El título', MAX_TITULO_DESTACADA).optional()),
    historia_ids: z.preprocess(vacioAUndefined, listaIds('historia_ids').optional()),
    /** null quita la historia de portada (vuelve a la primera). */
    portada_historia_id: z.preprocess((v) => (v === '' || v === 'null' ? null : v), idSchema.nullable().optional()),
    /** Quita la portada subida. */
    quitar_portada: bandera,
  })
  .strip();

export const agregarHistoriaSchema = z.object({ historia_id: idSchema }).strip();

export const ordenDestacadasSchema = z
  .object({ ids: z.array(idSchema).min(1, 'Indica el orden').max(MAX_DESTACADAS).transform((ids) => [...new Set(ids)]) })
  .strip();

export const usuarioParams = paramsDe('usuarioId');
export const destacadaHistoriaParams = paramsDe('id', 'historiaId');

export type CrearDestacadaDto = z.infer<typeof crearDestacadaSchema>;
export type ActualizarDestacadaDto = z.infer<typeof actualizarDestacadaSchema>;
export type AgregarHistoriaDto = z.infer<typeof agregarHistoriaSchema>;
export type OrdenDestacadasDto = z.infer<typeof ordenDestacadasSchema>;
