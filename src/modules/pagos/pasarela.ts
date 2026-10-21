import { env } from '../../config/env';
import { BadRequestError } from '../../core/errors';
import { ProveedorDemo } from './demo.proveedor';
import { MercadoPagoProveedor } from './mercadopago.proveedor';
import type { NombrePasarela, ProveedorPago } from './proveedor-pago';
import { StripeProveedor } from './stripe.proveedor';

/** Variables de entorno de pagos (se leen aquí con process.env; ver docs/api/pagos.md). */
export interface EntornoPagos {
  NODE_ENV?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  MERCADOPAGO_ACCESS_TOKEN?: string;
  MERCADOPAGO_WEBHOOK_SECRET?: string;
  /** stripe | mercadopago: cuál se usa si el comprador no elige. */
  PAGOS_PROVEEDOR?: string;
  /** Base pública de la API para el webhook de Mercado Pago (por defecto API_URL). */
  PAGOS_URL_WEBHOOK?: string;
}

export interface ProveedorDisponible {
  id: NombrePasarela;
  nombre: string;
  modo_prueba: boolean;
}

/**
 * Proveedores de pago activos según las claves del entorno. Sin claves y fuera de producción
 * queda solo el ProveedorDemo (simulación); en producción sin claves no se pueden vender boletos de pago.
 */
export class PasarelaPagos {
  private proveedores: ProveedorPago[];

  constructor(
    proveedores: ProveedorPago[],
    private preferido?: NombrePasarela,
  ) {
    this.proveedores = proveedores;
  }

  /** Cambia los proveedores activos (lo usan las pruebas para inyectar proveedores simulados). */
  reemplazar(proveedores: ProveedorPago[]): void;
  reemplazar(proveedores: ProveedorPago[], preferido: NombrePasarela): void;
  reemplazar(proveedores: ProveedorPago[], preferido?: NombrePasarela): void {
    this.proveedores = proveedores;
    this.preferido = preferido;
  }

  disponibles(): ProveedorDisponible[] {
    return this.proveedores.map((p) => ({ id: p.nombre, nombre: p.etiqueta, modo_prueba: p.modoPrueba }));
  }

  /** ¿Algún proveedor está en modo de prueba (claves de prueba o simulación)? */
  get modoPrueba(): boolean {
    return this.proveedores.some((p) => p.modoPrueba);
  }

  obtener(nombre: string): ProveedorPago | null {
    return this.proveedores.find((p) => p.nombre === nombre) ?? null;
  }

  /** El que pidió el comprador, el preferido del entorno o el primero. 400 si no hay ninguno. */
  elegir(): ProveedorPago;
  elegir(nombre: NombrePasarela | undefined): ProveedorPago;
  elegir(nombre?: NombrePasarela): ProveedorPago {
    if (!this.proveedores.length) throw new BadRequestError('Los pagos en línea no están configurados: por ahora solo hay boletos gratis');
    if (nombre) {
      const pedido = this.obtener(nombre);
      if (!pedido) throw new BadRequestError(`El método de pago "${nombre}" no está disponible`);
      return pedido;
    }
    return (this.preferido && this.obtener(this.preferido)) || this.proveedores[0];
  }
}

/** Arma la pasarela con lo que haya en el entorno. */
export function crearPasarela(entorno: EntornoPagos = process.env, apiUrl: string = env.API_URL): PasarelaPagos {
  const proveedores: ProveedorPago[] = [];
  if (entorno.STRIPE_SECRET_KEY) {
    proveedores.push(new StripeProveedor({ secretKey: entorno.STRIPE_SECRET_KEY, webhookSecret: entorno.STRIPE_WEBHOOK_SECRET }));
  }
  if (entorno.MERCADOPAGO_ACCESS_TOKEN) {
    const base = (entorno.PAGOS_URL_WEBHOOK ?? apiUrl).replace(/\/+$/, '');
    proveedores.push(
      new MercadoPagoProveedor({
        accessToken: entorno.MERCADOPAGO_ACCESS_TOKEN,
        webhookSecret: entorno.MERCADOPAGO_WEBHOOK_SECRET,
        // Mercado Pago rechaza notification_url que no sea https pública
        urlNotificacion: base.startsWith('https://') ? `${base}/api/pagos/webhook/mercadopago` : undefined,
      }),
    );
  }
  if (!proveedores.length && entorno.NODE_ENV !== 'production') proveedores.push(new ProveedorDemo(entorno.NODE_ENV));

  const preferido = entorno.PAGOS_PROVEEDOR === 'stripe' || entorno.PAGOS_PROVEEDOR === 'mercadopago' ? entorno.PAGOS_PROVEEDOR : undefined;
  return new PasarelaPagos(proveedores, preferido);
}

export const pasarelaPagos = crearPasarela();
