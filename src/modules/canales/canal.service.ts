import { randomBytes } from 'node:crypto';
import type { InferAttributes } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { sequelize, type Canal, type CanalMiembro, type CanalPublicacion, type RolCanal, type Usuario } from '../../infrastructure/database/models';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { usuarioRepository, type ATRIBUTOS_USUARIO_PUBLICO, type UsuarioRepository } from '../usuarios/usuario.repository';
import { canalPublicacionRepository, type CanalPublicacionRepository } from './canal-publicacion.repository';
import { canalMiembroRepository, canalRepository, type CanalMiembroRepository, type CanalRepository } from './canal.repository';
import type { ActualizarCanalDto, CrearCanalDto, DescubrirQuery } from './canal.schemas';

export type UsuarioPublico = Pick<InferAttributes<Usuario>, (typeof ATRIBUTOS_USUARIO_PUBLICO)[number]>;

/** Canal como lo recibe el cliente, con mi relación con él. */
export type CanalVista = Omit<InferAttributes<Canal>, 'codigo_invitacion'> & {
  creador: UsuarioPublico | null;
  /** Solo lo ven el propietario y los administradores (para compartir el enlace); null para los demás. */
  codigo_invitacion: string | null;
  /** null si no soy miembro (o sin sesión). */
  mi_rol: RolCanal | null;
  silenciado: boolean;
};

/** Resumen de la última publicación en "mis canales". */
export type ResumenPublicacionCanal = Pick<InferAttributes<CanalPublicacion>, 'id' | 'texto' | 'tipo_archivo' | 'autor_id' | 'fecha_creacion'>;

/** Fila de "mis canales". */
export type MiCanal = CanalVista & { no_leidos: number; ultima_publicacion: ResumenPublicacionCanal | null };

/** Fila de administradores / suscriptores. */
export interface MiembroCanalVista {
  usuario_id: number;
  rol: RolCanal;
  fecha_union: Date;
  usuario: UsuarioPublico | null;
}

/** Puede publicar y editar el canal. */
export const esAdminDeCanal = (m: Pick<CanalMiembro, 'rol'> | null | undefined): boolean => m?.rol === 'propietario' || m?.rol === 'admin';

/** Código aleatorio del enlace de invitación (12 caracteres seguros para URL). */
export const nuevoCodigo = (): string => randomBytes(9).toString('base64url');

export class CanalService extends BaseService<Canal, CanalRepository> {
  constructor(
    repository: CanalRepository,
    private readonly miembros: CanalMiembroRepository,
    private readonly publicaciones: CanalPublicacionRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly storage: FileStorage,
  ) {
    super(repository);
  }

  // ---------- Consultas ----------

  /** Canales públicos para descubrir (buscar / populares / recientes), con mi relación si hay sesión. */
  async descubrir({ q, orden, limit, offset }: DescubrirQuery, usuarioId?: number): Promise<Page<CanalVista>> {
    const page = await this.repository.descubrir({ q, orden }, { limit, offset });
    const mias = usuarioId ? await this.miembros.porCanal(page.items.map((c) => c.id), usuarioId) : new Map<number, CanalMiembro>();
    return { ...page, items: page.items.map((c) => this.vista(c, mias.get(c.id) ?? null)) };
  }

