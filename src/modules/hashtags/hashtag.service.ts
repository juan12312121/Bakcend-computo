import { BaseService } from '../../core/domain/BaseService';
import { NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import type { Hashtag } from '../../infrastructure/database/models';
import { publicacionService, type PublicacionService, type PublicacionVista } from '../publicaciones/publicacion.service';
import { hashtagRepository, type HashtagRepository } from './hashtag.repository';

/** Lo que el frontend recibe de un tema. */
export interface HashtagVista {
  id: number;
  nombre: string;
  total_publicaciones: number;
}

/** En tendencias, además: cuántas publicaciones públicas lo usaron en los últimos 7 días. */
export interface TendenciaVista extends HashtagVista {
  recientes: number;
}

export const DIAS_TENDENCIA = 7;
export const MAX_TENDENCIAS = 10;
export const MAX_AUTOCOMPLETAR = 8;

const aVista = (h: Hashtag): HashtagVista => ({ id: h.id, nombre: h.nombre, total_publicaciones: h.total_publicaciones });

export class HashtagService extends BaseService<Hashtag, HashtagRepository> {
  constructor(
    repository: HashtagRepository,
    private readonly publicaciones: PublicacionService,
  ) {
    super(repository);
  }

  /** Top 10 por publicaciones públicas de los últimos 7 días; si no alcanza, completa con los más usados de siempre. */
  async tendencias(): Promise<TendenciaVista[]> {
    const desde = new Date(Date.now() - DIAS_TENDENCIA * 24 * 3_600_000);
    const recientes = await this.repository.tendencias(desde, MAX_TENDENCIAS);
    const lista: TendenciaVista[] = recientes.map(({ hashtag, recientes: n }) => ({ ...aVista(hashtag), recientes: n }));
    const faltan = MAX_TENDENCIAS - lista.length;
    if (faltan > 0) {
      const respaldo = await this.repository.masUsados(faltan, lista.map((h) => h.id));
      lista.push(...respaldo.map((h) => ({ ...aVista(h), recientes: 0 })));
    }
    return lista;
  }

  /** Autocompletado de #: temas que empiezan con `q` (o los más usados si está vacío), máximo 8. */
  async buscar(q: string): Promise<HashtagVista[]> {
    const prefijo = q.replace(/[^\p{L}\p{N}_]/gu, '');
    const filas = prefijo
      ? await this.repository.buscar(prefijo, MAX_AUTOCOMPLETAR)
      : await this.repository.masUsados(MAX_AUTOCOMPLETAR);
    return filas.map(aVista);
  }

  async info(nombre: string): Promise<HashtagVista> {
    const hashtag = await this.repository.porNombre(nombre);
    if (!hashtag) throw new NotFoundError('Hashtag');
    return aVista(hashtag);
  }

  /** Publicaciones con el tema que el usuario puede ver (fuera de grupos), más recientes primero. */
  async publicacionesDe(nombre: string, usuarioId: number | undefined, paginacion: Paginacion): Promise<Page<PublicacionVista>> {
    const hashtag = await this.info(nombre);
    const ids = await this.repository.idsPublicaciones(hashtag.id);
    return this.publicaciones.paginaEntre(ids, usuarioId, paginacion);
  }
}

export const hashtagService = new HashtagService(hashtagRepository, publicacionService);
