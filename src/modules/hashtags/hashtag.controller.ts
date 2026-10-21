import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import { hashtagService, type HashtagService } from './hashtag.service';
import type { BuscarHashtagsQuery } from './hashtag.schemas';

export class HashtagController extends BaseController {
  constructor(private readonly service: HashtagService) {
    super();
  }

  tendencias = async (_req: Request, res: Response) => {
    return this.ok(res, await this.service.tendencias(), 'Tendencias');
  };

  buscar = async (_req: Request, res: Response) => {
    const { q } = validatedQuery<BuscarHashtagsQuery>(res);
    return this.ok(res, await this.service.buscar(q), 'Hashtags encontrados');
  };

  info = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.info(String(req.params.nombre)), 'Hashtag encontrado');
  };

  publicaciones = async (req: Request, res: Response) => {
    const page = await this.service.publicacionesDe(String(req.params.nombre), this.usuarioIdOpcional(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, `Publicaciones con #${String(req.params.nombre)}`);
  };
}

export const hashtagController = new HashtagController(hashtagService);
