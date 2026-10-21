import type { RolGrupo, RolTablero, Tablero } from '../../infrastructure/database/models';

/** Qué puede hacer un usuario en un tablero. */
export interface AccesoTablero {
  /** Miembro del tablero o miembro activo del grupo dueño. */
  ver: boolean;
  /** Ver y no ser observador. */
  editar: boolean;
  /** Admin del tablero, su creador, o admin/moderador del grupo dueño. */
  administrar: boolean;
  /** Rol como miembro del tablero (null si entra solo por el grupo). */
  rol: RolTablero | null;
}

export type NivelAcceso = 'ver' | 'editar' | 'administrar';

/**
 * Regla única de permisos (pura, para reutilizarla con un tablero o con muchos).
 * `rolGrupo` es el rol del usuario en el grupo dueño SOLO si es miembro activo; si no, null.
 */
export function calcularAcceso(
  tablero: Pick<Tablero, 'creador_id' | 'grupo_id'>,
  usuarioId: number,
  rolTablero: RolTablero | null,
  rolGrupo: RolGrupo | null,
): AccesoTablero {
  const grupoActivo = tablero.grupo_id !== null && rolGrupo !== null;
  const ver = rolTablero !== null || grupoActivo;
  const editar = ver && rolTablero !== 'observador';
  const administrar =
    ver && (rolTablero === 'admin' || tablero.creador_id === usuarioId || (grupoActivo && (rolGrupo === 'admin' || rolGrupo === 'moderador')));
  return { ver, editar, administrar, rol: rolTablero };
}

export const MENSAJES_ACCESO: Readonly<Record<NivelAcceso, string>> = {
  ver: 'No tienes acceso a este tablero',
  editar: 'Eres observador: solo puedes ver este tablero',
  administrar: 'Solo los administradores del tablero pueden hacer esto',
};
