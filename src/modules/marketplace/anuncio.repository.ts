import { Op, literal, type Attributes, type Includeable, type Order, type Transaction, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import {
  Anuncio,
  AnuncioFoto,
  Grupo,
  Usuario,
  type CategoriaAnuncio,
  type CondicionAnuncio,
  type EstadoAnuncio,
  type TipoAnuncio,
} from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';
import type { OrdenAnuncios } from './marketplace.schemas';

/** Datos del grupo que viajan dentro de un anuncio. */
export const ATRIBUTOS_GRUPO_ANUNCIO = ['id', 'nombre', 'imagen_url', 'privacidad'] as const;

/** Estados que ven los demás en búsquedas (pausado solo lo ve el dueño; vendido sale de la búsqueda). */
export const ESTADOS_PUBLICOS: EstadoAnuncio[] = ['activo', 'reservado'];

type WhereAnuncio = WhereOptions<Attributes<Anuncio>>;

/** Contadores desnormalizados del anuncio. */
export type ContadorAnuncio = 'total_vistas' | 'total_guardados' | 'total_interesados';

/** Filtros combinables de la búsqueda. */
export interface FiltroAnuncios {
  /** Vendedores con bloqueo de por medio (en cualquier sentido). */
  ocultos?: number[];
  /**
   * Grupos de los que se pueden ver anuncios cuando no se pide un grupo en concreto:
   * los anuncios sin grupo siempre entran; los de grupo, solo si es uno de estos (mis grupos).
   */
  gruposPermitidos?: number[];
  estados?: EstadoAnuncio[];
  q?: string;
  categoria?: CategoriaAnuncio;
  tipo?: TipoAnuncio;
  condicion?: CondicionAnuncio;
  precio_min?: number;
  precio_max?: number;
  ubicacion?: string;
  gratis?: boolean;
  envio?: boolean;
  grupo_id?: number;
  vendedor_id?: number;
}

/** Contiene el texto (LIKE sin distinguir mayúsculas en MySQL y en SQLite para ASCII). */
const patron = (texto: string) => `%${texto}%`;

/** Los "a convenir" (precio null) siempre van al final al ordenar por precio (vale en MySQL y SQLite). */
const PRECIO_NULO_AL_FINAL = literal('(`Anuncio`.`precio` IS NULL)');

const ORDENES: Record<OrdenAnuncios, Order> = {
  recientes: [
    ['renovado_en', 'DESC'],
    ['id', 'DESC'],
  ],
  precio_asc: [
    [PRECIO_NULO_AL_FINAL, 'ASC'],
    ['precio', 'ASC'],
    ['id', 'DESC'],
  ],
  precio_desc: [
    [PRECIO_NULO_AL_FINAL, 'ASC'],
    ['precio', 'DESC'],
    ['id', 'DESC'],
  ],
  vistas: [
    ['total_vistas', 'DESC'],
    ['id', 'DESC'],
  ],
};

/** Vendedor (cuenta activa) y grupo: lo que acompaña a todo anuncio. */
export function includesAnuncio(): Includeable[] {
  return [
    { model: Usuario, as: 'vendedor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO], where: { activo: true } },
    { model: Grupo, as: 'grupo', attributes: [...ATRIBUTOS_GRUPO_ANUNCIO], required: false },
  ];
}

export class AnuncioRepository extends BaseRepository<Anuncio> {
  protected readonly entidad = 'Anuncio';

  constructor() {
    super(Anuncio);
  }

  protected override opcionesPorDefecto() {
    return { include: includesAnuncio() };
  }

  buscar(filtro: FiltroAnuncios, paginacion: Paginacion): Promise<Page<Anuncio>>;
  buscar(filtro: FiltroAnuncios, paginacion: Paginacion, orden: OrdenAnuncios): Promise<Page<Anuncio>>;
  buscar(filtro: FiltroAnuncios, paginacion: Paginacion, orden: OrdenAnuncios = 'recientes'): Promise<Page<Anuncio>> {
    return this.paginate(this.where(filtro), paginacion, { order: ORDENES[orden] });
  }

  /** Lee varios anuncios por id (con vendedor y grupo) indexados por id. */
  async porIds(ids: number[]): Promise<Map<number, Anuncio>> {
    if (!ids.length) return new Map();
    const filas = await this.findAll({ id: ids });
    return new Map(filas.map((a) => [a.id, a]));
  }

  /** Suma o resta a un contador (nunca baja de 0). */
  async ajustarContador(id: number, campo: ContadorAnuncio, delta: number, transaction?: Transaction): Promise<void> {
    if (delta > 0) await Anuncio.increment(campo, { by: delta, where: { id }, transaction });
    else if (delta < 0) await Anuncio.decrement(campo, { by: -delta, where: { id, [campo]: { [Op.gte]: -delta } }, transaction });
  }

  /** Activos y vendidos de un vendedor (para su ficha). */
  async totalesDeVendedor(vendedorId: number): Promise<{ activos: number; vendidos: number }> {
    const [activos, vendidos] = await Promise.all([
      Anuncio.count({ where: { vendedor_id: vendedorId, estado: ESTADOS_PUBLICOS } }),
      Anuncio.count({ where: { vendedor_id: vendedorId, estado: 'vendido' } }),
    ]);
    return { activos, vendidos };
  }

  // ---------- Armado de filtros ----------

  private where(filtro: FiltroAnuncios): WhereAnuncio {
    const c: WhereAnuncio[] = [];
    if (filtro.estados) c.push({ estado: filtro.estados });
    if (filtro.ocultos?.length) c.push({ vendedor_id: { [Op.notIn]: filtro.ocultos } });
    if (filtro.grupo_id) c.push({ grupo_id: filtro.grupo_id });
    else if (filtro.gruposPermitidos) {
      c.push(
        filtro.gruposPermitidos.length
          ? { [Op.or]: [{ grupo_id: null }, { grupo_id: filtro.gruposPermitidos }] }
          : { grupo_id: null },
      );
    }
    if (filtro.vendedor_id) c.push({ vendedor_id: filtro.vendedor_id });
    if (filtro.categoria) c.push({ categoria: filtro.categoria });
    if (filtro.tipo) c.push({ tipo: filtro.tipo });
    if (filtro.condicion) c.push({ condicion: filtro.condicion });
    if (filtro.gratis) c.push({ modo_precio: 'gratis' });
    if (filtro.envio) c.push({ entrega_envio: true });
    if (filtro.precio_min !== undefined) c.push({ precio: { [Op.gte]: filtro.precio_min } });
    if (filtro.precio_max !== undefined) c.push({ precio: { [Op.lte]: filtro.precio_max } });
    if (filtro.ubicacion) c.push({ ubicacion: { [Op.like]: patron(filtro.ubicacion) } });
    if (filtro.q) {
      const p = patron(filtro.q);
      c.push({ [Op.or]: [{ titulo: { [Op.like]: p } }, { descripcion: { [Op.like]: p } }] });
    }
    return { [Op.and]: c };
  }
}

/** Foto principal y cuántas tiene cada anuncio. */
export interface PortadaAnuncio {
  url: string | null;
  total: number;
}

export class AnuncioFotoRepository extends BaseRepository<AnuncioFoto> {
  protected readonly entidad = 'Foto';

  constructor() {
    super(AnuncioFoto);
  }

  de(anuncioId: number): Promise<AnuncioFoto[]>;
  de(anuncioId: number, transaction: Transaction): Promise<AnuncioFoto[]>;
  de(anuncioId: number, transaction?: Transaction): Promise<AnuncioFoto[]> {
    return AnuncioFoto.findAll({ where: { anuncio_id: anuncioId }, order: [['orden', 'ASC'], ['id', 'ASC']], transaction });
  }

  /** Una consulta para toda una página de anuncios. */
  async portadas(anuncioIds: number[]): Promise<Map<number, PortadaAnuncio>> {
    const mapa = new Map<number, PortadaAnuncio>();
    if (!anuncioIds.length) return mapa;
    const fotos = await AnuncioFoto.findAll({
      where: { anuncio_id: anuncioIds },
      attributes: ['anuncio_id', 'url', 'orden', 'id'],
      order: [['orden', 'ASC'], ['id', 'ASC']],
    });
    for (const foto of fotos) {
      const actual = mapa.get(foto.anuncio_id);
      if (actual) actual.total += 1;
      else mapa.set(foto.anuncio_id, { url: foto.url, total: 1 });
    }
    return mapa;
  }
}

export const anuncioRepository = new AnuncioRepository();
export const anuncioFotoRepository = new AnuncioFotoRepository();
