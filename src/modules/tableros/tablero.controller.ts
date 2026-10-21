import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import type { FiltroTareas, ListarTablerosQuery } from './tablero.schemas';
import { tableroService, type TableroService } from './tablero.service';

export class TableroController extends BaseController {
  constructor(private readonly service: TableroService) {
    super();
  }

  // ---------- Tableros ----------

  listar = async (req: Request, res: Response) => {
    const tableros = await this.service.listar(this.usuarioId(req), validatedQuery<ListarTablerosQuery>(res));
    return this.ok(res, tableros, `${tableros.length} tableros`);
  };

  crear = async (req: Request, res: Response) => {
    return this.created(res, await this.service.crear(this.usuarioId(req), req.body), 'Tablero creado');
  };

  detalle = async (req: Request, res: Response) => {
    const tablero = await this.service.detalle(this.idParam(req), this.usuarioId(req), validatedQuery<FiltroTareas>(res));
    return this.ok(res, tablero, 'Tablero obtenido');
  };

  actualizar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.actualizar(this.idParam(req), this.usuarioId(req), req.body), 'Tablero actualizado');
  };

  archivar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.archivar(this.idParam(req), this.usuarioId(req), true), 'Tablero archivado');
  };

  desarchivar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.archivar(this.idParam(req), this.usuarioId(req), false), 'Tablero restaurado');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Tablero eliminado');
  };

  // ---------- Miembros ----------

  miembros = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.listarMiembros(this.idParam(req), this.usuarioId(req)), 'Miembros del tablero');
  };

  invitar = async (req: Request, res: Response) => {
    return this.created(res, await this.service.invitar(this.idParam(req), this.usuarioId(req), req.body), 'Miembro agregado');
  };

  cambiarRol = async (req: Request, res: Response) => {
    const miembros = await this.service.cambiarRol(this.idParam(req), this.usuarioId(req), this.idParam(req, 'usuario_id'), req.body.rol);
    return this.ok(res, miembros, 'Rol actualizado');
  };

  quitarMiembro = async (req: Request, res: Response) => {
    const miembros = await this.service.quitarMiembro(this.idParam(req), this.usuarioId(req), this.idParam(req, 'usuario_id'));
    return this.ok(res, miembros, 'Miembro quitado');
  };

  salir = async (req: Request, res: Response) => {
    await this.service.salir(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Saliste del tablero');
  };

  // ---------- Columnas ----------

  crearColumna = async (req: Request, res: Response) => {
    return this.created(res, await this.service.crearColumna(this.idParam(req), this.usuarioId(req), req.body), 'Columna creada');
  };

  editarColumna = async (req: Request, res: Response) => {
    const columnas = await this.service.editarColumna(this.idParam(req), this.idParam(req, 'columna_id'), this.usuarioId(req), req.body);
    return this.ok(res, columnas, 'Columna actualizada');
  };

  reordenarColumnas = async (req: Request, res: Response) => {
    const columnas = await this.service.reordenarColumnas(this.idParam(req), this.usuarioId(req), req.body.columnas);
    return this.ok(res, columnas, 'Columnas reordenadas');
  };

  eliminarColumna = async (req: Request, res: Response) => {
    const { mover_a } = validatedQuery<{ mover_a?: number }>(res);
    const columnas = await this.service.eliminarColumna(this.idParam(req), this.idParam(req, 'columna_id'), this.usuarioId(req), mover_a);
    return this.ok(res, columnas, 'Columna eliminada');
  };

  // ---------- Etiquetas ----------

  crearEtiqueta = async (req: Request, res: Response) => {
    return this.created(res, await this.service.crearEtiqueta(this.idParam(req), this.usuarioId(req), req.body), 'Etiqueta creada');
  };

  editarEtiqueta = async (req: Request, res: Response) => {
    const etiquetas = await this.service.editarEtiqueta(this.idParam(req), this.idParam(req, 'etiqueta_id'), this.usuarioId(req), req.body);
    return this.ok(res, etiquetas, 'Etiqueta actualizada');
  };

  eliminarEtiqueta = async (req: Request, res: Response) => {
    const etiquetas = await this.service.eliminarEtiqueta(this.idParam(req), this.idParam(req, 'etiqueta_id'), this.usuarioId(req));
    return this.ok(res, etiquetas, 'Etiqueta eliminada');
  };

  // ---------- Actividad y reporte ----------

  actividad = async (req: Request, res: Response) => {
    const page = await this.service.actividadDe(this.idParam(req), this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Actividad del tablero');
  };

  reporte = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.reporte(this.idParam(req), this.usuarioId(req)), 'Reporte del tablero');
  };
}

export const tableroController = new TableroController(tableroService);
