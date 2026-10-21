import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { BaseRepository, type OpcionesConsulta } from '../../core/domain/BaseRepository';
import { Seguidor, Usuario } from '../../infrastructure/database/models';

/** Campos de un usuario que se pueden mostrar a otros (para includes y listados). */
export const ATRIBUTOS_USUARIO_PUBLICO = ['id', 'nombre_usuario', 'nombre_completo', 'foto_perfil_url', 'carrera'] as const;

/** Minutos sin heartbeat tras los cuales alguien deja de contar como "en línea". */
export const MINUTOS_EN_LINEA = 5;

export class UsuarioRepository extends BaseRepository<Usuario> {
  protected readonly entidad = 'Usuario';

  constructor() {
    super(Usuario);
  }

  /** Solo cuentas habilitadas: una cuenta eliminada (activo = false) es invisible. */
  private static readonly habilitado: WhereOptions<Usuario> = { activo: true };

  override findById(id: number, opciones: OpcionesConsulta<Usuario> = {}): Promise<Usuario | null> {
    return this.findOne({ id, ...UsuarioRepository.habilitado }, opciones);
  }

  buscarPorEmail(email: string): Promise<Usuario | null> {
    return this.findOne({ email });
  }

  /** Para login: acepta email o nombre de usuario. */
  buscarPorCredencial(emailOUsuario: string): Promise<Usuario | null> {
    const valor = emailOUsuario.trim().replace(/^@/, '');
    return this.findOne({ [Op.or]: [{ email: valor }, { nombre_usuario: valor }] });
  }

  async existeEmailOUsuario(email: string, nombreUsuario: string): Promise<'email' | 'nombre_usuario' | null> {
    const existente = await this.findOne({ [Op.or]: [{ email }, { nombre_usuario: nombreUsuario }] });
    if (!existente) return null;
    return existente.email === email ? 'email' : 'nombre_usuario';
  }

  /** Por nombre de usuario, nombre o carrera; `excluir` = ids que no deben salir (bloqueos). */
  buscar(termino: string, limite: number): Promise<Usuario[]>;
  buscar(termino: string, limite: number, excluir: number[]): Promise<Usuario[]>;
  buscar(termino: string, limite: number, excluir: number[] = []): Promise<Usuario[]> {
    const patron = `%${termino.replace(/^@/, '')}%`;
    return this.findAll(
      {
        ...UsuarioRepository.habilitado,
        suspendido: false,
        ...(excluir.length > 0 && { id: { [Op.notIn]: excluir } }),
        [Op.or]: [
          { nombre_usuario: { [Op.like]: patron } },
          { nombre_completo: { [Op.like]: patron } },
          { carrera: { [Op.like]: patron } },
        ],
      },
      { attributes: [...ATRIBUTOS_USUARIO_PUBLICO], limit: limite, order: [['nombre_completo', 'ASC']] },
    );
  }

  private filtroEnLinea(): WhereOptions<Usuario> {
    return {
      ...UsuarioRepository.habilitado,
      suspendido: false,
      en_linea: true,
      ultima_actividad: { [Op.gte]: new Date(Date.now() - MINUTOS_EN_LINEA * 60_000) },
    };
  }

  /** Conectados ahora; `excluir` = ids que no deben salir (bloqueos). */
  enLinea(): Promise<Usuario[]>;
  enLinea(excluir: number[]): Promise<Usuario[]>;
  enLinea(excluir: number[] = []): Promise<Usuario[]> {
    const where = excluir.length > 0 ? { ...this.filtroEnLinea(), id: { [Op.notIn]: excluir } } : this.filtroEnLinea();
    return this.findAll(where, {
      attributes: [...ATRIBUTOS_USUARIO_PUBLICO, 'en_linea', 'ultima_actividad'],
      order: [['nombre_completo', 'ASC']],
    });
  }

  /** Seguidores (aceptados) del usuario que están conectados ahora. */
  async seguidoresEnLinea(usuarioId: number): Promise<Usuario[]> {
    const relaciones = await Seguidor.findAll({ where: { siguiendo_id: usuarioId, estado: 'aceptado' }, attributes: ['seguidor_id'] });
    if (!relaciones.length) return [];
    return this.findAll(
      { ...this.filtroEnLinea(), id: relaciones.map((r) => r.seguidor_id) },
      { attributes: [...ATRIBUTOS_USUARIO_PUBLICO, 'en_linea', 'ultima_actividad'], order: [['nombre_completo', 'ASC']] },
    );
  }

  marcarPresencia(id: number, enLinea: boolean): Promise<[number]> {
    return Usuario.update({ en_linea: enLinea, ultima_actividad: new Date() }, { where: { id } });
  }

  /** Suma o resta a un contador (total_posts, total_seguidores...) sin leer antes el registro. */
  async ajustarContador(
    id: number,
    campo: 'total_posts' | 'total_seguidores' | 'total_siguiendo',
    delta: number,
    transaction?: Transaction,
  ): Promise<void> {
    if (delta > 0) await Usuario.increment(campo, { by: delta, where: { id }, transaction });
    else await Usuario.decrement(campo, { by: -delta, where: { id, [campo]: { [Op.gt]: 0 } }, transaction });
  }
}

export const usuarioRepository = new UsuarioRepository();
