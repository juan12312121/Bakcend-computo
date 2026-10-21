import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import type { ListarTareasQuery } from './tablero.schemas';
import { tareaService, type TareaService } from './tarea.service';

export class TareaController extends BaseController {
  constructor(private readonly service: TareaService) {
    super();
  }

  private tareaId(req: Request): number {
    return this.idParam(req, 'tarea_id');
  }

  // ---------- Consultas ----------

  misTareas = async (req: Request, res: Response) => {
    const tareas = await this.service.misTareas(this.usuarioId(req));
    return this.ok(res, tareas, `${tareas.length} tareas asignadas`);
  };

  listar = async (req: Request, res: Response) => {
    const page = await this.service.listar(this.idParam(req), this.usuarioId(req), validatedQuery<ListarTareasQuery>(res));
    return this.paginated(res, page, 'Tareas del tablero');
  };

  detalle = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.detalle(this.tareaId(req), this.usuarioId(req)), 'Tarea obtenida');
  };

  actividad = async (req: Request, res: Response) => {
    const page = await this.service.actividadDe(this.tareaId(req), this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Actividad de la tarea');
  };

  // ---------- Escritura ----------

  crear = async (req: Request, res: Response) => {
    return this.created(res, await this.service.crear(this.idParam(req), this.usuarioId(req), req.body), 'Tarea creada');
  };

  actualizar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.actualizar(this.tareaId(req), this.usuarioId(req), req.body), 'Tarea actualizada');
  };

  mover = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.mover(this.tareaId(req), this.usuarioId(req), req.body), 'Tarea movida');
  };

  archivar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.archivar(this.tareaId(req), this.usuarioId(req), true), 'Tarea archivada');
  };

  desarchivar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.archivar(this.tareaId(req), this.usuarioId(req), false), 'Tarea restaurada');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.tareaId(req), this.usuarioId(req));
    return this.message(res, 'Tarea eliminada');
  };

  // ---------- Responsables y etiquetas ----------

  asignar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.asignar(this.tareaId(req), this.usuarioId(req), req.body.usuario_id), 'Responsable asignado');
  };

  desasignar = async (req: Request, res: Response) => {
    const tarea = await this.service.desasignar(this.tareaId(req), this.usuarioId(req), this.idParam(req, 'usuario_id'));
    return this.ok(res, tarea, 'Responsable quitado');
  };

  etiquetar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.etiquetar(this.tareaId(req), this.usuarioId(req), req.body.etiqueta_id), 'Etiqueta agregada');
  };

  quitarEtiqueta = async (req: Request, res: Response) => {
    const tarea = await this.service.quitarEtiqueta(this.tareaId(req), this.usuarioId(req), this.idParam(req, 'etiqueta_id'));
    return this.ok(res, tarea, 'Etiqueta quitada');
  };

  // ---------- Checklist ----------

  agregarItem = async (req: Request, res: Response) => {
    return this.created(res, await this.service.agregarItem(this.tareaId(req), this.usuarioId(req), req.body.texto), 'Elemento agregado');
  };

  editarItem = async (req: Request, res: Response) => {
    const items = await this.service.editarItem(this.tareaId(req), this.idParam(req, 'item_id'), this.usuarioId(req), req.body);
    return this.ok(res, items, 'Elemento actualizado');
  };

  eliminarItem = async (req: Request, res: Response) => {
    const items = await this.service.eliminarItem(this.tareaId(req), this.idParam(req, 'item_id'), this.usuarioId(req));
    return this.ok(res, items, 'Elemento eliminado');
  };

  // ---------- Comentarios ----------

  comentar = async (req: Request, res: Response) => {
    return this.created(res, await this.service.comentar(this.tareaId(req), this.usuarioId(req), req.body.texto), 'Comentario agregado');
  };

  editarComentario = async (req: Request, res: Response) => {
    const comentario = await this.service.editarComentario(this.tareaId(req), this.idParam(req, 'comentario_id'), this.usuarioId(req), req.body.texto);
    return this.ok(res, comentario, 'Comentario actualizado');
  };

  eliminarComentario = async (req: Request, res: Response) => {
    await this.service.eliminarComentario(this.tareaId(req), this.idParam(req, 'comentario_id'), this.usuarioId(req));
    return this.message(res, 'Comentario eliminado');
  };
}

export const tareaController = new TareaController(tareaService);
