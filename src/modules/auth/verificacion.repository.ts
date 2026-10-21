import { Op, type Transaction } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import { VerificacionEmail } from '../../infrastructure/database/models';

/** Tokens de "verifica tu correo" (solo hashes), igual que los de restablecer contraseña. */
export class VerificacionRepository extends BaseRepository<VerificacionEmail> {
  protected readonly entidad = 'Verificación de correo';

  constructor() {
    super(VerificacionEmail);
  }

  /** true si el usuario pidió un enlace desde cierta fecha (límite de reenvíos). */
  pidioDesde(usuarioId: number, desde: Date): Promise<boolean> {
    return this.exists({ usuario_id: usuarioId, fecha_creacion: { [Op.gte]: desde } });
  }

  /** Token sin usar y sin vencer cuyo hash coincide; null si no hay. */
  buscarVigente(tokenHash: string): Promise<VerificacionEmail | null> {
    return this.findOne({ token_hash: tokenHash, usado_en: null, expira_en: { [Op.gt]: new Date() } });
  }

  /** Deja vencidos los enlaces pendientes del usuario: invalidarPendientes(id) · (id, transacción). */
  invalidarPendientes(usuarioId: number): Promise<number>;
  invalidarPendientes(usuarioId: number, transaction: Transaction): Promise<number>;
  async invalidarPendientes(usuarioId: number, transaction?: Transaction): Promise<number> {
    const ahora = new Date();
    const [afectados] = await VerificacionEmail.update(
      { expira_en: ahora },
      { where: { usuario_id: usuarioId, usado_en: null, expira_en: { [Op.gt]: ahora } }, transaction },
    );
    return afectados;
  }

  marcarUsado(registro: VerificacionEmail, transaction: Transaction): Promise<VerificacionEmail> {
    return this.update(registro, { usado_en: new Date() }, transaction);
  }
}

export const verificacionRepository = new VerificacionRepository();
