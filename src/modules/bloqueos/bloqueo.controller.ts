import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import type { BloquearDto } from './bloqueo.schemas';
import { bloqueoService, type BloqueoService } from './bloqueo.service';

export class BloqueoController extends BaseController {
  constructor(private readonly service: BloqueoService) {
    super();
  }

  bloquear = async (req: Request, res: Response) => {
    const { usuario_id } = req.body as BloquearDto;
    return this.created(res, await this.service.bloquear(this.usuarioId(req), usuario_id), 'Usuario bloqueado');
  };

  desbloquear = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.desbloquear(this.usuarioId(req), this.idParam(req, 'usuarioId')), 'Usuario desbloqueado');
  };

  listar = async (req: Request, res: Response) => {
    const page = await this.service.listar(this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Usuarios bloqueados');
  };
}

export const bloqueoController = new BloqueoController(bloqueoService);
