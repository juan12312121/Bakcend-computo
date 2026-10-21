import { MercadoPagoConfig, Payment, PaymentRefund, Preference, WebhookSignatureValidator } from 'mercadopago';
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

export interface ConfigMercadoPago {
  /** MERCADOPAGO_ACCESS_TOKEN (TEST-... con credenciales de prueba). */
  accessToken: string;
  /** MERCADOPAGO_WEBHOOK_SECRET: si está, se valida la cabecera x-signature. */
  webhookSecret?: string;
  /** URL pública (https) del webhook; Mercado Pago no acepta localhost. */
  urlNotificacion?: string;
}

const APROBADO = 'approved';
const FALLIDOS = new Set(['rejected', 'cancelled']);

/**
 * Mercado Pago Checkout Pro: crea una Preference y confirma con la notificación (webhook / IPN)
 * consultando el pago en la API (la notificación sola no se cree: el pago consultado es la verdad).
 */
export class MercadoPagoProveedor implements ProveedorPago {
  readonly nombre = 'mercadopago' as const;
  readonly etiqueta = 'Mercado Pago';
  readonly modoPrueba: boolean;
  private readonly cliente: MercadoPagoConfig;

  constructor(private readonly config: ConfigMercadoPago) {
    this.cliente = new MercadoPagoConfig({ accessToken: config.accessToken });
    this.modoPrueba = config.accessToken.startsWith('TEST-');
  }

  async crearCobro(datos: DatosCobro): Promise<CobroCreado> {
    try {
      const preferencia = await new Preference(this.cliente).create({
        body: {
          items: [
            {
              id: `orden-${datos.ordenId}`,
              title: datos.titulo,
              description: datos.descripcion,
              quantity: datos.cantidad,
              unit_price: datos.precioUnitarioCentavos / 100,
              currency_id: datos.moneda.toUpperCase(),
            },
          ],
          external_reference: String(datos.ordenId),
          back_urls: { success: datos.urlRegreso, failure: datos.urlRegreso, pending: datos.urlRegreso },
          auto_return: 'approved',
          ...(this.config.urlNotificacion ? { notification_url: this.config.urlNotificacion } : {}),
          ...(datos.email ? { payer: { email: datos.email } } : {}),
          expires: true,
          expiration_date_to: datos.expiraEn.toISOString(),
        },
        requestOptions: { idempotencyKey: `trinoflow-orden-${datos.ordenId}` },
      });
      const url = preferencia.init_point ?? preferencia.sandbox_init_point;
      if (!preferencia.id || !url) throw new ErrorProveedorPago('Mercado Pago no devolvió la URL de pago');
      return { referencia: preferencia.id, url };
    } catch (error) {
      if (error instanceof ErrorProveedorPago) throw error;
      throw new ErrorProveedorPago('No se pudo iniciar el pago con Mercado Pago', error);
    }
  }

  /** Acepta el webhook nuevo ({ type: 'payment', data: { id } }) y el IPN (?topic=payment&id=). */
  async verificarWebhook({ cuerpo, query, cabeceras }: PeticionWebhook): Promise<AvisoPago | null> {
    const body = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as { type?: unknown; topic?: unknown; action?: unknown; data?: { id?: unknown } };
    const tipo = String(body.type ?? body.topic ?? query['type'] ?? query['topic'] ?? '');
    const pagoId = body.data?.id ?? query['data.id'] ?? query['id'];
    if (tipo !== 'payment' || (typeof pagoId !== 'string' && typeof pagoId !== 'number') || String(pagoId) === '') return null;

    if (this.config.webhookSecret) {
      try {
        WebhookSignatureValidator.validate({
          xSignature: cabecera(cabeceras, 'x-signature'),
          xRequestId: cabecera(cabeceras, 'x-request-id'),
          dataId: String(pagoId),
          secret: this.config.webhookSecret,
        });
      } catch {
        throw new FirmaWebhookInvalida('Firma de Mercado Pago inválida');
      }
    }

    let pago: { id?: number | string; status?: string; external_reference?: string; transaction_amount?: number };
    try {
      pago = await new Payment(this.cliente).get({ id: String(pagoId) });
    } catch (error) {
      throw new ErrorProveedorPago('No se pudo consultar el pago en Mercado Pago', error);
    }

    const ordenId = Number(pago.external_reference);
    if (!Number.isInteger(ordenId) || ordenId <= 0) return null;
    const base = {
      ordenId,
      pagoId: pago.id !== undefined ? String(pago.id) : String(pagoId),
      montoCentavos: typeof pago.transaction_amount === 'number' ? Math.round(pago.transaction_amount * 100) : null,
    };
    if (pago.status === APROBADO) return { ...base, estado: 'pagada' };
    if (pago.status && FALLIDOS.has(pago.status)) return { ...base, estado: 'fallida', motivo: 'Mercado Pago rechazó el pago' };
    // pending / in_process / authorized: llegará otra notificación; refunded / charged_back los provocamos nosotros
    return null;
  }

  async reembolsar(orden: OrdenAReembolsar): Promise<void> {
    if (!orden.pago_externo_id) throw new ErrorProveedorPago(`La orden ${orden.id} no tiene el id del pago de Mercado Pago`);
    try {
      await new PaymentRefund(this.cliente).create({
        payment_id: orden.pago_externo_id,
        requestOptions: { idempotencyKey: `trinoflow-reembolso-${orden.id}` },
      });
    } catch (error) {
      throw new ErrorProveedorPago('Mercado Pago rechazó el reembolso', error);
    }
  }
}
