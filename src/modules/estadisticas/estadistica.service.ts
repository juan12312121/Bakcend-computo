import { BaseService } from '../../core/domain/BaseService';
import { NotFoundError } from '../../core/errors';
import {
  fechaDia,
  type EstadisticaPerfilDiaria,
  type EstadisticaPublicacionDiaria,
  type EventoEstadistica,
  type Publicacion,
  type TipoReaccion,
} from '../../infrastructure/database/models';
import { privacidadService, type PrivacidadService } from '../privacidad/privacidad.service';
import { miniaturaVideo } from '../publicaciones/edicion-video';
import { publicacionRepository, type PublicacionRepository } from '../publicaciones/publicacion.repository';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { estadisticaRepository, type EstadisticaRepository, type Interaccion } from './estadistica.repository';
import type { RangoDias } from './estadistica.schemas';

/** La misma persona viendo la misma publicación (o el mismo perfil) dentro de esta ventana cuenta una sola vez. */
export const MINUTOS_SIN_DUPLICAR = 30;
/** Días que se guardan los eventos crudos (cubren el rango más largo y su periodo anterior). */
export const DIAS_EVENTOS = 200;
/** Cuántas mejores publicaciones devuelve el resumen. */
export const TOP_PUBLICACIONES = 5;

const MS_MINUTO = 60_000;
const MS_DIA = 24 * 60 * MS_MINUTO;

// ---------- Tipos de respuesta ----------

export interface ResultadoRegistro {
  registradas: number;
}

export interface TotalesInteraccion {
  interacciones: number;
  reacciones: number;
  comentarios: number;
  compartidos: number;
  guardados: number;
}

export interface TotalesResumen extends TotalesInteraccion {
  /** Personas únicas que vieron algo tuyo en el rango. */
  alcance: number;
  impresiones: number;
  reproducciones: number;
  reproducciones_historias: number;
  clics_enlace: number;
  visitas_perfil: number;
  seguidores_ganados: number;
  seguidores_perdidos: number;
  seguidores_netos: number;
  /** Seguidores al día de hoy. */
  seguidores_actuales: number;
}

/** Totales del periodo anterior del mismo largo (para mostrar el cambio). */
export interface TotalesAnteriores {
  alcance: number;
  impresiones: number;
  interacciones: number;
  visitas_perfil: number;
  seguidores_netos: number;
}

export interface Dia {
  fecha: string;
  impresiones: number;
  /** Suma de las personas únicas de cada día (una persona que vuelve otro día cuenta otra vez). */
  alcance: number;
  interacciones: number;
  reproducciones: number;
  visitas_perfil: number;
  seguidores_ganados: number;
  seguidores_perdidos: number;
}

/** Resumen corto de una publicación para listas y tarjetas. */
export interface PublicacionResumida {
  id: number;
  contenido: string;
  imagen_url: string | null;
  video_url: string | null;
  /** Primer cuadro del video (null si no es video de Cloudinary). */
  miniatura_url: string | null;
  fecha_creacion: Date;
}

export interface MejorPublicacion {
  publicacion: PublicacionResumida;
  impresiones: number;
  alcance: number;
  reproducciones: number;
  interacciones: number;
  /** Interacciones / alcance, en porcentaje con un decimal. */
  tasa_interaccion: number;
}

export interface ActividadHora {
  hora: number;
  actividad: number;
}

export interface ActividadDia {
  /** 0 = domingo … 6 = sábado. */
  dia: number;
  actividad: number;
}

export interface Conteo {
  nombre: string;
  total: number;
  /** 0-100, sobre el total de seguidores. */
  porcentaje: number;
}

export interface Audiencia {
  total_seguidores: number;
  ubicaciones: Conteo[];
  carreras: Conteo[];
  grupos: (Conteo & { grupo_id: number })[];
}

export interface ResumenCreador {
  rango: { dias: RangoDias; desde: string; hasta: string };
  totales: TotalesResumen;
  anterior: TotalesAnteriores;
  por_dia: Dia[];
  mejores_publicaciones: MejorPublicacion[];
  mejores_horas: ActividadHora[];
  mejores_dias: ActividadDia[];
  audiencia: Audiencia;
}

