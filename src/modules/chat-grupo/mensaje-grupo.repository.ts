import { Op, col, fn, type Attributes, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import { MensajeGrupo, Usuario } from '../../infrastructure/database/models';
import { vigentes } from '../chat/mensajes-temporales';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** Desde dónde cuenta como no leído en un grupo: tras el último id leído o, si nunca leyó, tras unirse. */
export interface PuntoDeLectura {
  grupo_id: number;
  ultimo_leido_id: number | null;
  desde: Date;
}

/** Lo mínimo de un mensaje vencido para borrarlo con su archivo. */
export type MensajeGrupoVencido = Pick<MensajeGrupo, 'id' | 'archivo_url'>;

type WhereMensaje = WhereOptions<Attributes<MensajeGrupo>>;

/** "No vencido" listo para combinar con otras condiciones (nunca se devuelven mensajes vencidos). */
const noVencidos = () => vigentes<Attributes<MensajeGrupo>>();

export class MensajeGrupoRepository extends BaseRepository<MensajeGrupo> {
  protected readonly entidad = 'Mensaje';

  constructor() {
    super(MensajeGrupo);
  }

  /** Cada mensaje viaja con los datos públicos de quien lo envió. */
  protected override opcionesPorDefecto() {
    return {
      include: [{ model: Usuario, as: 'emisor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
    };
  }

  /**
   * Página con cursor de mensajes vigentes, los más nuevos primero. `total` cuenta los mensajes anteriores al cursor
   * (así `hayMas` dice si quedan más viejos).
   */
  pagina(grupoId: number, limit: number): Promise<Page<MensajeGrupo>>;
  pagina(grupoId: number, limit: number, antesDe: number): Promise<Page<MensajeGrupo>>;
  pagina(grupoId: number, limit: number, antesDe?: number): Promise<Page<MensajeGrupo>> {
    const where: WhereMensaje = antesDe
      ? { grupo_id: grupoId, id: { [Op.lt]: antesDe }, [Op.and]: [noVencidos()] }
      : { grupo_id: grupoId, [Op.and]: [noVencidos()] };
    return this.paginate(where, { limit, offset: 0 }, { order: [['id', 'DESC']] });
  }

  /** Id del mensaje vigente más reciente del grupo (null si no hay). */
  async ultimoId(grupoId: number): Promise<number | null> {
    const maximo = (await MensajeGrupo.max('id', { where: { grupo_id: grupoId, [Op.and]: [noVencidos()] } })) as number | null;
    return maximo ? Number(maximo) : null;
  }

  /** Último mensaje vigente de cada grupo, con su emisor (2 consultas sin importar cuántos grupos). */
  async ultimosPorGrupo(grupoIds: number[]): Promise<Map<number, MensajeGrupo>> {
    if (!grupoIds.length) return new Map();
    const maximos = (await MensajeGrupo.findAll({
      attributes: ['grupo_id', [fn('MAX', col('id')), 'ultimo_id']],
      where: { grupo_id: grupoIds, [Op.and]: [noVencidos()] },
      group: ['grupo_id'],
      raw: true,
    })) as unknown as { grupo_id: number; ultimo_id: number }[];
    if (!maximos.length) return new Map();

    const mensajes = await this.findAll({ id: maximos.map((m) => Number(m.ultimo_id)) });
    return new Map(mensajes.map((m) => [m.grupo_id, m]));
  }

  /** Mensajes vigentes de otros sin leer por grupo, en una sola consulta. */
  async noLeidosPorGrupo(puntos: PuntoDeLectura[], lectorId: number): Promise<Map<number, number>> {
    if (!puntos.length) return new Map();
    const desde = puntos.map((p) =>
      p.ultimo_leido_id !== null
        ? { grupo_id: p.grupo_id, id: { [Op.gt]: p.ultimo_leido_id } }
        : { grupo_id: p.grupo_id, fecha_creacion: { [Op.gte]: p.desde } },
    );
    const filas = await MensajeGrupo.count({
      where: { emisor_id: { [Op.ne]: lectorId }, [Op.and]: [{ [Op.or]: desde }, noVencidos()] },
      group: ['grupo_id'],
    });
    return new Map(filas.map((f) => [Number(f.grupo_id), Number(f.count)]));
  }

  /** Hasta `limite` mensajes ya vencidos (para la limpieza programada). */
  vencidos(ahora: Date, limite: number): Promise<MensajeGrupoVencido[]> {
    return MensajeGrupo.findAll({
      where: { expira_en: { [Op.lte]: ahora } },
      attributes: ['id', 'archivo_url'],
      order: [['id', 'ASC']],
      limit: limite,
    });
  }
}

export const mensajeGrupoRepository = new MensajeGrupoRepository();
