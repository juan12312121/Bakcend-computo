import { Op } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Documento, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

export class DocumentoRepository extends BaseRepository<Documento> {
  protected readonly entidad = 'Documento';

  constructor() {
    super(Documento);
  }

  /** Cada documento viaja con los datos públicos de su dueño, los más nuevos primero. */
  protected override opcionesPorDefecto() {
    return {
      include: [{ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ] as [string, string][],
    };
  }

  /** Adjuntos de varias publicaciones de una sola vez (sin el dueño: ya viene en la publicación). */
  dePublicaciones(publicacionIds: number[]): Promise<Documento[]> {
    if (!publicacionIds.length) return Promise.resolve([]);
    return this.findAll(
      { publicacion_id: publicacionIds },
      {
        include: [],
        order: [
          ['fecha_creacion', 'ASC'],
          ['id', 'ASC'],
        ],
      },
    );
  }

  /** Adjuntos de una publicación, en el orden en que se subieron. */
  dePublicacion(publicacionId: number): Promise<Documento[]> {
    return this.dePublicaciones([publicacionId]);
  }

  /**
   * Documentos de un usuario. Si se indican publicaciones visibles, solo se incluyen
   * los sueltos (sin publicación) y los adjuntos a esas publicaciones.
   */
  deUsuario(usuarioId: number, paginacion: Paginacion): Promise<Page<Documento>>;
  deUsuario(usuarioId: number, paginacion: Paginacion, publicacionesVisibles: number[]): Promise<Page<Documento>>;
  deUsuario(usuarioId: number, paginacion: Paginacion, publicacionesVisibles?: number[]): Promise<Page<Documento>> {
    if (!publicacionesVisibles) return this.paginate({ usuario_id: usuarioId }, paginacion);
    return this.paginate(
      {
        usuario_id: usuarioId,
        [Op.or]: [{ publicacion_id: null }, { publicacion_id: publicacionesVisibles }],
      },
      paginacion,
    );
  }
}

export const documentoRepository = new DocumentoRepository();