export interface DetallePublicacion {
  publicacion: PublicacionResumida & {
    total_likes: number;
    total_comentarios: number;
    total_compartidos: number;
    total_vistas: number;
  };
  totales: TotalesInteraccion & {
    impresiones: number;
    alcance: number;
    reproducciones: number;
    clics_enlace: number;
    tasa_interaccion: number;
  };
  reacciones_por_tipo: { tipo: TipoReaccion; total: number }[];
  por_dia: Pick<Dia, 'fecha' | 'impresiones' | 'alcance' | 'reproducciones' | 'interacciones'>[];
  mejores_horas: ActividadHora[];
  /** De quienes la vieron: cuántos te siguen y cuántos no. */
  audiencia: { seguidores: number; no_seguidores: number };
}

// ---------- Funciones puras (se prueban solas) ----------

/** Inicio del día local de `fecha`. */
export function inicioDelDia(fecha: Date): Date {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}

/** Rango de `dias` días que termina hoy (incluido): [inicio del primero, fin de hoy]. */
export function rangoDeDias(dias: number, ahora: Date = new Date()): { desde: Date; hasta: Date } {
  const hoy = inicioDelDia(ahora);
  const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - (dias - 1));
  const hasta = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1, 0, 0, 0, -1);
  return { desde, hasta };
}

/** Días 'YYYY-MM-DD' entre dos fechas (incluidas). */
export function diasEntre(desde: Date, hasta: Date): string[] {
  const dias: string[] = [];
  for (let d = inicioDelDia(desde); d <= hasta; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) dias.push(fechaDia(d));
  return dias;
}

/** Hora (0-23) y día de la semana (0-6) de un instante en la zona del navegador (`zona` = getTimezoneOffset). */
export function horaYDia(fecha: Date, zona: number): { hora: number; dia: number } {
  const local = new Date(fecha.getTime() - zona * MS_MINUTO);
  return { hora: local.getUTCHours(), dia: local.getUTCDay() };
}

/** Actividad por hora (24 entradas) y por día de la semana (7 entradas). */
export function actividadPorHorario(momentos: Date[], zona: number): { horas: ActividadHora[]; dias: ActividadDia[] } {
  const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, actividad: 0 }));
  const dias = Array.from({ length: 7 }, (_, dia) => ({ dia, actividad: 0 }));
  for (const momento of momentos) {
    const { hora, dia } = horaYDia(momento, zona);
    horas[hora].actividad++;
    dias[dia].actividad++;
  }
  return { horas, dias };
}

/** Los `limite` valores más repetidos (sin vacíos, sin distinguir mayúsculas), con su porcentaje sobre `base`. */
export function masRepetidos(valores: (string | null | undefined)[], base: number, limite: number): Conteo[] {
  const conteo = new Map<string, { nombre: string; total: number }>();
  for (const valor of valores) {
    const limpio = valor?.trim();
    if (!limpio) continue;
    const clave = limpio.toLocaleLowerCase('es');
    const actual = conteo.get(clave);
    if (actual) actual.total++;
    else conteo.set(clave, { nombre: limpio, total: 1 });
  }
  return [...conteo.values()]
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, limite)
    .map((c) => ({ ...c, porcentaje: porcentaje(c.total, base) }));
}

/** Cuenta las interacciones por tipo. */
export function contarInteracciones(lista: Interaccion[]): TotalesInteraccion {
  const totales: TotalesInteraccion = { interacciones: lista.length, reacciones: 0, comentarios: 0, compartidos: 0, guardados: 0 };
  for (const i of lista) {
    if (i.tipo === 'reaccion') totales.reacciones++;
    else if (i.tipo === 'comentario') totales.comentarios++;
    else if (i.tipo === 'compartido') totales.compartidos++;
    else totales.guardados++;
  }
  return totales;
}

/** Porcentaje entero (0-100). */
export function porcentaje(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 100) : 0;
}

