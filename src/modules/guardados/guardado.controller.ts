import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import { guardadoService, type GuardadoService } from './guardado.service';

export class GuardadoController extends BaseController {
  constructor(private readonly service: GuardadoService) {
    super();
  }

  /** 201 si se guardó, 200 si se quitó. */
  alternar = async (req: Request, res: Response) => {
    const estado = await this.service.alternar(this.idParam(req, 'publicacion_id'), this.usuarioId(req));
    return estado.guardada
      ? this.created(res, estado, 'Publicación guardada')
      : this.ok(res, estado, 'Publicación quitada de guardados');
  };

  mias = async (req: Request, res: Response) => {
    const page = await this.service.mias(this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, page.total ? 'Publicaciones guardadas' : 'Aún no guardas publicaciones');
  };
}

export const guardadoController = new GuardadoController(guardadoService);
