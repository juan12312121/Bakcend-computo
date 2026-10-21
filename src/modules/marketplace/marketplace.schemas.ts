import { z } from 'zod';
import { idSchema, paginacionQuery, paramsDe } from '../../core/validation/common.schemas';
import {
  CATEGORIAS_ANUNCIO,
  CONDICIONES_ANUNCIO,
  ESTADOS_ANUNCIO,
  ESTADOS_REPORTE_ANUNCIO,
  MODOS_PRECIO_ANUNCIO,
  MONEDAS_ANUNCIO,
  MOTIVOS_REPORTE_ANUNCIO,
  TIPOS_ANUNCIO,
} from '../../infrastructure/database/models';

export const LIMITES_ANUNCIO = {
  titulo: 120,
  descripcion: 5000,
  ubicacion: 150,
  precioMaximo: 999_999_999.99,
  fotos: 10,
  mensajeInteres: 1000,
  detalleReporte: 500,
  comentarioCalificacion: 500,
} as const;

/** Campo multipart de las fotos (upload.array('imagen', 10)). */
export const CAMPO_FOTOS = 'imagen';

export const ORDENES_ANUNCIO = ['recientes', 'precio_asc', 'precio_desc', 'vistas'] as const;
export type OrdenAnuncios = (typeof ORDENES_ANUNCIO)[number];

/** Estados que el vendedor puede poner a mano (renovar es otra acción). */
export const ESTADOS_MANUALES = ESTADOS_ANUNCIO;

// ---------- Piezas ----------

/** En multipart todo llega como texto y "" significa "no lo mandé". */
const vacioAIndefinido = (v: unknown) => (v === '' || v === null ? undefined : v);
/** Al editar, "" (multipart) o null (JSON) borra el valor. */
const vacioANulo = (v: unknown) => (v === '' ? null : v);

const booleanoFlexible = z.preprocess(
  (v) => (v === 'true' || v === '1' || v === 1 ? true : v === 'false' || v === '0' || v === 0 ? false : v),
  z.boolean({ invalid_type_error: 'Debe ser verdadero o falso' }),
);

const enumCon = <T extends readonly [string, ...string[]]>(valores: T, campo: string) =>
  z.enum(valores, { errorMap: () => ({ message: `${campo} debe ser uno de: ${valores.join(', ')}` }) });

const texto = (campo: string, max: number) =>
  z.string({ invalid_type_error: `${campo} debe ser texto` }).trim().max(max, `${campo} admite máximo ${max} caracteres`);

const textoNoVacio = (campo: string, max: number) => texto(campo, max).min(1, `${campo} es requerido`);

const precio = z.coerce
  .number({ invalid_type_error: 'El precio debe ser un número' })
  .min(0, 'El precio no puede ser negativo')
  .max(LIMITES_ANUNCIO.precioMaximo, 'El precio es demasiado alto')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'El precio admite máximo 2 decimales');

/**
 * Lista final de fotos al editar (en orden): ids de fotos ya guardadas y "nueva:N" para la N-ésima foto subida
 * en esta petición. Acepta un arreglo, texto separado por comas o un JSON. Las guardadas que no aparezcan se borran.
 */
export const TOKEN_FOTO = /^(\d+|nueva:\d+)$/;
const listaFotos = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return undefined;
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'string') {
      const limpio = v.trim();
      if (limpio.startsWith('[')) {
        try {
          return (JSON.parse(limpio) as unknown[]).map(String);
        } catch {
          return [limpio];
        }
      }
      return limpio ? limpio.split(',').map((s) => s.trim()) : [];
    }
    return v;
  },
  z
    .array(z.string().regex(TOKEN_FOTO, 'Cada foto debe ser un id o "nueva:N"'), { invalid_type_error: 'fotos debe ser una lista' })
    .max(LIMITES_ANUNCIO.fotos, `Máximo ${LIMITES_ANUNCIO.fotos} fotos`)
    .optional(),
);

// ---------- Body ----------

/** POST / (multipart con las fotos en `imagen`, o JSON para servicios sin foto). */
export const crearAnuncioSchema = z
  .object({
    titulo: textoNoVacio('El título', LIMITES_ANUNCIO.titulo),
    descripcion: z.preprocess(vacioAIndefinido, texto('La descripción', LIMITES_ANUNCIO.descripcion).optional()),
    tipo: z.preprocess(vacioAIndefinido, enumCon(TIPOS_ANUNCIO, 'El tipo').default('producto')),
    /** Si no viene: "servicios" para servicios, "otros" para productos. */
    categoria: z.preprocess(vacioAIndefinido, enumCon(CATEGORIAS_ANUNCIO, 'La categoría').optional()),
    condicion: z.preprocess(vacioAIndefinido, enumCon(CONDICIONES_ANUNCIO, 'La condición').optional()),
    modo_precio: z.preprocess(vacioAIndefinido, enumCon(MODOS_PRECIO_ANUNCIO, 'El modo de precio').default('fijo')),
    precio: z.preprocess(vacioAIndefinido, precio.optional()),
    moneda: z.preprocess(vacioAIndefinido, enumCon(MONEDAS_ANUNCIO, 'La moneda').default('MXN')),
    ubicacion: textoNoVacio('La ubicación', LIMITES_ANUNCIO.ubicacion),
    entrega_en_persona: z.preprocess(vacioAIndefinido, booleanoFlexible.default(true)),
    entrega_envio: z.preprocess(vacioAIndefinido, booleanoFlexible.default(false)),
    grupo_id: z.preprocess(vacioAIndefinido, idSchema.optional()),
  })
  .strip();

