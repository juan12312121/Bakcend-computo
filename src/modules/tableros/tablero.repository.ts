import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import { NotFoundError } from '../../core/errors';
import {
  EtiquetaTablero,
  Grupo,
  Tablero,
  TableroColumna,
  TableroMiembro,
  Usuario,
  type RolGrupo,
  type RolTablero,
} from '../../infrastructure/database/models';
import { grupoMiembroRepository, type GrupoMiembroRepository } from '../grupos/grupo-miembro.repository';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';
import { calcularAcceso, type AccesoTablero } from './tablero.permisos';

/** Usuario público embebido en miembros, responsables, comentarios... */
export const incluirUsuario = (as: string) => ({ model: Usuario, as, attributes: [...ATRIBUTOS_USUARIO_PUBLICO] });

/** Desde dónde puede ver tableros un usuario: sus membresías directas y sus grupos activos (con su rol). */
export interface ContextoUsuario {
  rolesTablero: Map<number, RolTablero>;
  rolesGrupo: Map<number, RolGrupo>;
}

export interface FiltroListado {
  grupo_id?: number;
  archivados?: boolean;
}

export class TableroMiembroRepository extends BaseRepository<TableroMiembro> {
  protected readonly entidad = 'Miembro del tablero';

  constructor() {
    super(TableroMiembro);
  }

  membresia(tableroId: number, usuarioId: number): Promise<TableroMiembro | null> {
    return this.findOne({ tablero_id: tableroId, usuario_id: usuarioId });
  }

  /** Miembros con su usuario público, en orden de llegada. */
  delTablero(tableroId: number): Promise<TableroMiembro[]> {
    return this.findAll({ tablero_id: tableroId }, { include: [incluirUsuario('usuario')], order: [['id', 'ASC']] });
  }
}

export class TableroRepository extends BaseRepository<Tablero> {
  protected readonly entidad = 'Tablero';

  constructor(
    private readonly miembros: TableroMiembroRepository,
    private readonly grupoMiembros: GrupoMiembroRepository,
  ) {
    super(Tablero);
  }

  /** Permisos del usuario en un tablero (por id o ya cargado). */
  async acceso(tablero: Tablero, usuarioId: number): Promise<AccesoTablero> {
    const [miembro, grupo] = await Promise.all([
      this.miembros.membresia(tablero.id, usuarioId),
      tablero.grupo_id ? this.grupoMiembros.findOne({ grupo_id: tablero.grupo_id, usuario_id: usuarioId, estado: 'activo' }) : null,
    ]);
    return calcularAcceso(tablero, usuarioId, miembro?.rol ?? null, grupo?.rol ?? null);
  }

  /** Lo usa la sala de Socket.IO `join_board`: false si no existe o no tiene acceso. */
  async puedeVer(tableroId: number, usuarioId: number): Promise<boolean> {
    const tablero = await this.findById(tableroId);
    return !!tablero && (await this.acceso(tablero, usuarioId)).ver;
  }

  async contextoDe(usuarioId: number): Promise<ContextoUsuario> {
    const [membresias, grupos] = await Promise.all([
      this.miembros.findAll({ usuario_id: usuarioId }, { attributes: ['tablero_id', 'rol'] }),
      this.grupoMiembros.findAll({ usuario_id: usuarioId, estado: 'activo' }, { attributes: ['grupo_id', 'rol'] }),
    ]);
    return {
      rolesTablero: new Map(membresias.map((m) => [m.tablero_id, m.rol])),
      rolesGrupo: new Map(grupos.map((g) => [g.grupo_id, g.rol ?? 'miembro'])),
    };
  }

  /** Condición "tableros que este usuario puede ver". */
  alcance(contexto: ContextoUsuario): WhereOptions<Tablero> {
    return { [Op.or]: [{ id: { [Op.in]: [...contexto.rolesTablero.keys()] } }, { grupo_id: { [Op.in]: [...contexto.rolesGrupo.keys()] } }] };
  }

