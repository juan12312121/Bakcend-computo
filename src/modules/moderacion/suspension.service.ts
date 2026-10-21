import type { Sequelize, Transaction } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { sequelize, type Suspension } from '../../infrastructure/database/models';
import { logSeguridadRepository, type LogSeguridadRepository } from '../seguridad/log-seguridad.repository';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { suspensionRepository, type SuspensionRepository } from './suspension.repository';

const DIA_MS = 24 * 60 * 60 * 1000;
/** Cada cuánto revisa la tarea programada si alguna suspensión ya venció. */
export const MINUTOS_REVISION_SUSPENSIONES = 5;
export const EVENTO_SUSPENSION_VENCIDA = 'SUSPENSION_VENCIDA';

export interface DatosSuspension {
  /** null = automática (por reportes). */
  adminId: number | null;
  /** Días de suspensión; null o undefined = permanente. */
  dias?: number | null;
  motivo?: string | null;
}

export interface EstadoSuspension {
  id: number;
  suspendido: boolean;
  /** Fin de la suspensión; null si es permanente o si no está suspendido. */
  hasta: Date | null;
}

/**
 * Suspensiones temporales o permanentes. `usuarios.suspendido` es lo que revisa AuthGuard al instante;
 * la tabla `suspensiones` guarda hasta cuándo y quién la puso, y `levantarVencidas()` las quita al cumplirse.
 */
export class SuspensionService extends BaseService<Suspension, SuspensionRepository> {
  constructor(
    repository: SuspensionRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly logs: LogSeguridadRepository,
    private readonly db: Sequelize,
  ) {
    super(repository);
  }

  /** Suspende (reemplaza cualquier suspensión activa anterior) y saca al usuario de línea. */
  suspender(usuarioId: number, datos: DatosSuspension): Promise<EstadoSuspension>;
  suspender(usuarioId: number, datos: DatosSuspension, transaction: Transaction): Promise<EstadoSuspension>;
  async suspender(usuarioId: number, { adminId, dias, motivo }: DatosSuspension, transaction?: Transaction): Promise<EstadoSuspension> {
    const usuario = await this.usuarios.findByIdOrFail(usuarioId, { transaction });
    const hasta = dias ? new Date(Date.now() + dias * DIA_MS) : null;
    await this.enTransaccion(transaction, async (t) => {
      await this.repository.cerrarActivas(usuarioId, t);
      await this.repository.create({ usuario_id: usuarioId, admin_id: adminId, motivo: motivo ?? null, hasta }, t);
      await this.usuarios.update(usuario, { suspendido: true, en_linea: false }, t);
    });
    return { id: usuarioId, suspendido: true, hasta };
  }

  /** Quita la suspensión (y cierra su registro). */
  levantar(usuarioId: number): Promise<EstadoSuspension>;
  levantar(usuarioId: number, transaction: Transaction): Promise<EstadoSuspension>;
  async levantar(usuarioId: number, transaction?: Transaction): Promise<EstadoSuspension> {
    const usuario = await this.usuarios.findByIdOrFail(usuarioId, { transaction });
    await this.enTransaccion(transaction, async (t) => {
      await this.repository.cerrarActivas(usuarioId, t);
      await this.usuarios.update(usuario, { suspendido: false }, t);
    });
    return { id: usuarioId, suspendido: false, hasta: null };
  }

  activaDe(usuarioId: number): Promise<Suspension | null> {
    return this.repository.activaDe(usuarioId);
  }

  activasDe(usuarioIds: number[]): Promise<Map<number, Suspension>> {
    return this.repository.activasDe(usuarioIds);
  }

  listar(soloActivas: boolean, paginacion: Paginacion): Promise<Page<Suspension>> {
    return this.repository.listar(soloActivas, paginacion);
  }

  /** Levanta las suspensiones temporales vencidas. Devuelve cuántas levantó. */
  async levantarVencidas(ahora: Date = new Date()): Promise<number> {
    const vencidas = await this.repository.vencidas(ahora);
    for (const suspension of vencidas) {
      await this.db.transaction(async (t) => {
        await this.repository.update(suspension, { activa: false, levantada_en: ahora }, t);
        const otra = await this.repository.activaDe(suspension.usuario_id, t);
        if (!otra) {
          const usuario = await this.usuarios.findById(suspension.usuario_id, { transaction: t });
          if (usuario?.suspendido) await this.usuarios.update(usuario, { suspendido: false }, t);
        }
        await this.logs.registrar(suspension.usuario_id, EVENTO_SUSPENSION_VENCIDA, { suspensionId: suspension.id }, {}, t);
      });
    }
    return vencidas.length;
  }

  private async enTransaccion(transaction: Transaction | undefined, trabajo: (t: Transaction) => Promise<void>): Promise<void> {
    if (transaction) await trabajo(transaction);
    else await this.db.transaction(trabajo);
  }
}

export const suspensionService = new SuspensionService(suspensionRepository, usuarioRepository, logSeguridadRepository, sequelize);

/** Tarea programada para server.ts: levanta las suspensiones temporales vencidas. */
export function programarFinSuspensiones(): NodeJS.Timeout;
export function programarFinSuspensiones(intervaloMs: number): NodeJS.Timeout;
export function programarFinSuspensiones(intervaloMs: number = MINUTOS_REVISION_SUSPENSIONES * 60_000): NodeJS.Timeout {
  const temporizador = setInterval(() => {
    suspensionService
      .levantarVencidas()
      .catch((error: Error) => console.warn('No se pudieron levantar las suspensiones vencidas:', error.message));
  }, intervaloMs);
  temporizador.unref();
  return temporizador;
}
