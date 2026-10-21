import type { Transaction, WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { ContextoPeticion } from '../../core/http/ContextoPeticion';
import type { Paginacion } from '../../core/validation/common.schemas';
import { LogSeguridad, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

export interface FiltrosLog {
  evento?: string;
  usuario_id?: number;
}

/** Bitácora de seguridad (equivale al securityLogger del legacy). */
export class LogSeguridadRepository extends BaseRepository<LogSeguridad> {
  protected readonly entidad = 'Registro de seguridad';

  constructor() {
    super(LogSeguridad);
  }

  protected override opcionesPorDefecto() {
    return {
      include: [{ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
    };
  }

  listar(filtros: FiltrosLog, paginacion: Paginacion): Promise<Page<LogSeguridad>> {
    const where: WhereOptions<LogSeguridad> = {
      ...(filtros.evento ? { evento: filtros.evento } : {}),
      ...(filtros.usuario_id ? { usuario_id: filtros.usuario_id } : {}),
    };
    return this.paginate(where, paginacion, { order: [['fecha_creacion', 'DESC'], ['id', 'DESC']] });
  }

  /** registrar(usuario, evento) · (…, detalles) · (…, detalles, contexto) · (…, detalles, contexto, transacción) */
  registrar(usuarioId: number | null, evento: string): Promise<LogSeguridad>;
  registrar(usuarioId: number | null, evento: string, detalles: string | object): Promise<LogSeguridad>;
  registrar(usuarioId: number | null, evento: string, detalles: string | object, contexto: ContextoPeticion): Promise<LogSeguridad>;
  registrar(
    usuarioId: number | null,
    evento: string,
    detalles: string | object,
    contexto: ContextoPeticion,
    transaction: Transaction,
  ): Promise<LogSeguridad>;
  registrar(
    usuarioId: number | null,
    evento: string,
    detalles?: string | object,
    contexto: ContextoPeticion = {},
    transaction?: Transaction,
  ): Promise<LogSeguridad> {
    const datos = {
      usuario_id: usuarioId,
      evento,
      detalles: detalles === undefined || detalles === '' ? null : typeof detalles === 'string' ? detalles : JSON.stringify(detalles),
      ip: contexto.ip ?? null,
      user_agent: contexto.userAgent ?? null,
    };
    return transaction ? this.create(datos, transaction) : this.create(datos);
  }
}

export const logSeguridadRepository = new LogSeguridadRepository();
