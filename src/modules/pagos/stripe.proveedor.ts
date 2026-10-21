import Stripe from 'stripe';
import {
  ErrorProveedorPago,
  FirmaWebhookInvalida,
  cabecera,
  type AvisoPago,
  type CobroCreado,
  type DatosCobro,
  type OrdenAReembolsar,
  type PeticionWebhook,
  type ProveedorPago,
} from './proveedor-pago';

export interface ConfigStripe {
  /** STRIPE_SECRET_KEY (sk_test_... en pruebas). */
  secretKey: string;
  /** STRIPE_WEBHOOK_SECRET (whsec_...): sin él, los webhooks se rechazan. */
  webhookSecret?: string;
}

/** Lo que se usa de una Checkout Session (el objeto del evento). */
type SesionCheckout = Pick<Stripe.Checkout.Session, 'id' | 'client_reference_id' | 'metadata' | 'payment_status' | 'payment_intent' | 'amount_total'>;

/**
 * Stripe Checkout: crea una Checkout Session (pago único) y confirma con el webhook firmado
 * (`checkout.session.completed` / `async_payment_succeeded` → pagada; `expired` / `async_payment_failed` → fallida).
 */
export class StripeProveedor implements ProveedorPago {
  readonly nombre = 'stripe' as const;
  readonly etiqueta = 'Tarjeta (Stripe)';
  readonly modoPrueba: boolean;
  private readonly stripe: Stripe;

  constructor(private readonly config: ConfigStripe) {
    this.stripe = new Stripe(config.secretKey);
    this.modoPrueba = config.secretKey.startsWith('sk_test_') || config.secretKey.startsWith('rk_test_');
  }

  async crearCobro(datos: DatosCobro): Promise<CobroCreado> {
    try {
      const sesion = await this.stripe.checkout.sessions.create(
        {
          mode: 'payment',
          client_reference_id: String(datos.ordenId),
          metadata: { orden_id: String(datos.ordenId) },
          customer_email: datos.email ?? undefined,
          line_items: [
            {
              quantity: datos.cantidad,
              price_data: {
                currency: datos.moneda.toLowerCase(),
                unit_amount: datos.precioUnitarioCentavos,
                product_data: { name: datos.titulo, ...(datos.descripcion ? { description: datos.descripcion } : {}) },
              },
            },
          ],
          success_url: datos.urlRegreso,
          cancel_url: `${datos.urlRegreso}${datos.urlRegreso.includes('?') ? '&' : '?'}cancelado=1`,
          // Stripe exige entre 30 min y 24 h
          expires_at: Math.floor(Math.max(datos.expiraEn.getTime(), Date.now() + 30 * 60_000 + 5_000) / 1000),
        },
        { idempotencyKey: `trinoflow-orden-${datos.ordenId}` },
      );
      if (!sesion.url) throw new ErrorProveedorPago('Stripe no devolvió la URL de pago');
      return { referencia: sesion.id, url: sesion.url };
    } catch (error) {
      if (error instanceof ErrorProveedorPago) throw error;
      throw new ErrorProveedorPago('No se pudo iniciar el pago con Stripe', error);
    }
  }

  async verificarWebhook({ cuerpoCrudo, cabeceras }: PeticionWebhook): Promise<AvisoPago | null> {
    if (!this.config.webhookSecret) throw new FirmaWebhookInvalida('Falta STRIPE_WEBHOOK_SECRET: no se aceptan webhooks de Stripe');
    const firma = cabecera(cabeceras, 'stripe-signature');
    if (!firma) throw new FirmaWebhookInvalida('Falta la cabecera Stripe-Signature');

    let evento: Stripe.Event;
    try {
      evento = this.stripe.webhooks.constructEvent(cuerpoCrudo, firma, this.config.webhookSecret);
    } catch {
      throw new FirmaWebhookInvalida('Firma de Stripe inválida');
    }

    switch (evento.type) {
      case 'checkout.session.completed': {
        const sesion = evento.data.object as SesionCheckout;
        // Con pagos asíncronos (p. ej. OXXO) la sesión se completa sin pago: se espera async_payment_succeeded
        return sesion.payment_status === 'paid' ? this.aviso(sesion, 'pagada') : null;
      }
      case 'checkout.session.async_payment_succeeded':
        return this.aviso(evento.data.object as SesionCheckout, 'pagada');
      case 'checkout.session.async_payment_failed':
        return this.aviso(evento.data.object as SesionCheckout, 'fallida', 'El pago no se completó');
      case 'checkout.session.expired':
        return this.aviso(evento.data.object as SesionCheckout, 'fallida', 'La sesión de pago venció');
      default:
        return null;
    }
  }

  async reembolsar(orden: OrdenAReembolsar): Promise<void> {
    if (!orden.pago_externo_id) throw new ErrorProveedorPago(`La orden ${orden.id} no tiene el id del cobro de Stripe`);
    try {
      await this.stripe.refunds.create({ payment_intent: orden.pago_externo_id }, { idempotencyKey: `trinoflow-reembolso-${orden.id}` });
    } catch (error) {
      throw new ErrorProveedorPago('Stripe rechazó el reembolso', error);
    }
  }

  private aviso(sesion: SesionCheckout, estado: AvisoPago['estado'], motivo?: string): AvisoPago | null {
    const ordenId = Number(sesion.metadata?.['orden_id'] ?? sesion.client_reference_id);
    if (!Number.isInteger(ordenId) || ordenId <= 0) return null;
    const intento = sesion.payment_intent;
    return {
      ordenId,
      estado,
      pagoId: typeof intento === 'string' ? intento : (intento?.id ?? null),
      montoCentavos: sesion.amount_total ?? null,
      motivo,
    };
  }
}
