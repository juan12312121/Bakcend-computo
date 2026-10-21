import { Op, col, fn, type Attributes, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import { CanalPublicacion, CanalReaccion, CanalVista, Usuario, type EmojiReaccion } from '../../infrastructure/database/models';
import { resumirReacciones, type ReaccionResumen } from '../chat/reacciones';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** Desde dónde cuenta como no leído en un canal: tras la última leída o, si nunca leyó, desde que se unió. */
export interface PuntoLecturaCanal {
  canal_id: number;
  ultima_leida_id: number | null;
  desde: Date;
}

export class CanalPublicacionRepository extends BaseRepository<CanalPublicacion> {
  protected readonly entidad = 'Publicación';

  constructor() {
    super(CanalPublicacion);
  }

  /** Cada publicación viaja con los datos públicos de quien la escribió. */
  protected override opcionesPorDefecto() {
    return { include: [{ model: Usuario, as: 'autor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }] };
  }

  /** Página con cursor, las más nuevas primero; `total` cuenta las anteriores al cursor. */
  pagina(canalId: number, limit: number): Promise<Page<CanalPublicacion>>;
  pagina(canalId: number, limit: number, antesDe: number): Promise<Page<CanalPublicacion>>;
  pagina(canalId: number, limit: number, antesDe?: number): Promise<Page<CanalPublicacion>> {
    const where: WhereOptions<Attributes<CanalPublicacion>> = antesDe ? { canal_id: canalId, id: { [Op.lt]: antesDe } } : { canal_id: canalId };
    return this.paginate(where, { limit, offset: 0 }, { order: [['id', 'DESC']] });
  }

  async ultimoId(canalId: number): Promise<number | null> {
    const maximo = (await CanalPublicacion.max('id', { where: { canal_id: canalId } })) as number | null;
    return maximo ? Number(maximo) : null;
  }

  /** Última publicación de cada canal (2 consultas sin importar cuántos canales). */
  async ultimasPorCanal(canalIds: readonly number[]): Promise<Map<number, CanalPublicacion>> {
    if (!canalIds.length) return new Map();
    const maximos = (await CanalPublicacion.findAll({
      attributes: ['canal_id', [fn('MAX', col('id')), 'ultimo_id']],
      where: { canal_id: [...canalIds] },
      group: ['canal_id'],
      raw: true,
    })) as unknown as { canal_id: number; ultimo_id: number }[];
    if (!maximos.length) return new Map();
    const filas = await CanalPublicacion.findAll({ where: { id: maximos.map((m) => Number(m.ultimo_id)) } });
    return new Map(filas.map((p) => [p.canal_id, p]));
  }

  /** Publicaciones de otros sin leer por canal, en una sola consulta. */
  async noLeidasPorCanal(puntos: readonly PuntoLecturaCanal[], lectorId: number): Promise<Map<number, number>> {
    if (!puntos.length) return new Map();
    const desde = puntos.map((p) =>
      p.ultima_leida_id !== null
        ? { canal_id: p.canal_id, id: { [Op.gt]: p.ultima_leida_id } }
        : { canal_id: p.canal_id, fecha_creacion: { [Op.gte]: p.desde } },
    );
    const filas = await CanalPublicacion.count({ where: { autor_id: { [Op.ne]: lectorId }, [Op.or]: desde }, group: ['canal_id'] });
    return new Map(filas.map((f) => [Number(f.canal_id), Number(f.count)]));
  }

  /** URLs de los archivos de un canal (para borrarlos de Cloudinary al eliminarlo). */
  async archivosDe(canalId: number): Promise<string[]> {
    const filas = await CanalPublicacion.findAll({
      where: { canal_id: canalId, archivo_url: { [Op.ne]: null } },
      attributes: ['archivo_url'],
    });
    return filas.map((p) => p.archivo_url).filter((url): url is string => !!url);
  }

  sumarVistas(ids: readonly number[]): Promise<unknown> {
    return ids.length ? CanalPublicacion.increment('total_vistas', { by: 1, where: { id: [...ids] } }) : Promise.resolve();
  }
}

/** Una reacción por persona y publicación. */
export class CanalReaccionRepository extends BaseRepository<CanalReaccion> {
  protected readonly entidad = 'Reacción';

  constructor() {
    super(CanalReaccion);
  }

  async poner(publicacionId: number, usuarioId: number, emoji: EmojiReaccion): Promise<void> {
    const actual = await this.findOne({ publicacion_id: publicacionId, usuario_id: usuarioId });
    if (actual) {
      if (actual.emoji !== emoji) await this.update(actual, { emoji });
      return;
    }
    await this.create({ publicacion_id: publicacionId, usuario_id: usuarioId, emoji });
  }

  quitar(publicacionId: number, usuarioId: number): Promise<number> {
    return this.delete({ publicacion_id: publicacionId, usuario_id: usuarioId });
  }

  /** Conteos por emoji (agrupados en la base, sirve con miles de reacciones) + la mía si hay sesión. */
  async resumenDe(publicacionIds: readonly number[], usuarioId?: number): Promise<Map<number, ReaccionResumen[]>> {
    if (!publicacionIds.length) return new Map();
    const ids = [...publicacionIds];
    const [conteos, mias] = await Promise.all([
      CanalReaccion.count({ where: { publicacion_id: ids }, group: ['publicacion_id', 'emoji'] }),
      usuarioId ? this.findAll({ publicacion_id: ids, usuario_id: usuarioId }, { attributes: ['publicacion_id', 'emoji'] }) : Promise.resolve([]),
    ]);
    const filas = conteos.map((c) => ({ objetivo_id: Number(c.publicacion_id), emoji: String(c.emoji), total: Number(c.count) }));
    return resumirReacciones(filas, new Map(mias.map((m) => [m.publicacion_id, m.emoji])));
  }

  async de(publicacionId: number, usuarioId?: number): Promise<ReaccionResumen[]> {
    return (await this.resumenDe([publicacionId], usuarioId)).get(publicacionId) ?? [];
  }
}

/** Una vista por persona y publicación. */
export class CanalVistaRepository extends BaseRepository<CanalVista> {
  protected readonly entidad = 'Vista';

  constructor() {
    super(CanalVista);
  }

  /** Registra las vistas que falten y devuelve los ids de publicación que el usuario veía por primera vez. */
  async registrar(publicacionIds: readonly number[], usuarioId: number): Promise<number[]> {
    if (!publicacionIds.length) return [];
    const ya = await this.findAll({ publicacion_id: [...publicacionIds], usuario_id: usuarioId }, { attributes: ['publicacion_id'] });
    const vistas = new Set(ya.map((v) => v.publicacion_id));
    const nuevas = publicacionIds.filter((id) => !vistas.has(id));
    if (nuevas.length) {
      await CanalVista.bulkCreate(
        nuevas.map((publicacion_id) => ({ publicacion_id, usuario_id: usuarioId })),
        { ignoreDuplicates: true },
      );
    }
    return nuevas;
  }
}

export const canalPublicacionRepository = new CanalPublicacionRepository();
export const canalReaccionRepository = new CanalReaccionRepository();
export const canalVistaRepository = new CanalVistaRepository();
