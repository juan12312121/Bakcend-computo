import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { encuestaService, type EncuestaService } from './encuesta.service';

export class EncuestaController extends BaseController {
  constructor(private readonly service: EncuestaService) {
    super();
  }

  crear = async (req: Request, res: Response) => {
    const encuesta = await this.service.crear(this.usuarioId(req), req.body);
    return this.created(res, encuesta, 'Encuesta creada');
  };

  obtener = async (req: Request, res: Response) => {
    const encuesta = await this.service.vista(this.idParam(req), this.usuarioIdOpcional(req));
    return this.ok(res, encuesta, 'Encuesta obtenida');
  };

  votar = async (req: Request, res: Response) => {
    const encuesta = await this.service.votar(this.idParam(req), this.usuarioId(req), req.body.opcion_ids);
    return this.ok(res, encuesta, 'Voto registrado');
  };

  quitarVoto = async (req: Request, res: Response) => {
    const encuesta = await this.service.quitarVoto(this.idParam(req), this.usuarioId(req));
    return this.ok(res, encuesta, 'Voto retirado');
  };
}

export const encuestaController = new EncuestaController(encuestaService);
