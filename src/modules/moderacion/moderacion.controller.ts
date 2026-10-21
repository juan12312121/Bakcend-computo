import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { contextoDe } from '../../core/http/ContextoPeticion';
import { validatedQuery } from '../../core/validation/validate';
import { MOTIVOS_REPORTE, type TipoContenidoReportable } from '../../infrastructure/database/models';
import type {
  ActualizarPalabraDto,
  BandejaQuery,
  CrearPalabraDto,
  CrearReporteContenidoDto,
  EstadisticasQuery,
  HistorialQuery,
  NotaDto,
  PalabrasQuery,
  ProbarTextoDto,
  ResolverDto,
  SuspenderDto,
  SuspensionesQuery,
  UsuariosReportadosQuery,
} from './moderacion.schemas';
import { moderacionService, type ModeracionService } from './moderacion.service';
import { palabrasService, type PalabrasService } from './palabras.service';
import type { ClaveContenido } from './reporte-contenido.repository';

export class ModeracionController extends BaseController {
  constructor(
    private readonly service: ModeracionService,
    private readonly palabras: PalabrasService,
  ) {
    super();
  }

  // ---------- Cualquier usuario ----------

  opciones = async (_req: Request, res: Response) => {
    return this.ok(res, { motivos: MOTIVOS_REPORTE, tipos: this.service.tiposDisponibles() }, 'Opciones de reporte');
  };

  reportar = async (req: Request, res: Response) => {
    const resultado = await this.service.reportar(this.usuarioId(req), req.body as CrearReporteContenidoDto);
    const mensaje = resultado.publicacion_oculta ? 'Reporte enviado. La publicación quedó oculta por exceso de reportes' : 'Reporte enviado';
    return this.created(res, resultado, mensaje);
  };

  // ---------- Bandeja ----------

  bandeja = async (_req: Request, res: Response) => {
    const { tipo, estado, motivo, limit, offset } = validatedQuery<BandejaQuery>(res);
    const page = await this.service.bandeja({ tipo, estado, motivo }, { limit, offset });
    return this.paginated(res, page, 'Contenidos reportados');
  };

  detalle = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.detalle(this.contenido(req)), 'Contenido reportado');
  };

  resolver = async (req: Request, res: Response) => {
    const resultado = await this.service.resolver(this.usuarioId(req), this.contenido(req), req.body as ResolverDto, contextoDe(req));
    return this.ok(res, resultado, resultado.estado === 'descartado' ? 'Reportes descartados' : 'Reportes resueltos');
  };

  nota = async (req: Request, res: Response) => {
    const nota = await this.service.agregarNota(this.usuarioId(req), this.contenido(req), (req.body as NotaDto).texto);
    return this.created(res, nota, 'Nota guardada');
  };

  historial = async (_req: Request, res: Response) => {
    const { limit, offset, ...filtros } = validatedQuery<HistorialQuery>(res);
    return this.paginated(res, await this.service.historial(filtros, { limit, offset }), 'Historial de moderación');
  };

  estadisticas = async (_req: Request, res: Response) => {
    const { dias } = validatedQuery<EstadisticasQuery>(res);
    return this.ok(res, await this.service.estadisticas(dias), 'Estadísticas de moderación');
  };

  usuariosReportados = async (_req: Request, res: Response) => {
    const { limit } = validatedQuery<UsuariosReportadosQuery>(res);
    return this.ok(res, await this.service.usuariosMasReportados(limit), 'Usuarios con más reportes');
  };

  importar = async (_req: Request, res: Response) => {
    const cantidad = await this.service.importarReportesPublicaciones();
    return this.ok(res, { cantidad }, `${cantidad} reporte(s) de publicaciones copiados a la bandeja`);
  };

  // ---------- Suspensiones ----------

  suspensiones = async (_req: Request, res: Response) => {
    const { activas, limit, offset } = validatedQuery<SuspensionesQuery>(res);
    return this.paginated(res, await this.service.listarSuspensiones(activas, { limit, offset }), 'Suspensiones');
  };

  suspender = async (req: Request, res: Response) => {
    const estado = await this.service.suspenderUsuario(this.usuarioId(req), this.idParam(req), req.body as SuspenderDto, contextoDe(req));
    return this.ok(res, estado, estado.hasta ? 'Usuario suspendido temporalmente' : 'Usuario suspendido');
  };

  levantar = async (req: Request, res: Response) => {
    const estado = await this.service.levantarSuspension(this.usuarioId(req), this.idParam(req), contextoDe(req));
    return this.ok(res, estado, 'Suspensión levantada');
  };

  // ---------- Palabras prohibidas ----------

  listarPalabras = async (_req: Request, res: Response) => {
    const { limit, offset, ...filtros } = validatedQuery<PalabrasQuery>(res);
    return this.paginated(res, await this.palabras.listar(filtros, { limit, offset }), 'Palabras prohibidas');
  };

  crearPalabra = async (req: Request, res: Response) => {
    return this.created(res, await this.palabras.crear(this.usuarioId(req), req.body as CrearPalabraDto), 'Palabra agregada');
  };

  actualizarPalabra = async (req: Request, res: Response) => {
    return this.ok(res, await this.palabras.actualizar(this.idParam(req), req.body as ActualizarPalabraDto), 'Palabra actualizada');
  };

  eliminarPalabra = async (req: Request, res: Response) => {
    await this.palabras.eliminar(this.idParam(req));
    return this.message(res, 'Palabra eliminada');
  };

  probarTexto = async (req: Request, res: Response) => {
    const { texto, contexto } = req.body as ProbarTextoDto;
    return this.ok(res, await this.palabras.revisarTexto(texto, contexto), 'Texto revisado');
  };

  /** Tipo e id del contenido desde la ruta (ya validados con contenidoParams). */
  private contenido(req: Request): ClaveContenido {
    return { tipo: req.params.tipo as TipoContenidoReportable, contenido_id: this.idParam(req, 'contenidoId') };
  }
}

export const moderacionController = new ModeracionController(moderacionService, palabrasService);
