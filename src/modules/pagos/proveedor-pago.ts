import type { NombreProveedorPago } from '../../infrastructure/database/models';

/** Proveedores que cobran de verdad (o simulan cobrar); "gratis" nunca pasa por una pasarela. */
export type NombrePasarela = Exclude<NombreProveedorPago, 'gratis'>;

/** Lo que hace falta para iniciar un cobro. Montos en centavos. */
export interface DatosCobro {
  ordenId: number;
  /** Lo que ve el comprador en la página de pago ("Boleto General · Fiesta de fin de mes"). */
  titulo: string;
  descripcion?: string;
  cantidad: number;
  precioUnitarioCentavos: number;
  /** ISO 4217 (MXN, USD...). */
  moneda: string;
  email?: string | null;
  /** Página de la app a la que vuelve el comprador (resultado de la compra). */
  urlRegreso: string;
  /** Cuándo deja de valer el cobro (la orden libera su cupo). */
  expiraEn: Date;
}

export interface CobroCreado {
  /** Id de la sesión de Stripe / preferencia de Mercado Pago. */
  referencia: string;
  /** URL a la que se redirige al comprador para pagar. */
  url: string;
}

/** Petición de webhook tal como llegó (el cuerpo crudo hace falta para la firma de Stripe). */
export interface PeticionWebhook {
  cuerpoCrudo: Buffer;
  cuerpo: unknown;
  query: Record<string, unknown>;
  cabeceras: Record<string, string | string[] | undefined>;
}

/** Lo que el proveedor confirmó sobre una orden. */
export interface AvisoPago {
  ordenId: number;
  estado: 'pagada' | 'fallida';
  /** Id del cobro para poder reembolsar. */
  pagoId?: string | null;
  /** Monto cobrado en centavos (si el proveedor lo informa): se compara con la orden. */
  montoCentavos?: number | null;
  motivo?: string;
}

/** Datos de la orden que necesita un reembolso. */
export interface OrdenAReembolsar {
  id: number;
  pago_externo_id: string | null;
  referencia_externa: string | null;
  total_centavos: number;
}

/**
 * Pasarela de pago. Cada implementación lee sus claves del entorno y se prueba con la librería simulada.
 * - crearCobro: devuelve la URL de pago.
 * - verificarWebhook: valida la firma/el pago con el proveedor y traduce el aviso (null = aviso que no nos importa).
 * - reembolsar: devuelve el total del cobro.
 */
export interface ProveedorPago {
  readonly nombre: NombrePasarela;
  /** Nombre para mostrar. */
  readonly etiqueta: string;
  /** Claves de prueba (sk_test_ / TEST-) o simulación. */
  readonly modoPrueba: boolean;
  crearCobro(datos: DatosCobro): Promise<CobroCreado>;
  verificarWebhook(peticion: PeticionWebhook): Promise<AvisoPago | null>;
  reembolsar(orden: OrdenAReembolsar): Promise<void>;
}

/** Error al hablar con un proveedor (se traduce a 502 / 400 en el servicio). */
export class ErrorProveedorPago extends Error {
  constructor(
    message: string,
    public readonly causa?: unknown,
  ) {
    super(message);
    this.name = 'ErrorProveedorPago';
  }
}

/** Firma inválida o aviso mal formado: el webhook responde 400. */
export class FirmaWebhookInvalida extends Error {
  constructor(message = 'Firma del webhook inválida') {
    super(message);
    this.name = 'FirmaWebhookInvalida';
  }
}

/** Cabecera como texto (Express puede dar arreglos). */
export function cabecera(cabeceras: PeticionWebhook['cabeceras'], nombre: string): string | undefined {
  const valor = cabeceras[nombre.toLowerCase()];
  return Array.isArray(valor) ? valor[0] : valor;
}
