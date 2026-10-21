import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import type { ReaccionesQuery } from './like.schemas';
import { likeService, type LikeService } from './like.service';

export class LikeController extends BaseController {
  constructor(private readonly service: LikeService) {
    super();
  }

  // ---------- Reacciones ----------

  reaccionar = async (req: Request, res: Response) => {
    const estado = await this.service.reaccionar(req.body.publicacion_id, this.usuarioId(req), req.body.tipo);
    return this.ok(res, estado, 'Reacción guardada');
  };

  quitarReaccion = async (req: Request, res: Response) => {
    const estado = await this.service.quitarReaccion(this.idParam(req, 'publicacion_id'), this.usuarioId(req));
    return this.ok(res, estado, 'Reacción eliminada');
  };

  reacciones = async (req: Request, res: Response) => {
    const { tipo, ...paginacion } = validatedQuery<ReaccionesQuery>(res);
    const page = await this.service.reacciones(this.idParam(req, 'publicacion_id'), paginacion, tipo, this.usuarioIdOpcional(req));
    return this.paginated(res, page, 'Reacciones obtenidas');
  };

  resumen = async (req: Request, res: Response) => {
    const estado = await this.service.resumen(this.idParam(req, 'publicacion_id'), this.usuarioIdOpcional(req));
    return this.ok(res, estado, 'Resumen de reacciones');
  };

  // ---------- Rutas viejas ----------

  agregar = async (req: Request, res: Response) => {
    const estado = await this.service.agregar(req.body.publicacion_id, this.usuarioId(req));
    return this.created(res, estado, 'Like agregado');
  };

  eliminar = async (req: Request, res: Response) => {
    const estado = await this.service.quitar(req.body.publicacion_id, this.usuarioId(req));
    return this.ok(res, estado, 'Like eliminado');
  };

  /** 201 si se agregó, 200 si se quitó (igual que el legacy). */
  alternar = async (req: Request, res: Response) => {
    const estado = await this.service.alternar(req.body.publicacion_id, this.usuarioId(req));
    return estado.liked ? this.created(res, estado, 'Like agregado') : this.ok(res, estado, 'Like eliminado');
  };

  dePublicacion = async (req: Request, res: Response) => {
    const page = await this.service.dePublicacion(
      this.idParam(req, 'publicacion_id'),
      validatedQuery<Paginacion>(res),
      this.usuarioIdOpcional(req),
    );
    return this.paginated(res, page, 'Likes obtenidos');
  };

  verificar = async (req: Request, res: Response) => {
    const estado = await this.service.verificar(this.idParam(req, 'publicacion_id'), this.usuarioId(req));
    return this.ok(res, estado, 'Estado verificado');
  };

  total = async (req: Request, res: Response) => {
    const total = await this.service.total(this.idParam(req, 'publicacion_id'), this.usuarioIdOpcional(req));
    return this.ok(res, total, 'Total obtenido');
  };

  misLikes = async (req: Request, res: Response) => {
    const page = await this.service.misLikes(this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Mis likes');
  };
}

export const likeController = new LikeController(likeService);
