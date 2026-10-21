import { Op, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import { Seguidor, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** Usuarios que se pueden mencionar: cuenta habilitada y no suspendida. */
const MENCIONABLE: WhereOptions<Usuario> = { activo: true, suspendido: false };

export class MencionRepository extends BaseRepository<Usuario> {
  protected readonly entidad = 'Usuario';

  constructor() {
    super(Usuario);
  }

  /** Solo datos públicos en todas las lecturas de este módulo. */
  protected override opcionesPorDefecto() {
    return { attributes: [...ATRIBUTOS_USUARIO_PUBLICO] };
  }

  /** Usuarios mencionables cuyo nombre de usuario está en la lista. */
  activosPorNombre(nombres: string[]): Promise<Usuario[]> {
    if (!nombres.length) return Promise.resolve([]);
    return this.findAll({ ...MENCIONABLE, nombre_usuario: { [Op.in]: nombres } });
  }

  porNombre(nombre: string): Promise<Usuario | null> {
    return this.findOne({ ...MENCIONABLE, nombre_usuario: nombre });
  }

  /** Ids de las cuentas que sigue el usuario (seguimientos aceptados). */
  async idsSeguidos(usuarioId: number): Promise<number[]> {
    const filas = await Seguidor.findAll({ where: { seguidor_id: usuarioId, estado: 'aceptado' }, attributes: ['siguiendo_id'] });
    return filas.map((f) => f.siguiendo_id);
  }

  /**
   * Candidatos para el autocompletado de @: por nombre de usuario que empieza con `q`
   * o nombre completo que lo contiene. `soloIds` limita a esos ids; `excluir` los quita.
   */
  candidatos(q: string, limite: number, { soloIds, excluir = [] }: { soloIds?: number[]; excluir?: number[] }): Promise<Usuario[]> {
    if (soloIds && !soloIds.length) return Promise.resolve([]);
    const condiciones: WhereOptions<Usuario>[] = [MENCIONABLE];
    if (q) {
      condiciones.push({
        [Op.or]: [{ nombre_usuario: { [Op.like]: `${q}%` } }, { nombre_completo: { [Op.like]: `%${q}%` } }],
      });
    }
    if (soloIds) condiciones.push({ id: { [Op.in]: soloIds } });
    if (excluir.length) condiciones.push({ id: { [Op.notIn]: excluir } });
    return this.findAll({ [Op.and]: condiciones }, { limit: limite, order: [['nombre_usuario', 'ASC']] });
  }
}

export const mencionRepository = new MencionRepository();
