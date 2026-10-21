import { BaseService } from '../../core/domain/BaseService';
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { OrdenBoleto } from '../../infrastructure/database/models';
import { ordenBoletoRepository, type OrdenBoletoRepository } from '../boletos/boleto.repository';
import type { OrdenVista } from '../boletos/boleto.vistas';
import { ordenService, type OrdenService, type ResultadoAviso } from '../boletos/orden.service';
import { pasarelaPagos, type PasarelaPagos, type ProveedorDisponible } from './pasarela';
import { ErrorProveedorPago, FirmaWebhookInvalida, type AvisoPago, type NombrePasarela, type PeticionWebhook } from './proveedor-pago';

export interface InfoPagos {
  proveedores: ProveedorDisponible[];
  /** Pagos simulados o con claves de prueba. */
  modo_prueba: boolean;
}

export interface ResultadoWebhook {
  resultado: ResultadoAviso;
  orden_id: number | null;
}

/**
 * Entrada de los proveedores: webhooks (verificados por cada proveedor) y la simulación del modo de prueba.
 * Las reglas de la orden (emitir boletos, liberar cupo, reembolsar) viven en OrdenService.
 */
export class PagoService extends BaseService<OrdenBoleto, OrdenBoletoRepository> {
  constructor(
    repository: OrdenBoletoRepository,
    private readonly pasarela: PasarelaPagos,
    private readonly ordenes: OrdenService,
    private readonly entorno: string | undefined = process.env.NODE_ENV,
  ) {
    super(repository);
  }

  info(): InfoPagos {
    return { proveedores: this.pasarela.disponibles(), modo_prueba: this.pasarela.modoPrueba };
  }

  /** 400 si la firma no es válida (el proveedor reintenta); 200 con "ignorada" para avisos que no nos tocan. */
  async procesarWebhook(nombre: NombrePasarela, peticion: PeticionWebhook): Promise<ResultadoWebhook> {
    const proveedor = this.pasarela.obtener(nombre);
    if (!proveedor || nombre === 'demo') throw new NotFoundError('Proveedor de pago', `El proveedor "${nombre}" no está configurado`);

    let aviso: AvisoPago | null;
    try {
      aviso = await proveedor.verificarWebhook(peticion);
    } catch (error) {
      if (error instanceof FirmaWebhookInvalida) throw new BadRequestError(error.message);
      if (error instanceof ErrorProveedorPago) throw new AppError(error.message, 502);
      throw error;
    }
    if (!aviso) return { resultado: 'ignorada', orden_id: null };

    const resultado =
      aviso.estado === 'pagada'
        ? await this.ordenes.confirmarPago(aviso, nombre)
        : await this.ordenes.marcarFallida(aviso.ordenId, aviso.motivo ?? 'El pago no se completó');
    return { resultado, orden_id: aviso.ordenId };
  }

  /**
   * MODO DE PRUEBA: "paga" o "rechaza" una orden del ProveedorDemo sin dinero real.
   * Solo existe fuera de producción y con el proveedor demo activo.
   */
  async simularDemo(ordenId: number, usuarioId: number, aprobar: boolean): Promise<OrdenVista> {
    if (this.entorno === 'production' || !this.pasarela.obtener('demo')) {
      throw new ForbiddenError('El pago simulado solo existe en el modo de prueba');
    }
    const orden = await this.ordenes.asegurarOrdenDemo(ordenId, usuarioId);
    if (orden.estado !== 'pendiente') return this.ordenes.consultar(ordenId, usuarioId);
    if (aprobar) {
      await this.ordenes.confirmarPago({ ordenId, estado: 'pagada', pagoId: `demo-${ordenId}`, montoCentavos: orden.total_centavos }, 'demo');
    } else {
      await this.ordenes.marcarFallida(ordenId, 'Pago rechazado (simulación)');
    }
    return this.ordenes.consultar(ordenId, usuarioId);
  }
}

export const pagoService = new PagoService(ordenBoletoRepository, pasarelaPagos, ordenService);
