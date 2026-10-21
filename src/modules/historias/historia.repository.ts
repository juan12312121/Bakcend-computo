import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import { NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Historia, HistoriaVista, Seguidor, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** Horas que una historia sigue visible desde que se publica. */
export const HORAS_VIGENCIA = 24;

/** Condición "todavía no expira" (se calcula en cada consulta, nunca se guarda). */
const vigente = (): WhereOptions<Historia> => ({ expira_en: { [Op.gt]: new Date() } });

export class HistoriaRepository extends BaseRepository<Historia> {
  protected readonly entidad = 'Historia';

  constructor() {
    super(Historia);
  }

  /** Historia vigente; 404 si no existe o ya expiró (las vencidas nunca se devuelven). */
  async findVigenteOrFail(id: number): Promise<Historia> {
    const historia = await this.findOne({ id, ...vigente() });
    if (!historia) throw new NotFoundError(this.entidad, 'La historia no existe o ya expiró');
    return historia;
  }

  /**
   * Historias vigentes de un usuario o de varios, de la más antigua a la más reciente,
   * con el autor público (solo cuentas activas).
   */
  vigentesDe(usuarioId: number): Promise<Historia[]>;
  vigentesDe(usuarioIds: number[]): Promise<Historia[]>;
  vigentesDe(usuarios: number | number[]): Promise<Historia[]> {
    const ids = Array.isArray(usuarios) ? usuarios : [usuarios];
    if (!ids.length) return Promise.resolve([]);
    return this.findAll(
      { usuario_id: { [Op.in]: ids }, ...vigente() },
      {
        include: [{ model: Usuario, as: 'autor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO], where: { activo: true }, required: true }],
        order: [
          ['fecha_creacion', 'ASC'],
          ['id', 'ASC'],
        ],
      },
    );
  }

  /** [creadores] Vencidas que todavía no pasan al archivo (para la limpieza). */
  vencidas(): Promise<Historia[]> {
    return this.findAll({ expira_en: { [Op.lte]: new Date() }, archivada: false }, { attributes: ['id'] });
  }

  /** [creadores] Las pasa al archivo: ya no salen en la bandeja, pero se conservan (y su archivo) para las destacadas. */
  async archivar(ids: number[]): Promise<number> {
    if (!ids.length) return 0;
    const [cambiadas] = await Historia.update({ archivada: true }, { where: { id: { [Op.in]: ids } } });
    return cambiadas;
  }

  /** [creadores] Todas mis historias (vigentes y archivadas), la más reciente primero. */
  archivoDe(usuarioId: number, paginacion: Paginacion): Promise<Page<Historia>> {
    return this.paginate({ usuario_id: usuarioId }, paginacion, {
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ],
    });
  }

  /** [creadores] De `ids`, las que son del usuario (vigentes o archivadas). */
  propiasEntre(usuarioId: number, ids: number[]): Promise<Historia[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.findAll({ usuario_id: usuarioId, id: { [Op.in]: [...new Set(ids)] } });
  }

  /** Borra varias historias por id dentro de una transacción. */
  eliminarVarias(ids: number[], transaction: Transaction): Promise<number> {
    return this.delete({ id: { [Op.in]: ids } }, transaction);
  }

  /** Suma una vista al contador desnormalizado. */
  async sumarVista(id: number, transaction: Transaction): Promise<void> {
    await Historia.increment('total_vistas', { by: 1, where: { id }, transaction });
  }

  /** Ids de las cuentas que sigue el usuario (aceptado; una solicitud pendiente no cuenta). */
  async idsSeguidos(usuarioId: number): Promise<number[]> {
    const filas = await Seguidor.findAll({ where: { seguidor_id: usuarioId, estado: 'aceptado' }, attributes: ['siguiendo_id'] });
    return filas.map((f) => f.siguiendo_id);
  }

  /** Ids de quienes siguen al usuario (para avisarles en tiempo real). */
  async idsSeguidores(usuarioId: number): Promise<number[]> {
    const filas = await Seguidor.findAll({ where: { siguiendo_id: usuarioId, estado: 'aceptado' }, attributes: ['seguidor_id'] });
    return filas.map((f) => f.seguidor_id);
  }
}

/** Una vista con el usuario público que la hizo. */
export interface VistaDeHistoria {
  usuario: Usuario;
  vista_en: Date;
}

export class HistoriaVistaRepository extends BaseRepository<HistoriaVista> {
  protected readonly entidad = 'Vista';

  constructor() {
    super(HistoriaVista);
  }

  /** Registra la vista si no existía; devuelve si se creó ahora. */
  async registrar(historiaId: number, usuarioId: number, transaction: Transaction): Promise<boolean> {
    const [, creada] = await HistoriaVista.findOrCreate({
      where: { historia_id: historiaId, usuario_id: usuarioId },
      defaults: { historia_id: historiaId, usuario_id: usuarioId },
      transaction,
    });
    return creada;
  }

  /** De la lista `historiaIds`, cuáles ya vio el usuario. */
  async vistasPor(usuarioId: number, historiaIds: number[]): Promise<Set<number>> {
    if (!historiaIds.length) return new Set();
    const filas = await HistoriaVista.findAll({
      where: { usuario_id: usuarioId, historia_id: { [Op.in]: historiaIds } },
      attributes: ['historia_id'],
    });
    return new Set(filas.map((f) => f.historia_id));
  }

  /** Quién vio la historia, más reciente primero (solo cuentas activas). */
  async paginarDe(historiaId: number, paginacion: Paginacion): Promise<Page<VistaDeHistoria>> {
    const page = await this.paginate({ historia_id: historiaId }, paginacion, {
      include: [{ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO], where: { activo: true }, required: true }],
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ],
    });
    return { ...page, items: page.items.map((v) => ({ usuario: v.usuario!, vista_en: v.fecha_creacion })) };
  }

  /** Borra las vistas de varias historias (limpieza / borrado). */
  eliminarDe(historiaIds: number[], transaction: Transaction): Promise<number> {
    return this.delete({ historia_id: { [Op.in]: historiaIds } }, transaction);
  }
}

export const historiaRepository = new HistoriaRepository();
export const historiaVistaRepository = new HistoriaVistaRepository();
