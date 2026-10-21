import type { Transaction } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Grupo, Transmision, TransmisionComentario, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_GRUPO_LLAMADA } from '../llamadas/llamada.repository';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** Tope de transmisiones en vivo que se revisan a la vez (en vivo siempre son pocas). */
export const MAXIMO_EN_VIVO = 500;

export class TransmisionRepository extends BaseRepository<Transmision> {
  protected readonly entidad = 'Transmisión';

  constructor() {
    super(Transmision);
  }

  protected override opcionesPorDefecto() {
    return {
      include: [
        // cuenta_privada solo se usa para filtrar; el servicio no la devuelve.
        { model: Usuario, as: 'anfitrion', attributes: [...ATRIBUTOS_USUARIO_PUBLICO, 'cuenta_privada'] },
        { model: Grupo, as: 'grupo', attributes: [...ATRIBUTOS_GRUPO_LLAMADA], required: false },
      ],
    };
  }

  /** Todas las que están en vivo (con filtros opcionales), la más reciente primero. */
  enVivo(filtros: { grupo_id?: number; anfitrion_id?: number } = {}): Promise<Transmision[]> {
    return this.findAll(
      { estado: 'en_vivo', ...(filtros.grupo_id ? { grupo_id: filtros.grupo_id } : {}), ...(filtros.anfitrion_id ? { anfitrion_id: filtros.anfitrion_id } : {}) },
      { order: [['inicio', 'DESC'], ['id', 'DESC']], limit: MAXIMO_EN_VIVO },
    );
  }

  enVivoDe(anfitrionId: number): Promise<Transmision | null> {
    return this.findOne({ anfitrion_id: anfitrionId, estado: 'en_vivo' }, { include: [] });
  }

  async sumarComentario(id: number, transaction?: Transaction): Promise<void> {
    await Transmision.increment('total_comentarios', { by: 1, where: { id }, transaction });
  }

  /** Al arrancar el servidor: las que quedaron "en vivo" de la vez anterior ya terminaron. */
  async cerrarHuerfanas(ahora: Date = new Date()): Promise<number> {
    const [cerradas] = await Transmision.update({ estado: 'terminada', fin: ahora }, { where: { estado: 'en_vivo' } });
    return cerradas;
  }
}

export class TransmisionComentarioRepository extends BaseRepository<TransmisionComentario> {
  protected readonly entidad = 'Comentario';

  constructor() {
    super(TransmisionComentario);
  }

  protected override opcionesPorDefecto() {
    return { include: [{ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }] };
  }

  /** Página de comentarios, el más nuevo primero. */
  pagina(transmisionId: number, paginacion: Paginacion): Promise<Page<TransmisionComentario>> {
    return this.paginate({ transmision_id: transmisionId }, paginacion, { order: [['id', 'DESC']] });
  }

  /** Los últimos `cantidad`, en orden de llegada (para quien entra tarde). */
  async recientes(transmisionId: number, cantidad: number): Promise<TransmisionComentario[]> {
    const filas = await this.findAll({ transmision_id: transmisionId }, { order: [['id', 'DESC']], limit: cantidad });
    return filas.reverse();
  }
}

export const transmisionRepository = new TransmisionRepository();
export const transmisionComentarioRepository = new TransmisionComentarioRepository();
