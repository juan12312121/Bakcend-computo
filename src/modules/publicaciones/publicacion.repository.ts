import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { BaseRepository, type OpcionesConsulta } from '../../core/domain/BaseRepository';
import { NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import {
  Bloqueo,
  Grupo,
  GrupoMiembro,
  type Categoria,
  type EstadoPublicacion,
  Publicacion,
  PublicacionSeccion,
  PublicacionNoInteresa,
  PublicacionOculta,
  Seccion,
  Seguidor,
  Usuario,
} from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

export type ContadorPublicacion = 'total_likes' | 'total_comentarios' | 'total_compartidos' | 'total_dislikes' | 'total_vistas';

/** Filtros opcionales del feed. */
export interface FiltrosFeed {
  categoria?: Categoria;
  /** 'video' → solo publicaciones con video. */
  tipo?: 'video';
  /** true → solo publicaciones con imagen o video. */
  conMedia?: boolean;
}

/** Solo publicaciones con video. */
const CON_VIDEO: WhereOptions<Publicacion> = { video_url: { [Op.ne]: null } };
/** Con imagen o video. */
const CON_MEDIA: WhereOptions<Publicacion> = { [Op.or]: [{ imagen_url: { [Op.ne]: null } }, { video_url: { [Op.ne]: null } }] };

/** [creadores] Solo las publicadas salen en listados, búsquedas, perfil, grupos, hashtags y Reels. */
const PUBLICADA: WhereOptions<Publicacion> = { estado: 'publicada' };

/** Orden de todos los listados: lo más nuevo primero (id desempata registros del mismo instante). */
const MAS_RECIENTES: [string, string][] = [
  ['fecha_creacion', 'DESC'],
  ['id', 'DESC'],
];

export class PublicacionRepository extends BaseRepository<Publicacion> {
  protected readonly entidad = 'Publicación';

  constructor() {
    super(Publicacion);
  }

  /** Toda publicación se lee con su autor (datos públicos). */
  protected override opcionesPorDefecto() {
    return {
      include: [{ model: Usuario, as: 'autor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
    };
  }

  /** Listados públicos: solo autores con cuenta habilitada y no suspendida, más recientes primero. */
  private opcionesListado(): OpcionesConsulta<Publicacion> {
    return {
      include: [
        {
          model: Usuario,
          as: 'autor',
          attributes: [...ATRIBUTOS_USUARIO_PUBLICO],
          where: { activo: true, suspendido: false },
        },
      ],
      order: MAS_RECIENTES,
    };
  }

  /**
   * Regla de visibilidad (la usan publicaciones, comentarios, likes...):
   * el autor siempre ve; con un bloqueo de por medio nadie ve nada; las cuentas privadas solo las ven sus
   * seguidores aceptados (salvo dentro de un grupo, donde manda el grupo); "publico" lo ve cualquiera;
   * "seguidores" solo quien lo sigue (aceptado); "privado" solo el autor.
   */
  async puedeVer(publicacion: Publicacion, usuarioId?: number): Promise<boolean> {
    // Programadas y borradores: solo su autor
    if ((publicacion.estado ?? 'publicada') !== 'publicada') return publicacion.usuario_id === usuarioId;
    if (publicacion.oculto) return publicacion.usuario_id === usuarioId;
    if (publicacion.usuario_id === usuarioId) return true;
    if (publicacion.grupo_id && !(await this.puedeVerGrupo(publicacion.grupo_id, usuarioId))) return false;
    if (usuarioId && (await this.hayBloqueo(usuarioId, publicacion.usuario_id))) return false;

    const sigue = usuarioId ? await this.loSigue(usuarioId, publicacion.usuario_id) : false;
    if (!publicacion.grupo_id && !sigue) {
      const autor = await Usuario.findByPk(publicacion.usuario_id, { attributes: ['id', 'cuenta_privada'] });
      if (autor?.cuenta_privada) return false;
    }
    if (publicacion.visibilidad === 'publico') return true;
    if (publicacion.visibilidad === 'privado' || !usuarioId) return false;
    return sigue;
  }

  /** Sigue a esa cuenta y la relación está aceptada (una solicitud pendiente no cuenta). */
  private async loSigue(seguidorId: number, autorId: number): Promise<boolean> {
    return (await Seguidor.count({ where: { seguidor_id: seguidorId, siguiendo_id: autorId, estado: 'aceptado' } })) > 0;
  }

  private async hayBloqueo(a: number, b: number): Promise<boolean> {
    if (a === b) return false;
    const filas = await Bloqueo.count({
      where: { [Op.or]: [{ bloqueador_id: a, bloqueado_id: b }, { bloqueador_id: b, bloqueado_id: a }] },
    });
    return filas > 0;
  }

  /**
   * Para los listados: a quién sigue el usuario (aceptado), con quién hay bloqueo en cualquier sentido
   * y qué cuentas privadas no sigue (sin sesión: todas las privadas).
   */
  private async relacionesPara(usuarioId?: number): Promise<{ seguidos: number[]; bloqueados: number[]; privadosAjenos: number[] }> {
    const privados = (await Usuario.findAll({ where: { cuenta_privada: true }, attributes: ['id'] })).map((u) => u.id);
    if (!usuarioId) return { seguidos: [], bloqueados: [], privadosAjenos: privados };

    const [seguidos, bloqueos] = await Promise.all([
      Seguidor.findAll({ where: { seguidor_id: usuarioId, estado: 'aceptado' }, attributes: ['siguiendo_id'] }),
      Bloqueo.findAll({
        where: { [Op.or]: [{ bloqueador_id: usuarioId }, { bloqueado_id: usuarioId }] },
        attributes: ['bloqueador_id', 'bloqueado_id'],
      }),
    ]);
    const idsSeguidos = seguidos.map((s) => s.siguiendo_id);
    const sigo = new Set(idsSeguidos);
    return {
      seguidos: idsSeguidos,
      bloqueados: bloqueos.map((b) => (b.bloqueador_id === usuarioId ? b.bloqueado_id : b.bloqueador_id)),
      privadosAjenos: privados.filter((id) => id !== usuarioId && !sigo.has(id)),
    };
  }

  /** Obtiene la publicación si el usuario puede verla; si no, 404 (no se revela que existe). */
  async findVisibleOrFail(id: number, usuarioId?: number): Promise<Publicacion> {
    const publicacion = await this.findByIdOrFail(id);
    if (!(await this.puedeVer(publicacion, usuarioId))) throw new NotFoundError(this.entidad);
    return publicacion;
  }

  /** Condición SQL equivalente a puedeVer, para listados (feed, búsquedas, perfil). */
  async filtroVisibles(usuarioId?: number): Promise<WhereOptions<Publicacion>> {
    return { [Op.and]: [PUBLICADA, await this.filtroVisiblesPublicadas(usuarioId)] };
  }

  private async filtroVisiblesPublicadas(usuarioId?: number): Promise<WhereOptions<Publicacion>> {
    const { seguidos, bloqueados, privadosAjenos } = await this.relacionesPara(usuarioId);
    // Ojo: NOT IN () vacío no se arma (en SQL dejaría fuera todo).
    const restricciones: WhereOptions<Publicacion>[] = [];
    if (bloqueados.length) restricciones.push({ usuario_id: { [Op.notIn]: bloqueados } });
    if (privadosAjenos.length) restricciones.push({ [Op.or]: [{ grupo_id: { [Op.ne]: null } }, { usuario_id: { [Op.notIn]: privadosAjenos } }] });

    if (!usuarioId) return { [Op.and]: [{ oculto: false, visibilidad: 'publico' }, ...restricciones] };
    return {
      [Op.or]: [
        { usuario_id: usuarioId },
        {
          [Op.and]: [
            { oculto: false },
            ...restricciones,
            { [Op.or]: [{ visibilidad: 'publico' }, { visibilidad: 'seguidores', usuario_id: seguidos }] },
          ],
        },
      ],
    };
  }

  async ajustarContador(id: number, campo: ContadorPublicacion, delta: number, transaction?: Transaction): Promise<void> {
    if (delta > 0) await Publicacion.increment(campo, { by: delta, where: { id }, transaction });
    else await Publicacion.decrement(campo, { by: -delta, where: { id, [campo]: { [Op.gt]: 0 } }, transaction });
  }

  /** Antes de borrar una publicación: la quita de las secciones donde estaba y les descuenta el post. */
  async quitarDeSecciones(publicacionId: number, transaction?: Transaction): Promise<void> {
    const enlaces = await PublicacionSeccion.findAll({ where: { publicacion_id: publicacionId }, transaction });
    if (!enlaces.length) return;
    const secciones = enlaces.map((e) => e.seccion_id);
    await Seccion.decrement('total_posts', { by: 1, where: { id: secciones, total_posts: { [Op.gt]: 0 } }, transaction });
    await PublicacionSeccion.destroy({ where: { publicacion_id: publicacionId }, transaction });
  }

  // ---------- Listados ----------

  /** Lo que entra al feed: visible, fuera de grupos y sin lo que el usuario ocultó o marcó "no me interesa". */
  private async condicionesFeed(usuarioId: number | undefined): Promise<WhereOptions<Publicacion>[]> {
    const condiciones: WhereOptions<Publicacion>[] = [await this.filtroVisibles(usuarioId), { grupo_id: null }];
    if (usuarioId) {
      const descartadas = await this.idsDescartadas(usuarioId);
      if (descartadas.length) condiciones.push({ id: { [Op.notIn]: descartadas } });
    }
    return condiciones;
  }

  /** Condiciones del feed más los filtros opcionales (categoría, solo video, solo con imagen o video). */
  private async condicionesFiltradas(usuarioId: number | undefined, { categoria, tipo, conMedia }: FiltrosFeed): Promise<WhereOptions<Publicacion>> {
    const condiciones = await this.condicionesFeed(usuarioId);
    if (categoria) condiciones.push({ categoria });
    if (tipo === 'video') condiciones.push(CON_VIDEO);
    if (conMedia) condiciones.push(CON_MEDIA);
    return { [Op.and]: condiciones };
  }

  /** Feed paginado: feed(usuario, paginacion) o feed(usuario, paginacion, { categoria: 'Tecnología', tipo: 'video' }). */
  feed(usuarioId: number | undefined, paginacion: Paginacion): Promise<Page<Publicacion>>;
  feed(usuarioId: number | undefined, paginacion: Paginacion, filtros: FiltrosFeed): Promise<Page<Publicacion>>;
  async feed(usuarioId: number | undefined, paginacion: Paginacion, filtros: FiltrosFeed = {}): Promise<Page<Publicacion>> {
    return this.paginate(await this.condicionesFiltradas(usuarioId, filtros), paginacion, this.opcionesListado());
  }

  /**
   * Ventana acotada de candidatos: las `ventana` publicaciones más recientes del feed (con filtros).
   * La usan Reels y el feed "populares"; el orden final lo calcula el servicio en memoria.
   */
  async ventanaFeed(usuarioId: number | undefined, filtros: FiltrosFeed, ventana: number): Promise<Publicacion[]> {
    return this.findAll(await this.condicionesFiltradas(usuarioId, filtros), { ...this.opcionesListado(), limit: ventana });
  }

  /** Página de publicaciones entre `ids` (p. ej. las de un hashtag) visibles para el usuario y fuera de grupos. */
  async paginarEntre(ids: number[], usuarioId: number | undefined, paginacion: Paginacion): Promise<Page<Publicacion>> {
    if (!ids.length) return { items: [], total: 0, limit: paginacion.limit, offset: paginacion.offset };
    return this.paginate(
      { [Op.and]: [{ id: { [Op.in]: [...new Set(ids)] } }, { grupo_id: null }, await this.filtroVisibles(usuarioId)] },
      paginacion,
      this.opcionesListado(),
    );
  }

  /** Suma una reproducción y devuelve el total actualizado. */
  async sumarVista(id: number): Promise<number> {
    await this.ajustarContador(id, 'total_vistas', +1);
    const publicacion = await Publicacion.findByPk(id, { attributes: ['total_vistas'] });
    return publicacion?.total_vistas ?? 0;
  }

  /** Cuántas publicaciones del feed hay por categoría (para filtros y Explorar). */
  async totalesPorCategoria(usuarioId: number | undefined): Promise<Map<Categoria, number>> {
    const filas = (await Publicacion.count({
      where: { [Op.and]: await this.condicionesFeed(usuarioId) },
      include: [{ model: Usuario, as: 'autor', attributes: [], where: { activo: true, suspendido: false } }],
      group: ['Publicacion.categoria'],
    })) as unknown as { categoria: Categoria; count: number }[];
    return new Map(filas.map((f) => [f.categoria, Number(f.count)]));
  }

  /** Publicaciones de un autor: él ve todas (incluidas las de grupos); los demás, solo las visibles fuera de grupos. */
  async deAutor(autorId: number, usuarioId: number | undefined, paginacion: Paginacion): Promise<Page<Publicacion>> {
    const where: WhereOptions<Publicacion> =
      autorId === usuarioId
        ? { usuario_id: autorId, ...PUBLICADA }
        : { [Op.and]: [{ usuario_id: autorId, grupo_id: null }, await this.filtroVisibles(usuarioId)] };
    return this.paginate(where, paginacion, this.opcionesListado());
  }

  /** Busca por contenido o por nombre del autor, respetando la visibilidad. */
  async buscar(termino: string, usuarioId: number | undefined, paginacion: Paginacion): Promise<Page<Publicacion>> {
    const patron = `%${termino}%`;
    return this.paginate(
      {
        [Op.and]: [
          await this.filtroVisibles(usuarioId),
          { grupo_id: null },
          {
            [Op.or]: [
              { contenido: { [Op.like]: patron } },
              { '$autor.nombre_usuario$': { [Op.like]: patron } },
              { '$autor.nombre_completo$': { [Op.like]: patron } },
            ],
          },
        ],
      },
      paginacion,
      this.opcionesListado(),
    );
  }

  /** Publicaciones de un grupo (el permiso para verlas lo decide el servicio de grupos). */
  deGrupo(grupoId: number, paginacion: Paginacion): Promise<Page<Publicacion>> {
    return this.paginate({ grupo_id: grupoId, oculto: false, ...PUBLICADA }, paginacion, this.opcionesListado());
  }

  /**
   * De la lista `ids`, las que el usuario puede ver (misma regla que puedeVer, en pocas consultas).
   * No respeta el orden de `ids`: eso lo hace el servicio.
   */
  async visiblesPorIds(ids: number[], usuarioId?: number): Promise<Publicacion[]> {
    const unicos = [...new Set(ids)];
    if (!unicos.length) return [];
    const { order: _orden, ...opciones } = this.opcionesListado();
    const filas = await this.findAll({ [Op.and]: [{ id: unicos }, await this.filtroVisibles(usuarioId)] }, opciones);

    // Las de grupo además exigen poder ver el grupo (una consulta por grupo distinto, no por publicación)
    const grupos = [...new Set(filas.filter((p) => p.grupo_id && p.usuario_id !== usuarioId).map((p) => p.grupo_id as number))];
    const gruposVisibles = new Set<number>();
    for (const grupoId of grupos) if (await this.puedeVerGrupo(grupoId, usuarioId)) gruposVisibles.add(grupoId);
    return filas.filter((p) => !p.grupo_id || p.usuario_id === usuarioId || gruposVisibles.has(p.grupo_id));
  }

  /** Ids de las publicaciones de un autor que el usuario puede ver (para filtrar sus documentos). */
  async idsVisiblesDe(autorId: number, usuarioId?: number): Promise<number[]> {
    const visibles = await this.findAll(
      { [Op.and]: [{ usuario_id: autorId }, await this.filtroVisibles(usuarioId)] },
      { attributes: ['id'], include: [] },
    );
    return visibles.map((p) => p.id);
  }

  /** Ids que el usuario ocultó o marcó como "no me interesa". */
  async idsDescartadas(usuarioId: number): Promise<number[]> {
    const [ocultas, noInteresa] = await Promise.all([
      PublicacionOculta.findAll({ where: { usuario_id: usuarioId }, attributes: ['publicacion_id'] }),
      PublicacionNoInteresa.findAll({ where: { usuario_id: usuarioId }, attributes: ['publicacion_id'] }),
    ]);
    return [...new Set([...ocultas, ...noInteresa].map((r) => r.publicacion_id))];
  }

  // ---------- [creadores] Programadas y borradores ----------

  /** Mis programadas (por fecha de salida, la más próxima primero) o mis borradores (el último editado primero). */
  noPublicadasDe(usuarioId: number, estado: Exclude<EstadoPublicacion, 'publicada'>, paginacion: Paginacion): Promise<Page<Publicacion>> {
    const orden: [string, string][] =
      estado === 'programada'
        ? [
            ['programada_para', 'ASC'],
            ['id', 'ASC'],
          ]
        : [
            ['fecha_actualizacion', 'DESC'],
            ['id', 'DESC'],
          ];
    return this.paginate({ usuario_id: usuarioId, estado }, paginacion, { order: orden });
  }

  /** Programadas cuya hora ya llegó (las más atrasadas primero). */
  listasParaPublicar(ahora: Date, limite: number): Promise<Publicacion[]> {
    return this.findAll(
      { estado: 'programada', programada_para: { [Op.lte]: ahora } },
      { include: [], order: [['programada_para', 'ASC'], ['id', 'ASC']], limit: limite },
    );
  }

  /** Lo de un grupo privado solo lo ven sus miembros activos; lo de uno público, cualquiera. */
  async puedeVerGrupo(grupoId: number, usuarioId?: number): Promise<boolean> {
    const grupo = await Grupo.findByPk(grupoId, { attributes: ['privacidad'] });
    if (!grupo) return false;
    if (grupo.privacidad === 'publico') return true;
    return usuarioId ? this.esMiembroActivoDeGrupo(grupoId, usuarioId) : false;
  }

  /** Para publicar en un grupo hay que ser miembro activo. */
  async esMiembroActivoDeGrupo(grupoId: number, usuarioId: number): Promise<boolean> {
    return (await GrupoMiembro.count({ where: { grupo_id: grupoId, usuario_id: usuarioId, estado: 'activo' } })) > 0;
  }
}

export const publicacionRepository = new PublicacionRepository();
