import { Op } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import { NotFoundError } from '../../core/errors';
import { Notificacion, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export class NotificacionRepository extends BaseRepository<Notificacion> {
  protected readonly entidad = 'Notificación';

  constructor() {
    super(Notificacion);
  }

  /** Cada notificación viaja con los datos públicos de quien la provocó. */
  protected override opcionesPorDefecto() {
    return {
      include: [{ model: Usuario, as: 'emisor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
      order: [['fecha_creacion', 'DESC']] as [string, string][],
    };
  }

  contarNoLeidas(usuarioId: number): Promise<number> {
    return this.count({ usuario_id: usuarioId, leida: false });
  }

  /** Notificación del destinatario; 404 si no existe o es de otra persona (no se revela cuál). */
  async findDelUsuarioOrFail(id: number, usuarioId: number): Promise<Notificacion> {
    const notificacion = await this.findOne({ id, usuario_id: usuarioId });
    if (!notificacion) throw new NotFoundError(this.entidad, 'Notificación no encontrada');
    return notificacion;
  }

  async marcarTodasLeidas(usuarioId: number): Promise<number> {
    const [actualizadas] = await Notificacion.update({ leida: true }, { where: { usuario_id: usuarioId, leida: false } });
    return actualizadas;
  }

  /** Borra las notificaciones leídas del usuario con más de `dias` días. */
  eliminarLeidasAntiguas(usuarioId: number, dias: number): Promise<number> {
    return this.delete({
      usuario_id: usuarioId,
      leida: true,
      fecha_creacion: { [Op.lt]: new Date(Date.now() - dias * MS_POR_DIA) },
    });
  }
}

export const notificacionRepository = new NotificacionRepository();
