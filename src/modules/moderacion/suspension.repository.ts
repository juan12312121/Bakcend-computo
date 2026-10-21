import { Op, type Transaction } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Suspension, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

export class SuspensionRepository extends BaseRepository<Suspension> {
  protected readonly entidad = 'Suspensión';

  constructor() {
    super(Suspension);
  }

  protected override opcionesPorDefecto() {
    return {
      include: [
        { model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
        { model: Usuario, as: 'admin', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
      ],
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ] as [string, string][],
    };
  }

  activaDe(usuarioId: number): Promise<Suspension | null>;
  activaDe(usuarioId: number, transaction: Transaction): Promise<Suspension | null>;
  activaDe(usuarioId: number, transaction?: Transaction): Promise<Suspension | null> {
    return Suspension.findOne({ where: { usuario_id: usuarioId, activa: true }, order: [['id', 'DESC']], transaction });
  }

  /** Suspensiones activas de varios usuarios (para la bandeja y estadísticas). */
  async activasDe(usuarioIds: number[]): Promise<Map<number, Suspension>> {
    if (!usuarioIds.length) return new Map();
    const filas = await this.findAll({ usuario_id: { [Op.in]: usuarioIds }, activa: true }, { include: [] });
    return new Map(filas.map((s) => [s.usuario_id, s]));
  }

  /** Cierra las activas de un usuario (al levantar o al reemplazarla por otra). */
  async cerrarActivas(usuarioId: number, transaction?: Transaction): Promise<number> {
    const [cambiadas] = await Suspension.update(
      { activa: false, levantada_en: new Date() },
      { where: { usuario_id: usuarioId, activa: true }, transaction },
    );
    return cambiadas;
  }

  /** Activas con fecha de fin ya cumplida. */
  vencidas(ahora: Date): Promise<Suspension[]> {
    return this.findAll({ activa: true, hasta: { [Op.ne]: null, [Op.lte]: ahora } }, { include: [] });
  }

  listar(soloActivas: boolean, paginacion: Paginacion): Promise<Page<Suspension>> {
    return this.paginate(soloActivas ? { activa: true } : {}, paginacion);
  }
}

export const suspensionRepository = new SuspensionRepository();
