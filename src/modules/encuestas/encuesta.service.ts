import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors';
import { sequelize, type Encuesta } from '../../infrastructure/database/models';
import { realtime, type RealtimeGateway } from '../../infrastructure/realtime/RealtimeGateway';
import type { EncuestaVista } from '../publicaciones/publicacion-extras';
import { publicacionRepository, type PublicacionRepository } from '../publicaciones/publicacion.repository';
import { encuestaRepository, type EncuestaRepository } from './encuesta.repository';
import type { CrearEncuestaDto } from './encuesta.schemas';
import { estaCerrada, vistaEncuesta } from './encuesta.vista';

/** Socket.IO a todos cuando cambian los votos: { publicacion_id, encuesta } (sin `mis_votos`). */
export const EVENTO_ENCUESTA = 'encuesta_actualizada';

export type EncuestaPublica = Omit<EncuestaVista, 'mis_votos'>;

export class EncuestaService extends BaseService<Encuesta, EncuestaRepository> {
  constructor(
    repository: EncuestaRepository,
    private readonly publicaciones: PublicacionRepository,
    private readonly tiempoReal: RealtimeGateway,
  ) {
    super(repository);
  }

  /** Solo el autor de la publicación, y una encuesta por publicación. */
  async crear(usuarioId: number, { publicacion_id, opciones, multiple, cierra_en }: CrearEncuestaDto): Promise<EncuestaVista> {
    const publicacion = await this.publicaciones.findByIdOrFail(publicacion_id, { include: [] });
    this.asegurarDueno(publicacion.usuario_id, usuarioId, 'Solo el autor de la publicación puede agregarle una encuesta');
    if (await this.repository.deUnaPublicacion(publicacion_id)) throw new ConflictError('Esta publicación ya tiene una encuesta');

    const id = await sequelize.transaction((transaction) =>
      this.repository.crearConOpciones({ publicacion_id, multiple, cierra_en: cierra_en ?? null }, opciones, transaction),
    );
    return this.emitir(await this.repository.findByIdOrFail(id), []);
  }

  /** Encuesta con mis votos (404 si no puedo ver la publicación). */
  async vista(id: number, usuarioId?: number): Promise<EncuestaVista> {
    const encuesta = await this.visible(id, usuarioId);
    const misVotos = usuarioId ? (await this.repository.misVotos([id], usuarioId)).get(id) ?? [] : [];
    return vistaEncuesta(encuesta, misVotos);
  }

  /** Reemplaza mi voto. Si la encuesta no es múltiple, una sola opción. */
  async votar(id: number, usuarioId: number, opcionIds: number[]): Promise<EncuestaVista> {
    const encuesta = await this.abiertaVisible(id, usuarioId);
    if (!encuesta.multiple && opcionIds.length > 1) throw new BadRequestError('Esta encuesta solo admite una opción');
    const validas = new Set((encuesta.opciones ?? []).map((o) => o.id));
    if (opcionIds.some((o) => !validas.has(o))) throw new BadRequestError('Alguna opción no pertenece a esta encuesta');

    await sequelize.transaction((transaction) => this.repository.reemplazarVotos(id, usuarioId, opcionIds, transaction));
    return this.emitir(await this.repository.findByIdOrFail(id), [...opcionIds].sort((a, b) => a - b));
  }

  /** Retira mi voto (404 si no había votado). */
  async quitarVoto(id: number, usuarioId: number): Promise<EncuestaVista> {
    await this.abiertaVisible(id, usuarioId);
    const previos = await sequelize.transaction((transaction) => this.repository.reemplazarVotos(id, usuarioId, [], transaction));
    if (!previos) throw new NotFoundError('Voto', 'No has votado en esta encuesta');
    return this.emitir(await this.repository.findByIdOrFail(id), []);
  }

  // ---------- Internos ----------

  private async visible(id: number, usuarioId?: number): Promise<Encuesta> {
    const encuesta = await this.repository.findByIdOrFail(id);
    const publicacion = await this.publicaciones.findById(encuesta.publicacion_id, { include: [] });
    if (!publicacion || !(await this.publicaciones.puedeVer(publicacion, usuarioId))) throw new NotFoundError('Encuesta');
    return encuesta;
  }

  private async abiertaVisible(id: number, usuarioId: number): Promise<Encuesta> {
    const encuesta = await this.visible(id, usuarioId);
    if (estaCerrada(encuesta)) throw new BadRequestError('La encuesta ya está cerrada');
    return encuesta;
  }

  /** Avisa a todos los nuevos resultados y devuelve la vista con mis votos. */
  private emitir(encuesta: Encuesta, misVotos: number[]): EncuestaVista {
    const vista = vistaEncuesta(encuesta, misVotos);
    const publica: EncuestaPublica = {
      id: vista.id,
      multiple: vista.multiple,
      cierra_en: vista.cierra_en,
      cerrada: vista.cerrada,
      total_votos: vista.total_votos,
      opciones: vista.opciones,
    };
    this.tiempoReal.aTodos(EVENTO_ENCUESTA, { publicacion_id: encuesta.publicacion_id, encuesta: publica });
    return vista;
  }
}

export const encuestaService = new EncuestaService(encuestaRepository, publicacionRepository, realtime);
