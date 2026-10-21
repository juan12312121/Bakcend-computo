import type { Transaction } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Grupo, Llamada, LlamadaParticipante, Usuario, type EstadoParticipante } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** Datos del grupo que viajan con una llamada o una transmisión. */
export const ATRIBUTOS_GRUPO_LLAMADA = ['id', 'nombre', 'imagen_url', 'tipo'] as const;

export class LlamadaRepository extends BaseRepository<Llamada> {
  protected readonly entidad = 'Llamada';

  constructor() {
    super(Llamada);
  }

  protected override opcionesPorDefecto() {
    return {
      include: [
        { model: Usuario, as: 'iniciador', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
        { model: Usuario, as: 'destinatario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO], required: false },
        { model: Grupo, as: 'grupo', attributes: [...ATRIBUTOS_GRUPO_LLAMADA], required: false },
      ],
    };
  }

  /**
   * Llamadas donde participé (hice o recibí), la más reciente primero, con MI fila de participante.
   * `soloPerdidas`: las que me sonaron y no contesté.
   */
  historialDe(usuarioId: number, paginacion: Paginacion, soloPerdidas: boolean): Promise<Page<Llamada>> {
    return this.paginate({}, paginacion, {
      include: [
        ...this.opcionesPorDefecto().include,
        {
          model: LlamadaParticipante,
          as: 'participantes',
          attributes: ['usuario_id', 'estado', 'unido_en', 'salio_en'],
          where: { usuario_id: usuarioId, ...(soloPerdidas ? { estado: 'perdida' } : {}) },
          required: true,
        },
      ],
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ],
    });
  }

  /** Al arrancar el servidor: lo que quedó "sonando" o "en curso" de la vez anterior ya no existe. */
  async cerrarHuerfanas(ahora: Date = new Date()): Promise<number> {
    const [sinContestar] = await Llamada.update({ estado: 'perdida', fin: ahora }, { where: { estado: 'sonando' } });
    const [enCurso] = await Llamada.update({ estado: 'terminada', fin: ahora }, { where: { estado: 'en_curso' } });
    await LlamadaParticipante.update({ estado: 'perdida' }, { where: { estado: 'invitado' } });
    await LlamadaParticipante.update({ estado: 'salio', salio_en: ahora }, { where: { estado: 'unido' } });
    return sinContestar + enCurso;
  }
}

export class LlamadaParticipanteRepository extends BaseRepository<LlamadaParticipante> {
  protected readonly entidad = 'Participante';

  constructor() {
    super(LlamadaParticipante);
  }

  de(llamadaId: number, usuarioId: number): Promise<LlamadaParticipante | null> {
    return this.findOne({ llamada_id: llamadaId, usuario_id: usuarioId });
  }

  /** Cambia el estado de una persona (crea su fila si entró sin invitación, p. ej. a la llamada de su grupo). */
  async marcar(llamadaId: number, usuarioId: number, estado: EstadoParticipante, ahora: Date = new Date()): Promise<void> {
    const fila = await this.de(llamadaId, usuarioId);
    const cambios = {
      estado,
      ...(estado === 'unido' ? { unido_en: fila?.unido_en ?? ahora, salio_en: null } : {}),
      ...(estado === 'salio' ? { salio_en: ahora } : {}),
    };
    if (fila) await this.update(fila, cambios);
    else await this.create({ llamada_id: llamadaId, usuario_id: usuarioId, ...cambios });
  }

  /** Al terminar: los que seguían sonando → perdida; los que seguían dentro → salio. */
  async cerrarTodos(llamadaId: number, ahora: Date, transaction?: Transaction): Promise<void> {
    await LlamadaParticipante.update({ estado: 'perdida' }, { where: { llamada_id: llamadaId, estado: 'invitado' }, transaction });
    await LlamadaParticipante.update({ estado: 'salio', salio_en: ahora }, { where: { llamada_id: llamadaId, estado: 'unido' }, transaction });
  }
}

export const llamadaRepository = new LlamadaRepository();
export const llamadaParticipanteRepository = new LlamadaParticipanteRepository();
