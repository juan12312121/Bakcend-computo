import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import { comentarioService, type ComentarioService } from './comentario.service';

export class ComentarioController extends BaseController {
  constructor(private readonly service: ComentarioService) {
    super();
  }

  crear = async (req: Request, res: Response) => {
    const comentario = await this.service.crear(this.usuarioId(req), req.body);
    return this.created(res, comentario, comentario.padre_id ? 'Respuesta creada' : 'Comentario creado');
  };

  dePublicacion = async (req: Request, res: Response) => {
    const pagina = await this.service.dePublicacion(
      this.idParam(req, 'publicacion_id'),
      this.usuarioIdOpcional(req),
      validatedQuery<Paginacion>(res),
    );
    return this.paginated(res, pagina, 'Comentarios obtenidos');
  };

  respuestas = async (req: Request, res: Response) => {
    const pagina = await this.service.respuestas(this.idParam(req), this.usuarioIdOpcional(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, pagina, 'Respuestas obtenidas');
  };

  deUsuario = async (req: Request, res: Response) => {
    const pagina = await this.service.deUsuario(
      this.idParam(req, 'usuario_id'),
      this.usuarioIdOpcional(req),
      validatedQuery<Paginacion>(res),
    );
    return this.paginated(res, pagina, 'Comentarios del usuario obtenidos');
  };

  obtener = async (req: Request, res: Response) => {
    const comentario = await this.service.obtenerVisible(this.idParam(req), this.usuarioIdOpcional(req));
    return this.ok(res, comentario, 'Comentario obtenido');
  };

  actualizar = async (req: Request, res: Response) => {
    const comentario = await this.service.actualizar(this.idParam(req), this.usuarioId(req), req.body);
    return this.ok(res, comentario, 'Comentario actualizado');
  };

  alternarLike = async (req: Request, res: Response) => {
    const estado = await this.service.alternarLike(this.idParam(req), this.usuarioId(req));
    return this.ok(res, estado, estado.yo_di_like ? 'Te gusta el comentario' : 'Ya no te gusta el comentario');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Comentario eliminado');
  };
}

export const comentarioController = new ComentarioController(comentarioService);
