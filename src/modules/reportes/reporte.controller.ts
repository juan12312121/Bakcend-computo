import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import { preferenciaService, type PreferenciaService } from './preferencia.service';
import type { CrearReporteDto, PublicacionBodyDto } from './reporte.schemas';
import { reporteService, type ReporteService } from './reporte.service';

export class ReporteController extends BaseController {
  constructor(
    private readonly reportes: ReporteService,
    private readonly preferencias: PreferenciaService,
  ) {
    super();
  }

  // ---------- Reportes ----------

  crear = async (req: Request, res: Response) => {
    const resultado = await this.reportes.crear(this.usuarioId(req), req.body as CrearReporteDto);
    const mensaje = resultado.publicacion_oculta ? 'Reporte creado. La publicación quedó oculta por exceso de reportes' : 'Reporte creado';
    return this.created(res, resultado, mensaje);
  };

  dePublicacion = async (req: Request, res: Response) => {
    const reportes = await this.reportes.dePublicacion(this.idParam(req, 'publicacionId'));
    return this.ok(res, reportes, 'Reportes obtenidos');
  };

  todos = async (_req: Request, res: Response) => {
    const page = await this.reportes.publicacionesReportadas(validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Publicaciones reportadas');
  };

  estadisticas = async (_req: Request, res: Response) => {
    return this.ok(res, await this.reportes.estadisticas(), 'Estadísticas obtenidas');
  };

  // ---------- Ocultar publicaciones ajenas ----------

  ocultar = async (req: Request, res: Response) => {
    const { publicacion_id } = req.body as PublicacionBodyDto;
    await this.preferencias.ocultar(this.usuarioId(req), publicacion_id);
    return this.ok(res, { publicacion_id }, 'Publicación ocultada');
  };

  mostrar = async (req: Request, res: Response) => {
    const { publicacion_id } = req.body as PublicacionBodyDto;
    await this.preferencias.mostrar(this.usuarioId(req), publicacion_id);
    return this.ok(res, { publicacion_id }, 'Publicación visible de nuevo');
  };

  ocultas = async (req: Request, res: Response) => {
    const page = await this.preferencias.listarOcultas(this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Publicaciones ocultas');
  };

  // ---------- Publicaciones propias ----------

  ocultarPropias = async (req: Request, res: Response) => {
    const cantidad = await this.preferencias.ocultarPropias(this.usuarioId(req));
    return this.ok(res, { cantidad }, `${cantidad} publicación(es) propia(s) ocultada(s)`);
  };

  mostrarPropias = async (req: Request, res: Response) => {
    const cantidad = await this.preferencias.mostrarPropias(this.usuarioId(req));
    return this.ok(res, { cantidad }, `${cantidad} publicación(es) propia(s) visible(s) de nuevo`);
  };

  propiasOcultas = async (req: Request, res: Response) => {
    const page = await this.preferencias.propiasOcultas(this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Publicaciones propias ocultas');
  };

  // ---------- No me interesa ----------

  noInteresa = async (req: Request, res: Response) => {
    const { publicacion_id } = req.body as PublicacionBodyDto;
    const marca = await this.preferencias.marcarNoInteresa(this.usuarioId(req), publicacion_id);
    return this.created(res, marca, 'No verás más esta publicación en tu feed');
  };

  siInteresa = async (req: Request, res: Response) => {
    const { publicacion_id } = req.body as PublicacionBodyDto;
    await this.preferencias.desmarcarNoInteresa(this.usuarioId(req), publicacion_id);
    return this.ok(res, { publicacion_id }, 'Publicación visible de nuevo');
  };

  noInteresan = async (req: Request, res: Response) => {
    const page = await this.preferencias.listarNoInteresan(this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Publicaciones marcadas como no interesa');
  };

  limpiarNoInteresa = async (req: Request, res: Response) => {
    const cantidad = await this.preferencias.limpiarNoInteresa(this.usuarioId(req));
    return this.ok(res, { cantidad }, `${cantidad} publicación(es) visible(s) de nuevo`);
  };
}

export const reporteController = new ReporteController(reporteService, preferenciaService);
