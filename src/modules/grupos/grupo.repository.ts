import { Op, type Attributes, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Grupo, Usuario, type TipoGrupo } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

export class GrupoRepository extends BaseRepository<Grupo> {
  protected readonly entidad = 'Grupo';

  constructor() {
    super(Grupo);
  }

  /** Todo grupo se lee con los datos públicos de su creador. */
  protected override opcionesPorDefecto() {
    return {
      include: [{ model: Usuario, as: 'creador', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
    };
  }

  /** Los más recientes primero; listar(pag), listar(pag, 'trabajo') o listar(pag, tipo, 'texto'). */
  listar(paginacion: Paginacion): Promise<Page<Grupo>>;
  listar(paginacion: Paginacion, tipo: TipoGrupo | undefined): Promise<Page<Grupo>>;
  listar(paginacion: Paginacion, tipo: TipoGrupo | undefined, texto: string | undefined): Promise<Page<Grupo>>;
  listar(paginacion: Paginacion, tipo?: TipoGrupo, texto?: string): Promise<Page<Grupo>> {
    const patron = texto ? `%${texto}%` : null;
    const where: WhereOptions<Attributes<Grupo>> = {
      ...(tipo ? { tipo } : {}),
      ...(patron ? { [Op.or]: [{ nombre: { [Op.like]: patron } }, { descripcion: { [Op.like]: patron } }] } : {}),
    };
    return this.paginate(where, paginacion, { order: [['fecha_creacion', 'DESC'], ['id', 'DESC']] });
  }

  porIds(ids: number[]): Promise<Grupo[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.findAll({ id: ids }, { order: [['fecha_creacion', 'DESC'], ['id', 'DESC']] });
  }
}

export const grupoRepository = new GrupoRepository();
