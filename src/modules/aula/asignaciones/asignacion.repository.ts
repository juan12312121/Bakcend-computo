import { Op, type Attributes, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../../core/domain/BaseRepository';
import { NotFoundError } from '../../../core/errors';
import type { Page } from '../../../core/http/ApiResponse';
import type { Paginacion } from '../../../core/validation/common.schemas';
import { Asignacion, Entrega, Usuario, type EstadoEntrega } from '../../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../../usuarios/usuario.repository';

type WhereAsignacion = WhereOptions<Attributes<Asignacion>>;

const incluirUsuario = (as: string) => ({ model: Usuario, as, attributes: [...ATRIBUTOS_USUARIO_PUBLICO] });

/** Tope de seguridad para lecturas sin paginar (calendario, libreta). */
export const MAXIMO_ASIGNACIONES = 500;

export type CuandoAsignaciones = 'todas' | 'proximas' | 'pasadas';

/** Cuántas entregas hay en cada estado (por asignación). */
export type ConteoEntregas = Record<EstadoEntrega, number>;

export const conteoVacio = (): ConteoEntregas => ({ entregada: 0, tarde: 0, calificada: 0, devuelta: 0 });

export class AsignacionRepository extends BaseRepository<Asignacion> {
  protected readonly entidad = 'Asignación';

  constructor() {
    super(Asignacion);
  }

  protected override opcionesPorDefecto() {
    return { include: [incluirUsuario('creador')] };
  }

  /** Página de asignaciones del grupo: próximas (de la más cercana) o pasadas (de la más reciente). */
  delGrupo(grupoId: number, cuando: CuandoAsignaciones, paginacion: Paginacion, ahora: Date = new Date()): Promise<Page<Asignacion>> {
    const where: WhereAsignacion = { grupo_id: grupoId };
    if (cuando === 'proximas') Object.assign(where, { fecha_entrega: { [Op.gte]: ahora } });
    if (cuando === 'pasadas') Object.assign(where, { fecha_entrega: { [Op.lt]: ahora } });
    const direccion = cuando === 'pasadas' ? 'DESC' : 'ASC';
    return this.paginate(where, paginacion, {
      order: [
        ['fecha_entrega', direccion],
        ['id', direccion],
      ],
    });
  }

  /** Todas las del grupo (con tope), por fecha de entrega: para la libreta. */
  todasDelGrupo(grupoId: number): Promise<Asignacion[]> {
    return this.findAll(
      { grupo_id: grupoId },
      {
        include: [],
        order: [
          ['fecha_entrega', 'ASC'],
          ['id', 'ASC'],
        ],
        limit: MAXIMO_ASIGNACIONES,
      },
    );
  }

  /** Las del grupo que vencen en [desde, hasta). */
  enRango(grupoId: number, desde: Date, hasta: Date): Promise<Asignacion[]> {
    return this.findAll(
      { grupo_id: grupoId, fecha_entrega: { [Op.gte]: desde, [Op.lt]: hasta } },
      { include: [], order: [['fecha_entrega', 'ASC']], limit: MAXIMO_ASIGNACIONES },
    );
  }

  /** Sin recordatorio y que vencen dentro de (desde, hasta]. */
  porVencer(desde: Date, hasta: Date): Promise<Asignacion[]> {
    return this.findAll({ recordatorio_enviado: false, fecha_entrega: { [Op.gt]: desde, [Op.lte]: hasta } }, { include: [] });
  }
}

export class EntregaRepository extends BaseRepository<Entrega> {
  protected readonly entidad = 'Entrega';

  constructor() {
    super(Entrega);
  }

  deAlumno(asignacionId: number, alumnoId: number): Promise<Entrega | null> {
    return this.findOne({ asignacion_id: asignacionId, alumno_id: alumnoId });
  }

  /** La entrega de un alumno con su usuario público (404 si no hay). */
  async conAlumno(asignacionId: number, alumnoId: number): Promise<Entrega> {
    const entrega = await this.findOne({ asignacion_id: asignacionId, alumno_id: alumnoId }, { include: [incluirUsuario('alumno')] });
    if (!entrega) throw new NotFoundError(this.entidad);
    return entrega;
  }

  /** Entregas de una asignación con el alumno público. */
  deAsignacion(asignacionId: number): Promise<Entrega[]> {
    return this.findAll({ asignacion_id: asignacionId }, { include: [incluirUsuario('alumno')] });
  }

  /** Mis entregas de varias asignaciones, indexadas por asignación. */
  async delAlumnoEn(alumnoId: number, asignacionIds: number[]): Promise<Map<number, Entrega>> {
    if (!asignacionIds.length) return new Map();
    const filas = await this.findAll({ alumno_id: alumnoId, asignacion_id: asignacionIds });
    return new Map(filas.map((e) => [e.asignacion_id, e]));
  }

  /** Entregas de varias asignaciones (para la libreta y los conteos). */
  deAsignaciones(asignacionIds: number[]): Promise<Entrega[]> {
    if (!asignacionIds.length) return Promise.resolve([]);
    return this.findAll({ asignacion_id: asignacionIds });
  }

  /** Conteo por estado de cada asignación (solo de los alumnos indicados, para no contar a quien ya salió del grupo). */
  async conteos(asignacionIds: number[], alumnoIds: number[]): Promise<Map<number, ConteoEntregas>> {
    const mapa = new Map<number, ConteoEntregas>(asignacionIds.map((id) => [id, conteoVacio()]));
    if (!asignacionIds.length || !alumnoIds.length) return mapa;
    const filas = await this.findAll({ asignacion_id: asignacionIds, alumno_id: alumnoIds }, { attributes: ['asignacion_id', 'estado'] });
    for (const fila of filas) {
      const conteo = mapa.get(fila.asignacion_id);
      if (conteo) conteo[fila.estado as EstadoEntrega]++;
    }
    return mapa;
  }

  /** Ids de alumnos que ya entregaron algo que no está devuelto (para el recordatorio). */
  async alumnosAlCorriente(asignacionId: number): Promise<Set<number>> {
    const filas = await this.findAll({ asignacion_id: asignacionId, estado: ['entregada', 'tarde', 'calificada'] }, { attributes: ['alumno_id'] });
    return new Set(filas.map((f) => f.alumno_id));
  }

  /** Puntos más altos ya puestos en la asignación (para no bajar los máximos por debajo). */
  async puntosMasAltos(asignacionId: number): Promise<number | null> {
    const maximo = await Entrega.max<number | null, Entrega>('puntos', { where: { asignacion_id: asignacionId } });
    return maximo ?? null;
  }

  /** Archivos de todas las entregas de una asignación (para borrarlos del almacenamiento). */
  async archivosDe(asignacionId: number): Promise<string[]> {
    const filas = await this.findAll({ asignacion_id: asignacionId, archivo_url: { [Op.ne]: null } }, { attributes: ['archivo_id', 'archivo_url'] });
    return filas.map((f) => f.archivo_id ?? f.archivo_url ?? '').filter(Boolean);
  }
}

export const asignacionRepository = new AsignacionRepository();
export const entregaRepository = new EntregaRepository();
