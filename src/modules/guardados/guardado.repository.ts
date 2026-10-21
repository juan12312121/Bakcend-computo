import type { WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Publicacion, PublicacionGuardada } from '../../infrastructure/database/models';

export class GuardadoRepository extends BaseRepository<PublicacionGuardada> {
  protected readonly entidad = 'Publicación guardada';

  constructor() {
    super(PublicacionGuardada);
  }

  deUsuarioEn(publicacionId: number, usuarioId: number): Promise<PublicacionGuardada | null> {
    return this.findOne({ publicacion_id: publicacionId, usuario_id: usuarioId });
  }

  /** De una lista de publicaciones, cuáles guardó el usuario (una sola consulta). */
  async guardadasDe(usuarioId: number, publicacionIds: number[]): Promise<Set<number>> {
    if (!publicacionIds.length) return new Set();
    const filas = await this.findAll({ usuario_id: usuarioId, publicacion_id: publicacionIds }, { attributes: ['publicacion_id'] });
    return new Set(filas.map((f) => f.publicacion_id));
  }

  /** Mis guardadas que aún puedo ver, de la más reciente a la más antigua. */
  deUsuario(usuarioId: number, visibles: WhereOptions<Publicacion>, paginacion: Paginacion): Promise<Page<PublicacionGuardada>> {
    return this.paginate({ usuario_id: usuarioId }, paginacion, {
      attributes: ['id', 'publicacion_id', 'fecha_creacion'],
      include: [{ model: Publicacion, as: 'publicacion', attributes: [], where: visibles, required: true }],
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ],
    });
  }
}

export const guardadoRepository = new GuardadoRepository();
