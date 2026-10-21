import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { CONTEXTOS_TEXTO, type ContextoTexto, type PalabraProhibida } from '../../infrastructure/database/models';
import { FiltroPalabras, normalizar, type ResultadoRevision } from './filtro-palabras';
import { palabraRepository, type FiltrosPalabras, type PalabraRepository } from './palabra.repository';
import type { ActualizarPalabraDto, CrearPalabraDto } from './moderacion.schemas';

/** La caché se recarga sola pasado este tiempo (por si hay varias instancias del servidor). */
export const VIGENCIA_CACHE_MS = 5 * 60_000;

const SUJETO: Record<ContextoTexto, string> = {
  publicacion: 'La publicación',
  comentario: 'El comentario',
  mensaje: 'El mensaje',
  nombre: 'El nombre',
};

/**
 * Palabras prohibidas: CRUD para el admin y revisión de textos para el resto de módulos.
 * Las reglas activas viven en memoria (FiltroPalabras) y se recargan al cambiar la lista.
 * Este archivo no importa otros módulos de contenido: publicaciones, comentarios y chat pueden usarlo sin ciclos.
 */
export class PalabrasService extends BaseService<PalabraProhibida, PalabraRepository> {
  private filtro: FiltroPalabras | null = null;
  private cargadoEn = 0;
  private cargando: Promise<FiltroPalabras> | null = null;
  /** Sube con cada cambio de la lista: una carga que empezó antes ya no se guarda. */
  private version = 0;

  constructor(
    repository: PalabraRepository,
    private readonly vigenciaMs: number = VIGENCIA_CACHE_MS,
  ) {
    super(repository);
  }

  listar(filtros: FiltrosPalabras, paginacion: Paginacion): Promise<Page<PalabraProhibida>> {
    return this.repository.listar(filtros, paginacion);
  }

  async crear(adminId: number, { palabra, coincidencia, accion, aplica_a, activa }: CrearPalabraDto): Promise<PalabraProhibida> {
    await this.asegurarUnica(palabra);
    const creada = await this.repository.create({
      palabra: palabra.trim(),
      coincidencia,
      accion,
      aplica_a: aplica_a ?? [...CONTEXTOS_TEXTO],
      activa: activa ?? true,
      creado_por: adminId,
    });
    this.invalidar();
    return creada;
  }

  async actualizar(id: number, cambios: ActualizarPalabraDto): Promise<PalabraProhibida> {
    const palabra = await this.repository.findByIdOrFail(id);
    if (cambios.palabra !== undefined) await this.asegurarUnica(cambios.palabra, id);
    const actualizada = await this.repository.update(palabra, {
      ...cambios,
      ...(cambios.palabra !== undefined ? { palabra: cambios.palabra.trim() } : {}),
    });
    this.invalidar();
    return actualizada;
  }

  async eliminar(id: number): Promise<void> {
    await this.repository.delete(id);
    this.invalidar();
  }

  // ---------- Revisión de textos (la usan los demás módulos) ----------

  /** Revisa un texto: { permitido, texto (censurado), coincidencias }. */
  async revisarTexto(texto: string, contexto: ContextoTexto): Promise<ResultadoRevision> {
    return (await this.filtroActual()).revisar(texto, contexto);
  }

  /**
   * Devuelve el texto censurado o lanza 400 con un mensaje claro si hay que bloquearlo.
   * Con null/undefined/'' devuelve lo mismo sin consultar nada.
   */
  asegurarTextoPermitido(texto: string, contexto: ContextoTexto): Promise<string>;
  asegurarTextoPermitido(texto: string | null | undefined, contexto: ContextoTexto): Promise<string | null | undefined>;
  async asegurarTextoPermitido(texto: string | null | undefined, contexto: ContextoTexto): Promise<string | null | undefined> {
    if (!texto) return texto;
    const resultado = await this.revisarTexto(texto, contexto);
    if (!resultado.permitido) {
      const palabras = [...new Set(resultado.coincidencias.map((c) => `«${c.fragmento}»`))].join(', ');
      throw new BadRequestError(`${SUJETO[contexto]} contiene palabras no permitidas (${palabras}). Cámbialas para poder continuar.`);
    }
    return resultado.texto;
  }

  /** Olvida la caché: la próxima revisión vuelve a leer las palabras activas. */
  invalidar(): void {
    this.version++;
    this.filtro = null;
    this.cargando = null;
  }

  private async filtroActual(): Promise<FiltroPalabras> {
    if (this.filtro && Date.now() - this.cargadoEn < this.vigenciaMs) return this.filtro;
    this.cargando ??= this.cargar();
    return this.cargando;
  }

  private async cargar(): Promise<FiltroPalabras> {
    const version = this.version;
    const reglas = await this.repository.activas();
    const filtro = new FiltroPalabras(
      reglas.map((r) => ({ id: r.id, palabra: r.palabra, coincidencia: r.coincidencia, accion: r.accion, aplica_a: r.aplica_a })),
    );
    // Si la lista cambió mientras se cargaba, esta carga ya no sirve para la caché.
    if (version === this.version) {
      this.filtro = filtro;
      this.cargadoEn = Date.now();
      this.cargando = null;
    }
    return filtro;
  }

  private async asegurarUnica(palabra: string, exceptoId?: number): Promise<void> {
    const normal = normalizar(palabra.trim());
    const todas = await this.repository.findAll({}, { attributes: ['id', 'palabra'] });
    if (todas.some((p) => p.id !== exceptoId && normalizar(p.palabra) === normal)) {
      throw new ConflictError('Esa palabra ya está en la lista');
    }
  }
}

export const palabrasService = new PalabrasService(palabraRepository);

/** Atajos para otros módulos: revisarTexto(texto, 'comentario') / asegurarTextoPermitido(texto, 'mensaje'). */
export const revisarTexto = (texto: string, contexto: ContextoTexto): Promise<ResultadoRevision> => palabrasService.revisarTexto(texto, contexto);

export function asegurarTextoPermitido(texto: string, contexto: ContextoTexto): Promise<string>;
export function asegurarTextoPermitido(texto: string | undefined, contexto: ContextoTexto): Promise<string | undefined>;
export function asegurarTextoPermitido(texto: string | null | undefined, contexto: ContextoTexto): Promise<string | null | undefined>;
export function asegurarTextoPermitido(texto: string | null | undefined, contexto: ContextoTexto): Promise<string | null | undefined> {
  return palabrasService.asegurarTextoPermitido(texto, contexto);
}
