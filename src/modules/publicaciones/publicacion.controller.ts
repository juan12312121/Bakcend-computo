import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import { archivoDe, archivosDe } from '../../infrastructure/storage/FileStorage';
import { publicacionService, type PublicacionService } from './publicacion.service';
import type { BuscarPublicacionesQuery, EdicionVideoDto, FeedQuery, ProgramadasQuery, ProgramarDto } from './publicacion.schemas';

export class PublicacionController extends BaseController {
  constructor(private readonly service: PublicacionService) {
    super();
  }

  categorias = async (_req: Request, res: Response) => {
    return this.ok(res, this.service.categorias(), 'Lista de categorías disponibles');
  };

  visibilidades = async (_req: Request, res: Response) => {
    return this.ok(res, this.service.visibilidades(), 'Opciones de visibilidad disponibles');
  };

  /** Catálogo de categorías con cuántas publicaciones visibles tiene cada una. */
  categoriasConTotales = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.categoriasConTotales(this.usuarioIdOpcional(req)), 'Publicaciones por categoría');
  };

  feed = async (req: Request, res: Response) => {
    const { categoria, tipo, orden, con_media, ...paginacion } = validatedQuery<FeedQuery>(res);
    const page = await this.service.feed(this.usuarioIdOpcional(req), paginacion, { categoria, tipo, conMedia: con_media }, orden);
    return this.paginated(res, page, page.items.length ? 'Feed de publicaciones' : 'No hay más publicaciones');
  };

  /** Reels: videos visibles ordenados por recientes + populares. */
  reels = async (req: Request, res: Response) => {
    const page = await this.service.reels(this.usuarioIdOpcional(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, page.items.length ? 'Reels' : 'No hay más reels');
  };

  /** Suma una reproducción (también sin sesión). */
  registrarVista = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.registrarVista(this.idParam(req), this.usuarioIdOpcional(req)), 'Vista registrada');
  };

  buscar = async (req: Request, res: Response) => {
    const { q, ...paginacion } = validatedQuery<BuscarPublicacionesQuery>(res);
    const page = await this.service.buscar(q, this.usuarioIdOpcional(req), paginacion);
    return this.paginated(res, page, `Resultados de búsqueda para: ${q}`);
  };

  misPublicaciones = async (req: Request, res: Response) => {
    const usuarioId = this.usuarioId(req);
    const page = await this.service.deAutor(usuarioId, usuarioId, validatedQuery<Paginacion>(res));
    return this.paginated(res, page, page.total ? 'Mis publicaciones' : 'No tienes publicaciones aún');
  };

  deUsuario = async (req: Request, res: Response) => {
    const page = await this.service.deAutor(
      this.idParam(req, 'usuarioId'),
      this.usuarioIdOpcional(req),
      validatedQuery<Paginacion>(res),
    );
    return this.paginated(res, page, 'Publicaciones del usuario');
  };

  detalle = async (req: Request, res: Response) => {
    const publicacion = await this.service.detalle(this.idParam(req), this.usuarioIdOpcional(req));
    return this.ok(res, publicacion, 'Publicación encontrada');
  };

  crear = async (req: Request, res: Response) => {
    const publicacion = await this.service.crear(this.usuarioId(req), req.body, {
      imagen: archivoDe(req, 'imagen'),
      video: archivoDe(req, 'video'),
      documentos: archivosDe(req, 'documentos'),
    });
    return this.created(res, publicacion, 'Publicación creada exitosamente');
  };

  actualizar = async (req: Request, res: Response) => {
    const publicacion = await this.service.actualizar(this.idParam(req), this.usuarioId(req), req.body, {
      imagen: archivoDe(req, 'imagen'),
      video: archivoDe(req, 'video'),
      documentos: archivosDe(req, 'documentos'),
    });
    return this.ok(res, publicacion, 'Publicación actualizada correctamente');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Publicación eliminada correctamente');
  };

  // ---------- Programadas, borradores y editor ----------

  programadas = async (req: Request, res: Response) => {
    const { estado, ...paginacion } = validatedQuery<ProgramadasQuery>(res);
    const page = await this.service.noPublicadas(this.usuarioId(req), estado, paginacion);
    const nombre = estado === 'programada' ? 'programadas' : 'borradores';
    return this.paginated(res, page, page.total ? `Mis ${nombre}` : `No tienes ${nombre}`);
  };

  programar = async (req: Request, res: Response) => {
    const { programada_para } = req.body as ProgramarDto;
    const publicacion = await this.service.programar(this.idParam(req), this.usuarioId(req), programada_para);
    return this.ok(res, publicacion, 'Publicación programada');
  };

  cancelarProgramacion = async (req: Request, res: Response) => {
    const publicacion = await this.service.cancelarProgramacion(this.idParam(req), this.usuarioId(req));
    return this.ok(res, publicacion, 'Programación cancelada: quedó como borrador');
  };

  publicarAhora = async (req: Request, res: Response) => {
    const publicacion = await this.service.publicarAhora(this.idParam(req), this.usuarioId(req));
    return this.ok(res, publicacion, 'Publicación publicada');
  };

  editarVideo = async (req: Request, res: Response) => {
    const publicacion = await this.service.editarVideo(this.idParam(req), this.usuarioId(req), req.body as EdicionVideoDto, archivoDe(req));
    return this.ok(res, publicacion, 'Ajustes del video guardados');
  };
}

export const publicacionController = new PublicacionController(publicacionService);