  /** Mis canales (suscrito o administrador) con publicaciones sin leer y la última publicación. */
  async mios(usuarioId: number, paginacion: Paginacion): Promise<Page<MiCanal>> {
    const page = await this.miembros.mios(usuarioId, paginacion);
    const ids = page.items.map((m) => m.canal_id);
    const [ultimas, noLeidas] = await Promise.all([
      this.publicaciones.ultimasPorCanal(ids),
      this.publicaciones.noLeidasPorCanal(
        page.items.map((m) => ({ canal_id: m.canal_id, ultima_leida_id: m.ultima_leida_id, desde: m.fecha_union })),
        usuarioId,
      ),
    ]);
    return {
      ...page,
      items: page.items
        .filter((m): m is CanalMiembro & { canal: Canal } => !!m.canal)
        .map((m) => {
          const ultima = ultimas.get(m.canal_id);
          return {
            ...this.vista(m.canal, m),
            no_leidos: noLeidas.get(m.canal_id) ?? 0,
            ultima_publicacion: ultima
              ? { id: ultima.id, texto: ultima.texto, tipo_archivo: ultima.tipo_archivo, autor_id: ultima.autor_id, fecha_creacion: ultima.fecha_creacion }
              : null,
          };
        }),
    };
  }

  /** Detalle: los públicos los ve cualquiera; los privados, solo sus miembros. */
  async detalle(canalId: number, usuarioId?: number): Promise<CanalVista> {
    const { canal, membresia } = await this.visible(canalId, usuarioId);
    return this.vista(canal, membresia);
  }

  /** Vista previa por enlace de invitación (sirve también para canales privados). */
  async porInvitacion(codigo: string, usuarioId?: number): Promise<CanalVista> {
    const canal = await this.canalPorCodigo(codigo);
    return this.vista(canal, usuarioId ? await this.miembros.de(canal.id, usuarioId) : null);
  }

  /** Para Socket.IO y los demás servicios: ¿puede ver el canal? */
  async puedeVer(canalId: number, usuarioId?: number): Promise<boolean> {
    const canal = await this.repository.findById(canalId, { include: [] });
    if (!canal) return false;
    if (canal.privacidad === 'publico') return true;
    return usuarioId !== undefined && (await this.miembros.exists({ canal_id: canalId, usuario_id: usuarioId }));
  }

  /** Propietario y administradores. */
  async administradores(canalId: number, usuarioId?: number): Promise<MiembroCanalVista[]> {
    await this.visible(canalId, usuarioId);
    return (await this.miembros.administradores(canalId)).map((m) => this.miembroVista(m));
  }

  /** Todos los miembros (solo administradores: para elegir a quién hacer admin). */
  async suscriptores(canalId: number, usuarioId: number, paginacion: Paginacion): Promise<Page<MiembroCanalVista>> {
    await this.administrador(canalId, usuarioId);
    const page = await this.miembros.miembros(canalId, paginacion);
    return { ...page, items: page.items.map((m) => this.miembroVista(m)) };
  }

  // ---------- Canal ----------

  /** Quien lo crea queda como propietario (y primer suscriptor). */
  async crear(usuarioId: number, { nombre, descripcion, privacidad }: CrearCanalDto, foto?: ArchivoSubido): Promise<CanalVista> {
    const id = await sequelize.transaction(async (t) => {
      const canal = await this.repository.create(
        {
          creador_id: usuarioId,
          nombre,
          descripcion: descripcion ?? null,
          privacidad,
          foto_url: foto?.url ?? null,
          codigo_invitacion: nuevoCodigo(),
          total_suscriptores: 1,
        },
        t,
      );
      await this.miembros.create({ canal_id: canal.id, usuario_id: usuarioId, rol: 'propietario' }, t);
      return canal.id;
    });
    return this.detalle(id, usuarioId);
  }

  /** Administradores: nombre, descripción, privacidad y foto (`quitar_foto` la borra). */
  async actualizar(canalId: number, usuarioId: number, dto: ActualizarCanalDto, foto?: ArchivoSubido): Promise<CanalVista> {
    const { canal } = await this.administrador(canalId, usuarioId);
    const anterior = canal.foto_url;
    const cambios: Partial<InferAttributes<Canal>> = {};
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre;
    if (dto.descripcion !== undefined) cambios.descripcion = dto.descripcion;
    if (dto.privacidad !== undefined) cambios.privacidad = dto.privacidad;
    if (foto) cambios.foto_url = foto.url;
    else if (dto.quitar_foto) cambios.foto_url = null;

    await this.repository.update(canal, cambios);
    if (anterior && cambios.foto_url !== undefined && cambios.foto_url !== anterior) await this.storage.eliminar(anterior);
    return this.detalle(canalId, usuarioId);
  }

