import type { WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import {
  AccionModeracion,
  Usuario,
  type AccionModeracionTipo,
  type TipoContenidoReportable,
} from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';
import type { ClaveContenido } from './reporte-contenido.repository';

export interface FiltrosHistorial {
  accion?: AccionModeracionTipo;
  tipo?: TipoContenidoReportable;
  contenido_id?: number;
  admin_id?: number;
  autor_id?: number;
}

/** Historial de acciones de moderación (quién, qué, cuándo). */
export class AccionModeracionRepository extends BaseRepository<AccionModeracion> {
  protected readonly entidad = 'Acción de moderación';

  constructor() {
    super(AccionModeracion);
  }

  protected override opcionesPorDefecto() {
    return {
      include: [
        { model: Usuario, as: 'admin', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
        { model: Usuario, as: 'autor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
      ],
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ] as [string, string][],
    };
  }

  listar(filtros: FiltrosHistorial, paginacion: Paginacion): Promise<Page<AccionModeracion>> {
    const where: WhereOptions<AccionModeracion> = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== undefined));
    return this.paginate(where, paginacion);
  }

  deContenido({ tipo, contenido_id }: ClaveContenido): Promise<AccionModeracion[]> {
    return this.findAll({ tipo, contenido_id });
  }
}

export const accionModeracionRepository = new AccionModeracionRepository();
