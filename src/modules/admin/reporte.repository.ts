import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Publicacion, Reporte, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** Lectura de reportes para moderación (quién reportó y qué publicación, con su autor). */
export class ReporteRepository extends BaseRepository<Reporte> {
  protected readonly entidad = 'Reporte';

  constructor() {
    super(Reporte);
  }

  protected override opcionesPorDefecto() {
    return {
      include: [
        { model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
        {
          model: Publicacion,
          as: 'publicacion',
          attributes: ['id', 'contenido', 'imagen_url', 'usuario_id', 'oculto', 'fecha_creacion'],
          include: [{ model: Usuario, as: 'autor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
        },
      ],
    };
  }

  listar(paginacion: Paginacion): Promise<Page<Reporte>> {
    return this.paginate({}, paginacion, { order: [['fecha_reporte', 'DESC'], ['id', 'DESC']] });
  }
}

export const reporteRepository = new ReporteRepository();