  /** Solo el propietario. Se borran publicaciones, reacciones y vistas (cascada) y los archivos de Cloudinary. */
  async eliminar(canalId: number, usuarioId: number): Promise<void> {
    const { canal, membresia } = await this.administrador(canalId, usuarioId);
    if (membresia.rol !== 'propietario') throw new ForbiddenError('Solo el propietario puede eliminar el canal');
    const archivos = [...(await this.publicaciones.archivosDe(canalId)), canal.foto_url];
    await this.repository.delete(canalId);
    await Promise.all(archivos.filter((url): url is string => !!url).map((url) => this.storage.eliminar(url)));
  }

  /** Cambia el código del enlace: el anterior deja de servir. */
  async regenerarEnlace(canalId: number, usuarioId: number): Promise<CanalVista> {
    const { canal } = await this.administrador(canalId, usuarioId);
    await this.repository.update(canal, { codigo_invitacion: nuevoCodigo() });
    return this.detalle(canalId, usuarioId);
  }

  // ---------- Suscripción ----------

  /** Suscribirse a un canal público (los privados solo con su enlace). */
  async suscribirse(canalId: number, usuarioId: number): Promise<CanalVista> {
    const canal = await this.repository.findByIdOrFail(canalId);
    if (canal.privacidad === 'privado') throw new ForbiddenError('Este canal es privado: únete con su enlace de invitación');
    if (await this.miembros.de(canalId, usuarioId)) throw new ConflictError('Ya estás suscrito a este canal');
    await this.agregarSuscriptor(canalId, usuarioId);
    return this.detalle(canalId, usuarioId);
  }

  /** Unirse con el enlace de invitación (público o privado). Si ya era miembro, solo devuelve el canal. */
  async unirsePorInvitacion(codigo: string, usuarioId: number): Promise<{ canal: CanalVista; nuevo: boolean }> {
    const canal = await this.canalPorCodigo(codigo);
    const nuevo = !(await this.miembros.de(canal.id, usuarioId));
    if (nuevo) await this.agregarSuscriptor(canal.id, usuarioId);
    return { canal: await this.detalle(canal.id, usuarioId), nuevo };
  }

  /** Dejar el canal. El propietario no puede (debe eliminarlo). */
  async salir(canalId: number, usuarioId: number): Promise<void> {
    await this.repository.findByIdOrFail(canalId);
    const membresia = await this.miembros.de(canalId, usuarioId);
    if (!membresia) throw new NotFoundError('Suscripción', 'No estás suscrito a este canal');
    if (membresia.rol === 'propietario') throw new BadRequestError('El propietario no puede salir del canal; puedes eliminarlo');
    await sequelize.transaction(async (t) => {
      await membresia.destroy({ transaction: t });
      await this.repository.ajustarContador(canalId, 'total_suscriptores', -1, t);
    });
  }

  /** Silenciar: sin notificaciones ni push de este canal. */
  async silenciar(canalId: number, usuarioId: number, silenciado: boolean): Promise<CanalVista> {
    await this.repository.findByIdOrFail(canalId);
    const membresia = await this.miembros.de(canalId, usuarioId);
    if (!membresia) throw new ForbiddenError('Suscríbete al canal para silenciarlo');
    await this.miembros.update(membresia, { silenciado });
    return this.detalle(canalId, usuarioId);
  }

  // ---------- Administradores ----------

