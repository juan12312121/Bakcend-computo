import express, { Router } from 'express';
import { z } from 'zod';
import { idParams } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { pagoController as c } from './pago.controller';

/**
 * Lee el cuerpo como Buffer (la firma de Stripe se calcula sobre los bytes exactos).
 * Para que funcione con Stripe hay que montarlo en app.ts ANTES de express.json:
 *   app.use('/api/pagos/webhook', cuerpoCrudoWebhook);
 * Si express.json ya leyó el cuerpo, no hace nada.
 */
export const cuerpoCrudoWebhook = express.raw({ type: () => true, limit: '1mb' });

export const simularPagoSchema = z.object({
  aprobar: z.boolean({ required_error: 'Indica si se aprueba el pago', invalid_type_error: 'aprobar debe ser verdadero o falso' }),
});

/** Se monta en /api/pagos. Los webhooks no llevan sesión: se verifican con la firma / la API del proveedor. */
export const pagoRoutes = Router();

pagoRoutes.get('/proveedores', c.proveedores);
pagoRoutes.post('/webhook/stripe', cuerpoCrudoWebhook, c.webhookStripe);
pagoRoutes.post('/webhook/mercadopago', cuerpoCrudoWebhook, c.webhookMercadoPago);
// MODO DE PRUEBA (solo fuera de producción y sin claves reales)
pagoRoutes.post('/demo/ordenes/:id', auth.proteger, validate({ params: idParams, body: simularPagoSchema }), c.simularDemo);
