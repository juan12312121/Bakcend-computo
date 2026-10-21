import { ForbiddenError } from '../../core/errors';
import type { Grupo, GrupoMiembro } from '../../infrastructure/database/models';
import { realtime, salas, type RealtimeGateway } from '../../infrastructure/realtime/RealtimeGateway';
import { miembroChatGrupoRepository, type MiembroChatGrupoRepository } from '../chat-grupo/miembro-chat-grupo.repository';
import { grupoRepository, type GrupoRepository } from '../grupos/grupo.repository';

export interface MiembroDelGrupo {
  grupo: Grupo;
  membresia: GrupoMiembro;
  /** admin o moderador del grupo. */
  moderador: boolean;
}

/** Aviso a la sala del grupo cuando cambia su carpeta compartida: { grupo_id, carpeta_id, accion, por_usuario_id }. */
export const EVENTO_ARCHIVOS_GRUPO = 'archivos_grupo_actualizado';

export type AccionArchivos = 'carpeta_creada' | 'carpeta_actualizada' | 'carpeta_eliminada' | 'archivo_subido' | 'archivo_actualizado' | 'archivo_eliminado';

/** Guardia común de carpetas y archivos: solo miembros activos; modificar = autor o admin/moderador. */
export class AccesoArchivosGrupo {
  constructor(
    private readonly grupos: GrupoRepository,
    private readonly miembros: MiembroChatGrupoRepository,
    private readonly tiempoReal: RealtimeGateway,
  ) {}

  /** 404 si el grupo no existe; 403 si no es miembro activo. */
  async exigirMiembro(grupoId: number, usuarioId: number): Promise<MiembroDelGrupo> {
    const grupo = await this.grupos.findByIdOrFail(grupoId);
    const membresia = await this.miembros.activa(grupoId, usuarioId);
    if (!membresia) throw new ForbiddenError('Solo los miembros del grupo pueden usar sus archivos');
    return { grupo, membresia, moderador: membresia.rol === 'admin' || membresia.rol === 'moderador' };
  }

  puedeModificar(autorId: number, usuarioId: number, miembro: MiembroDelGrupo): boolean {
    return autorId === usuarioId || miembro.moderador;
  }

  exigirAutorOModerador(autorId: number, usuarioId: number, miembro: MiembroDelGrupo, mensaje: string): void {
    if (!this.puedeModificar(autorId, usuarioId, miembro)) throw new ForbiddenError(mensaje);
  }

  idsMiembros(grupoId: number): Promise<number[]> {
    return this.miembros.idsActivos(grupoId);
  }

  avisar(grupoId: number, carpetaId: number | null, accion: AccionArchivos, usuarioId: number): void {
    this.tiempoReal.aSala(salas.grupo(grupoId), EVENTO_ARCHIVOS_GRUPO, { grupo_id: grupoId, carpeta_id: carpetaId, accion, por_usuario_id: usuarioId });
  }
}

export const accesoArchivosGrupo = new AccesoArchivosGrupo(grupoRepository, miembroChatGrupoRepository, realtime);