/** Interacciones sobre alcance, en porcentaje con un decimal. */
export function tasaInteraccion(interacciones: number, alcance: number): number {
  return alcance > 0 ? Math.round((interacciones / alcance) * 1000) / 10 : 0;
}

function resumida(p: Publicacion): PublicacionResumida {
  return {
    id: p.id,
    contenido: p.contenido.length > 160 ? `${p.contenido.slice(0, 157)}...` : p.contenido,
    imagen_url: p.imagen_url,
    video_url: p.video_url,
    miniatura_url: p.video_url ? miniaturaVideo(p.video_original_url ?? p.video_url) : null,
    fecha_creacion: p.fecha_creacion,
  };
}

const suma = <T>(filas: T[], campo: (f: T) => number) => filas.reduce((total, f) => total + campo(f), 0);

/**
 * Estadísticas para creadores: registra impresiones, visitas al perfil y clics (sin duplicar a la misma persona
 * en 30 min) y arma el panel del dueño. Las reproducciones de video e historias las suman sus propios módulos.
 */
export class EstadisticaService extends BaseService<EventoEstadistica, EstadisticaRepository> {
  constructor(
    repository: EstadisticaRepository,
    private readonly publicaciones: PublicacionRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly privacidad: PrivacidadService,
  ) {
    super(repository);
  }

  // ---------- Registrar ----------

  /**
   * Lote de publicaciones que el usuario vio en pantalla. Cuenta solo las que puede ver, que no son suyas
   * y que no vio en los últimos 30 min. La primera del día de cada persona suma al alcance de ese día.
   */
  async registrarImpresiones(usuarioId: number, publicacionIds: number[]): Promise<ResultadoRegistro> {
    const visibles = (await this.publicaciones.visiblesPorIds(publicacionIds, usuarioId)).filter((p) => p.usuario_id !== usuarioId);
    if (!visibles.length) return { registradas: 0 };

    const ahora = new Date();
    const recientes = await this.repository.conEventoDesde(
      'impresion',
      usuarioId,
      visibles.map((p) => p.id),
      new Date(ahora.getTime() - MINUTOS_SIN_DUPLICAR * MS_MINUTO),
    );
    const nuevas = visibles.filter((p) => !recientes.has(p.id));
    if (!nuevas.length) return { registradas: 0 };

    const vistasHoy = await this.repository.conEventoDesde('impresion', usuarioId, nuevas.map((p) => p.id), inicioDelDia(ahora));
    await this.repository.registrarEventos(
      nuevas.map((p) => ({ tipo: 'impresion' as const, dueno_id: p.usuario_id, usuario_id: usuarioId, publicacion_id: p.id })),
    );
    for (const p of nuevas) {
      await this.repository.sumarPublicacion(p.id, p.usuario_id, 'impresiones');
      if (!vistasHoy.has(p.id)) await this.repository.sumarPublicacion(p.id, p.usuario_id, 'alcance');
    }
    return { registradas: nuevas.length };
  }

  /** Visita al perfil de otra persona (no cuenta la propia, con bloqueo ni repetida en 30 min). */
  async registrarVisitaPerfil(usuarioId: number, perfilId: number): Promise<ResultadoRegistro> {
    if (usuarioId === perfilId) return { registradas: 0 };
    const perfil = await this.usuarios.findById(perfilId, { attributes: ['id', 'activo'] });
    if (!perfil || !perfil.activo) throw new NotFoundError('Usuario');
    if (await this.privacidad.hayBloqueo(usuarioId, perfilId)) return { registradas: 0 };

    const desde = new Date(Date.now() - MINUTOS_SIN_DUPLICAR * MS_MINUTO);
    if (await this.repository.hayEventoDePerfil('visita_perfil', usuarioId, perfilId, desde)) return { registradas: 0 };
    await this.repository.registrarEventos([{ tipo: 'visita_perfil', dueno_id: perfilId, usuario_id: usuarioId, publicacion_id: null }]);
    await this.repository.sumarPerfil(perfilId, 'visitas_perfil');
    return { registradas: 1 };
  }

