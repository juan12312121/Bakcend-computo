import { randomBytes } from 'crypto';
import { Op } from 'sequelize';
import { BaseRepository } from '../../../core/domain/BaseRepository';
import { CalendarioToken, Tablero, Tarea } from '../../../infrastructure/database/models';

/** Tope de tareas por consulta del calendario. */
const MAXIMO_TAREAS = 500;

/** Tarea con su tablero (asociación de models/index.ts). */
export type TareaConTablero = Tarea & { tablero?: Pick<Tablero, 'id' | 'nombre' | 'clave' | 'color'> };

export class CalendarioTokenRepository extends BaseRepository<CalendarioToken> {
  protected readonly entidad = 'Calendario';

  constructor() {
    super(CalendarioToken);
  }

  /** Token secreto nuevo (48 caracteres hexadecimales). */
  static nuevoToken(): string {
    return randomBytes(24).toString('hex');
  }

  /** El token del usuario (lo crea la primera vez). */
  async deUsuario(usuarioId: number): Promise<CalendarioToken> {
    const existente = await this.findOne({ usuario_id: usuarioId });
    return existente ?? this.create({ usuario_id: usuarioId, token: CalendarioTokenRepository.nuevoToken() });
  }

  /** Cambia el token: las suscripciones con el anterior dejan de funcionar. */
  async regenerar(usuarioId: number): Promise<CalendarioToken> {
    const actual = await this.deUsuario(usuarioId);
    return this.update(actual, { token: CalendarioTokenRepository.nuevoToken() });
  }

  porToken(token: string): Promise<CalendarioToken | null> {
    return this.findOne({ token });
  }
}

/** Tareas con fecha límite de los tableros (no archivados) de un grupo. */
export class TareaCalendarioRepository extends BaseRepository<Tarea> {
  protected readonly entidad = 'Tarea';

  constructor() {
    super(Tarea);
  }

  delGrupoEnRango(grupoId: number, desde: Date, hasta: Date): Promise<TareaConTablero[]> {
    return this.findAll(
      { archivada: false, fecha_limite: { [Op.gte]: desde, [Op.lt]: hasta } },
      {
        include: [{ model: Tablero, as: 'tablero', attributes: ['id', 'nombre', 'clave', 'color'], where: { grupo_id: grupoId, archivado: false }, required: true }],
        order: [['fecha_limite', 'ASC']],
        limit: MAXIMO_TAREAS,
      },
    ) as Promise<TareaConTablero[]>;
  }
}

export const calendarioTokenRepository = new CalendarioTokenRepository();
export const tareaCalendarioRepository = new TareaCalendarioRepository();
