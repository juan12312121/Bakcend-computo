import { z } from 'zod';
import { idSchema, paginacionQuery, paramsDe, textoRequerido } from '../../core/validation/common.schemas';
import { TIPOS_ARCHIVO_GRUPO } from '../../infrastructure/database/models';

export const grupoArchivosParams = paramsDe('grupoId');
export const archivoParams = paramsDe('id');

/** En multipart todo llega como texto y "" significa "no lo mandé". */
const vacioAIndefinido = (v: unknown) => (v === '' || v === null ? undefined : v);
/** Al mover, "" o null = a la raíz. */
const vacioANulo = (v: unknown) => (v === '' || v === 'null' ? null : v);

const nombre = (campo: string, max: number) => textoRequerido(campo, max).refine((v) => !/[\\/]/.test(v), `${campo} no puede llevar / ni \\`);

/** Contenido de una carpeta; sin `carpeta_id` = la raíz. */
export const contenidoQuery = z.object({ carpeta_id: z.preprocess(vacioAIndefinido, idSchema.optional()) });

export const buscarArchivosQuery = paginacionQuery.extend({
  q: z.string().trim().max(100).optional().transform((v) => v || undefined),
  tipo: z.enum(TIPOS_ARCHIVO_GRUPO).optional(),
});

export const crearCarpetaSchema = z
  .object({
    nombre: nombre('El nombre', 120),
    padre_id: z.preprocess(vacioANulo, idSchema.nullable().optional()),
  })
  .strip();

export const actualizarCarpetaSchema = z
  .object({
    nombre: nombre('El nombre', 120).optional(),
    /** null = mover a la raíz. */
    padre_id: z.preprocess(vacioANulo, idSchema.nullable().optional()),
  })
  .strip()
  .refine((d) => d.nombre !== undefined || d.padre_id !== undefined, { message: 'Indica un nombre nuevo o a dónde moverla' });

/** Multipart: `archivo` + carpeta destino y nombre opcionales (por defecto el del archivo). */
export const subirArchivoSchema = z
  .object({
    carpeta_id: z.preprocess(vacioAIndefinido, idSchema.optional()),
    nombre: z.preprocess(vacioAIndefinido, nombre('El nombre', 255).optional()),
  })
  .strip();

export const actualizarArchivoSchema = z
  .object({
    nombre: nombre('El nombre', 255).optional(),
    /** null = mover a la raíz. */
    carpeta_id: z.preprocess(vacioANulo, idSchema.nullable().optional()),
  })
  .strip()
  .refine((d) => d.nombre !== undefined || d.carpeta_id !== undefined, { message: 'Indica un nombre nuevo o a dónde moverlo' });

export type ContenidoQuery = z.infer<typeof contenidoQuery>;
export type BuscarArchivosQuery = z.infer<typeof buscarArchivosQuery>;
export type CrearCarpetaDto = z.infer<typeof crearCarpetaSchema>;
export type ActualizarCarpetaDto = z.infer<typeof actualizarCarpetaSchema>;
export type SubirArchivoDto = z.infer<typeof subirArchivoSchema>;
export type ActualizarArchivoDto = z.infer<typeof actualizarArchivoSchema>;
