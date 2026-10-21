import { Op, type Attributes, type Order, type Transaction, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Canal, CanalMiembro, Usuario, type RolCanal } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';
import type { DescubrirQuery } from './canal.schemas';

/** Contadores desnormalizados del canal. */
export type ContadorCanal = 'total_suscriptores' | 'total_publicaciones';

const ORDEN_DESCUBRIR: Record<DescubrirQuery['orden'], Order> = {
  populares: [['total_suscriptores', 'DESC'], ['id', 'DESC']],
  recientes: [['ultima_publicacion_en', 'DESC'], ['id', 'DESC']],
};

export class CanalRepository extends BaseRepository<Canal> {
  protected readonly entidad = 'Canal';

  constructor() {
    super(Canal);
  }

  /** Un canal siempre viaja con los datos públicos de quien lo creó. */
  protected override opcionesPorDefecto() {
    return { include: [{ model: Usuario, as: 'creador', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }] };
  }

  /** Canales públicos, con búsqueda por nombre/descripción y orden por populares o actividad reciente. */
  descubrir({ q, orden }: Pick<DescubrirQuery, 'q' | 'orden'>, paginacion: Paginacion): Promise<Page<Canal>> {
    const where: WhereOptions<Attributes<Canal>> = q
      ? { privacidad: 'publico', [Op.or]: [{ nombre: { [Op.like]: `%${q}%` } }, { descripcion: { [Op.like]: `%${q}%` } }] }
      : { privacidad: 'publico' };
    return this.paginate(where, paginacion, { order: ORDEN_DESCUBRIR[orden] });
  }

  porCodigo(codigo: string): Promise<Canal | null> {
    return this.findOne({ codigo_invitacion: codigo });
  }

  /** Suma o resta a un contador sin bajar de 0. */
  async ajustarContador(id: number, campo: ContadorCanal, delta: number, transaction?: Transaction): Promise<void> {
    if (delta > 0) await Canal.increment(campo, { by: delta, where: { id }, transaction });
    else if (delta < 0) {
      const where = { id, [campo]: { [Op.gte]: -delta } } as WhereOptions<Attributes<Canal>>;
      await Canal.decrement(campo, { by: -delta, where, transaction });
    }
  }
}

export class CanalMiembroRepository extends BaseRepository<CanalMiembro> {
  protected readonly entidad = 'Suscripción';

  constructor() {
    super(CanalMiembro);
  }

  de(canalId: number, usuarioId: number): Promise<CanalMiembro | null> {
    return this.findOne({ canal_id: canalId, usuario_id: usuarioId });
  }

  /** Mis membresías en varios canales (canal → membresía). */
  async porCanal(canalIds: readonly number[], usuarioId: number): Promise<Map<number, CanalMiembro>> {
    if (!canalIds.length) return new Map();
    const filas = await this.findAll({ canal_id: [...canalIds], usuario_id: usuarioId });
    return new Map(filas.map((m) => [m.canal_id, m]));
  }

  /** Mis canales (cualquier rol) con el canal incluido, el de publicación más reciente primero. */
  mios(usuarioId: number, paginacion: Paginacion): Promise<Page<CanalMiembro>> {
    return this.paginate({ usuario_id: usuarioId }, paginacion, {
      include: [
        {
          model: Canal,
          as: 'canal',
          required: true,
          include: [{ model: Usuario, as: 'creador', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
        },
      ],
      order: [
        [{ model: Canal, as: 'canal' }, 'ultima_publicacion_en', 'DESC'],
        ['id', 'DESC'],
      ],
    });
  }

  /** A quién avisar de una publicación: miembros que no lo silenciaron, salvo `exceptoId`. */
  async idsParaAvisar(canalId: number, exceptoId: number): Promise<number[]> {
    const filas = await this.findAll(
      { canal_id: canalId, silenciado: false, usuario_id: { [Op.ne]: exceptoId } },
      { attributes: ['usuario_id'], order: [['id', 'ASC']] },
    );
    return filas.map((m) => m.usuario_id);
  }

  /** Propietario y administradores con sus datos públicos. */
  administradores(canalId: number): Promise<CanalMiembro[]> {
    const roles: RolCanal[] = ['propietario', 'admin'];
    return this.findAll(
      { canal_id: canalId, rol: roles },
      { include: [{ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }], order: [['id', 'ASC']] },
    );
  }

  /** Todos los miembros (para elegir administradores), los más antiguos primero. */
  miembros(canalId: number, paginacion: Paginacion): Promise<Page<CanalMiembro>> {
    return this.paginate({ canal_id: canalId }, paginacion, {
      include: [{ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
      order: [['id', 'ASC']],
    });
  }
}

export const canalRepository = new CanalRepository();
export const canalMiembroRepository = new CanalMiembroRepository();