  /** El propietario nombra administrador a un miembro del canal. */
  async agregarAdministrador(canalId: number, propietarioId: number, usuarioId: number): Promise<MiembroCanalVista[]> {
    await this.propietario(canalId, propietarioId);
    await this.usuarios.findByIdOrFail(usuarioId);
    const membresia = await this.miembros.de(canalId, usuarioId);
    if (!membresia) throw new BadRequestError('Esa persona debe suscribirse al canal antes de ser administradora');
    if (membresia.rol !== 'suscriptor') throw new ConflictError('Ya es administrador del canal');
    await this.miembros.update(membresia, { rol: 'admin' });
    return this.administradores(canalId, propietarioId);
  }

  /** El propietario quita a un administrador (sigue como suscriptor). */
  async quitarAdministrador(canalId: number, propietarioId: number, usuarioId: number): Promise<MiembroCanalVista[]> {
    await this.propietario(canalId, propietarioId);
    const membresia = await this.miembros.de(canalId, usuarioId);
    if (!membresia || membresia.rol !== 'admin') throw new NotFoundError('Administrador', 'Esa persona no es administradora del canal');
    await this.miembros.update(membresia, { rol: 'suscriptor' });
    return this.administradores(canalId, propietarioId);
  }

  // ---------- Reglas que usan otros servicios del módulo ----------

  /** 404 si no existe; 403 si es privado y no soy miembro. */
  async visible(canalId: number, usuarioId?: number): Promise<{ canal: Canal; membresia: CanalMiembro | null }> {
    const canal = await this.repository.findByIdOrFail(canalId);
    const membresia = usuarioId ? await this.miembros.de(canalId, usuarioId) : null;
    if (canal.privacidad === 'privado' && !membresia) throw new ForbiddenError('Este canal es privado');
    return { canal, membresia };
  }

  /** 404 si no existe; 403 si no soy propietario ni administrador. */
  async administrador(canalId: number, usuarioId: number): Promise<{ canal: Canal; membresia: CanalMiembro }> {
    const canal = await this.repository.findByIdOrFail(canalId);
    const membresia = await this.miembros.de(canalId, usuarioId);
    if (!membresia || !esAdminDeCanal(membresia)) throw new ForbiddenError('Solo los administradores del canal pueden hacer esto');
    return { canal, membresia };
  }

  vista(canal: Canal, membresia: CanalMiembro | null): CanalVista {
    const { codigo_invitacion, creador, ...datos } = canal.toJSON() as InferAttributes<Canal> & { creador?: UsuarioPublico };
    return {
      ...datos,
      creador: creador ?? null,
      codigo_invitacion: esAdminDeCanal(membresia) ? codigo_invitacion : null,
      mi_rol: membresia?.rol ?? null,
      silenciado: membresia?.silenciado ?? false,
    };
  }

  // ---------- Apoyo ----------

  private async propietario(canalId: number, usuarioId: number): Promise<void> {
    const { membresia } = await this.administrador(canalId, usuarioId);
    if (membresia.rol !== 'propietario') throw new ForbiddenError('Solo el propietario gestiona los administradores');
  }

  private async canalPorCodigo(codigo: string): Promise<Canal> {
    const canal = await this.repository.porCodigo(codigo);
    if (!canal) throw new NotFoundError('Canal', 'El enlace de invitación no es válido o ya cambió');
    return canal;
  }

  private async agregarSuscriptor(canalId: number, usuarioId: number): Promise<void> {
    await sequelize.transaction(async (t) => {
      await this.miembros.create({ canal_id: canalId, usuario_id: usuarioId, rol: 'suscriptor' }, t);
      await this.repository.ajustarContador(canalId, 'total_suscriptores', +1, t);
    });
  }

  private miembroVista(m: CanalMiembro): MiembroCanalVista {
    return { usuario_id: m.usuario_id, rol: m.rol, fecha_union: m.fecha_union, usuario: (m.usuario?.toJSON() as UsuarioPublico | undefined) ?? null };
  }
}

export const canalService = new CanalService(canalRepository, canalMiembroRepository, canalPublicacionRepository, usuarioRepository, fileStorage);
