import type { AvisoPago, CobroCreado, DatosCobro, ProveedorPago } from './proveedor-pago';

/**
 * MODO DE PRUEBA — no cobra nada. Se usa cuando no hay claves de Stripe ni de Mercado Pago y NUNCA en producción
 * (el constructor lo impide). La "página de pago" es la pantalla de resultado de la app con un botón de simulación,
 * que llama a POST /api/pagos/demo/ordenes/:id. No recibe webhooks y reembolsar no hace nada.
 */
export class ProveedorDemo implements ProveedorPago {
  readonly nombre = 'demo' as const;
  readonly etiqueta = 'Pago simulado (modo de prueba)';
  readonly modoPrueba = true;

  constructor(entorno: string | undefined = process.env.NODE_ENV) {
    if (entorno === 'production') throw new Error('El proveedor de pagos de demostración no se puede usar en producción');
  }

  async crearCobro(datos: DatosCobro): Promise<CobroCreado> {
    const separador = datos.urlRegreso.includes('?') ? '&' : '?';
    return { referencia: `demo-${datos.ordenId}`, url: `${datos.urlRegreso}${separador}demo=1` };
  }

  async verificarWebhook(): Promise<AvisoPago | null> {
    return null;
  }

  async reembolsar(): Promise<void> {
    // Nada que devolver: nunca se cobró
  }
}
