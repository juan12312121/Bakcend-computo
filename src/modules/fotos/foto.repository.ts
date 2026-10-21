import { Op, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Publicacion } from '../../infrastructure/database/models';

/** Las "fotos" de un usuario son sus publicaciones con imagen (imagen_url, nunca imagen_s3). */
export class FotoRepository extends BaseRepository<Publicacion> {
  protected readonly entidad = 'Foto';

  constructor() {
    super(Publicacion);
  }

  deUsuario(usuarioId: number, visibles: WhereOptions<Publicacion>, paginacion: Paginacion): Promise<Page<Publicacion>> {
    return this.paginate(
      { [Op.and]: [{ usuario_id: usuarioId, imagen_url: { [Op.ne]: '', [Op.not]: null } }, visibles] },
      paginacion,
      {
        attributes: ['id', 'imagen_url', 'contenido', 'fecha_creacion'],
        order: [
          ['fecha_creacion', 'DESC'],
          ['id', 'DESC'],
        ],
      },
    );
  }
}

export const fotoRepository = new FotoRepository();
