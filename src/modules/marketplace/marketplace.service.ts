import type { InferAttributes, Sequelize } from 'sequelize';
import { env } from '../../config/env';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, ValidationError, type CampoError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import {
  sequelize,
  type Anuncio,
  type AnuncioFoto,
  type AnuncioReporte,
  type CalificacionVendedor,
  type EstadoAnuncio,
  type EstadoReporteAnuncio,
  type Grupo,
  type Usuario,
} from '../../infrastructure/database/models';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { chatService, type ChatService } from '../chat/chat.service';
import { grupoMiembroRepository, type GrupoMiembroRepository } from '../grupos/grupo-miembro.repository';
import { grupoRepository, type GrupoRepository } from '../grupos/grupo.repository';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { privacidadService, type PrivacidadService } from '../privacidad/privacidad.service';
import { ATRIBUTOS_USUARIO_PUBLICO, usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import {
  ESTADOS_PUBLICOS,
  anuncioFotoRepository,
  anuncioRepository,
  type ATRIBUTOS_GRUPO_ANUNCIO,
  type AnuncioFotoRepository,
  type AnuncioRepository,
  type PortadaAnuncio,
} from './anuncio.repository';
import {
  anuncioGuardadoRepository,
  anuncioInteresadoRepository,
  anuncioReporteRepository,
  anuncioVisitaRepository,
  calificacionVendedorRepository,
  type AnuncioGuardadoRepository,
  type AnuncioInteresadoRepository,
  type AnuncioReporteRepository,
  type AnuncioVisitaRepository,
  type CalificacionVendedorRepository,
  type FiltroReportes,
  type InteresadoEnAnuncio,
  type ResumenCalificaciones,
} from './interacciones.repository';
import {
  LIMITES_ANUNCIO,
  type ActualizarAnuncioDto,
  type BuscarAnunciosQuery,
  type CalificarDto,
  type CambiarEstadoDto,
  type CrearAnuncioDto,
  type InteresDto,
  type MisAnunciosQuery,
  type ReportarAnuncioDto,
} from './marketplace.schemas';

export type UsuarioPublico = Pick<InferAttributes<Usuario>, (typeof ATRIBUTOS_USUARIO_PUBLICO)[number]>;
export type GrupoDeAnuncio = Pick<InferAttributes<Grupo>, (typeof ATRIBUTOS_GRUPO_ANUNCIO)[number]>;

export interface FotoAnuncio {
  id: number;
  url: string;
  orden: number;
}

/** Anuncio en listados (tarjeta): sin comprador, con foto principal y mi relación. */
export type AnuncioResumen = Omit<InferAttributes<Anuncio>, 'comprador_id'> & {
  vendedor: UsuarioPublico;
  grupo: GrupoDeAnuncio | null;
  foto_principal: string | null;
  total_fotos: number;
  guardado: boolean;
  es_mio: boolean;
};

/** Detalle: todas las fotos, calificación del vendedor y lo que puedo hacer. */
export type AnuncioDetalle = AnuncioResumen & {
  fotos: FotoAnuncio[];
  vendedor_calificacion: ResumenCalificaciones;
  /** Solo lo ven el vendedor y el propio comprador. */
  comprador_id: number | null;
  me_interesa: boolean;
  /** Chat con el vendedor si ya pregunté. */
  chat_id: number | null;
  puede_renovar: boolean;
  /** Se puede renovar a partir de esta fecha (null si está vendido). */
  renovable_desde: Date | null;
  puedo_calificar: boolean;
  mi_calificacion: number | null;
};

export interface ResultadoGuardado {
  anuncio_id: number;
  guardado: boolean;
  total_guardados: number;
}

export interface ResultadoInteres {
  anuncio_id: number;
  chat_id: number;
  mensaje_id: number;
  /** false si ya había preguntado antes (no se vuelve a notificar al vendedor). */
  primera_vez: boolean;
}

export interface FichaVendedor {
  vendedor: UsuarioPublico;
  calificacion: ResumenCalificaciones;
  anuncios_activos: number;
  vendidos: number;
}

export interface OpcionesEliminar {
  /** Un administrador (o el panel de moderación) borra anuncios ajenos. */
  comoAdmin?: boolean;
}

/** Cada cuánto se puede renovar (subir a "recientes") un anuncio. */
export const HORAS_PARA_RENOVAR = 24;
const MS_RENOVAR = HORAS_PARA_RENOVAR * 60 * 60 * 1000;

/** Prefijo de los tokens de fotos nuevas en `fotos` al editar. */
const PREFIJO_NUEVA = 'nueva:';

/** Valores finales que se revisan juntos (crear y editar). */
interface DatosCoherencia {
  tipo: Anuncio['tipo'];
  condicion?: Anuncio['condicion'];
  modo_precio: Anuncio['modo_precio'];
  precio?: number | null;
  entrega_en_persona: boolean;
  entrega_envio: boolean;
  totalFotos: number;
}

/** Reglas entre campos: condición en productos, precio según modo, alguna entrega y fotos (1-10 en productos). */
export function erroresDeCoherencia(d: DatosCoherencia): CampoError[] {
  const errores: CampoError[] = [];
  if (d.tipo === 'producto' && !d.condicion) errores.push({ campo: 'condicion', mensaje: 'Indica la condición del producto' });
  if (d.modo_precio === 'fijo' && (d.precio === undefined || d.precio === null || d.precio <= 0)) {
    errores.push({ campo: 'precio', mensaje: 'Indica un precio mayor a 0 (o marca "gratis" / "a convenir")' });
  }
  if (d.tipo === 'producto' && !d.entrega_en_persona && !d.entrega_envio) {
    errores.push({ campo: 'entrega_en_persona', mensaje: 'Elige al menos una forma de entrega' });
  }
  if (d.tipo === 'producto' && d.totalFotos < 1) errores.push({ campo: 'fotos', mensaje: 'Agrega al menos una foto del producto' });
  if (d.totalFotos > LIMITES_ANUNCIO.fotos) errores.push({ campo: 'fotos', mensaje: `Máximo ${LIMITES_ANUNCIO.fotos} fotos por anuncio` });
  return errores;
}

/** Precio que se guarda según el modo: gratis → 0, a convenir → null. */
function precioSegunModo(modo: Anuncio['modo_precio'], precio: number | null | undefined): number | null {
  if (modo === 'gratis') return 0;
  if (modo === 'a_convenir') return null;
  return precio ?? null;
}

/** Elemento de la lista final de fotos al editar. */
type PlanFoto = { existente: AnuncioFoto } | { nueva: ArchivoSubido };

export class MarketplaceService extends BaseService<Anuncio, AnuncioRepository> {
  constructor(
    repository: AnuncioRepository,
    private readonly fotos: AnuncioFotoRepository,
    private readonly guardados: AnuncioGuardadoRepository,
    private readonly visitas: AnuncioVisitaRepository,
    private readonly interesados: AnuncioInteresadoRepository,
    private readonly reportes: AnuncioReporteRepository,
    private readonly calificaciones: CalificacionVendedorRepository,
    private readonly grupos: GrupoRepository,
    private readonly miembros: GrupoMiembroRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly privacidad: PrivacidadService,
    private readonly chats: ChatService,
    private readonly notificaciones: NotificacionService,
    private readonly storage: FileStorage,
    private readonly db: Sequelize,
    /** Base de la app web, para el enlace del anuncio en el chat. */
    private readonly urlApp: string,
  ) {
    super(repository);
  }

  // ---------- Consultas ----------

  /**
   * Búsqueda con filtros (activos y reservados). Sin `grupo_id` entran los anuncios sin grupo y los de mis grupos;
   * con `grupo_id`, solo los de ese grupo (si es privado, solo para sus miembros).
   */
  async buscar(query: BuscarAnunciosQuery, usuarioId?: number): Promise<Page<AnuncioResumen>> {
    const { limit, offset, orden, ...filtros } = query;
    if (filtros.grupo_id) await this.asegurarVeGrupo(filtros.grupo_id, usuarioId);
    const [ocultos, misGrupos] = usuarioId
      ? await Promise.all([this.privacidad.idsOcultosPara(usuarioId), this.miembros.gruposActivosDe(usuarioId)])
      : [[], []];
    const page = await this.repository.buscar(
      { ...filtros, q: filtros.q || undefined, ubicacion: filtros.ubicacion || undefined, ocultos, gruposPermitidos: misGrupos, estados: ESTADOS_PUBLICOS },
      { limit, offset },
      orden,
    );
    return { ...page, items: await this.resumir(page.items, usuarioId) };
  }

  /** Todos mis anuncios (cualquier estado o uno), los renovados más recientemente primero. */
  async misAnuncios(usuarioId: number, { estado, limit, offset }: MisAnunciosQuery): Promise<Page<AnuncioResumen>> {
    const page = await this.repository.buscar({ vendedor_id: usuarioId, estados: estado ? [estado] : undefined }, { limit, offset });
    return { ...page, items: await this.resumir(page.items, usuarioId) };
  }

  async misGuardados(usuarioId: number, paginacion: Paginacion): Promise<Page<AnuncioResumen>> {
    const ocultos = await this.privacidad.idsOcultosPara(usuarioId);
    const page = await this.guardados.paginarDe(usuarioId, ocultos, paginacion);
    return { ...page, items: await this.resumir(page.items, usuarioId) };
  }

  /** Lo último que abrí (sin los míos, sin vendidos ni pausados). */
  async vistosRecientemente(usuarioId: number, paginacion: Paginacion): Promise<Page<AnuncioResumen>> {
    const ocultos = await this.privacidad.idsOcultosPara(usuarioId);
    const page = await this.visitas.recientesDe(usuarioId, ocultos, ESTADOS_PUBLICOS, paginacion);
    return { ...page, items: await this.resumir(page.items, usuarioId) };
  }

  /** Abre el anuncio: cuenta la vista (una por persona; sin sesión, cada vez) salvo para el vendedor. */
  async detalle(id: number, usuarioId?: number): Promise<AnuncioDetalle> {
    const anuncio = await this.visibleOrFail(id, usuarioId);
    if (anuncio.vendedor_id !== usuarioId) {
      const nueva = usuarioId ? await this.visitas.registrar(id, usuarioId) : true;
      if (nueva) {
        await this.repository.ajustarContador(id, 'total_vistas', 1);
        anuncio.total_vistas += 1;
      }
    }
    return this.detallar(anuncio, usuarioId);
  }

  /** Interesados de mi anuncio (para elegir a quién se lo vendí). */
  async interesadosDe(id: number, usuarioId: number, paginacion: Paginacion): Promise<Page<InteresadoEnAnuncio>> {
    const anuncio = await this.repository.findByIdOrFail(id);
    this.asegurarDueno(anuncio.vendedor_id, usuarioId, 'Solo quien vende ve a los interesados');
    return this.interesados.paginarDe(id, await this.privacidad.idsOcultosPara(usuarioId), paginacion);
  }

  /** Ficha pública del vendedor: calificación y cuántos anuncios tiene. */
  async fichaVendedor(vendedorId: number, usuarioId?: number): Promise<FichaVendedor> {
    const vendedor = await this.usuarios.findById(vendedorId, { attributes: [...ATRIBUTOS_USUARIO_PUBLICO, 'activo'] });
    if (!vendedor || !vendedor.activo || (usuarioId && (await this.privacidad.hayBloqueo(usuarioId, vendedorId)))) {
      throw new NotFoundError('Vendedor');
    }
    const [calificacion, totales] = await Promise.all([this.calificaciones.resumen(vendedorId), this.repository.totalesDeVendedor(vendedorId)]);
    const { activo: _activo, ...publico } = vendedor.toJSON() as UsuarioPublico & { activo: boolean };
    return { vendedor: publico, calificacion, anuncios_activos: totales.activos, vendidos: totales.vendidos };
  }

  async calificacionesDe(vendedorId: number, paginacion: Paginacion, usuarioId?: number): Promise<Page<CalificacionVendedor>> {
    const ocultos = usuarioId ? await this.privacidad.idsOcultosPara(usuarioId) : [];
    if (ocultos.includes(vendedorId)) throw new NotFoundError('Vendedor');
    return this.calificaciones.paginarDe(vendedorId, ocultos, paginacion);
  }

  // ---------- Publicar y editar ----------

  async crear(usuarioId: number, datos: CrearAnuncioDto): Promise<AnuncioDetalle>;
  async crear(usuarioId: number, datos: CrearAnuncioDto, fotos: ArchivoSubido[]): Promise<AnuncioDetalle>;
  async crear(usuarioId: number, datos: CrearAnuncioDto, fotos: ArchivoSubido[] = []): Promise<AnuncioDetalle> {
    const condicion = datos.tipo === 'servicio' ? null : (datos.condicion ?? null);
    const errores = erroresDeCoherencia({ ...datos, condicion, totalFotos: fotos.length });
    if (errores.length) throw new ValidationError(errores);

    if (datos.grupo_id) {
      await this.grupos.findByIdOrFail(datos.grupo_id);
      if (!(await this.miembros.esMiembroActivo(datos.grupo_id, usuarioId))) {
        throw new ForbiddenError('Solo los miembros activos del grupo pueden publicar anuncios en él');
      }
    }

    const creado = await this.db.transaction(async (t) => {
      const anuncio = await this.repository.create(
        {
          vendedor_id: usuarioId,
          grupo_id: datos.grupo_id ?? null,
          titulo: datos.titulo,
          descripcion: datos.descripcion || null,
          tipo: datos.tipo,
          categoria: datos.categoria ?? (datos.tipo === 'servicio' ? 'servicios' : 'otros'),
          condicion,
          modo_precio: datos.modo_precio,
          precio: precioSegunModo(datos.modo_precio, datos.precio),
          moneda: datos.moneda,
          ubicacion: datos.ubicacion,
          entrega_en_persona: datos.entrega_en_persona,
          entrega_envio: datos.entrega_envio,
          renovado_en: new Date(),
        },
        t,
      );
      for (const [orden, foto] of fotos.entries()) {
        await this.fotos.create({ anuncio_id: anuncio.id, url: foto.url, archivo_id: foto.id, orden }, t);
      }
      return anuncio;
    });
    return this.detallar(await this.repository.findByIdOrFail(creado.id), usuarioId);
  }

  /**
   * Solo el vendedor. `fotos` es la lista final (ids guardados y "nueva:N"): lo que no aparezca se borra de la base
   * y de Cloudinary; sin `fotos`, las nuevas se agregan al final.
   */
  async actualizar(id: number, usuarioId: number, datos: ActualizarAnuncioDto): Promise<AnuncioDetalle>;
  async actualizar(id: number, usuarioId: number, datos: ActualizarAnuncioDto, nuevas: ArchivoSubido[]): Promise<AnuncioDetalle>;
  async actualizar(id: number, usuarioId: number, datos: ActualizarAnuncioDto, nuevas: ArchivoSubido[] = []): Promise<AnuncioDetalle> {
    const anuncio = await this.repository.findByIdOrFail(id);
    this.asegurarDueno(anuncio.vendedor_id, usuarioId, 'Solo quien publicó el anuncio puede editarlo');

    const { fotos: listaFotos, ...campos } = datos;
    const cambios: Partial<InferAttributes<Anuncio>> = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
    const actuales = await this.fotos.de(id);
    const plan = this.planDeFotos(actuales, listaFotos, nuevas);
    const quitadas = actuales.filter((f) => !plan.some((p) => 'existente' in p && p.existente.id === f.id));
    const cambianFotos = nuevas.length > 0 || quitadas.length > 0 || plan.some((p, i) => !('existente' in p) || p.existente.id !== actuales[i]?.id);
    if (!Object.keys(cambios).length && !cambianFotos) throw new BadRequestError('No hay datos para actualizar');

    const final = { ...(anuncio.get({ plain: true }) as InferAttributes<Anuncio>), ...cambios };
    if (final.tipo === 'servicio') cambios.condicion = final.condicion = null;
    if (cambios.modo_precio !== undefined || cambios.precio !== undefined) {
      cambios.precio = final.precio = precioSegunModo(final.modo_precio, final.precio);
    }
    const errores = erroresDeCoherencia({ ...final, totalFotos: plan.length });
    if (errores.length) throw new ValidationError(errores);

    await this.db.transaction(async (t) => {
      if (Object.keys(cambios).length) await this.repository.update(anuncio, cambios, t);
      if (quitadas.length) await this.fotos.delete({ id: quitadas.map((f) => f.id) }, t);
      for (const [orden, paso] of plan.entries()) {
        if ('existente' in paso) {
          if (paso.existente.orden !== orden) await this.fotos.update(paso.existente, { orden }, t);
        } else {
          await this.fotos.create({ anuncio_id: id, url: paso.nueva.url, archivo_id: paso.nueva.id, orden }, t);
        }
      }
    });
    for (const foto of quitadas) await this.storage.eliminar(foto.archivo_id ?? foto.url);
    return this.detallar(await this.repository.findByIdOrFail(id), usuarioId);
  }

  /**
   * activo / reservado / vendido / pausado. Al marcar vendido (opcionalmente con el comprador, que debe ser
   * uno de los interesados) avisa 'anuncio_vendido' a quienes lo guardaron. Salir de vendido limpia el comprador.
   */
  async cambiarEstado(id: number, usuarioId: number, { estado, comprador_id: compradorId }: CambiarEstadoDto): Promise<AnuncioDetalle> {
    const anuncio = await this.repository.findByIdOrFail(id);
    this.asegurarDueno(anuncio.vendedor_id, usuarioId, 'Solo quien publicó el anuncio puede cambiar su estado');
    if (compradorId !== undefined && estado !== 'vendido') throw new BadRequestError('El comprador solo se indica al marcar vendido');
    if (compradorId !== undefined && !(await this.interesados.exists({ anuncio_id: id, usuario_id: compradorId }))) {
      throw new ValidationError([{ campo: 'comprador_id', mensaje: 'Esa persona no preguntó por este anuncio' }]);
    }
    if (anuncio.estado === estado && (estado !== 'vendido' || compradorId === undefined || compradorId === anuncio.comprador_id)) {
      throw new BadRequestError(`El anuncio ya está ${ETIQUETA_ESTADO[estado]}`);
    }

    const recienVendido = estado === 'vendido' && anuncio.estado !== 'vendido';
    await this.repository.update(anuncio, {
      estado,
      comprador_id: estado === 'vendido' ? (compradorId ?? anuncio.comprador_id ?? null) : null,
      vendido_en: estado === 'vendido' ? (anuncio.vendido_en ?? new Date()) : null,
    });

    if (recienVendido) {
      for (const destinatario of await this.guardados.usuariosDe(id)) {
        await this.notificaciones.notificar({
          usuario_id: destinatario,
          de_usuario_id: usuarioId,
          tipo: 'anuncio_vendido',
          mensaje: `vendió «${anuncio.titulo}», que tenías guardado`,
          entidad_tipo: 'anuncio',
          entidad_id: id,
        });
      }
    }
    return this.detallar(await this.repository.findByIdOrFail(id), usuarioId);
  }

  /** Lo sube a "recientes" (una vez cada 24 h; no si está vendido). Un anuncio pausado vuelve a activo. */
  async renovar(id: number, usuarioId: number): Promise<AnuncioDetalle>;
  async renovar(id: number, usuarioId: number, ahora: Date): Promise<AnuncioDetalle>;
  async renovar(id: number, usuarioId: number, ahora: Date = new Date()): Promise<AnuncioDetalle> {
    const anuncio = await this.repository.findByIdOrFail(id);
    this.asegurarDueno(anuncio.vendedor_id, usuarioId, 'Solo quien publicó el anuncio puede renovarlo');
    if (anuncio.estado === 'vendido') throw new BadRequestError('Un anuncio vendido no se puede renovar');
    const desde = this.renovableDesde(anuncio);
    if (desde && desde.getTime() > ahora.getTime()) {
      throw new BadRequestError(`Solo puedes renovar un anuncio una vez cada ${HORAS_PARA_RENOVAR} horas`);
    }
    await this.repository.update(anuncio, { renovado_en: ahora, estado: anuncio.estado === 'pausado' ? 'activo' : anuncio.estado });
    return this.detallar(await this.repository.findByIdOrFail(id), usuarioId);
  }

  /** Borra el anuncio con todo lo suyo y después sus fotos de Cloudinary. Las calificaciones se conservan. */
  async eliminar(id: number, usuarioId: number): Promise<void>;
  async eliminar(id: number, usuarioId: number, opciones: OpcionesEliminar): Promise<void>;
  async eliminar(id: number, usuarioId: number, { comoAdmin = false }: OpcionesEliminar = {}): Promise<void> {
    const anuncio = await this.repository.findByIdOrFail(id, { include: [] });
    if (!comoAdmin) this.asegurarDueno(anuncio.vendedor_id, usuarioId, 'Solo quien publicó el anuncio puede eliminarlo');
    const fotos = await this.fotos.de(id);

    await this.db.transaction(async (t) => {
      await this.fotos.delete({ anuncio_id: id }, t);
      await this.guardados.delete({ anuncio_id: id }, t);
      await this.visitas.delete({ anuncio_id: id }, t);
      await this.interesados.delete({ anuncio_id: id }, t);
      await this.reportes.delete({ anuncio_id: id }, t);
      await this.calificaciones.desligarAnuncio(id, t);
      await this.repository.delete({ id }, t);
    });
    for (const foto of fotos) await this.storage.eliminar(foto.archivo_id ?? foto.url);
  }

  // ---------- Interacciones ----------

  /** Guarda o quita de guardados (no el propio). */
  async alternarGuardado(id: number, usuarioId: number): Promise<ResultadoGuardado> {
    const anuncio = await this.visibleOrFail(id, usuarioId);
    if (anuncio.vendedor_id === usuarioId) throw new BadRequestError('No puedes guardar tu propio anuncio');

    const guardado = await this.db.transaction(async (t) => {
      const existente = await this.guardados.de(id, usuarioId, t);
      if (existente) {
        await this.guardados.delete({ id: existente.id }, t);
        await this.repository.ajustarContador(id, 'total_guardados', -1, t);
        return false;
      }
      await this.guardados.create({ anuncio_id: id, usuario_id: usuarioId }, t);
      await this.repository.ajustarContador(id, 'total_guardados', 1, t);
      return true;
    });
    const actualizado = await this.repository.findByIdOrFail(id, { include: [], attributes: ['total_guardados'] });
    return { anuncio_id: id, guardado, total_guardados: actualizado.total_guardados };
  }

  /**
   * "Me interesa / ¿Sigue disponible?": abre (o crea) el chat directo con el vendedor y manda un primer mensaje con
   * el enlace al anuncio. La primera vez queda como interesado y se notifica 'anuncio_interes' al vendedor.
   */
  async meInteresa(id: number, usuarioId: number, { mensaje }: InteresDto): Promise<ResultadoInteres> {
    const anuncio = await this.visibleOrFail(id, usuarioId);
    if (anuncio.vendedor_id === usuarioId) throw new BadRequestError('Es tu propio anuncio');
    if (!ESTADOS_PUBLICOS.includes(anuncio.estado)) {
      throw new BadRequestError(anuncio.estado === 'vendido' ? 'Este anuncio ya se vendió' : 'Este anuncio no está disponible por ahora');
    }

    const { chat } = await this.chats.iniciar(usuarioId, anuncio.vendedor_id);
    const chatId = idDe(chat);
    const texto = `${mensaje || `¡Hola! ¿Sigue disponible «${anuncio.titulo}»?`}\n${this.enlace(id)}`;
    const enviado = await this.chats.enviar(usuarioId, { chatId, texto });

    const previo = await this.interesados.de(id, usuarioId);
    if (previo) {
      if (previo.chat_id !== chatId) await this.interesados.update(previo, { chat_id: chatId });
    } else {
      await this.db.transaction(async (t) => {
        await this.interesados.create({ anuncio_id: id, usuario_id: usuarioId, chat_id: chatId }, t);
        await this.repository.ajustarContador(id, 'total_interesados', 1, t);
      });
      await this.notificaciones.notificar({
        usuario_id: anuncio.vendedor_id,
        de_usuario_id: usuarioId,
        tipo: 'anuncio_interes',
        mensaje: `preguntó por tu anuncio «${anuncio.titulo}»`,
        entidad_tipo: 'anuncio',
        entidad_id: id,
      });
    }
    return { anuncio_id: id, chat_id: chatId, mensaje_id: idDe(enviado), primera_vez: !previo };
  }

  /** Un reporte por persona y anuncio (no el propio). */
  async reportar(id: number, usuarioId: number, { motivo, detalle }: ReportarAnuncioDto): Promise<AnuncioReporte> {
    const anuncio = await this.visibleOrFail(id, usuarioId);
    if (anuncio.vendedor_id === usuarioId) throw new BadRequestError('No puedes reportar tu propio anuncio');
    if (await this.reportes.exists({ anuncio_id: id, usuario_id: usuarioId })) throw new ConflictError('Ya reportaste este anuncio');
    return this.reportes.create({ anuncio_id: id, usuario_id: usuarioId, motivo, detalle: detalle ?? null });
  }

  /** Para el panel de moderación (admin): reportes con el anuncio y quien reportó. */
  listarReportes(filtro: FiltroReportes, paginacion: Paginacion): Promise<Page<AnuncioReporte>> {
    return this.reportes.paginarFiltrado(filtro, paginacion);
  }

  async revisarReporte(reporteId: number, adminId: number, estado: Exclude<EstadoReporteAnuncio, 'pendiente'>): Promise<AnuncioReporte> {
    const reporte = await this.reportes.findByIdOrFail(reporteId);
    return this.reportes.update(reporte, { estado, revisado_por: adminId, revisado_en: new Date() });
  }

  /** Solo quien compró (comprador del anuncio vendido), una vez. */
  async calificar(id: number, usuarioId: number, { puntuacion, comentario }: CalificarDto): Promise<CalificacionVendedor> {
    const anuncio = await this.repository.findByIdOrFail(id, { include: [] });
    if (anuncio.estado !== 'vendido' || anuncio.comprador_id !== usuarioId) {
      throw new ForbiddenError('Solo quien compró este anuncio puede calificar al vendedor');
    }
    if (await this.privacidad.hayBloqueo(usuarioId, anuncio.vendedor_id)) throw new ForbiddenError('No puedes calificar a esta persona');
    if (await this.calificaciones.exists({ anuncio_id: id, comprador_id: usuarioId })) throw new ConflictError('Ya calificaste esta compra');
    const creada = await this.calificaciones.create({
      vendedor_id: anuncio.vendedor_id,
      comprador_id: usuarioId,
      anuncio_id: id,
      titulo_anuncio: anuncio.titulo,
      puntuacion,
      comentario: comentario ?? null,
    });
    return this.calificaciones.findByIdOrFail(creada.id);
  }

  // ---------- Permisos ----------

  /**
   * 404 si no existe, si hay bloqueo con el vendedor, si su cuenta no está activa o si está pausado (y no es mío).
   * Anuncio de grupo privado: 403 para quien no es miembro.
   */
  private async visibleOrFail(id: number, usuarioId?: number): Promise<Anuncio> {
    const anuncio = await this.repository.findById(id);
    if (!anuncio) throw new NotFoundError('Anuncio');
    if (anuncio.vendedor_id === usuarioId) return anuncio;
    if (anuncio.estado === 'pausado') throw new NotFoundError('Anuncio');
    if (usuarioId && (await this.privacidad.hayBloqueo(usuarioId, anuncio.vendedor_id))) throw new NotFoundError('Anuncio');
    if (anuncio.grupo_id) await this.asegurarVeGrupo(anuncio.grupo_id, usuarioId, anuncio.grupo ?? undefined);
    return anuncio;
  }

  /** Grupo público: cualquiera · privado: solo miembros activos. */
  private async asegurarVeGrupo(grupoId: number, usuarioId?: number, grupo?: Pick<Grupo, 'privacidad'>): Promise<void> {
    const datos = grupo ?? (await this.grupos.findByIdOrFail(grupoId));
    if (datos.privacidad !== 'privado') return;
    if (!(await this.miembros.esMiembroActivo(grupoId, usuarioId))) {
      throw new ForbiddenError('Solo los miembros del grupo ven sus anuncios');
    }
  }

  // ---------- Apoyo ----------

  enlace(id: number): string {
    return `${this.urlApp.replace(/\/+$/, '')}/marketplace/${id}`;
  }

  private renovableDesde(anuncio: Anuncio): Date | null {
    if (anuncio.estado === 'vendido') return null;
    return new Date(new Date(anuncio.renovado_en).getTime() + MS_RENOVAR);
  }

  /** Arma la lista final de fotos (ver `actualizar`). */
  private planDeFotos(actuales: AnuncioFoto[], lista: string[] | undefined, nuevas: ArchivoSubido[]): PlanFoto[] {
    if (!lista) return [...actuales.map((existente) => ({ existente })), ...nuevas.map((nueva) => ({ nueva }))];
    const porId = new Map(actuales.map((f) => [f.id, f]));
    const usadas = new Set<string>();
    const plan: PlanFoto[] = [];
    for (const token of lista) {
      if (usadas.has(token)) continue;
      usadas.add(token);
      if (token.startsWith(PREFIJO_NUEVA)) {
        const nueva = nuevas[Number(token.slice(PREFIJO_NUEVA.length))];
        if (!nueva) throw new ValidationError([{ campo: 'fotos', mensaje: `No se subió la foto ${token}` }]);
        plan.push({ nueva });
      } else {
        const existente = porId.get(Number(token));
        if (!existente) throw new ValidationError([{ campo: 'fotos', mensaje: `La foto ${token} no es de este anuncio` }]);
        plan.push({ existente });
      }
    }
    // Las nuevas que no se mencionaron van al final
    nuevas.forEach((nueva, i) => {
      if (!usadas.has(`${PREFIJO_NUEVA}${i}`)) plan.push({ nueva });
    });
    return plan;
  }

  /** Tarjetas: foto principal y "guardado" en 2 consultas para toda la página. */
  private async resumir(anuncios: Anuncio[], usuarioId?: number): Promise<AnuncioResumen[]> {
    if (!anuncios.length) return [];
    const ids = anuncios.map((a) => a.id);
    const [portadas, guardados] = await Promise.all([
      this.fotos.portadas(ids),
      usuarioId ? this.guardados.guardadosEntre(usuarioId, ids) : Promise.resolve(new Set<number>()),
    ]);
    return anuncios.map((a) => this.presentar(a, portadas.get(a.id), guardados.has(a.id), usuarioId));
  }

  private async detallar(anuncio: Anuncio, usuarioId?: number): Promise<AnuncioDetalle> {
    const [fotos, calificacion, guardado, interes, miCalificacion] = await Promise.all([
      this.fotos.de(anuncio.id),
      this.calificaciones.resumen(anuncio.vendedor_id),
      usuarioId ? this.guardados.exists({ anuncio_id: anuncio.id, usuario_id: usuarioId }) : Promise.resolve(false),
      usuarioId ? this.interesados.de(anuncio.id, usuarioId) : Promise.resolve(null),
      usuarioId ? this.calificaciones.findOne({ anuncio_id: anuncio.id, comprador_id: usuarioId }, { include: [] }) : Promise.resolve(null),
    ]);
    const esMio = anuncio.vendedor_id === usuarioId;
    const soyComprador = !!usuarioId && anuncio.comprador_id === usuarioId;
    const desde = this.renovableDesde(anuncio);
    const resumen = this.presentar(anuncio, { url: fotos[0]?.url ?? null, total: fotos.length }, guardado, usuarioId);
    return {
      ...resumen,
      fotos: fotos.map((f) => ({ id: f.id, url: f.url, orden: f.orden })),
      vendedor_calificacion: calificacion,
      comprador_id: esMio || soyComprador ? anuncio.comprador_id : null,
      me_interesa: !!interes,
      chat_id: interes?.chat_id ?? null,
      puede_renovar: esMio && !!desde && desde.getTime() <= Date.now(),
      renovable_desde: esMio ? desde : null,
      puedo_calificar: soyComprador && anuncio.estado === 'vendido' && !miCalificacion,
      mi_calificacion: miCalificacion?.puntuacion ?? null,
    };
  }

  private presentar(anuncio: Anuncio, portada: PortadaAnuncio | undefined, guardado: boolean, usuarioId?: number): AnuncioResumen {
    const { comprador_id: _comprador, ...datos } = anuncio.toJSON() as InferAttributes<Anuncio> & {
      vendedor: UsuarioPublico;
      grupo?: GrupoDeAnuncio | null;
    };
    return {
      ...datos,
      precio: anuncio.precio,
      grupo: datos.grupo ?? null,
      foto_principal: portada?.url ?? null,
      total_fotos: portada?.total ?? 0,
      guardado,
      es_mio: anuncio.vendedor_id === usuarioId,
    };
  }
}

/** Las vistas del chat se tipan como objeto plano: solo se necesita su id. */
function idDe(vista: object): number {
  return (vista as { id: number }).id;
}

const ETIQUETA_ESTADO: Record<EstadoAnuncio, string> = {
  activo: 'activo',
  reservado: 'reservado',
  vendido: 'marcado como vendido',
  pausado: 'pausado',
};

export const marketplaceService = new MarketplaceService(
  anuncioRepository,
  anuncioFotoRepository,
  anuncioGuardadoRepository,
  anuncioVisitaRepository,
  anuncioInteresadoRepository,
  anuncioReporteRepository,
  calificacionVendedorRepository,
  grupoRepository,
  grupoMiembroRepository,
  usuarioRepository,
  privacidadService,
  chatService,
  notificacionService,
  fileStorage,
  sequelize,
  env.FRONTEND_URL,
);
