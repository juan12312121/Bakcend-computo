import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { validatedQuery } from '../../core/validation/validate';
import type { HistorialQuery } from './llamada.schemas';
import { senalizacionLlamadas, type SenalizacionLlamadas } from './llamada.senalizacion';
import { llamadaService, type LlamadaService } from './llamada.service';

export class LlamadaController extends BaseController {
  constructor(
    private readonly service: LlamadaService,
    private readonly senalizacion: SenalizacionLlamadas,
  ) {
    super();
  }

  historial = async (req: Request, res: Response) => {
    const page = await this.service.historial(this.usuarioId(req), validatedQuery<HistorialQuery>(res));
    return this.paginated(res, page, 'Historial de llamadas');
  };

  ice = async (req: Request, res: Response) => {
    this.usuarioId(req);
    return this.ok(res, this.service.ice(), 'Servidores ICE');
  };

  activaDeGrupo = async (req: Request, res: Response) => {
    const llamada = await this.senalizacion.activaDeGrupo(this.idParam(req, 'grupoId'), this.usuarioId(req));
    return this.ok(res, llamada, llamada ? 'Hay una llamada en curso en el grupo' : 'No hay llamada en curso');
  };
}

export const llamadaController = new LlamadaController(llamadaService, senalizacionLlamadas);
