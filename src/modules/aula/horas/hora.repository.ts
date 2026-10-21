import { Op, type Attributes, type Transaction, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../../core/domain/BaseRepository';
import { RegistroHoras, Tablero, Tarea, TarifaHora, Usuario } from '../../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../../usuarios/usuario.repository';
import type { Tarifas } from './horas.resumen';

/** Tope de registros por consulta (resumen y CSV). */
export const MAXIMO_REGISTROS = 5000;
export const MONEDA_POR_DEFECTO = 'MXN';

const incluirUsuario = () => ({ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] });
const incluirTarea = () => ({
  model: Tarea,
  as: 'tarea',
  attributes: ['id', 'numero', 'titulo', 'tablero_id'],
  include: [{ model: Tablero, as: 'tablero', attributes: ['id', 'nombre', 'clave', 'color'] }],
});

export interface FiltroRegistros {
  tablero_id: number;
  desde: Date;
  hasta: Date;
  usuario_id?: number;
  facturable?: boolean;
}

export class RegistroHorasRepository extends BaseRepository<RegistroHoras> {
  protected readonly entidad = 'Registro de horas';

  constructor() {
    super(RegistroHoras);
  }

  /** El cronómetro que está corriendo para el usuario (con su tarea y tablero). */
  activoDe(usuarioId: number): Promise<RegistroHoras | null>;
  activoDe(usuarioId: number, transaction: Transaction): Promise<RegistroHoras | null>;
  activoDe(usuarioId: number, transaction?: Transaction): Promise<RegistroHoras | null> {
    return RegistroHoras.findOne({ where: { cronometro_de: usuarioId }, include: [incluirUsuario(), incluirTarea()], transaction });
  }

  /** Registros de una tarea (todas las personas), del más reciente al más viejo. */
  deTarea(tareaId: number): Promise<RegistroHoras[]> {
    return this.findAll(
      { tarea_id: tareaId },
      {
        include: [incluirUsuario()],
        order: [
          ['inicio', 'DESC'],
          ['id', 'DESC'],
        ],
        limit: MAXIMO_REGISTROS,
      },
    );
  }

  /** Uno con su usuario y su tarea (para responder). */
  completo(id: number): Promise<RegistroHoras> {
    return this.findByIdOrFail(id, { include: [incluirUsuario(), incluirTarea()] });
  }

  /** Registros del tablero que EMPIEZAN en [desde, hasta), con usuario y tarea. */
  delTablero({ tablero_id, desde, hasta, usuario_id, facturable }: FiltroRegistros): Promise<RegistroHoras[]> {
    const where: WhereOptions<Attributes<RegistroHoras>> = { tablero_id, inicio: { [Op.gte]: desde, [Op.lt]: hasta } };
    if (usuario_id) Object.assign(where, { usuario_id });
    if (facturable !== undefined) Object.assign(where, { facturable });
    return this.findAll(where, {
      include: [incluirUsuario(), incluirTarea()],
      order: [
        ['inicio', 'ASC'],
        ['id', 'ASC'],
      ],
      limit: MAXIMO_REGISTROS,
    });
  }
}

export class TarifaRepository extends BaseRepository<TarifaHora> {
  protected readonly entidad = 'Tarifa';

  constructor() {
    super(TarifaHora);
  }

  /** Tarifas del tablero listas para calcular (la moneda la marca la fila del tablero o la primera que haya). */
  async deTablero(tableroId: number): Promise<Tarifas> {
    const filas = await this.findAll({ tablero_id: tableroId });
    const delTablero = filas.find((f) => f.usuario_id === null) ?? null;
    return {
      moneda: delTablero?.moneda ?? filas[0]?.moneda ?? MONEDA_POR_DEFECTO,
      tablero: delTablero?.tarifa_centavos ?? null,
      porUsuario: new Map(filas.filter((f) => f.usuario_id !== null).map((f) => [f.usuario_id as number, f.tarifa_centavos])),
    };
  }

  /** Crea, cambia o (con null) quita la tarifa del tablero o de un miembro. */
  async fijar(tableroId: number, usuarioId: number | null, centavos: number | null, moneda: string): Promise<void> {
    const existente = await this.findOne({ tablero_id: tableroId, usuario_id: usuarioId });
    if (centavos === null) {
      if (existente) await existente.destroy();
    } else if (existente) {
      await this.update(existente, { tarifa_centavos: centavos, moneda });
    } else {
      await this.create({ tablero_id: tableroId, usuario_id: usuarioId, tarifa_centavos: centavos, moneda });
    }
    // Una sola moneda por tablero.
    await TarifaHora.update({ moneda }, { where: { tablero_id: tableroId } });
  }
}

export const registroHorasRepository = new RegistroHorasRepository();
export const tarifaRepository = new TarifaRepository();
