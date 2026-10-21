import { Op, type Transaction } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import { RestablecimientoContrasena } from '../../infrastructure/database/models';

/** Tokens de "olvidé mi contraseña" (solo hashes). */
export class RestablecimientoRepository extends BaseRepository<RestablecimientoContrasena> {
  protected readonly entidad = 'Restablecimiento de contraseña';

  constructor() {
    super(RestablecimientoContrasena);
  }

  /** Cuántas solicitudes hizo el usuario desde cierta fecha (para el límite por hora). */
  solicitudesDesde(usuarioId: number, desde: Date): Promise<number> {
    return this.count({ usuario_id: usuarioId, fecha_creacion: { [Op.gte]: desde } });
  }

  /** Token sin usar y sin vencer cuyo hash coincide; null si no hay. */
  buscarVigente(tokenHash: string): Promise<RestablecimientoContrasena | null> {
    return this.findOne({ token_hash: tokenHash, usado_en: null, expira_en: { [Op.gt]: new Date() } });
  }

  /** Deja vencidos los enlaces pendientes del usuario: invalidarPendientes(id) · (id, transacción). */
  invalidarPendientes(usuarioId: number): Promise<number>;
  invalidarPendientes(usuarioId: number, transaction: Transaction): Promise<number>;
  async invalidarPendientes(usuarioId: number, transaction?: Transaction): Promise<number> {
    const ahora = new Date();
    const [afectados] = await RestablecimientoContrasena.update(
      { expira_en: ahora },
      { where: { usuario_id: usuarioId, usado_en: null, expira_en: { [Op.gt]: ahora } }, transaction },
    );
    return afectados;
  }

  marcarUsado(registro: RestablecimientoContrasena, transaction: Transaction): Promise<RestablecimientoContrasena> {
    return this.update(registro, { usado_en: new Date() }, transaction);
  }
}

export const restablecimientoRepository = new RestablecimientoRepository();
