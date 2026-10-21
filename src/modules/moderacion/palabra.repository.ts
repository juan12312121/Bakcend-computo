import { Op, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { PalabraProhibida, type AccionPalabra } from '../../infrastructure/database/models';

export interface FiltrosPalabras {
  q?: string;
  accion?: AccionPalabra;
  activa?: boolean;
}

export class PalabraRepository extends BaseRepository<PalabraProhibida> {
  protected readonly entidad = 'Palabra prohibida';

  constructor() {
    super(PalabraProhibida);
  }

  listar({ q, accion, activa }: FiltrosPalabras, paginacion: Paginacion): Promise<Page<PalabraProhibida>> {
    const where: WhereOptions<PalabraProhibida> = {
      ...(q ? { palabra: { [Op.like]: `%${q}%` } } : {}),
      ...(accion ? { accion } : {}),
      ...(activa !== undefined ? { activa } : {}),
    };
    return this.paginate(where, paginacion, { order: [['palabra', 'ASC']] });
  }

  activas(): Promise<PalabraProhibida[]> {
    return this.findAll({ activa: true });
  }
}

export const palabraRepository = new PalabraRepository();