  /** Clic en un enlace de una publicación visible (no cuenta el autor ni repetido en 30 min). */
  async registrarClic(usuarioId: number, publicacionId: number): Promise<ResultadoRegistro> {
    const publicacion = await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    if (publicacion.usuario_id === usuarioId) return { registradas: 0 };
    const desde = new Date(Date.now() - MINUTOS_SIN_DUPLICAR * MS_MINUTO);
    if ((await this.repository.conEventoDesde('clic_enlace', usuarioId, [publicacionId], desde)).size) return { registradas: 0 };
    await this.repository.registrarEventos([{ tipo: 'clic_enlace', dueno_id: publicacion.usuario_id, usuario_id: usuarioId, publicacion_id: publicacionId }]);
    await this.repository.sumarPublicacion(publicacionId, publicacion.usuario_id, 'clics_enlace');
    return { registradas: 1 };
  }

  /** Borra los eventos crudos de más de `DIAS_EVENTOS` días (los totales diarios se conservan). */
  limpiarEventosAntiguos(ahora: Date = new Date()): Promise<number> {
    return this.repository.limpiarEventos(new Date(ahora.getTime() - DIAS_EVENTOS * MS_DIA));
  }

  // ---------- Panel del creador ----------

  /** Resumen del creador para los últimos 7, 28 o 90 días (solo sus propias estadísticas). */
  async resumen(usuarioId: number, dias: RangoDias, zona = 0, ahora: Date = new Date()): Promise<ResumenCreador> {
    const usuario = await this.usuarios.findByIdOrFail(usuarioId, { attributes: ['id', 'total_seguidores'] });
    const { desde, hasta } = rangoDeDias(dias, ahora);
    const anteriorHasta = new Date(desde.getTime() - 1);
    const anteriorDesde = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate() - dias);
    const [d, h, dAnt, hAnt] = [fechaDia(desde), fechaDia(hasta), fechaDia(anteriorDesde), fechaDia(anteriorHasta)];

    const publicaciones = await this.repository.publicacionesDe(usuarioId);
    const ids = publicaciones.map((p) => p.id);
    const [pubDiarias, perfilDiarias, interacciones, alcance, momentos, pubAnt, perfilAnt, interAnt, alcanceAnt] = await Promise.all([
      this.repository.diariasDePublicaciones(usuarioId, d, h),
      this.repository.diariasDePerfil(usuarioId, d, h),
      this.repository.interacciones(ids, usuarioId, desde, hasta),
      this.repository.alcanceUnico(usuarioId, desde, hasta),
      this.repository.momentosImpresiones(usuarioId, desde, hasta),
      this.repository.diariasDePublicaciones(usuarioId, dAnt, hAnt),
      this.repository.diariasDePerfil(usuarioId, dAnt, hAnt),
      this.repository.interacciones(ids, usuarioId, anteriorDesde, anteriorHasta),
      this.repository.alcanceUnico(usuarioId, anteriorDesde, anteriorHasta),
    ]);

    const porTipo = contarInteracciones(interacciones);
    const ganados = suma(perfilDiarias, (f) => f.seguidores_ganados);
    const perdidos = suma(perfilDiarias, (f) => f.seguidores_perdidos);
    const totales: TotalesResumen = {
      ...porTipo,
      alcance,
      impresiones: suma(pubDiarias, (f) => f.impresiones),
      reproducciones: suma(pubDiarias, (f) => f.reproducciones),
      clics_enlace: suma(pubDiarias, (f) => f.clics_enlace),
      reproducciones_historias: suma(perfilDiarias, (f) => f.reproducciones_historias),
      visitas_perfil: suma(perfilDiarias, (f) => f.visitas_perfil),
      seguidores_ganados: ganados,
      seguidores_perdidos: perdidos,
      seguidores_netos: ganados - perdidos,
      seguidores_actuales: usuario.total_seguidores,
    };
    const anterior: TotalesAnteriores = {
      alcance: alcanceAnt,
      impresiones: suma(pubAnt, (f) => f.impresiones),
      interacciones: interAnt.length,
      visitas_perfil: suma(perfilAnt, (f) => f.visitas_perfil),
      seguidores_netos: suma(perfilAnt, (f) => f.seguidores_ganados - f.seguidores_perdidos),
    };

