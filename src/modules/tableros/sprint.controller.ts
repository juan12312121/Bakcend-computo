import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { sprintService, type SprintService } from './sprint.service';

export class SprintController extends BaseController {
  constructor(private readonly service: SprintService) {
    super();
  }

  private sprintId(req: Request): number {
    return this.idParam(req, 'sprint_id');
  }

  listar = async (req: Request, res: Response) => {
    const sprints = await this.service.listar(this.idParam(req), this.usuarioId(req));
    return this.ok(res, sprints, `${sprints.length} sprints`);
  };

  backlog = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.backlog(this.idParam(req), this.usuarioId(req)), 'Backlog del tablero');
  };

  crear = async (req: Request, res: Response) => {
    return this.created(res, await this.service.crear(this.idParam(req), this.usuarioId(req), req.body), 'Sprint creado');
  };

  actualizar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.actualizar(this.sprintId(req), this.usuarioId(req), req.body), 'Sprint actualizado');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.sprintId(req), this.usuarioId(req));
    return this.message(res, 'Sprint eliminado');
  };

  iniciar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.iniciar(this.sprintId(req), this.usuarioId(req), req.body), 'Sprint iniciado');
  };

  cerrar = async (req: Request, res: Response) => {
    const resultado = await this.service.cerrar(this.sprintId(req), this.usuarioId(req), req.body);
    return this.ok(res, resultado, 'Sprint cerrado');
  };
}

export const sprintController = new SprintController(sprintService);
