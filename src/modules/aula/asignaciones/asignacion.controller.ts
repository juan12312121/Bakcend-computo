import type { Request, Response } from 'express';
import { BaseController } from '../../../core/http/BaseController';
import { validatedQuery } from '../../../core/validation/validate';
import { archivoDe } from '../../../infrastructure/storage/FileStorage';
import { enviarArchivo } from '../aula.archivos';
import type { ListarAsignacionesQuery } from './asignacion.schemas';
import { asignacionService, type AsignacionService } from './asignacion.service';

const MENSAJES_ENTREGA = {
  entregada: 'Tarea entregada',
  tarde: 'Tarea entregada (tarde)',
} as const;

export class AsignacionController extends BaseController {
  constructor(private readonly service: AsignacionService) {
    super();
  }

  private grupoId(req: Request): number {
    return this.idParam(req, 'grupo_id');
  }

  // ---------- Grupo ----------

  resumen = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.resumen(this.grupoId(req), this.usuarioId(req)), 'Aula del grupo');
  };

  listar = async (req: Request, res: Response) => {
    const page = await this.service.listar(this.grupoId(req), this.usuarioId(req), validatedQuery<ListarAsignacionesQuery>(res));
    return this.paginated(res, page, 'Tareas del grupo');
  };

  crear = async (req: Request, res: Response) => {
    const asignacion = await this.service.crear(this.grupoId(req), this.usuarioId(req), req.body, archivoDe(req));
    return this.created(res, asignacion, 'Tarea creada y enviada a los alumnos');
  };

  libreta = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.libreta(this.grupoId(req), this.usuarioId(req)), 'Libreta de calificaciones');
  };

  libretaCsv = async (req: Request, res: Response) => {
    return enviarArchivo(res, await this.service.libretaCsv(this.grupoId(req), this.usuarioId(req)));
  };

  // ---------- Una asignación ----------

  detalle = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.detalle(this.idParam(req), this.usuarioId(req)), 'Tarea obtenida');
  };

  actualizar = async (req: Request, res: Response) => {
    const asignacion = await this.service.actualizar(this.idParam(req), this.usuarioId(req), req.body, archivoDe(req));
    return this.ok(res, asignacion, 'Tarea actualizada');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Tarea eliminada');
  };

  entregas = async (req: Request, res: Response) => {
    const filas = await this.service.entregasDe(this.idParam(req), this.usuarioId(req));
    return this.ok(res, filas, `${filas.length} alumnos`);
  };

  entregar = async (req: Request, res: Response) => {
    const asignacion = await this.service.entregar(this.idParam(req), this.usuarioId(req), req.body, archivoDe(req));
    const estado = asignacion.mi_estado === 'tarde' ? 'tarde' : 'entregada';
    return this.ok(res, asignacion, MENSAJES_ENTREGA[estado]);
  };

  calificar = async (req: Request, res: Response) => {
    const fila = await this.service.calificar(this.idParam(req), this.idParam(req, 'alumno_id'), this.usuarioId(req), req.body);
    return this.ok(res, fila, 'Entrega calificada');
  };

  devolver = async (req: Request, res: Response) => {
    const fila = await this.service.devolver(this.idParam(req), this.idParam(req, 'alumno_id'), this.usuarioId(req), req.body);
    return this.ok(res, fila, 'Entrega devuelta para corregir');
  };
}

export const asignacionController = new AsignacionController(asignacionService);
