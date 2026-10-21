import { BaseRepository } from '../../core/domain/BaseRepository';
import { NotaModeracion, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';
import type { ClaveContenido } from './reporte-contenido.repository';

/** Notas internas de los admins sobre un contenido reportado. */
export class NotaModeracionRepository extends BaseRepository<NotaModeracion> {
  protected readonly entidad = 'Nota';

  constructor() {
    super(NotaModeracion);
  }

  protected override opcionesPorDefecto() {
    return {
      include: [{ model: Usuario, as: 'admin', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ] as [string, string][],
    };
  }

  deContenido({ tipo, contenido_id }: ClaveContenido): Promise<NotaModeracion[]> {
    return this.findAll({ tipo, contenido_id });
  }
}

export const notaModeracionRepository = new NotaModeracionRepository();
