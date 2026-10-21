import type {
  Attributes,
  CreationAttributes,
  FindOptions,
  Model,
  ModelStatic,
  Transaction,
  WhereOptions,
} from 'sequelize';
import { NotFoundError } from '../errors';
import type { Page } from '../http/ApiResponse';
import type { Paginacion } from '../validation/common.schemas';

export type OpcionesConsulta<M extends Model> = Omit<FindOptions<Attributes<M>>, 'where'>;

/**
 * Repositorio genérico sobre un modelo de Sequelize.
 * Los repositorios concretos heredan el CRUD y solo agregan consultas propias
 * (o sobrescriben `opcionesPorDefecto` para incluir asociaciones).
 */
export abstract class BaseRepository<M extends Model> {
  /** Nombre legible para mensajes de error: "Publicación", "Usuario"... */
  protected abstract readonly entidad: string;

  constructor(protected readonly model: ModelStatic<M>) {}

  /** Opciones que se aplican a todas las lecturas (includes, attributes...). */
  protected opcionesPorDefecto(): OpcionesConsulta<M> {
    return {};
  }

  // ---------- Lectura ----------

  findById(id: number): Promise<M | null>;
  findById(id: number, opciones: OpcionesConsulta<M>): Promise<M | null>;
  findById(id: number, opciones: OpcionesConsulta<M> = {}): Promise<M | null> {
    return this.model.findByPk(id, { ...this.opcionesPorDefecto(), ...opciones });
  }

  findByIdOrFail(id: number): Promise<M>;
  findByIdOrFail(id: number, opciones: OpcionesConsulta<M>): Promise<M>;
  async findByIdOrFail(id: number, opciones: OpcionesConsulta<M> = {}): Promise<M> {
    const registro = await this.findById(id, opciones);
    if (!registro) throw new NotFoundError(this.entidad);
    return registro;
  }

  findOne(where: WhereOptions<Attributes<M>>): Promise<M | null>;
  findOne(where: WhereOptions<Attributes<M>>, opciones: OpcionesConsulta<M>): Promise<M | null>;
  findOne(where: WhereOptions<Attributes<M>>, opciones: OpcionesConsulta<M> = {}): Promise<M | null> {
    return this.model.findOne({ ...this.opcionesPorDefecto(), ...opciones, where });
  }

  findAll(): Promise<M[]>;
  findAll(where: WhereOptions<Attributes<M>>): Promise<M[]>;
  findAll(where: WhereOptions<Attributes<M>>, opciones: OpcionesConsulta<M>): Promise<M[]>;
  findAll(where: WhereOptions<Attributes<M>> = {}, opciones: OpcionesConsulta<M> = {}): Promise<M[]> {
    return this.model.findAll({ ...this.opcionesPorDefecto(), ...opciones, where });
  }

  paginate(where: WhereOptions<Attributes<M>>, paginacion: Paginacion): Promise<Page<M>>;
  paginate(where: WhereOptions<Attributes<M>>, paginacion: Paginacion, opciones: OpcionesConsulta<M>): Promise<Page<M>>;
  async paginate(
    where: WhereOptions<Attributes<M>>,
    { limit, offset }: Paginacion,
    opciones: OpcionesConsulta<M> = {},
  ): Promise<Page<M>> {
    const { rows, count } = await this.model.findAndCountAll({
      ...this.opcionesPorDefecto(),
      ...opciones,
      where,
      limit,
      offset,
      distinct: true,
    });
    return { items: rows, total: count, limit, offset };
  }

  count(where: WhereOptions<Attributes<M>> = {}): Promise<number> {
    return this.model.count({ where });
  }

  async exists(where: WhereOptions<Attributes<M>>): Promise<boolean> {
    return (await this.model.count({ where })) > 0;
  }

  // ---------- Escritura ----------

  create(data: CreationAttributes<M>): Promise<M>;
  create(data: CreationAttributes<M>, transaction: Transaction): Promise<M>;
  create(data: CreationAttributes<M>, transaction?: Transaction): Promise<M> {
    return this.model.create(data, { transaction });
  }

  update(id: number, cambios: Partial<Attributes<M>>): Promise<M>;
  update(registro: M, cambios: Partial<Attributes<M>>): Promise<M>;
  update(objetivo: number | M, cambios: Partial<Attributes<M>>, transaction?: Transaction): Promise<M>;
  async update(objetivo: number | M, cambios: Partial<Attributes<M>>, transaction?: Transaction): Promise<M> {
    const registro = typeof objetivo === 'number' ? await this.findByIdOrFail(objetivo) : objetivo;
    return registro.update(cambios, { transaction });
  }

  /** Borra por id (404 si no existe) o por condición (devuelve cuántos borró). */
  delete(id: number): Promise<number>;
  delete(where: WhereOptions<Attributes<M>>): Promise<number>;
  delete(objetivo: number | WhereOptions<Attributes<M>>, transaction?: Transaction): Promise<number>;
  async delete(objetivo: number | WhereOptions<Attributes<M>>, transaction?: Transaction): Promise<number> {
    if (typeof objetivo === 'number') {
      const registro = await this.findByIdOrFail(objetivo);
      await registro.destroy({ transaction });
      return 1;
    }
    return this.model.destroy({ where: objetivo, transaction });
  }
}
