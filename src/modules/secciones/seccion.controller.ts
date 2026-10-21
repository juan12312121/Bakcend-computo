import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { archivoDe } from '../../infrastructure/storage/FileStorage';
import { seccionService, type SeccionService } from './seccion.service';

export class SeccionController extends BaseController {
  constructor(private readonly service: SeccionService) {
    super();
  }

  // ---------- Públicas ----------

  deUsuario = async (req: Request, res: Response) => {
    const secciones = await this.service.deUsuario(this.idParam(req, 'usuario_id'));
    return this.ok(res, secciones, 'Secciones del usuario obtenidas');
  };

  verPublica = async (req: Request, res: Response) => {
    const vista = await this.service.verPublica(
      this.idParam(req, 'usuario_id'),
      this.idParam(req, 'seccion_id'),
      this.usuarioIdOpcional(req),
    );
    return this.ok(res, vista, 'Sección obtenida');
  };

  // ---------- Propias ----------

  misSecciones = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.deUsuario(this.usuarioId(req)), 'Secciones obtenidas');
  };

  ver = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.verPropia(this.idParam(req), this.usuarioId(req)), 'Sección obtenida');
  };

  crear = async (req: Request, res: Response) => {
    const seccion = await this.service.crear(this.usuarioId(req), req.body, archivoDe(req));
    return this.created(res, seccion, 'Sección creada');
  };

  actualizar = async (req: Request, res: Response) => {
    const seccion = await this.service.actualizar(this.idParam(req), this.usuarioId(req), req.body, archivoDe(req));
    return this.ok(res, seccion, 'Sección actualizada');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Sección eliminada');
  };

  agregarPost = async (req: Request, res: Response) => {
    const seccion = await this.service.agregarPublicacion(this.usuarioId(req), req.body);
    return this.ok(res, seccion, 'Publicación agregada a la sección');
  };

  quitarPost = async (req: Request, res: Response) => {
    const seccion = await this.service.quitarPublicacion(this.usuarioId(req), req.body);
    return this.ok(res, seccion, 'Publicación quitada de la sección');
  };

  seccionesDePost = async (req: Request, res: Response) => {
    const secciones = await this.service.seccionesDePublicacion(this.idParam(req, 'publicacion_id'), this.usuarioId(req));
    return this.ok(res, secciones, 'Secciones de la publicación obtenidas');
  };
}

export const seccionController = new SeccionController(seccionService);
