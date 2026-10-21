import type { Model } from 'sequelize';
import { ForbiddenError } from '../errors';
import type { BaseRepository } from './BaseRepository';

/**
 * Servicio base: reglas de negocio comunes a todos los módulos.
 * Cada servicio concreto recibe su repositorio por constructor (inyección de dependencias),
 * así se puede probar con un repositorio falso.
 */
export abstract class BaseService<M extends Model, R extends BaseRepository<M> = BaseRepository<M>> {
  constructor(protected readonly repository: R) {}

  obtener(id: number): Promise<M> {
    return this.repository.findByIdOrFail(id);
  }

  /** Lanza 403 si el registro no pertenece al usuario (o si no es admin cuando se indica). */
  protected asegurarDueno(duenoId: number, usuarioId: number): void;
  protected asegurarDueno(duenoId: number, usuarioId: number, mensaje: string): void;
  protected asegurarDueno(duenoId: number, usuarioId: number, mensaje = 'No tienes permiso para modificar este recurso'): void {
    if (duenoId !== usuarioId) throw new ForbiddenError(mensaje);
  }
}
