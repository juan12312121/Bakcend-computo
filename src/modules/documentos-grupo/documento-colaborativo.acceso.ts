import { ForbiddenError } from '../../core/errors';
import type { DocumentoColaborativo } from '../../infrastructure/database/models';
import { miembroChatGrupoRepository, type MiembroChatGrupoRepository } from '../chat-grupo/miembro-chat-grupo.repository';
import { documentoPermisoRepository, type DocumentoPermisoRepository } from './documento-colaborativo.repository';

/** Papel de quien abre el documento. */
export type RolDocumento = 'propietario' | 'moderador' | 'miembro' | 'editor' | 'lector';

/**
 * Qué puede hacer un usuario con un documento:
 * - ver: abrirlo y leerlo · editar: escribir, renombrar y guardar versiones
 * - administrar: papelera, restaurar y borrar · compartir: dar o quitar permisos (solo personales).
 */
export interface AccesoDocumento {
  rol: RolDocumento | null;
  ver: boolean;
  editar: boolean;
  administrar: boolean;
  compartir: boolean;
}

export type NivelDocumento = 'ver' | 'editar' | 'administrar' | 'compartir';

const SIN_ACCESO: AccesoDocumento = { rol: null, ver: false, editar: false, administrar: false, compartir: false };

const MENSAJES: Record<NivelDocumento, string> = {
  ver: 'No tienes acceso a este documento',
  editar: 'Solo puedes leer este documento',
  administrar: 'Solo el dueño del documento o un admin/moderador del grupo puede hacer esto',
  compartir: 'Solo el dueño puede compartir este documento',
};

/**
 * Reglas de acceso:
 * - De un grupo: solo sus miembros activos lo ven y editan; su creador y los admin/moderadores lo administran.
 * - Personal: el dueño hace todo; con quien lo compartió, según el permiso ('ver' o 'editar').
 */
export class AccesoDocumentos {
  constructor(
    private readonly miembros: MiembroChatGrupoRepository,
    private readonly permisos: DocumentoPermisoRepository,
  ) {}

  async de(documento: DocumentoColaborativo, usuarioId: number): Promise<AccesoDocumento> {
    const esDueno = documento.propietario_id === usuarioId;
    if (documento.grupo_id) {
      const membresia = await this.miembros.activa(documento.grupo_id, usuarioId);
      if (!membresia) return SIN_ACCESO;
      const moderador = membresia.rol === 'admin' || membresia.rol === 'moderador';
      const rol: RolDocumento = esDueno ? 'propietario' : moderador ? 'moderador' : 'miembro';
      return { rol, ver: true, editar: true, administrar: esDueno || moderador, compartir: false };
    }
    if (esDueno) return { rol: 'propietario', ver: true, editar: true, administrar: true, compartir: true };
    const permiso = await this.permisos.de(documento.id, usuarioId);
    if (!permiso) return SIN_ACCESO;
    const editar = permiso.permiso === 'editar';
    return { rol: editar ? 'editor' : 'lector', ver: true, editar, administrar: false, compartir: false };
  }

  /** 403 si no llega al nivel pedido. */
  async exigir(documento: DocumentoColaborativo, usuarioId: number, nivel: NivelDocumento): Promise<AccesoDocumento> {
    const acceso = await this.de(documento, usuarioId);
    if (!acceso.ver) throw new ForbiddenError(MENSAJES.ver);
    if (!acceso[nivel]) throw new ForbiddenError(MENSAJES[nivel]);
    return acceso;
  }
}

export const accesoDocumentos = new AccesoDocumentos(miembroChatGrupoRepository, documentoPermisoRepository);