    const { horas, dias: semana } = actividadPorHorario([...momentos, ...interacciones.map((i) => i.fecha)], zona);
    return {
      rango: { dias, desde: d, hasta: h },
      totales,
      anterior,
      por_dia: this.porDia(diasEntre(desde, hasta), pubDiarias, perfilDiarias, interacciones),
      mejores_publicaciones: this.mejores(publicaciones, pubDiarias, interacciones),
      mejores_horas: horas,
      mejores_dias: semana,
      audiencia: await this.audiencia(usuarioId),
    };
  }

  /** Estadísticas de una publicación propia desde que se publicó (por día, los últimos 90 días). */
  async detallePublicacion(usuarioId: number, publicacionId: number, zona = 0, ahora: Date = new Date()): Promise<DetallePublicacion> {
    const publicacion = await this.publicaciones.findByIdOrFail(publicacionId);
    this.asegurarDueno(publicacion.usuario_id, usuarioId, 'Solo el autor puede ver las estadísticas de su publicación');

    const inicio = new Date(Math.max(publicacion.fecha_creacion.getTime(), rangoDeDias(90, ahora).desde.getTime()));
    const [diarias, interacciones, alcance, espectadores, seguidores] = await Promise.all([
      this.repository.diariasDePublicacion(publicacionId),
      this.repository.interacciones([publicacionId], usuarioId, new Date(0), ahora),
      this.repository.alcanceUnico(usuarioId, new Date(0), ahora, publicacionId),
      this.repository.espectadoresDe(publicacionId),
      this.repository.idsSeguidores(usuarioId),
    ]);

    const porTipo = contarInteracciones(interacciones);
    const reacciones = new Map<TipoReaccion, number>();
    for (const i of interacciones) if (i.reaccion) reacciones.set(i.reaccion, (reacciones.get(i.reaccion) ?? 0) + 1);
    const siguen = new Set(seguidores);
    const deSeguidores = espectadores.filter((id) => siguen.has(id)).length;
    const alcanceTotal = Math.max(alcance, espectadores.length);

    return {
      publicacion: {
        ...resumida(publicacion),
        total_likes: publicacion.total_likes,
        total_comentarios: publicacion.total_comentarios,
        total_compartidos: publicacion.total_compartidos,
        total_vistas: publicacion.total_vistas,
      },
      totales: {
        ...porTipo,
        impresiones: suma(diarias, (f) => f.impresiones),
        alcance: alcanceTotal,
        reproducciones: suma(diarias, (f) => f.reproducciones),
        clics_enlace: suma(diarias, (f) => f.clics_enlace),
        tasa_interaccion: tasaInteraccion(porTipo.interacciones, alcanceTotal),
      },
      reacciones_por_tipo: [...reacciones.entries()].map(([tipo, total]) => ({ tipo, total })).sort((a, b) => b.total - a.total),
      por_dia: this.porDia(diasEntre(inicio, ahora), diarias, [], interacciones).map(({ fecha, impresiones, alcance: a, reproducciones, interacciones: i }) => ({
        fecha,
        impresiones,
        alcance: a,
        reproducciones,
        interacciones: i,
      })),
      mejores_horas: actividadPorHorario(interacciones.map((i) => i.fecha), zona).horas,
      audiencia: { seguidores: deSeguidores, no_seguidores: espectadores.length - deSeguidores },
    };
  }

  // ---------- Apoyo ----------

  private porDia(
    fechas: string[],
    pubDiarias: EstadisticaPublicacionDiaria[],
    perfilDiarias: EstadisticaPerfilDiaria[],
    interacciones: Interaccion[],
  ): Dia[] {
    const dias = new Map<string, Dia>(
      fechas.map((fecha) => [
        fecha,
        { fecha, impresiones: 0, alcance: 0, interacciones: 0, reproducciones: 0, visitas_perfil: 0, seguidores_ganados: 0, seguidores_perdidos: 0 },
      ]),
    );
    for (const f of pubDiarias) {
      const dia = dias.get(f.fecha);
      if (!dia) continue;
      dia.impresiones += f.impresiones;
      dia.alcance += f.alcance;
      dia.reproducciones += f.reproducciones;
    }
    for (const f of perfilDiarias) {
      const dia = dias.get(f.fecha);
      if (!dia) continue;
      dia.visitas_perfil += f.visitas_perfil;
      dia.seguidores_ganados += f.seguidores_ganados;
      dia.seguidores_perdidos += f.seguidores_perdidos;
    }
    for (const i of interacciones) {
      const dia = dias.get(fechaDia(i.fecha));
      if (dia) dia.interacciones++;
    }
    return [...dias.values()];
  }

  /** Mejores publicaciones del rango: más interacciones, luego más impresiones (solo las que tuvieron algo). */
  private mejores(publicaciones: Publicacion[], diarias: EstadisticaPublicacionDiaria[], interacciones: Interaccion[]): MejorPublicacion[] {
    const datos = new Map<number, { impresiones: number; alcance: number; reproducciones: number; interacciones: number }>();
    const de = (id: number) => {
      let d = datos.get(id);
      if (!d) datos.set(id, (d = { impresiones: 0, alcance: 0, reproducciones: 0, interacciones: 0 }));
      return d;
    };
    for (const f of diarias) {
      const d = de(f.publicacion_id);
      d.impresiones += f.impresiones;
      d.alcance += f.alcance;
      d.reproducciones += f.reproducciones;
    }
    for (const i of interacciones) de(i.publicacion_id).interacciones++;

    const porId = new Map(publicaciones.map((p) => [p.id, p]));
    return [...datos.entries()]
      .filter(([id, d]) => porId.has(id) && d.impresiones + d.interacciones + d.reproducciones > 0)
      .sort(([idA, a], [idB, b]) => b.interacciones - a.interacciones || b.impresiones - a.impresiones || idB - idA)
      .slice(0, TOP_PUBLICACIONES)
      .map(([id, d]) => ({ publicacion: resumida(porId.get(id) as Publicacion), ...d, tasa_interaccion: tasaInteraccion(d.interacciones, d.alcance) }));
  }

  /** Seguidores por ubicación, carrera y grupos en los que participan. */
  private async audiencia(usuarioId: number): Promise<Audiencia> {
    const seguidores = await this.repository.idsSeguidores(usuarioId);
    const total = seguidores.length;
    const [datos, grupos] = await Promise.all([this.repository.datosDe(seguidores), this.repository.gruposDe(seguidores, 5)]);
    return {
      total_seguidores: total,
      ubicaciones: masRepetidos(datos.map((d) => d.ubicacion), total, 6),
      carreras: masRepetidos(datos.map((d) => d.carrera), total, 6),
      grupos: grupos.map((g) => ({ grupo_id: g.grupo_id, nombre: g.nombre, total: g.total, porcentaje: porcentaje(g.total, total) })),
    };
  }
}

export const estadisticaService = new EstadisticaService(estadisticaRepository, publicacionRepository, usuarioRepository, privacidadService);

/**
 * Limpia una vez al día los eventos crudos viejos (los totales por día se quedan). `unref()` evita que el
 * temporizador mantenga vivo el proceso. Se llama una vez al arrancar el servidor.
 */
export function programarLimpiezaEstadisticas(): NodeJS.Timeout;
export function programarLimpiezaEstadisticas(intervaloMs: number): NodeJS.Timeout;
export function programarLimpiezaEstadisticas(intervaloMs: number = MS_DIA): NodeJS.Timeout {
  const temporizador = setInterval(() => {
    estadisticaService
      .limpiarEventosAntiguos()
      .catch((error: Error) => console.warn('No se pudieron limpiar los eventos de estadísticas:', error.message));
  }, intervaloMs);
  temporizador.unref();
  return temporizador;
}
