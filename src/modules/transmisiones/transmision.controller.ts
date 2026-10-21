import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { validatedQuery } from '../../core/validation/validate';
import type { ComentariosQuery, ListarTransmisionesQuery } from './transmision.schemas';
import { senalizacionTransmisiones, type SenalizacionTransmisiones } from './transmision.senalizacion';
import { transmisionService, type TransmisionService } from './transmision.service';

export class TransmisionController extends BaseController {
  constructor(
    private readonly service: TransmisionService,
    private readonly senalizacion: SenalizacionTransmisiones,
  ) {
    super();
  }

  listar = async (req: Request, res: Response) => {
    const page = await this.service.listar(this.usuarioId(req), validatedQuery<ListarTransmisionesQuery>(res));
    return this.paginated(res, page, 'Transmisiones en vivo');
  };

  detalle = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.detalle(this.idParam(req), this.usuarioId(req)), 'Transmisión obtenida');
  };

  iniciar = async (req: Request, res: Response) => {
    const transmision = await this.senalizacion.iniciar(this.usuarioId(req), req.body);
    return this.created(res, transmision, '¡Estás en vivo!');
  };

  terminar = async (req: Request, res: Response) => {
    await this.senalizacion.terminar(this.idParam(req), this.usuarioId(req));
    return this.ok(res, await this.service.detalle(this.idParam(req), this.usuarioId(req)), 'Transmisión terminada');
  };

  comentarios = async (req: Request, res: Response) => {
    const page = await this.service.comentariosDe(this.idParam(req), this.usuarioId(req), validatedQuery<ComentariosQuery>(res));
    return this.paginated(res, page, 'Comentarios de la transmisión');
  };

  espectadores = async (req: Request, res: Response) => {
    const lista = await this.senalizacion.espectadoresDe(this.idParam(req), this.usuarioId(req));
    return this.ok(res, lista, `${lista.length} viendo ahora`);
  };
}

export const transmisionController = new TransmisionController(transmisionService, senalizacionTransmisiones);
