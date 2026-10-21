import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import { aArchivo, type ArchivoSubido } from '../../infrastructure/storage/FileStorage';
import type { EstadoAnuncio } from '../../infrastructure/database/models';
import type { BuscarAnunciosQuery, MisAnunciosQuery, ReportesQuery } from './marketplace.schemas';
import { marketplaceService, type MarketplaceService } from './marketplace.service';

/** Fotos de upload.array('imagen', 10): req.files llega como arreglo. */
function fotosDe(req: Request): ArchivoSubido[] {
  return Array.isArray(req.files) ? req.files.map(aArchivo) : [];
}

const MENSAJES_ESTADO: Record<EstadoAnuncio, string> = {
  activo: 'Anuncio activo',
  reservado: 'Anuncio marcado como reservado',
  vendido: '¡Anuncio marcado como vendido!',
  pausado: 'Anuncio pausado',
};

export class MarketplaceController extends BaseController {
  constructor(private readonly service: MarketplaceService) {
    super();
  }

  // ---------- Consultas ----------

  buscar = async (req: Request, res: Response) => {
    const page = await this.service.buscar(validatedQuery<BuscarAnunciosQuery>(res), this.usuarioIdOpcional(req));
    return this.paginated(res, page, 'Anuncios obtenidos');
  };

  mios = async (req: Request, res: Response) => {
    const page = await this.service.misAnuncios(this.usuarioId(req), validatedQuery<MisAnunciosQuery>(res));
    return this.paginated(res, page, 'Tus anuncios');
  };

  guardados = async (req: Request, res: Response) => {
    const page = await this.service.misGuardados(this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Anuncios guardados');
  };

  vistos = async (req: Request, res: Response) => {
    const page = await this.service.vistosRecientemente(this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Vistos recientemente');
  };

  detalle = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.detalle(this.idParam(req), this.usuarioIdOpcional(req)), 'Anuncio obtenido');
  };

  interesados = async (req: Request, res: Response) => {
    const page = await this.service.interesadosDe(this.idParam(req), this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Interesados en el anuncio');
  };

  vendedor = async (req: Request, res: Response) => {
    const ficha = await this.service.fichaVendedor(this.idParam(req, 'usuarioId'), this.usuarioIdOpcional(req));
    return this.ok(res, ficha, 'Vendedor obtenido');
  };

  calificaciones = async (req: Request, res: Response) => {
    const page = await this.service.calificacionesDe(this.idParam(req, 'usuarioId'), validatedQuery<Paginacion>(res), this.usuarioIdOpcional(req));
    return this.paginated(res, page, 'Calificaciones del vendedor');
  };

  // ---------- Escritura ----------

  crear = async (req: Request, res: Response) => {
    const anuncio = await this.service.crear(this.usuarioId(req), req.body, fotosDe(req));
    return this.created(res, anuncio, 'Anuncio publicado');
  };

  actualizar = async (req: Request, res: Response) => {
    const anuncio = await this.service.actualizar(this.idParam(req), this.usuarioId(req), req.body, fotosDe(req));
    return this.ok(res, anuncio, 'Anuncio actualizado');
  };

  cambiarEstado = async (req: Request, res: Response) => {
    const anuncio = await this.service.cambiarEstado(this.idParam(req), this.usuarioId(req), req.body);
    return this.ok(res, anuncio, MENSAJES_ESTADO[anuncio.estado as EstadoAnuncio]);
  };

  renovar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.renovar(this.idParam(req), this.usuarioId(req)), 'Anuncio renovado: vuelve a aparecer entre los recientes');
  };

  /** El vendedor, o un administrador. */
  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.idParam(req), this.usuarioId(req), { comoAdmin: req.usuario?.rol === 'admin' });
    return this.message(res, 'Anuncio eliminado');
  };

  guardar = async (req: Request, res: Response) => {
    const resultado = await this.service.alternarGuardado(this.idParam(req), this.usuarioId(req));
    return this.ok(res, resultado, resultado.guardado ? 'Anuncio guardado' : 'Anuncio quitado de guardados');
  };

  interes = async (req: Request, res: Response) => {
    const resultado = await this.service.meInteresa(this.idParam(req), this.usuarioId(req), req.body);
    return this.ok(res, resultado, 'Mensaje enviado al vendedor');
  };

  reportar = async (req: Request, res: Response) => {
    const reporte = await this.service.reportar(this.idParam(req), this.usuarioId(req), req.body);
    return this.created(res, reporte, 'Gracias, revisaremos el anuncio');
  };

  calificar = async (req: Request, res: Response) => {
    const calificacion = await this.service.calificar(this.idParam(req), this.usuarioId(req), req.body);
    return this.created(res, calificacion, 'Gracias por calificar al vendedor');
  };

  // ---------- Moderación (admin) ----------

  reportes = async (req: Request, res: Response) => {
    const { limit, offset, ...filtro } = validatedQuery<ReportesQuery>(res);
    return this.paginated(res, await this.service.listarReportes(filtro, { limit, offset }), 'Reportes de anuncios');
  };

  revisarReporte = async (req: Request, res: Response) => {
    const reporte = await this.service.revisarReporte(this.idParam(req, 'reporteId'), this.usuarioId(req), req.body.estado);
    return this.ok(res, reporte, 'Reporte actualizado');
  };
}

export const marketplaceController = new MarketplaceController(marketplaceService);
