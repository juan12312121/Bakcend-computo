import type { InferAttributes, Sequelize } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { sequelize, type Bloqueo, type TipoNotificacion, type Usuario } from '../../infrastructure/database/models';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { seguidorRepository, type SeguidorRepository } from '../seguidores/seguidor.repository';
import { ATRIBUTOS_USUARIO_PUBLICO, usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { bloqueoRepository, type BloqueoRepository } from './bloqueo.repository';

/** Elemento de "mis bloqueados". */
export type UsuarioBloqueado = Pick<InferAttributes<Usuario>, (typeof ATRIBUTOS_USUARIO_PUBLICO)[number]> & {
  bloqueado_desde: Date;
};

export interface ResultadoBloqueo {
  usuario_id: number;
  bloqueado: boolean;
}

/** Notificaciones de seguimiento que dejan de tener sentido al bloquear. */
const TIPOS_A_RETIRAR: TipoNotificacion[] = ['follow', 'solicitud_seguimiento', 'seguimiento_aceptado'];

export class BloqueoService extends BaseService<Bloqueo, BloqueoRepository> {
  constructor(
    repository: BloqueoRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly seguidores: SeguidorRepository,
    private readonly notificaciones: NotificacionService,
    private readonly db: Sequelize,
  ) {
    super(repository);
  }

  /**
   * Bloquea a `bloqueadoId`: borra los seguimientos en ambos sentidos (aceptados, con sus contadores,
   * y solicitudes pendientes) y retira las notificaciones de seguimiento entre los dos.
   */
  async bloquear(usuarioId: number, bloqueadoId: number): Promise<ResultadoBloqueo> {
    if (usuarioId === bloqueadoId) throw new BadRequestError('No puedes bloquearte a ti mismo');
    await this.usuarios.findByIdOrFail(bloqueadoId);

    await this.db.transaction(async (t) => {
      if (await this.repository.buscar(usuarioId, bloqueadoId, t)) throw new ConflictError('Ya bloqueaste a este usuario');
      await this.repository.create({ bloqueador_id: usuarioId, bloqueado_id: bloqueadoId }, t);
      await this.seguidores.quitar(usuarioId, bloqueadoId, t);
      await this.seguidores.quitar(bloqueadoId, usuarioId, t);
    });

    for (const [destino, origen] of [
      [usuarioId, bloqueadoId],
      [bloqueadoId, usuarioId],
    ]) {
      for (const tipo of TIPOS_A_RETIRAR) await this.notificaciones.retirar({ usuario_id: destino, de_usuario_id: origen, tipo });
    }
    return { usuario_id: bloqueadoId, bloqueado: true };
  }

  /** Quita el bloqueo (los seguimientos borrados no vuelven). */
  async desbloquear(usuarioId: number, bloqueadoId: number): Promise<ResultadoBloqueo> {
    const borrados = await this.repository.delete({ bloqueador_id: usuarioId, bloqueado_id: bloqueadoId });
    if (!borrados) throw new NotFoundError('Bloqueo', 'No has bloqueado a este usuario');
    return { usuario_id: bloqueadoId, bloqueado: false };
  }

  async listar(usuarioId: number, paginacion: Paginacion): Promise<Page<UsuarioBloqueado>> {
    const page = await this.repository.paginarBloqueados(usuarioId, paginacion);
    return {
      ...page,
      items: page.items
        .filter((b) => b.bloqueado)
        .map((b) => ({ ...(b.bloqueado!.toJSON() as UsuarioBloqueado), bloqueado_desde: b.fecha_creacion })),
    };
  }
}

export const bloqueoService = new BloqueoService(bloqueoRepository, usuarioRepository, seguidorRepository, notificacionService, sequelize);
