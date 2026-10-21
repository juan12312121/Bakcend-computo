import type { Request, Response } from 'express';
import { BaseController } from '../../../core/http/BaseController';
import { validatedQuery } from '../../../core/validation/validate';
import { enviarArchivo } from '../aula.archivos';
import type { ResumenQuery } from './hora.schemas';
import { horaService, type HoraService } from './hora.service';

export class HoraController extends BaseController {
  constructor(private readonly service: HoraService) {
    super();
  }

  private tareaId(req: Request): number {
    return this.idParam(req, 'tarea_id');
  }

  // ---------- Cronómetro ----------

  activo = async (req: Request, res: Response) => {
    const activo = await this.service.activo(this.usuarioId(req));
    return this.ok(res, activo, activo ? 'Cronómetro corriendo' : 'No hay cronómetro corriendo');
  };

  iniciar = async (req: Request, res: Response) => {
    const resultado = await this.service.iniciar(this.tareaId(req), this.usuarioId(req), req.body);
    return this.created(res, resultado, resultado.detenido ? 'Cronómetro iniciado (se detuvo el anterior)' : 'Cronómetro iniciado');
  };

  detener = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.detener(this.usuarioId(req)), 'Cronómetro detenido');
  };

  // ---------- Registros ----------

  deTarea = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.deTarea(this.tareaId(req), this.usuarioId(req)), 'Tiempo de la tarea');
  };

  registrar = async (req: Request, res: Response) => {
    return this.created(res, await this.service.registrar(this.tareaId(req), this.usuarioId(req), req.body), 'Tiempo registrado');
  };

  editar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.editar(this.idParam(req), this.usuarioId(req), req.body), 'Registro actualizado');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Registro eliminado');
  };

  // ---------- Tablero ----------

  resumen = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.resumen(this.idParam(req), this.usuarioId(req), validatedQuery<ResumenQuery>(res)), 'Resumen de horas');
  };

  csv = async (req: Request, res: Response) => {
    return enviarArchivo(res, await this.service.csv(this.idParam(req), this.usuarioId(req), validatedQuery<ResumenQuery>(res)));
  };

  tarifas = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.verTarifas(this.idParam(req), this.usuarioId(req)), 'Tarifas del tablero');
  };

  fijarTarifa = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.fijarTarifa(this.idParam(req), this.usuarioId(req), req.body), 'Tarifa guardada');
  };
}

export const horaController = new HoraController(horaService);