/** PUT /:id: todo opcional; `fotos` (lista final) reordena, quita y ubica las nuevas. */
export const actualizarAnuncioSchema = z
  .object({
    titulo: z.preprocess(vacioAIndefinido, textoNoVacio('El título', LIMITES_ANUNCIO.titulo).optional()),
    descripcion: z.preprocess(vacioANulo, texto('La descripción', LIMITES_ANUNCIO.descripcion).nullable().optional()),
    tipo: z.preprocess(vacioAIndefinido, enumCon(TIPOS_ANUNCIO, 'El tipo').optional()),
    categoria: z.preprocess(vacioAIndefinido, enumCon(CATEGORIAS_ANUNCIO, 'La categoría').optional()),
    condicion: z.preprocess(vacioANulo, enumCon(CONDICIONES_ANUNCIO, 'La condición').nullable().optional()),
    modo_precio: z.preprocess(vacioAIndefinido, enumCon(MODOS_PRECIO_ANUNCIO, 'El modo de precio').optional()),
    precio: z.preprocess(vacioANulo, precio.nullable().optional()),
    moneda: z.preprocess(vacioAIndefinido, enumCon(MONEDAS_ANUNCIO, 'La moneda').optional()),
    ubicacion: z.preprocess(vacioAIndefinido, textoNoVacio('La ubicación', LIMITES_ANUNCIO.ubicacion).optional()),
    entrega_en_persona: z.preprocess(vacioAIndefinido, booleanoFlexible.optional()),
    entrega_envio: z.preprocess(vacioAIndefinido, booleanoFlexible.optional()),
    fotos: listaFotos,
  })
  .strip();

export const cambiarEstadoSchema = z.object({
  estado: enumCon(ESTADOS_MANUALES, 'El estado'),
  /** Al marcar vendido: a cuál de los interesados se lo vendió (habilita su calificación). */
  comprador_id: z.preprocess(vacioAIndefinido, idSchema.optional()),
});

export const interesSchema = z
  .object({
    /** Primer mensaje del chat; si no viene se manda "¿Sigue disponible?". */
    mensaje: z.preprocess(vacioAIndefinido, texto('El mensaje', LIMITES_ANUNCIO.mensajeInteres).optional()),
  })
  .strip();

export const reportarAnuncioSchema = z.object({
  motivo: enumCon(MOTIVOS_REPORTE_ANUNCIO, 'El motivo'),
  detalle: z.preprocess(vacioAIndefinido, texto('El detalle', LIMITES_ANUNCIO.detalleReporte).optional()),
});

export const calificarSchema = z.object({
  puntuacion: z.coerce
    .number({ invalid_type_error: 'La puntuación debe ser un número' })
    .int('La puntuación debe ser un número entero')
    .min(1, 'La puntuación mínima es 1')
    .max(5, 'La puntuación máxima es 5'),
  comentario: z.preprocess(vacioAIndefinido, texto('El comentario', LIMITES_ANUNCIO.comentarioCalificacion).optional()),
});

export const revisarReporteSchema = z.object({
  estado: enumCon(['revisado', 'descartado'] as const, 'El estado'),
});

// ---------- Query ----------

const booleanoQuery = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean().optional());

export const buscarAnunciosQuery = paginacionQuery
  .extend({
    q: z.string().trim().max(100, 'La búsqueda admite máximo 100 caracteres').optional(),
    categoria: enumCon(CATEGORIAS_ANUNCIO, 'La categoría').optional(),
    tipo: enumCon(TIPOS_ANUNCIO, 'El tipo').optional(),
    condicion: enumCon(CONDICIONES_ANUNCIO, 'La condición').optional(),
    precio_min: z.coerce.number({ invalid_type_error: 'precio_min debe ser un número' }).min(0).optional(),
    precio_max: z.coerce.number({ invalid_type_error: 'precio_max debe ser un número' }).min(0).optional(),
    ubicacion: z.string().trim().max(LIMITES_ANUNCIO.ubicacion).optional(),
    gratis: booleanoQuery,
    /** Con envío disponible. */
    envio: booleanoQuery,
    grupo_id: idSchema.optional(),
    vendedor_id: idSchema.optional(),
    orden: enumCon(ORDENES_ANUNCIO, 'El orden').default('recientes'),
  })
  .superRefine((q, ctx) => {
    if (q.precio_min !== undefined && q.precio_max !== undefined && q.precio_max < q.precio_min) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['precio_max'], message: 'El precio máximo debe ser mayor o igual al mínimo' });
    }
  });

export const misAnunciosQuery = paginacionQuery.extend({
  estado: enumCon(ESTADOS_ANUNCIO, 'El estado').optional(),
});

export const reportesQuery = paginacionQuery.extend({
  estado: enumCon(ESTADOS_REPORTE_ANUNCIO, 'El estado').optional(),
  anuncio_id: idSchema.optional(),
});

export const usuarioIdParams = paramsDe('usuarioId');
export const reporteIdParams = paramsDe('reporteId');

export type CrearAnuncioDto = z.infer<typeof crearAnuncioSchema>;
export type ActualizarAnuncioDto = z.infer<typeof actualizarAnuncioSchema>;
export type CambiarEstadoDto = z.infer<typeof cambiarEstadoSchema>;
export type InteresDto = z.infer<typeof interesSchema>;
export type ReportarAnuncioDto = z.infer<typeof reportarAnuncioSchema>;
export type CalificarDto = z.infer<typeof calificarSchema>;
export type BuscarAnunciosQuery = z.infer<typeof buscarAnunciosQuery>;
export type MisAnunciosQuery = z.infer<typeof misAnunciosQuery>;
export type ReportesQuery = z.infer<typeof reportesQuery>;
