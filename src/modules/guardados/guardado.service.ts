import { BaseService } from '../../core/domain/BaseService';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import type { PublicacionGuardada } from '../../infrastructure/database/models';
import { publicacionRepository, type PublicacionRepository } from '../publicaciones/publicacion.repository';
import { publicacionService, type PublicacionService, type PublicacionVista } from '../publicaciones/publicacion.service';
import { guardadoRepository, type GuardadoRepository } from './guardado.repository';

export interface EstadoGuardado {
  publicacion_id: number;
  guardada: boolean;
}

export class GuardadoService extends BaseService<PublicacionGuardada, GuardadoRepository> {
  constructor(
    repository: GuardadoRepository,
    private readonly publicaciones: PublicacionRepository,
    private readonly vistas: PublicacionService,
  ) {
    super(repository);
  }

  /** Guarda o quita de guardados. Guardar exige poder ver la publicación; quitar, no (por si dejó de verse). */
  async alternar(publicacionId: number, usuarioId: number): Promise<EstadoGuardado> {
    const actual = await this.repository.deUsuarioEn(publicacionId, usuarioId);
    if (actual) {
      await this.repository.delete({ id: actual.id });
      return { publicacion_id: publicacionId, guardada: false };
    }
    await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    await this.repository.create({ publicacion_id: publicacionId, usuario_id: usuarioId });
    return { publicacion_id: publicacionId, guardada: true };
  }

  /** Mis guardadas (solo las que sigo pudiendo ver), más recientes primero, como PublicacionVista. */
  async mias(usuarioId: number, paginacion: Paginacion): Promise<Page<PublicacionVista>> {
    const visibles = await this.publicaciones.filtroVisibles(usuarioId);
    const page = await this.repository.deUsuario(usuarioId, visibles, paginacion);
    const items = await this.vistas.publicas(page.items.map((g) => g.publicacion_id), usuarioId);
    return { ...page, items };
  }
}

export const guardadoService = new GuardadoService(guardadoRepository, publicacionRepository, publicacionService);
