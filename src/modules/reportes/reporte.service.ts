import { Op, type InferAttributes, type Sequelize, type Transaction } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { sequelize, type Publicacion, type Reporte, type ReporteContenido, type Usuario } from '../../infrastructure/database/models';
import { copiaPublicacion } from '../moderacion/copias';
import { reporteContenidoRepository, type ReporteContenidoRepository } from '../moderacion/reporte-contenido.repository';
import { suspensionService, type SuspensionService } from '../moderacion/suspension.service';
import { publicacionRepository, type PublicacionRepository } from '../publicaciones/publicacion.repository';
import { ATRIBUTOS_USUARIO_PUBLICO, usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { reporteRepository, type ReporteRepository } from './reporte.repository';
import type { CrearReporteDto } from './reporte.schemas';

/** Con esta cantidad de reportes la publicación se oculta automáticamente. */
export const UMBRAL_OCULTAR = 5;
/** Con esta cantidad de publicaciones ocultadas por reportes, el autor queda suspendido. */
export const UMBRAL_SUSPENDER = 3;

export interface ResultadoReporte {
  reporte: Reporte;
  total_reportes: number;
  /** true si la publicación quedó oculta por exceso de reportes. */
  publicacion_oculta: boolean;
  /** El mismo reporte en la bandeja común de moderación (con copia de la publicación). */
  reporte_moderacion: ReporteContenido;
}

export type PublicacionReportada = InferAttributes<Publicacion> & { total_reportes: number; motivos: string[] };

export interface EstadisticaUsuario {
  usuario: Pick<InferAttributes<Usuario>, (typeof ATRIBUTOS_USUARIO_PUBLICO)[number]> & {
    suspendido: boolean;
  };
  publicaciones_ocultadas: number;
  publicaciones_reportadas: number;
  reportes_recibidos: number;
}

export class ReporteService extends BaseService<Reporte, ReporteRepository> {
  constructor(
    repository: ReporteRepository,
    private readonly publicaciones: PublicacionRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly db: Sequelize,
    private readonly bandeja: ReporteContenidoRepository,
    private readonly suspensiones: SuspensionService,
  ) {
    super(repository);
  }

  /**
   * Un reporte por (publicación, usuario). Al llegar a UMBRAL_OCULTAR la publicación se oculta,
   * y si el autor acumula UMBRAL_SUSPENDER publicaciones ocultadas así, queda suspendido.
   */
  async crear(usuarioId: number, { publicacion_id, motivo, descripcion }: CrearReporteDto): Promise<ResultadoReporte> {
    const publicacion = await this.publicaciones.findVisibleOrFail(publicacion_id, usuarioId);
    if (publicacion.usuario_id === usuarioId) throw new BadRequestError('No puedes reportar tu propia publicación');
    if (await this.repository.exists({ publicacion_id, usuario_id: usuarioId })) {
      throw new ConflictError('Ya has reportado esta publicación');
    }

    return this.db.transaction(async (t) => {
      const reporte = await this.repository.create(
        { publicacion_id, usuario_id: usuarioId, motivo, descripcion: descripcion ?? null },
        t,
      );
      const reporte_moderacion = await this.copiarABandeja(usuarioId, publicacion, { motivo, descripcion: descripcion ?? null }, t);
      const total = await this.repository.contarDePublicacion(publicacion_id, t);

      if (total >= UMBRAL_OCULTAR && !publicacion.oculto) {
        await this.publicaciones.update(publicacion, { oculto: true }, t);
        await this.suspenderSiReincide(publicacion, t);
      }
      return { reporte, total_reportes: total, publicacion_oculta: total >= UMBRAL_OCULTAR, reporte_moderacion };
    });
  }

  /** Reportes de una publicación (solo admin). */
  dePublicacion(publicacionId: number): Promise<Reporte[]> {
    return this.repository.findAll({ publicacion_id: publicacionId });
  }

  /** Publicaciones con reportes, de la más reportada a la menos (solo admin). */
  async publicacionesReportadas(paginacion: Paginacion): Promise<Page<PublicacionReportada>> {
    const { filas, total } = await this.repository.resumenPaginado(paginacion);
    const ids = filas.map((f) => f.publicacion_id);
    const [publicaciones, motivos] = await Promise.all([
      this.publicaciones.findAll({ id: { [Op.in]: ids } }),
      this.repository.motivosDe(ids),
    ]);
    const porId = new Map(publicaciones.map((p) => [p.id, p]));

    const items = filas
      .filter((f) => porId.has(f.publicacion_id))
      .map((f) => ({
        ...(porId.get(f.publicacion_id)!.toJSON() as InferAttributes<Publicacion>),
        total_reportes: f.total,
        motivos: motivos.get(f.publicacion_id) ?? [],
      }));
    return { items, total, ...paginacion };
  }

  /** Por autor: publicaciones reportadas, ocultadas y reportes recibidos; incluye suspendidos (solo admin). */
  async estadisticas(): Promise<EstadisticaUsuario[]> {
    const conteos = await this.repository.conteoPorPublicacion();
    const publicaciones = conteos.size
      ? await this.publicaciones.findAll({ id: { [Op.in]: [...conteos.keys()] } }, { attributes: ['id', 'usuario_id', 'oculto'], include: [] })
      : [];

    const porAutor = new Map<number, Omit<EstadisticaUsuario, 'usuario'>>();
    for (const p of publicaciones) {
      const acumulado = porAutor.get(p.usuario_id) ?? { publicaciones_ocultadas: 0, publicaciones_reportadas: 0, reportes_recibidos: 0 };
      acumulado.publicaciones_reportadas += 1;
      acumulado.reportes_recibidos += conteos.get(p.id) ?? 0;
      if (p.oculto) acumulado.publicaciones_ocultadas += 1;
      porAutor.set(p.usuario_id, acumulado);
    }

    const usuarios = await this.usuarios.findAll(
      { [Op.or]: [{ id: { [Op.in]: [...porAutor.keys()] } }, { suspendido: true }] },
      { attributes: [...ATRIBUTOS_USUARIO_PUBLICO, 'suspendido'] },
    );

    return usuarios
      .map((u) => ({
        usuario: u.toJSON() as EstadisticaUsuario['usuario'],
        ...(porAutor.get(u.id) ?? { publicaciones_ocultadas: 0, publicaciones_reportadas: 0, reportes_recibidos: 0 }),
      }))
      .sort((a, b) => b.publicaciones_ocultadas - a.publicaciones_ocultadas || b.reportes_recibidos - a.reportes_recibidos);
  }

  /** Ids de publicaciones que la moderación ocultó (las usa "mostrar-propias" para no destaparlas). */
  async idsModeradas(): Promise<number[]> {
    return [...(await this.repository.conteoPorPublicacion(UMBRAL_OCULTAR)).keys()];
  }

  /** Deja el reporte también en la bandeja común (tipo 'publicacion'); si ya estaba (importado), lo reutiliza. */
  private async copiarABandeja(
    usuarioId: number,
    publicacion: Publicacion,
    { motivo, descripcion }: Pick<ReporteContenido, 'motivo' | 'descripcion'>,
    t: Transaction,
  ): Promise<ReporteContenido> {
    const clave = { tipo: 'publicacion' as const, contenido_id: publicacion.id, usuario_id: usuarioId };
    const existente = await this.bandeja.findOne(clave, { include: [], transaction: t });
    if (existente) return existente;
    return this.bandeja.create({ ...clave, autor_id: publicacion.usuario_id, motivo, descripcion, copia: copiaPublicacion(publicacion) }, t);
  }

  /** Suspensión automática (sin admin y permanente) que queda registrada en el historial de suspensiones. */
  private async suspenderSiReincide(publicacion: Publicacion, t: Transaction): Promise<void> {
    const moderadas = [...(await this.repository.conteoPorPublicacion(UMBRAL_OCULTAR, t)).keys()];
    const ocultadas = await this.repository.contarOcultadasDelAutor(publicacion.usuario_id, moderadas, t);
    if (ocultadas >= UMBRAL_SUSPENDER && publicacion.autor && !publicacion.autor.suspendido) {
      await this.suspensiones.suspender(
        publicacion.usuario_id,
        { adminId: null, dias: null, motivo: `Automática: ${ocultadas} publicaciones ocultadas por reportes` },
        t,
      );
    }
  }
}

export const reporteService = new ReporteService(
  reporteRepository,
  publicacionRepository,
  usuarioRepository,
  sequelize,
  reporteContenidoRepository,
  suspensionService,
);
