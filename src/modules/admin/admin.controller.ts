import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import { adminService, type AdminService } from './admin.service';
import type { LogsQuery, SuspensionDto } from './admin.schemas';
import { contextoDe } from '../../core/http/ContextoPeticion';

export class AdminController extends BaseController {
  constructor(private readonly service: AdminService) {
    super();
  }

  reportes = async (_req: Request, res: Response) => {
    const page = await this.service.listarReportes(validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Reportes obtenidos correctamente');
  };

  eliminarPublicacion = async (req: Request, res: Response) => {
    await this.service.eliminarPublicacion(this.usuarioId(req), this.idParam(req), req.body.motivo, contextoDe(req));
    return this.message(res, 'Publicación eliminada por moderación');
  };

  suspender = async (req: Request, res: Response) => {
    const { motivo, dias } = req.body as SuspensionDto;
    const estado = await this.service.alternarSuspension(this.usuarioId(req), this.idParam(req), motivo, contextoDe(req), dias);
    return this.ok(res, estado, estado.suspendido ? 'Usuario suspendido exitosamente' : 'Suspensión levantada');
  };

  logs = async (_req: Request, res: Response) => {
    const { evento, usuario_id, limit, offset } = validatedQuery<LogsQuery>(res);
    const page = await this.service.listarLogs({ evento, usuario_id }, { limit, offset });
    return this.paginated(res, page, 'Logs de seguridad obtenidos');
  };

}

export const adminController = new AdminController(adminService);
