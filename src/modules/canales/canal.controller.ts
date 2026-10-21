import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import { archivoDe } from '../../infrastructure/storage/FileStorage';
import type { ReaccionDto } from '../chat/reacciones';
import { canalPublicacionService, type CanalPublicacionService } from './canal-publicacion.service';
import type { DescubrirQuery, PublicacionesQuery } from './canal.schemas';
import { canalService, type CanalService } from './canal.service';

export class CanalController extends BaseController {
  constructor(
    private readonly canales: CanalService,
    private readonly publicaciones: CanalPublicacionService,
  ) {
    super();
  }

  // ---------- Canales ----------

  descubrir = async (req: Request, res: Response) => {
    const page = await this.canales.descubrir(validatedQuery<DescubrirQuery>(res), this.usuarioIdOpcional(req));
    return this.paginated(res, page, 'Canales para descubrir');
  };

  mios = async (req: Request, res: Response) => {
    return this.paginated(res, await this.canales.mios(this.usuarioId(req), validatedQuery<Paginacion>(res)), 'Mis canales');
  };

  detalle = async (req: Request, res: Response) => {
    return this.ok(res, await this.canales.detalle(this.idParam(req), this.usuarioIdOpcional(req)), 'Canal obtenido');
  };

  invitacion = async (req: Request, res: Response) => {
    return this.ok(res, await this.canales.porInvitacion(String(req.params.codigo), this.usuarioIdOpcional(req)), 'Invitación al canal');
  };

  unirse = async (req: Request, res: Response) => {
    const { canal, nuevo } = await this.canales.unirsePorInvitacion(String(req.params.codigo), this.usuarioId(req));
    return nuevo ? this.created(res, canal, 'Te uniste al canal') : this.ok(res, canal, 'Ya eras parte del canal');
  };

  crear = async (req: Request, res: Response) => {
    return this.created(res, await this.canales.crear(this.usuarioId(req), req.body, archivoDe(req)), 'Canal creado');
  };

  actualizar = async (req: Request, res: Response) => {
    return this.ok(res, await this.canales.actualizar(this.idParam(req), this.usuarioId(req), req.body, archivoDe(req)), 'Canal actualizado');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.canales.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Canal eliminado');
  };

  regenerarEnlace = async (req: Request, res: Response) => {
    return this.ok(res, await this.canales.regenerarEnlace(this.idParam(req), this.usuarioId(req)), 'Enlace de invitación nuevo');
  };

  // ---------- Suscripción ----------

  suscribirse = async (req: Request, res: Response) => {
    return this.created(res, await this.canales.suscribirse(this.idParam(req), this.usuarioId(req)), 'Te suscribiste al canal');
  };

  salir = async (req: Request, res: Response) => {
    await this.canales.salir(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Saliste del canal');
  };

  silenciar = async (req: Request, res: Response) => {
    const silenciado = req.body.silenciado as boolean;
    const canal = await this.canales.silenciar(this.idParam(req), this.usuarioId(req), silenciado);
    return this.ok(res, canal, silenciado ? 'Canal silenciado' : 'Canal con notificaciones');
  };

  leer = async (req: Request, res: Response) => {
    return this.ok(res, await this.publicaciones.leer(this.idParam(req), this.usuarioId(req)), 'Canal al día');
  };

  // ---------- Administradores ----------

  administradores = async (req: Request, res: Response) => {
    const lista = await this.canales.administradores(this.idParam(req), this.usuarioIdOpcional(req));
    return this.ok(res, lista, `${lista.length} administradores`);
  };

  suscriptores = async (req: Request, res: Response) => {
    const page = await this.canales.suscriptores(this.idParam(req), this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Miembros del canal');
  };

  agregarAdministrador = async (req: Request, res: Response) => {
    const lista = await this.canales.agregarAdministrador(this.idParam(req), this.usuarioId(req), req.body.usuario_id as number);
    return this.ok(res, lista, 'Administrador agregado');
  };

  quitarAdministrador = async (req: Request, res: Response) => {
    const lista = await this.canales.quitarAdministrador(this.idParam(req), this.usuarioId(req), this.idParam(req, 'usuarioId'));
    return this.ok(res, lista, 'Administrador quitado');
  };

  // ---------- Publicaciones ----------

  listarPublicaciones = async (req: Request, res: Response) => {
    const page = await this.publicaciones.listar(this.idParam(req), validatedQuery<PublicacionesQuery>(res), this.usuarioIdOpcional(req));
    return this.paginated(res, page, 'Publicaciones del canal');
  };

  publicar = async (req: Request, res: Response) => {
    const { publicacion } = await this.publicaciones.publicar(this.idParam(req), this.usuarioId(req), req.body, archivoDe(req));
    return this.created(res, publicacion, 'Publicado en el canal');
  };

  eliminarPublicacion = async (req: Request, res: Response) => {
    const aviso = await this.publicaciones.eliminar(this.idParam(req), this.idParam(req, 'publicacionId'), this.usuarioId(req));
    return this.ok(res, aviso, 'Publicación eliminada');
  };

  reaccionar = async (req: Request, res: Response) => {
    const { emoji } = req.body as ReaccionDto;
    const resultado = await this.publicaciones.reaccionar(this.idParam(req), this.idParam(req, 'publicacionId'), this.usuarioId(req), emoji);
    return this.ok(res, resultado, 'Reacción guardada');
  };

  quitarReaccion = async (req: Request, res: Response) => {
    const resultado = await this.publicaciones.quitarReaccion(this.idParam(req), this.idParam(req, 'publicacionId'), this.usuarioId(req));
    return this.ok(res, resultado, 'Reacción quitada');
  };
}

export const canalController = new CanalController(canalService, canalPublicacionService);
