import type { InferAttributes } from 'sequelize';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import type { Publicacion, PublicacionNoInteresa, PublicacionOculta } from '../../infrastructure/database/models';
import { publicacionRepository, type PublicacionRepository } from '../publicaciones/publicacion.repository';
import {
  publicacionNoInteresaRepository,
  publicacionOcultaRepository,
  publicacionPropiaRepository,
  type PreferenciaPublicacionRepository,
  type PublicacionNoInteresaRepository,
  type PublicacionOcultaRepository,
  type PublicacionPropiaRepository,
} from './preferencia.repository';
import { reporteService, type ReporteService } from './reporte.service';

/** Publicación de un listado de ocultas / no interesa, con la fecha en que se marcó. */
export type PublicacionMarcada = InferAttributes<Publicacion> & { fecha_marcada: Date };

/** Qué ve cada usuario: publicaciones ajenas ocultas, "no me interesa" y ocultar/mostrar las propias. */
export class PreferenciaService {
  constructor(
    private readonly ocultas: PublicacionOcultaRepository,
    private readonly noInteresa: PublicacionNoInteresaRepository,
    private readonly propias: PublicacionPropiaRepository,
    private readonly publicaciones: PublicacionRepository,
    private readonly reportes: ReporteService,
  ) {}

  // ---------- Ocultar publicaciones ajenas ----------

  async ocultar(usuarioId: number, publicacionId: number): Promise<void> {
    const publicacion = await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    await this.ocultas.marcar(usuarioId, publicacion);
  }

  async mostrar(usuarioId: number, publicacionId: number): Promise<void> {
    await this.ocultas.desmarcar(usuarioId, publicacionId);
  }

  listarOcultas(usuarioId: number, paginacion: Paginacion): Promise<Page<PublicacionMarcada>> {
    return this.listar(this.ocultas, usuarioId, paginacion);
  }

  // ---------- No me interesa ----------

  async marcarNoInteresa(usuarioId: number, publicacionId: number): Promise<PublicacionNoInteresa> {
    const publicacion = await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    return this.noInteresa.marcar(usuarioId, publicacion);
  }

  async desmarcarNoInteresa(usuarioId: number, publicacionId: number): Promise<void> {
    await this.noInteresa.desmarcar(usuarioId, publicacionId);
  }

  listarNoInteresan(usuarioId: number, paginacion: Paginacion): Promise<Page<PublicacionMarcada>> {
    return this.listar(this.noInteresa, usuarioId, paginacion);
  }

  limpiarNoInteresa(usuarioId: number): Promise<number> {
    return this.noInteresa.limpiar(usuarioId);
  }

  // ---------- Publicaciones propias ----------

  ocultarPropias(usuarioId: number): Promise<number> {
    return this.propias.cambiarOculto(usuarioId, true);
  }

  /** Vuelve a mostrar las propias, excepto las que ocultó la moderación por reportes. */
  async mostrarPropias(usuarioId: number): Promise<number> {
    return this.propias.cambiarOculto(usuarioId, false, await this.reportes.idsModeradas());
  }

  propiasOcultas(usuarioId: number, paginacion: Paginacion): Promise<Page<Publicacion>> {
    return this.propias.paginarOcultas(usuarioId, paginacion);
  }

  /** Listado común a ocultas y no interesa: solo publicaciones que el usuario aún puede ver. */
  private async listar<M extends PublicacionNoInteresa | PublicacionOculta>(
    repositorio: PreferenciaPublicacionRepository<M>,
    usuarioId: number,
    paginacion: Paginacion,
  ): Promise<Page<PublicacionMarcada>> {
    const page = await repositorio.paginarDelUsuario(usuarioId, paginacion, await this.publicaciones.filtroVisibles(usuarioId));
    return {
      ...page,
      items: page.items.map((marca) => ({
        ...(marca.publicacion!.toJSON() as InferAttributes<Publicacion>),
        fecha_marcada: marca.fecha_creacion,
      })),
    };
  }
}

export const preferenciaService = new PreferenciaService(
  publicacionOcultaRepository,
  publicacionNoInteresaRepository,
  publicacionPropiaRepository,
  publicacionRepository,
  reporteService,
);
