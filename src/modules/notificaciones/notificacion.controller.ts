import type { Request, Response } from 'express';
import { ForbiddenError } from '../../core/errors';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import type { LimpiarAntiguasQuery } from './notificacion.schemas';
import { notificacionService, type NotificacionService } from './notificacion.service';

export class NotificacionController extends BaseController {
  constructor(private readonly service: NotificacionService) {
    super();
  }

  /** SSE: solo el dueño del token puede abrir su propio stream; se libera al cerrar la conexión. */
  stream = async (req: Request, res: Response) => {
    const usuarioId = this.idParam(req, 'usuarioId');
    if (usuarioId !== this.usuarioId(req)) throw new ForbiddenError('No autorizado para este stream');

    const desconectar = this.service.conectarStream(usuarioId, res);
    req.on('close', () => {
      desconectar();
      res.end();
    });
  };

  listar = async (req: Request, res: Response) => {
    const page = await this.service.listar(this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Notificaciones obtenidas');
  };

  noLeidas = async (req: Request, res: Response) => {
    const page = await this.service.listar(this.usuarioId(req), validatedQuery<Paginacion>(res), { soloNoLeidas: true });
    return this.paginated(res, page, 'Notificaciones no leídas obtenidas');
  };

  contador = async (req: Request, res: Response) => {
    return this.ok(res, { total: await this.service.contador(this.usuarioId(req)) }, 'Contador obtenido');
  };

  marcarLeida = async (req: Request, res: Response) => {
    const notificacion = await this.service.marcarLeida(this.idParam(req), this.usuarioId(req));
    return this.ok(res, notificacion, 'Notificación marcada como leída');
  };

  marcarTodasLeidas = async (req: Request, res: Response) => {
    const actualizadas = await this.service.marcarTodasLeidas(this.usuarioId(req));
    return this.ok(res, { actualizadas }, actualizadas ? `${actualizadas} notificaciones marcadas como leídas` : 'No hay notificaciones pendientes');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Notificación eliminada');
  };

  limpiarAntiguas = async (req: Request, res: Response) => {
    const { dias } = validatedQuery<LimpiarAntiguasQuery>(res);
    const eliminadas = await this.service.limpiarAntiguas(this.usuarioId(req), dias);
    return this.ok(res, { eliminadas }, eliminadas ? `${eliminadas} notificaciones antiguas eliminadas` : 'No hay notificaciones antiguas para limpiar');
  };

  estadisticasStream = async (_req: Request, res: Response) => {
    return this.ok(res, this.service.estadisticasStream(), 'Conexiones SSE activas');
  };
}

export const notificacionController = new NotificacionController(notificacionService);