  /** Tableros visibles (personales donde soy miembro + los de mis grupos), más recientes primero. */
  visibles(contexto: ContextoUsuario, { grupo_id, archivados = false }: FiltroListado = {}): Promise<Tablero[]> {
    const condiciones: WhereOptions<Tablero>[] = [this.alcance(contexto), { archivado: archivados }];
    if (grupo_id) condiciones.push({ grupo_id });
    return this.findAll(
      { [Op.and]: condiciones },
      {
        include: [
          { model: Grupo, as: 'grupo', attributes: ['id', 'nombre', 'imagen_url'] },
          { model: TableroMiembro, as: 'miembros', include: [incluirUsuario('usuario')] },
        ],
        order: [
          ['fecha_actualizacion', 'DESC'],
          ['id', 'DESC'],
        ],
      },
    );
  }

  /** Detalle con grupo y creador. */
  conRelaciones(id: number): Promise<Tablero> {
    return this.findByIdOrFail(id, {
      include: [{ model: Grupo, as: 'grupo', attributes: ['id', 'nombre', 'imagen_url'] }, incluirUsuario('creador')],
    });
  }

  /** Suma 1 al contador del tablero y devuelve el número para la tarea nueva (dentro de la transacción). */
  async siguienteNumero(tableroId: number, transaction: Transaction): Promise<number> {
    await Tablero.increment('contador_tareas', { by: 1, where: { id: tableroId }, transaction });
    const tablero = await Tablero.findByPk(tableroId, { attributes: ['contador_tareas'], transaction });
    if (!tablero) throw new NotFoundError(this.entidad);
    return tablero.contador_tareas;
  }

  /** Marca el tablero como modificado (para ordenar "recientes"). */
  async tocar(tableroId: number): Promise<void> {
    await Tablero.update({ fecha_actualizacion: new Date() }, { where: { id: tableroId } });
  }
}

export class ColumnaRepository extends BaseRepository<TableroColumna> {
  protected readonly entidad = 'Columna';

  constructor() {
    super(TableroColumna);
  }

  delTablero(tableroId: number): Promise<TableroColumna[]>;
  delTablero(tableroId: number, transaction: Transaction): Promise<TableroColumna[]>;
  delTablero(tableroId: number, transaction?: Transaction): Promise<TableroColumna[]> {
    return TableroColumna.findAll({
      where: { tablero_id: tableroId },
      order: [
        ['posicion', 'ASC'],
        ['id', 'ASC'],
      ],
      transaction,
    });
  }

  /** Columna de ESE tablero; 404 si no existe o es de otro. */
  async delTableroOrFail(id: number, tableroId: number): Promise<TableroColumna> {
    const columna = await this.findOne({ id, tablero_id: tableroId });
    if (!columna) throw new NotFoundError(this.entidad, 'La columna no existe en este tablero');
    return columna;
  }

  async siguientePosicion(tableroId: number): Promise<number> {
    const maxima = await TableroColumna.max<number | null, TableroColumna>('posicion', { where: { tablero_id: tableroId } });
    return (maxima ?? -1) + 1;
  }
}

export class EtiquetaRepository extends BaseRepository<EtiquetaTablero> {
  protected readonly entidad = 'Etiqueta';

  constructor() {
    super(EtiquetaTablero);
  }

  delTablero(tableroId: number): Promise<EtiquetaTablero[]> {
    return this.findAll({ tablero_id: tableroId }, { order: [['nombre', 'ASC']] });
  }

  async delTableroOrFail(id: number, tableroId: number): Promise<EtiquetaTablero> {
    const etiqueta = await this.findOne({ id, tablero_id: tableroId });
    if (!etiqueta) throw new NotFoundError(this.entidad, 'La etiqueta no existe en este tablero');
    return etiqueta;
  }
}

export const tableroMiembroRepository = new TableroMiembroRepository();
export const tableroRepository = new TableroRepository(tableroMiembroRepository, grupoMiembroRepository);
export const columnaRepository = new ColumnaRepository();
export const etiquetaRepository = new EtiquetaRepository();
