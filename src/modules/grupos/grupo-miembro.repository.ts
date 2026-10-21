import type { Transaction } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import { GrupoMiembro } from '../../infrastructure/database/models';

export class GrupoMiembroRepository extends BaseRepository<GrupoMiembro> {
  protected readonly entidad = 'Membresía';

  constructor() {
    super(GrupoMiembro);
  }

  membresia(grupoId: number, usuarioId: number): Promise<GrupoMiembro | null> {
    return this.findOne({ grupo_id: grupoId, usuario_id: usuarioId });
  }

  /** Membresías del usuario en varios grupos, indexadas por grupo. */
  async membresiasPorGrupo(grupoIds: number[], usuarioId: number): Promise<Map<number, GrupoMiembro>> {
    if (!grupoIds.length) return new Map();
    const filas = await this.findAll({ grupo_id: grupoIds, usuario_id: usuarioId });
    return new Map(filas.map((m) => [m.grupo_id, m]));
  }

  async esMiembroActivo(grupoId: number, usuarioId?: number): Promise<boolean> {
    if (!usuarioId) return false;
    return this.exists({ grupo_id: grupoId, usuario_id: usuarioId, estado: 'activo' });
  }

  esAdmin(grupoId: number, usuarioId: number): Promise<boolean> {
    return this.exists({ grupo_id: grupoId, usuario_id: usuarioId, estado: 'activo', rol: 'admin' });
  }

  /** Ids de los grupos donde el usuario es miembro activo. */
  async gruposActivosDe(usuarioId: number): Promise<number[]> {
    const filas = await this.findAll({ usuario_id: usuarioId, estado: 'activo' }, { attributes: ['grupo_id'] });
    return filas.map((m) => m.grupo_id);
  }

  /** Miembros activos de un grupo (número) o de varios (mapa grupo → total). */
  contarActivos(grupoId: number): Promise<number>;
  contarActivos(grupoIds: number[]): Promise<Map<number, number>>;
  async contarActivos(objetivo: number | number[]): Promise<number | Map<number, number>> {
    if (typeof objetivo === 'number') return this.count({ grupo_id: objetivo, estado: 'activo' });
    if (!objetivo.length) return new Map();
    const filas = await GrupoMiembro.count({ where: { grupo_id: objetivo, estado: 'activo' }, group: ['grupo_id'] });
    return new Map(filas.map((f) => [Number(f.grupo_id), Number(f.count)]));
  }

  /** Deja al usuario como miembro activo (crea la fila o reactiva una pendiente/rechazada). */
  async activar(grupoId: number, usuarioId: number, transaction?: Transaction): Promise<GrupoMiembro> {
    const existente = await GrupoMiembro.findOne({ where: { grupo_id: grupoId, usuario_id: usuarioId }, transaction });
    if (existente) return this.update(existente, { estado: 'activo' }, transaction);
    return transaction
      ? this.create({ grupo_id: grupoId, usuario_id: usuarioId, rol: 'miembro', estado: 'activo' }, transaction)
      : this.create({ grupo_id: grupoId, usuario_id: usuarioId, rol: 'miembro', estado: 'activo' });
  }
}

export const grupoMiembroRepository = new GrupoMiembroRepository();
