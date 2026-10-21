import { z } from 'zod';
import { idSchema, paginacionQuery, paramsDe, textoOpcional, textoRequerido } from '../../core/validation/common.schemas';
import { PERMISOS_DOCUMENTO } from '../../infrastructure/database/models';

export const documentoParams = paramsDe('id');
export const grupoDocumentosParams = paramsDe('grupoId');
export const versionParams = paramsDe('id', 'versionId');
export const permisoParams = paramsDe('id', 'usuarioId');

/** "true" / "1" / "false" / "0" de la query. */
const booleanoQuery = z.preprocess(
  (v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v),
  z.boolean({ invalid_type_error: 'Debe ser verdadero o falso' }),
);

/** Listas: `q` busca en título y contenido; `papelera=true` muestra solo los de la papelera. */
export const listarDocumentosQuery = paginacionQuery.extend({
  q: z.string().trim().max(100).optional().transform((v) => v || undefined),
  papelera: booleanoQuery.default(false),
});

export const TITULO_POR_DEFECTO = 'Documento sin título';

export const crearDocumentoSchema = z
  .object({
    titulo: z
      .string({ invalid_type_error: 'El título debe ser texto' })
      .trim()
      .max(200, 'El título admite máximo 200 caracteres')
      .optional()
      .transform((v) => v || TITULO_POR_DEFECTO),
    /** Sin grupo = documento personal. */
    grupo_id: idSchema.optional().nullable(),
  })
  .strip();

export const renombrarDocumentoSchema = z.object({ titulo: textoRequerido('El título', 200) }).strip();

export const compartirDocumentoSchema = z
  .object({
    usuario_id: idSchema,
    permiso: z.enum(PERMISOS_DOCUMENTO, { errorMap: () => ({ message: 'El permiso debe ser "ver" o "editar"' }) }).default('ver'),
  })
  .strip();

export const crearVersionSchema = z.object({ nombre: textoOpcional(120) }).strip();

export const FORMATOS_EXPORTAR = ['texto', 'html'] as const;
export const exportarQuery = z.object({
  formato: z.enum(FORMATOS_EXPORTAR, { errorMap: () => ({ message: 'El formato debe ser "texto" o "html"' }) }).default('html'),
});

export type ListarDocumentosQuery = z.infer<typeof listarDocumentosQuery>;
export type CrearDocumentoDto = z.infer<typeof crearDocumentoSchema>;
export type CompartirDocumentoDto = z.infer<typeof compartirDocumentoSchema>;
export type CrearVersionDto = z.infer<typeof crearVersionSchema>;
export type ExportarQuery = z.infer<typeof exportarQuery>;
export type FormatoExportar = (typeof FORMATOS_EXPORTAR)[number];
