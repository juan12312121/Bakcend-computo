import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { validatedQuery } from '../../core/validation/validate';
import { mencionService, type MencionService } from './mencion.service';
import type { SugerenciasQuery } from './mencion.schemas';

export class MencionController extends BaseController {
  constructor(private readonly service: MencionService) {
    super();
  }

  /** Resuelve los enlaces /u/:nombre. */
  usuarioPorNombre = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.usuarioPorNombre(String(req.params.nombre)), 'Usuario encontrado');
  };

  sugerencias = async (req: Request, res: Response) => {
    const { q } = validatedQuery<SugerenciasQuery>(res);
    return this.ok(res, await this.service.sugerencias(q, this.usuarioId(req)), 'Sugerencias para mencionar');
  };
}

export const mencionController = new MencionController(mencionService);
