import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { NombrePasarela, PeticionWebhook } from './proveedor-pago';
import { pagoService, type PagoService } from './pago.service';

/** El cuerpo llega como Buffer si se montó `cuerpoCrudoWebhook` antes de express.json (lo ideal para Stripe). */
function peticionWebhook(req: Request): PeticionWebhook {
  const conCrudo = req as Request & { rawBody?: Buffer };
  if (Buffer.isBuffer(req.body)) {
    const texto = req.body.toString('utf8');
    let cuerpo: unknown = {};
    try {
      cuerpo = texto ? JSON.parse(texto) : {};
    } catch {
      cuerpo = {};
    }
    return { cuerpoCrudo: req.body, cuerpo, query: req.query as Record<string, unknown>, cabeceras: req.headers };
  }
  return {
    // Sin el cuerpo crudo, la firma de Stripe no coincidirá (ver docs/api/pagos.md, "Conexión")
    cuerpoCrudo: conCrudo.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})),
    cuerpo: req.body ?? {},
    query: req.query as Record<string, unknown>,
    cabeceras: req.headers,
  };
}

export class PagoController extends BaseController {
  constructor(private readonly service: PagoService) {
    super();
  }

  proveedores = async (_req: Request, res: Response) => {
    return this.ok(res, this.service.info(), 'Métodos de pago disponibles');
  };

  webhookStripe = async (req: Request, res: Response) => {
    return this.webhook('stripe', req, res);
  };

  webhookMercadoPago = async (req: Request, res: Response) => {
    return this.webhook('mercadopago', req, res);
  };

  simularDemo = async (req: Request, res: Response) => {
    const orden = await this.service.simularDemo(this.idParam(req), this.usuarioId(req), req.body.aprobar);
    return this.ok(res, orden, orden.estado === 'pagada' ? 'Pago simulado aprobado' : 'Pago simulado rechazado');
  };

  private async webhook(proveedor: NombrePasarela, req: Request, res: Response) {
    return this.ok(res, await this.service.procesarWebhook(proveedor, peticionWebhook(req)), 'Aviso recibido');
  }
}

export const pagoController = new PagoController(pagoService);
