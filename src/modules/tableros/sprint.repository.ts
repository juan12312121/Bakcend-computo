import { Op } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import { NotFoundError } from '../../core/errors';
import { Sprint } from '../../infrastructure/database/models';

export class SprintRepository extends BaseRepository<Sprint> {
  protected readonly entidad = 'Sprint';

  constructor() {
    super(Sprint);
  }

  activo(tableroId: number): Promise<Sprint | null> {
    return this.findOne({ tablero_id: tableroId, estado: 'activo' });
  }

  /** Activo primero y después los planeados, en orden de creación. */
  async abiertos(tableroId: number): Promise<Sprint[]> {
    const sprints = await this.findAll({ tablero_id: tableroId, estado: { [Op.in]: ['activo', 'planeado'] } }, { order: [['id', 'ASC']] });
    // Se ordena aquí: MySQL ordena los ENUM por índice y SQLite por texto.
    return sprints.sort((a, b) => Number(b.estado === 'activo') - Number(a.estado === 'activo'));
  }

  /** Todos los sprints del tablero, más recientes primero. */
  delTablero(tableroId: number): Promise<Sprint[]> {
    return this.findAll({ tablero_id: tableroId }, { order: [['id', 'DESC']] });
  }

  async delTableroOrFail(id: number, tableroId: number): Promise<Sprint> {
    const sprint = await this.findOne({ id, tablero_id: tableroId });
    if (!sprint) throw new NotFoundError(this.entidad, 'El sprint no existe en este tablero');
    return sprint;
  }
}

export const sprintRepository = new SprintRepository();
