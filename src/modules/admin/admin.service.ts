import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { sequelize, type LogSeguridad, type Reporte } from '../../infrastructure/database/models';
import { publicacionService, type PublicacionService } from '../publicaciones/publicacion.service';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import type { ContextoPeticion } from '../../core/http/ContextoPeticion';
import { logSeguridadRepository, type FiltrosLog, type LogSeguridadRepository } from '../seguridad/log-seguridad.repository';
import { reporteContenidoRepository, type ReporteContenidoRepository } from '../moderacion/reporte-contenido.repository';
import { suspensionService, type EstadoSuspension, type SuspensionService } from '../moderacion/suspension.service';
import { reporteRepository, type ReporteRepository } from './reporte.repository';

/** Eventos que deja la moderación en la bitácora. */
export const EVENTOS_ADMIN = {
  borrarPublicacion: 'ADMIN_DELETE_POST',
  suspender: 'ADMIN_SUSPEND_USER',
  reactivar: 'ADMIN_UNSUSPEND_USER',
} as const;

export class AdminService extends BaseService<LogSeguridad, LogSeguridadRepository> {
  constructor(
    repository: LogSeguridadRepository,
    private readonly reportes: ReporteRepository,
    private readonly publicaciones: PublicacionService,
    private readonly usuarios: UsuarioRepository,
    private readonly suspensiones: SuspensionService,
    private readonly bandeja: ReporteContenidoRepository,
  ) {
    super(repository);
  }

  listarReportes(paginacion: Paginacion): Promise<Page<Reporte>> {
    return this.reportes.listar(paginacion);
  }

  listarLogs(filtros: FiltrosLog, paginacion: Paginacion): Promise<Page<LogSeguridad>> {
    return this.repository.listar(filtros, paginacion);
  }

  /**
   * Moderación: borra cualquier publicación con el mismo flujo que usa su autor y lo deja en la bitácora.
   * Sus reportes pendientes en la bandeja común quedan resueltos.
   */
  async eliminarPublicacion(adminId: number, publicacionId: number, motivo: string | null | undefined, contexto: ContextoPeticion): Promise<void> {
    const publicacion = await this.publicaciones.eliminar(publicacionId, adminId, { comoAdmin: true });
    await this.bandeja.cerrarPendientes({ tipo: 'publicacion', contenido_id: publicacionId }, 'resuelto', adminId);
    await this.repository.registrar(
      adminId,
      EVENTOS_ADMIN.borrarPublicacion,
      { postId: publicacionId, postOwner: publicacion.usuario_id, motivo: motivo ?? null },
      contexto,
    );
  }

  /**
   * Alterna la suspensión de un usuario (suspender ↔ reactivar) y lo registra en la bitácora.
   * Al suspender, `dias` la vuelve temporal (sin días = permanente); al vencer la levanta la tarea programada.
   */
  async alternarSuspension(
    adminId: number,
    usuarioId: number,
    motivo: string | null | undefined,
    contexto: ContextoPeticion,
    dias?: number | null,
  ): Promise<EstadoSuspension> {
    if (adminId === usuarioId) throw new BadRequestError('No puedes suspenderte a ti mismo');
    const usuario = await this.usuarios.findByIdOrFail(usuarioId);
    const suspender = !usuario.suspendido;

    return sequelize.transaction(async (t) => {
      const estado = suspender
        ? await this.suspensiones.suspender(usuarioId, { adminId, dias: dias ?? null, motivo: motivo ?? null }, t)
        : await this.suspensiones.levantar(usuarioId, t);
      await this.repository.registrar(
        adminId,
        suspender ? EVENTOS_ADMIN.suspender : EVENTOS_ADMIN.reactivar,
        { targetUserId: usuarioId, motivo: motivo ?? null, ...(suspender && dias ? { dias } : {}) },
        contexto,
        t,
      );
      return estado;
    });
  }
}

export const adminService = new AdminService(
  logSeguridadRepository,
  reporteRepository,
  publicacionService,
  usuarioRepository,
  suspensionService,
  reporteContenidoRepository,
);
