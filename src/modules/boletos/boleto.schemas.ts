import { z } from 'zod';
import { idSchema, paginacionQuery, textoRequerido } from '../../core/validation/common.schemas';
import { ESTADOS_BOLETO } from '../../infrastructure/database/models';

export const LIMITES_BOLETOS = {
  nombre: 80,
  descripcion: 300,
  /** 100,000.00 en la moneda del evento. */
  precioMaximo: 100_000,
  cupo: 100_000,
  maxPorPersona: 50,
  cantidadPorCompra: 20,
  codigo: 120,
  staff: 30,
} as const;

/** Monedas aceptadas (las que manejan Stripe y Mercado Pago en la región). */
export const MONEDAS = ['MXN', 'USD', 'ARS', 'BRL', 'CLP', 'COP', 'PEN', 'UYU', 'EUR'] as const;

export const CUANDO_BOLETOS = ['proximos', 'pasados', 'todos'] as const;

const fecha = (campo: string) => z.coerce.date({ errorMap: () => ({ message: `${campo} no es una fecha válida` }) });

/** Pesos con hasta 2 decimales → centavos. 0 = gratis. */
const precio = z.coerce
  .number({ invalid_type_error: 'El precio debe ser un número' })
  .min(0, 'El precio no puede ser negativo')
  .max(LIMITES_BOLETOS.precioMaximo, `El precio máximo es ${LIMITES_BOLETOS.precioMaximo}`)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'El precio admite máximo 2 decimales')
  .transform((v) => Math.round(v * 100));

const cupo = z.coerce
  .number({ invalid_type_error: 'El cupo debe ser un número' })
  .int('El cupo debe ser un número entero')
  .min(1, 'El cupo mínimo es 1')
  .max(LIMITES_BOLETOS.cupo, `El cupo máximo es ${LIMITES_BOLETOS.cupo}`);

const maxPorPersona = z.coerce
  .number({ invalid_type_error: 'Debe ser un número' })
  .int('Debe ser un número entero')
  .min(1, 'Mínimo 1 por persona')
  .max(LIMITES_BOLETOS.maxPorPersona, `Máximo ${LIMITES_BOLETOS.maxPorPersona} por persona`);

const ventanaValida = (datos: { venta_desde?: Date | null; venta_hasta?: Date | null }, ctx: z.RefinementCtx) => {
  if (datos.venta_desde && datos.venta_hasta && datos.venta_hasta.getTime() <= datos.venta_desde.getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['venta_hasta'], message: 'El fin de la venta debe ser después del inicio' });
  }
};

// ---------- Body ----------

/** PUT /eventos/:evento_id/configuracion */
export const configuracionSchema = z
  .object({
    requiere_boleto: z.boolean({ invalid_type_error: 'requiere_boleto debe ser verdadero o falso' }).optional(),
    moneda: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.enum(MONEDAS, { errorMap: () => ({ message: `La moneda debe ser una de: ${MONEDAS.join(', ')}` }) }))
      .optional(),
  })
  .strip()
  .refine((d) => d.requiere_boleto !== undefined || d.moneda !== undefined, { message: 'No hay datos para actualizar' });

/** POST /eventos/:evento_id/tipos */
export const crearTipoSchema = z
  .object({
    nombre: textoRequerido('El nombre', LIMITES_BOLETOS.nombre),
    descripcion: z.string().trim().max(LIMITES_BOLETOS.descripcion, `La descripción admite máximo ${LIMITES_BOLETOS.descripcion} caracteres`).optional().nullable(),
    precio: precio.default(0),
    cupo: cupo.optional().nullable(),
    venta_desde: fecha('El inicio de la venta').optional().nullable(),
    venta_hasta: fecha('El fin de la venta').optional().nullable(),
    max_por_persona: maxPorPersona.default(10),
  })
  .strip()
  .superRefine(ventanaValida);

/** PUT /tipos/:id — todo opcional; null borra descripción, cupo y fechas de venta. */
export const actualizarTipoSchema = z
  .object({
    nombre: z.string().trim().min(1, 'El nombre no puede quedar vacío').max(LIMITES_BOLETOS.nombre).optional(),
    descripcion: z.string().trim().max(LIMITES_BOLETOS.descripcion).optional().nullable(),
    precio: precio.optional(),
    cupo: cupo.optional().nullable(),
    venta_desde: fecha('El inicio de la venta').optional().nullable(),
    venta_hasta: fecha('El fin de la venta').optional().nullable(),
    max_por_persona: maxPorPersona.optional(),
    activo: z.boolean().optional(),
    orden: z.coerce.number().int().min(0).max(1000).optional(),
  })
  .strip()
  .superRefine(ventanaValida);

/** POST /comprar */
export const comprarSchema = z.object({
  tipo_boleto_id: idSchema,
  cantidad: z.coerce
    .number({ invalid_type_error: 'La cantidad debe ser un número' })
    .int('La cantidad debe ser un número entero')
    .min(1, 'Mínimo 1 boleto')
    .max(LIMITES_BOLETOS.cantidadPorCompra, `Máximo ${LIMITES_BOLETOS.cantidadPorCompra} boletos por compra`)
    .default(1),
  proveedor: z.enum(['stripe', 'mercadopago', 'demo'], { errorMap: () => ({ message: 'Método de pago no válido' }) }).optional(),
});

/** POST /validar */
export const validarSchema = z.object({
  codigo: z
    .string({ required_error: 'Falta el código', invalid_type_error: 'El código debe ser texto' })
    .trim()
    .min(1, 'Falta el código')
    .max(LIMITES_BOLETOS.codigo, 'El código no es válido'),
  evento_id: idSchema,
});

export const transferirSchema = z.object({ usuario_id: idSchema });
export const staffSchema = z.object({ usuario_id: idSchema });

// ---------- Params / query ----------

export const eventoParams = z.object({ evento_id: idSchema });
export const staffParams = z.object({ evento_id: idSchema, usuario_id: idSchema });

export const misBoletosQuery = paginacionQuery.extend({
  cuando: z.enum(CUANDO_BOLETOS).default('proximos'),
});

export const boletosEventoQuery = paginacionQuery.extend({
  estado: z.enum(ESTADOS_BOLETO).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

export type ConfiguracionDto = z.infer<typeof configuracionSchema>;
export type CrearTipoDto = z.infer<typeof crearTipoSchema>;
export type ActualizarTipoDto = z.infer<typeof actualizarTipoSchema>;
export type ComprarDto = z.infer<typeof comprarSchema>;
export type ValidarDto = z.infer<typeof validarSchema>;
export type MisBoletosQuery = z.infer<typeof misBoletosQuery>;
export type BoletosEventoQuery = z.infer<typeof boletosEventoQuery>;
