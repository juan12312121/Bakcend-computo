import { Op, type Transaction } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Seguidor, Usuario, type EstadoSeguimiento } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** Lado de la relación que se lista: quienes siguen al usuario o a quienes sigue. */
export type LadoRelacion = 'seguidores' | 'seguidos';

/** Usuario del otro lado de la relación y desde cuándo existe. */
export interface UsuarioRelacionado {
  usuario: Usuario;
  desde: Date;
}

export interface OpcionesListado {
  /** 'aceptado' (por defecto) para seguidores/seguidos; 'pendiente' para las solicitudes. */
  estado?: EstadoSeguimiento;
  /** Ids que no deben aparecer (p. ej. bloqueados de quien consulta). */
  excluir?: number[];
}

export class SeguidorRepository extends BaseRepository<Seguidor> {
  protected readonly entidad = 'Seguimiento';

  constructor() {
    super(Seguidor);
  }

  /** Relación "seguidorId sigue a seguidoId" en cualquier estado (opcionalmente dentro de una transacción). */
  relacion(seguidorId: number, seguidoId: number): Promise<Seguidor | null>;
  relacion(seguidorId: number, seguidoId: number, transaction: Transaction): Promise<Seguidor | null>;
  relacion(seguidorId: number, seguidoId: number, transaction?: Transaction): Promise<Seguidor | null> {
    return Seguidor.findOne({ where: { seguidor_id: seguidorId, siguiendo_id: seguidoId }, transaction });
  }

  /**
   * Página de usuarios de un lado de la relación (solo cuentas activas), con la fecha en que empezó.
   * No usa include: el alias de asociación "seguidor" choca con el alias de tabla "Seguidor" en
   * motores que no distinguen mayúsculas (SQLite, MySQL en Windows) → "ambiguous column".
   */
  paginarUsuarios(usuarioId: number, lado: LadoRelacion, paginacion: Paginacion): Promise<Page<UsuarioRelacionado>>;
  paginarUsuarios(usuarioId: number, lado: LadoRelacion, paginacion: Paginacion, opciones: OpcionesListado): Promise<Page<UsuarioRelacionado>>;
  async paginarUsuarios(
    usuarioId: number,
    lado: LadoRelacion,
    paginacion: Paginacion,
    { estado = 'aceptado', excluir = [] }: OpcionesListado = {},
  ): Promise<Page<UsuarioRelacionado>> {
    const inactivos = (await Usuario.findAll({ where: { activo: false }, attributes: ['id'] })).map((u) => u.id);
    const fuera = [...inactivos, ...excluir];
    const hayFuera = fuera.length > 0;
    const where =
      lado === 'seguidores'
        ? { siguiendo_id: usuarioId, estado, ...(hayFuera && { seguidor_id: { [Op.notIn]: fuera } }) }
        : { seguidor_id: usuarioId, estado, ...(hayFuera && { siguiendo_id: { [Op.notIn]: fuera } }) };

    const page = await this.paginate(where, paginacion, {
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ],
    });
    const otroId = (rel: Seguidor) => (lado === 'seguidores' ? rel.seguidor_id : rel.siguiendo_id);
    const usuarios = await Usuario.findAll({
      where: { id: { [Op.in]: page.items.map(otroId) } },
      attributes: [...ATRIBUTOS_USUARIO_PUBLICO],
    });
    const porId = new Map(usuarios.map((u) => [u.id, u]));

    return {
      ...page,
      items: page.items
        .filter((rel) => porId.has(otroId(rel)))
        .map((rel) => ({ usuario: porId.get(otroId(rel))!, desde: rel.fecha_creacion })),
    };
  }

  /** De la lista `ids`, a cuáles sigue `seguidorId` con el estado indicado (por defecto, 'aceptado'). */
  seguidosEntre(seguidorId: number, ids: number[]): Promise<Set<number>>;
  seguidosEntre(seguidorId: number, ids: number[], estado: EstadoSeguimiento): Promise<Set<number>>;
  async seguidosEntre(seguidorId: number, ids: number[], estado: EstadoSeguimiento = 'aceptado'): Promise<Set<number>> {
    if (!ids.length) return new Set();
    const filas = await Seguidor.findAll({
      where: { seguidor_id: seguidorId, siguiendo_id: { [Op.in]: ids }, estado },
      attributes: ['siguiendo_id'],
    });
    return new Set(filas.map((f) => f.siguiendo_id));
  }

  /** Solo cuentan las relaciones aceptadas. */
  async contar(usuarioId: number): Promise<{ seguidores: number; seguidos: number }> {
    const [seguidores, seguidos] = await Promise.all([
      this.count({ siguiendo_id: usuarioId, estado: 'aceptado' }),
      this.count({ seguidor_id: usuarioId, estado: 'aceptado' }),
    ]);
    return { seguidores, seguidos };
  }

  /** Solicitudes pendientes que recibió el usuario (para aceptarlas todas al volver pública la cuenta). */
  pendientesDe(usuarioId: number, transaction: Transaction): Promise<Seguidor[]> {
    return Seguidor.findAll({ where: { siguiendo_id: usuarioId, estado: 'pendiente' }, transaction });
  }

  /**
   * Mantiene total_siguiendo (de quien sigue) y total_seguidores (del seguido) dentro de la
   * misma transacción que crea/borra la relación. Sin la transacción, en MySQL el UPDATE de
   * usuarios esperaría el bloqueo que la llave foránea de `seguidores` deja sobre esas filas.
   * Solo se llama para relaciones aceptadas (las pendientes no cuentan).
   */
  async ajustarContadores(seguidorId: number, seguidoId: number, delta: 1 | -1, transaction: Transaction): Promise<void> {
    const cambios: [number, 'total_siguiendo' | 'total_seguidores'][] = [
      [seguidorId, 'total_siguiendo'],
      [seguidoId, 'total_seguidores'],
    ];
    for (const [id, campo] of cambios) {
      if (delta > 0) await Usuario.increment(campo, { by: 1, where: { id }, transaction });
      else await Usuario.decrement(campo, { by: 1, where: { id, [campo]: { [Op.gt]: 0 } }, transaction });
    }
  }

  /** Borra la relación y, si estaba aceptada, descuenta los contadores. Devuelve la que había (o null). */
  async quitar(seguidorId: number, seguidoId: number, transaction: Transaction): Promise<Seguidor | null> {
    const relacion = await this.relacion(seguidorId, seguidoId, transaction);
    if (!relacion) return null;
    await this.delete({ id: relacion.id }, transaction);
    if (relacion.estado === 'aceptado') await this.ajustarContadores(seguidorId, seguidoId, -1, transaction);
    return relacion;
  }
}

export const seguidorRepository = new SeguidorRepository();
