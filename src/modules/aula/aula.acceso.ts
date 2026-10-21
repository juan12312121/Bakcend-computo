import { Op } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import { ForbiddenError } from '../../core/errors';
import { GrupoMiembro, Usuario, type Grupo } from '../../infrastructure/database/models';
import { grupoRepository, type GrupoRepository } from '../grupos/grupo.repository';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** En el aula de un grupo: admin/moderador = maestro; miembro activo = alumno. */
export type RolAula = 'maestro' | 'alumno';

export interface MiembroAula {
  grupo: Grupo;
  rol: RolAula;
}

/** Usuario público (las columnas de ATRIBUTOS_USUARIO_PUBLICO). */
export type UsuarioPublico = Pick<Usuario, (typeof ATRIBUTOS_USUARIO_PUBLICO)[number]>;

export const MENSAJES_AULA = {
  miembro: 'Solo los miembros del grupo pueden ver su aula',
  maestro: 'Solo los administradores o moderadores del grupo (maestros) pueden hacer esto',
  alumno: 'Solo los alumnos (miembros del grupo) entregan tareas',
} as const;

const ROLES_MAESTRO = ['admin', 'moderador'] as const;

/** Membresías activas vistas como maestro / alumno. */
export class MiembrosAulaRepository extends BaseRepository<GrupoMiembro> {
  protected readonly entidad = 'Membresía';

  constructor() {
    super(GrupoMiembro);
  }

  /** Rol en el aula o null si no es miembro activo. */
  async rolDe(grupoId: number, usuarioId: number): Promise<RolAula | null> {
    const membresia = await this.findOne({ grupo_id: grupoId, usuario_id: usuarioId, estado: 'activo' }, { attributes: ['rol'] });
    if (!membresia) return null;
    return (ROLES_MAESTRO as readonly string[]).includes(membresia.rol ?? 'miembro') ? 'maestro' : 'alumno';
  }

  /** Alumnos del grupo (miembros activos que no son admin ni moderador), por nombre. */
  async alumnos(grupoId: number): Promise<UsuarioPublico[]> {
    const filas = await this.findAll(
      { grupo_id: grupoId, estado: 'activo', rol: { [Op.notIn]: [...ROLES_MAESTRO] } },
      { include: [{ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO], required: true }] },
    );
    return filas
      .map((m) => m.usuario?.get({ plain: true }) as UsuarioPublico)
      .sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo, 'es'));
  }

  /** Ids de los alumnos activos. */
  async idsAlumnos(grupoId: number): Promise<number[]> {
    const filas = await this.findAll({ grupo_id: grupoId, estado: 'activo', rol: { [Op.notIn]: [...ROLES_MAESTRO] } }, { attributes: ['usuario_id'] });
    return filas.map((m) => m.usuario_id);
  }
}

/** Guardia del aula de un grupo: carga el grupo (404) y exige ser miembro activo / maestro / alumno (403). */
export class AccesoAula {
  constructor(
    private readonly grupos: GrupoRepository,
    readonly miembros: MiembrosAulaRepository,
  ) {}

  rolDe(grupoId: number, usuarioId: number): Promise<RolAula | null> {
    return this.miembros.rolDe(grupoId, usuarioId);
  }

  exigirMiembro(grupoId: number, usuarioId: number): Promise<MiembroAula>;
  exigirMiembro(grupoId: number, usuarioId: number, rol: RolAula): Promise<MiembroAula>;
  async exigirMiembro(grupoId: number, usuarioId: number, rolPedido?: RolAula): Promise<MiembroAula> {
    const grupo = await this.grupos.findByIdOrFail(grupoId, { include: [] });
    const rol = await this.rolDe(grupoId, usuarioId);
    if (!rol) throw new ForbiddenError(MENSAJES_AULA.miembro);
    if (rolPedido && rol !== rolPedido) throw new ForbiddenError(MENSAJES_AULA[rolPedido]);
    return { grupo, rol };
  }

  exigirMaestro(grupoId: number, usuarioId: number): Promise<MiembroAula> {
    return this.exigirMiembro(grupoId, usuarioId, 'maestro');
  }
}

export const miembrosAulaRepository = new MiembrosAulaRepository();
export const accesoAula = new AccesoAula(grupoRepository, miembrosAulaRepository);
