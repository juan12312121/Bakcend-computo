import { BaseRepository } from '../../core/domain/BaseRepository';
import { Grupo, GrupoMiembro } from '../../infrastructure/database/models';

/** Columnas del grupo que acompañan al resumen de su chat. */
export const ATRIBUTOS_GRUPO_CHAT = ['id', 'nombre', 'imagen_url', 'tipo', 'privacidad', 'mensajes_temporales'] as const;

/** Membresías vistas desde el chat de grupo: solo cuentan los miembros con estado "activo". */
export class MiembroChatGrupoRepository extends BaseRepository<GrupoMiembro> {
  protected readonly entidad = 'Membresía';

  constructor() {
    super(GrupoMiembro);
  }

  activa(grupoId: number, usuarioId: number): Promise<GrupoMiembro | null> {
    return this.findOne({ grupo_id: grupoId, usuario_id: usuarioId, estado: 'activo' });
  }

  /** Ids de los miembros activos (destinatarios de los mensajes del grupo). */
  async idsActivos(grupoId: number): Promise<number[]> {
    const filas = await this.findAll({ grupo_id: grupoId, estado: 'activo' }, { attributes: ['usuario_id'] });
    return filas.map((m) => m.usuario_id);
  }

  /** Mis membresías activas con los datos básicos de cada grupo. */
  activasDe(usuarioId: number): Promise<GrupoMiembro[]> {
    return this.findAll(
      { usuario_id: usuarioId, estado: 'activo' },
      { include: [{ model: Grupo, as: 'grupo', attributes: [...ATRIBUTOS_GRUPO_CHAT] }] },
    );
  }
}

export const miembroChatGrupoRepository = new MiembroChatGrupoRepository();
