import { Op, type Transaction } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Bloqueo, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** Usuarios bloqueados: "bloqueador_id ya no ve a bloqueado_id ni este a él". */
export class BloqueoRepository extends BaseRepository<Bloqueo> {
  protected readonly entidad = 'Bloqueo';

  constructor() {
    super(Bloqueo);
  }

  /** El bloqueo de `bloqueadorId` hacia `bloqueadoId` (solo ese sentido). */
  buscar(bloqueadorId: number, bloqueadoId: number): Promise<Bloqueo | null>;
  buscar(bloqueadorId: number, bloqueadoId: number, transaction: Transaction): Promise<Bloqueo | null>;
  buscar(bloqueadorId: number, bloqueadoId: number, transaction?: Transaction): Promise<Bloqueo | null> {
    return Bloqueo.findOne({ where: { bloqueador_id: bloqueadorId, bloqueado_id: bloqueadoId }, transaction });
  }

  /** true si alguno de los dos bloqueó al otro. */
  hayEntre(a: number, b: number): Promise<boolean> {
    return this.exists({
      [Op.or]: [
        { bloqueador_id: a, bloqueado_id: b },
        { bloqueador_id: b, bloqueado_id: a },
      ],
    });
  }

  /** Ids de quienes bloqueé o me bloquearon (sin repetir). */
  async idsRelacionados(usuarioId: number): Promise<number[]> {
    const filas = await Bloqueo.findAll({
      where: { [Op.or]: [{ bloqueador_id: usuarioId }, { bloqueado_id: usuarioId }] },
      attributes: ['bloqueador_id', 'bloqueado_id'],
    });
    const ids = filas.map((f) => (f.bloqueador_id === usuarioId ? f.bloqueado_id : f.bloqueador_id));
    return [...new Set(ids)];
  }

  /** Mis bloqueados (cuentas activas), del más reciente al más antiguo, con sus datos públicos. */
  paginarBloqueados(usuarioId: number, paginacion: Paginacion): Promise<Page<Bloqueo>> {
    return this.paginate({ bloqueador_id: usuarioId }, paginacion, {
      include: [{ model: Usuario, as: 'bloqueado', attributes: [...ATRIBUTOS_USUARIO_PUBLICO], where: { activo: true }, required: true }],
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ],
    });
  }
}

export const bloqueoRepository = new BloqueoRepository();
