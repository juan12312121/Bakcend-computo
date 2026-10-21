import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import {
  sequelize,
  type EstadoMiembro,
  type Grupo,
  type GrupoInvitacion,
  type RolGrupo,
  type TipoGrupo,
} from '../../infrastructure/database/models';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { publicacionService, type PublicacionService, type PublicacionVista } from '../publicaciones/publicacion.service';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { grupoInvitacionRepository, type GrupoInvitacionRepository } from './grupo-invitacion.repository';
import { grupoMiembroRepository, type GrupoMiembroRepository } from './grupo-miembro.repository';
import { grupoRepository, type GrupoRepository } from './grupo.repository';
import type { ActualizarGrupoDto, CrearGrupoDto, ResponderInvitacionDto } from './grupo.schemas';
import { asegurarTextoPermitido } from '../moderacion/palabras.service';

export interface FotosGrupo {
  foto_perfil?: ArchivoSubido;
  foto_portada?: ArchivoSubido;
}

/** Grupo tal como lo recibe el frontend: datos + contexto del usuario que consulta. */
export type GrupoVista = ReturnType<Grupo['toJSON']> & {
  total_miembros: number;
  es_miembro: boolean;
  mi_rol: RolGrupo | null;
  mi_estado: EstadoMiembro | null;
};

export class GrupoService extends BaseService<Grupo, GrupoRepository> {
  constructor(
    repository: GrupoRepository,
    private readonly miembros: GrupoMiembroRepository,
    private readonly invitaciones: GrupoInvitacionRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly publicaciones: PublicacionService,
    private readonly notificaciones: NotificacionService,
    private readonly storage: FileStorage,
  ) {
    super(repository);
  }

  // ---------- Consultas ----------

  async listar(paginacion: Paginacion, usuarioId?: number, tipo?: TipoGrupo, texto?: string): Promise<Page<GrupoVista>> {
    const page = await this.repository.listar(paginacion, tipo, texto);
    return { ...page, items: await this.enriquecer(page.items, usuarioId) };
  }

  async misGrupos(usuarioId: number): Promise<GrupoVista[]> {
    const grupos = await this.repository.porIds(await this.miembros.gruposActivosDe(usuarioId));
    return this.enriquecer(grupos, usuarioId);
  }

  async detalle(id: number, usuarioId?: number): Promise<GrupoVista> {
    const grupo = await this.repository.findByIdOrFail(id);
    const [vista] = await this.enriquecer([grupo], usuarioId);
    return vista;
  }

  /** Publicaciones del grupo: si es privado, solo para miembros activos. */
  async publicacionesDe(id: number, paginacion: Paginacion, usuarioId?: number): Promise<Page<PublicacionVista>> {
    const grupo = await this.repository.findByIdOrFail(id);
    if (grupo.privacidad === 'privado' && !(await this.miembros.esMiembroActivo(id, usuarioId))) {
      throw new ForbiddenError('Este grupo es privado: solo sus miembros ven las publicaciones');
    }

    return this.publicaciones.deGrupo(id, paginacion, usuarioId);
  }

  invitacionesPendientes(usuarioId: number): Promise<GrupoInvitacion[]> {
    return this.invitaciones.pendientesDe(usuarioId);
  }

  // ---------- Escritura ----------

  /** Crea el grupo y deja al creador como miembro admin activo (en una sola transacción). */
  async crear(usuarioId: number, datos: CrearGrupoDto, fotos: FotosGrupo = {}): Promise<GrupoVista> {
    datos = { ...datos, nombre: await asegurarTextoPermitido(datos.nombre, 'nombre'), descripcion: await asegurarTextoPermitido(datos.descripcion, 'publicacion') };
    let grupo: Grupo;
    try {
      grupo = await sequelize.transaction(async (t) => {
        const nuevo = await this.repository.create(
          {
            nombre: datos.nombre,
            descripcion: datos.descripcion ?? null,
            privacidad: datos.privacidad,
            req_aprobacion: datos.req_aprobacion,
            tipo: datos.tipo,
            creador_id: usuarioId,
            imagen_url: fotos.foto_perfil?.url ?? null,
            imagen_portada_url: fotos.foto_portada?.url ?? null,
          },
          t,
        );
        await this.miembros.create({ grupo_id: nuevo.id, usuario_id: usuarioId, rol: 'admin', estado: 'activo' }, t);
        return nuevo;
      });
    } catch (error) {
      // Si no se guardó el grupo, las imágenes ya subidas quedarían huérfanas.
      await Promise.all([this.storage.eliminar(fotos.foto_perfil?.id), this.storage.eliminar(fotos.foto_portada?.id)]);
      throw error;
    }
    return this.detalle(grupo.id, usuarioId);
  }

  async actualizar(id: number, usuarioId: number, datos: ActualizarGrupoDto, fotos: FotosGrupo = {}): Promise<GrupoVista> {
    datos = { ...datos, nombre: await asegurarTextoPermitido(datos.nombre, 'nombre'), descripcion: await asegurarTextoPermitido(datos.descripcion, 'publicacion') };
    const grupo = await this.repository.findByIdOrFail(id);
    await this.asegurarAdmin(id, usuarioId, 'Solo los administradores del grupo pueden editarlo');

    const cambios: Partial<Grupo> = { ...datos };
    if (fotos.foto_perfil) cambios.imagen_url = fotos.foto_perfil.url;
    if (fotos.foto_portada) cambios.imagen_portada_url = fotos.foto_portada.url;

    if (Object.values(cambios).every((v) => v === undefined)) {
      throw new BadRequestError('No hay datos para actualizar');
    }

    const anteriores = [fotos.foto_perfil && grupo.imagen_url, fotos.foto_portada && grupo.imagen_portada_url];
    await this.repository.update(grupo, cambios);
    await Promise.all(anteriores.map((url) => this.storage.eliminar(url)));
    return this.detalle(id, usuarioId);
  }

  /** Público sin aprobación → activo; privado o con aprobación → pendiente. */
  async unirse(id: number, usuarioId: number): Promise<{ estado: EstadoMiembro }> {
    const grupo = await this.repository.findByIdOrFail(id);
    const estado: EstadoMiembro = grupo.privacidad === 'publico' && !grupo.req_aprobacion ? 'activo' : 'pendiente';

    const existente = await this.miembros.membresia(id, usuarioId);
    if (existente && existente.estado !== 'rechazado') {
      throw new ConflictError(existente.estado === 'activo' ? 'Ya eres miembro de este grupo' : 'Ya tienes una solicitud pendiente');
    }

    if (existente) await this.miembros.update(existente, { estado });
    else await this.miembros.create({ grupo_id: id, usuario_id: usuarioId, rol: 'miembro', estado });
    return { estado };
  }

  async salir(id: number, usuarioId: number): Promise<void> {
    const grupo = await this.repository.findByIdOrFail(id);
    if (grupo.creador_id === usuarioId) throw new BadRequestError('El creador no puede salir del grupo');

    const borrados = await this.miembros.delete({ grupo_id: id, usuario_id: usuarioId });
    if (!borrados) throw new NotFoundError('Membresía', 'No eres miembro de este grupo');
  }

  async invitar(id: number, remitenteId: number, invitadoId: number): Promise<GrupoInvitacion> {
    const grupo = await this.repository.findByIdOrFail(id);
    await this.asegurarAdmin(id, remitenteId, 'Solo los administradores del grupo pueden invitar');
    if (invitadoId === remitenteId) throw new BadRequestError('No puedes invitarte a ti mismo');
    await this.usuarios.findByIdOrFail(invitadoId);

    const membresia = await this.miembros.membresia(id, invitadoId);
    if (membresia?.estado === 'activo') throw new ConflictError('El usuario ya es miembro de este grupo');
    if (await this.invitaciones.existePendiente(id, invitadoId)) {
      throw new ConflictError('Ya existe una invitación pendiente para este usuario');
    }

    const invitacion = await this.invitaciones.create({ grupo_id: id, remitente_id: remitenteId, invitado_id: invitadoId });
    await this.notificaciones.notificar({
      usuario_id: invitadoId,
      de_usuario_id: remitenteId,
      tipo: 'invitacion_grupo',
      mensaje: `Has sido invitado al grupo "${grupo.nombre}"`,
    });
    return this.invitaciones.findByIdOrFail(invitacion.id);
  }

  /** Solo el invitado responde; aceptar lo deja como miembro activo. */
  async responderInvitacion(
    invitacionId: number,
    usuarioId: number,
    { accion }: ResponderInvitacionDto,
  ): Promise<{ grupo_id: number; estado: 'aceptada' | 'rechazada' }> {
    const invitacion = await this.invitaciones.findById(invitacionId);
    if (!invitacion || invitacion.estado !== 'pendiente') throw new NotFoundError('Invitación', 'Invitación no encontrada');
    this.asegurarDueno(invitacion.invitado_id, usuarioId, 'Solo el usuario invitado puede responder esta invitación');

    const estado = accion === 'aceptar' ? 'aceptada' : 'rechazada';
    await sequelize.transaction(async (t) => {
      await this.invitaciones.update(invitacion, { estado }, t);
      if (estado === 'aceptada') await this.miembros.activar(invitacion.grupo_id, usuarioId, t);
    });
    return { grupo_id: invitacion.grupo_id, estado };
  }

  // ---------- Apoyo ----------

  private async asegurarAdmin(grupoId: number, usuarioId: number, mensaje: string): Promise<void> {
    if (!(await this.miembros.esAdmin(grupoId, usuarioId))) throw new ForbiddenError(mensaje);
  }

  /** Agrega total de miembros activos y la relación del usuario con cada grupo (2 consultas en total). */
  private async enriquecer(grupos: Grupo[], usuarioId?: number): Promise<GrupoVista[]> {
    const ids = grupos.map((g) => g.id);
    const [totales, membresias] = await Promise.all([
      this.miembros.contarActivos(ids),
      usuarioId ? this.miembros.membresiasPorGrupo(ids, usuarioId) : Promise.resolve(new Map()),
    ]);

    return grupos.map((g) => {
      const m = membresias.get(g.id);
      return {
        ...g.toJSON(),
        total_miembros: totales.get(g.id) ?? 0,
        es_miembro: m?.estado === 'activo',
        mi_rol: m?.estado === 'activo' ? m.rol : null,
        mi_estado: m?.estado ?? null,
      };
    });
  }
}

export const grupoService = new GrupoService(
  grupoRepository,
  grupoMiembroRepository,
  grupoInvitacionRepository,
  usuarioRepository,
  publicacionService,
  notificacionService,
  fileStorage,
);
