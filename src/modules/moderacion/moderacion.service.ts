import { Op, type InferAttributes, type Sequelize } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { ContextoPeticion } from '../../core/http/ContextoPeticion';
import type { Paginacion } from '../../core/validation/common.schemas';
import {
  sequelize,
  TIPOS_CONTENIDO_REPORTABLE,
  type AccionModeracion,
  type ContextoTexto,
  type CopiaContenido,
  type EntidadNotificacion,
  type EstadoReporte,
  type MotivoReporte,
  type NotaModeracion,
  type ReporteContenido,
  type Suspension,
  type TipoContenidoReportable,
  type Usuario,
} from '../../infrastructure/database/models';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { reporteService, type ReporteService } from '../reportes/reporte.service';
import { reporteRepository as reportePublicacionRepository, type ReporteRepository as ReportePublicacionRepository } from '../reportes/reporte.repository';
import { logSeguridadRepository, type LogSeguridadRepository } from '../seguridad/log-seguridad.repository';
import { ATRIBUTOS_USUARIO_PUBLICO, usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { accionModeracionRepository, type AccionModeracionRepository, type FiltrosHistorial } from './accion-moderacion.repository';
import { proveedoresPorDefecto, type ProveedorContenido } from './contenidos';
import { copiaPublicacion } from './copias';
import type { ResultadoRevision } from './filtro-palabras';
import type { AccionResolver, CrearReporteContenidoDto, ResolverDto, SuspenderDto } from './moderacion.schemas';
import { notaModeracionRepository, type NotaModeracionRepository } from './nota-moderacion.repository';
import { palabrasService, type PalabrasService } from './palabras.service';
import {
  ATRIBUTOS_USUARIO_MODERACION,
  reporteContenidoRepository,
  type ClaveContenido,
  type FiltrosBandeja,
  type ReporteContenidoRepository,
} from './reporte-contenido.repository';
import { suspensionService, type EstadoSuspension, type SuspensionService } from './suspension.service';

/** Eventos que deja la moderación en la bitácora de seguridad (los de suspender son los mismos que usa /admin). */
export const EVENTOS_MODERACION = {
  borrarContenido: 'ADMIN_DELETE_CONTENT',
  suspender: 'ADMIN_SUSPEND_USER',
  reactivar: 'ADMIN_UNSUSPEND_USER',
} as const;

/** Cuántos reportantes y descripciones se muestran en la tarjeta de la bandeja. */
export const MUESTRA_REPORTANTES = 5;

const DIA_MS = 24 * 60 * 60 * 1000;

const NOMBRE_TIPO: Record<TipoContenidoReportable, string> = {
  publicacion: 'una publicación',
  comentario: 'un comentario',
  mensaje_chat: 'un mensaje',
  mensaje_grupo: 'un mensaje de grupo',
  usuario: 'una cuenta',
  grupo: 'un grupo',
  evento: 'un evento',
  publicacion_canal: 'una publicación de canal',
};

type UsuarioPublico = Pick<InferAttributes<Usuario>, (typeof ATRIBUTOS_USUARIO_PUBLICO)[number]>;

/** Autor de un contenido reportado, con su suspensión activa si la tiene. */
export type AutorReportado = UsuarioPublico & {
  suspendido: boolean;
  /** null si no está suspendido o si la suspensión es permanente (mira `suspendido`). */
  suspension_hasta: Date | null;
};

export interface ResultadoReporteContenido {
  reporte: ReporteContenido;
  /** Reportes pendientes del contenido (en publicaciones: todos, como en /reportes/crear). */
  total_reportes: number;
  /** Solo publicaciones: true si con este reporte quedó oculta (5 reportes). */
  publicacion_oculta?: boolean;
}

/** Tarjeta de la bandeja: un contenido con sus reportes agrupados. */
export interface ContenidoReportado extends ClaveContenido {
  estado: EstadoReporte;
  total_reportes: number;
  motivos: { motivo: MotivoReporte; total: number }[];
  primer_reporte: Date;
  ultimo_reporte: Date;
  /** Copia del contenido tomada en el reporte más reciente. */
  copia: CopiaContenido | null;
  autor: AutorReportado | null;
  reportantes: UsuarioPublico[];
  descripciones: { usuario: UsuarioPublico | null; motivo: MotivoReporte; descripcion: string; fecha: Date }[];
  /** false si el contenido ya no existe (se borró después de reportarlo). */
  existe: boolean;
  /** Acciones que admite este contenido al resolver. */
  acciones: AccionResolver[];
}

export interface DetalleContenidoReportado extends ContenidoReportado {
  reportes: ReporteContenido[];
  notas: NotaModeracion[];
  historial: AccionModeracion[];
}

export interface ResultadoResolucion extends ClaveContenido {
  estado: Exclude<EstadoReporte, 'pendiente'>;
  acciones: AccionResolver[];
  reportes_cerrados: number;
  reportantes_avisados: number;
  suspension: EstadoSuspension | null;
}

export interface UsuarioMasReportado {
  usuario: AutorReportado;
  reportes: number;
  pendientes: number;
  contenidos_reportados: number;
}

export interface EstadisticasModeracion {
  pendientes: { reportes: number; contenidos: number; por_tipo: Record<TipoContenidoReportable, number> };
  /** Contenidos cerrados por día (UTC), del más viejo al más nuevo. */
  resueltos_por_dia: { fecha: string; resueltos: number; descartados: number }[];
  total_resueltos: number;
  total_descartados: number;
  motivos: { motivo: MotivoReporte; total: number }[];
  usuarios_mas_reportados: UsuarioMasReportado[];
}

const clave = (c: ClaveContenido): string => `${c.tipo}:${c.contenido_id}`;

/**
 * Moderación de todo el contenido: reportes de cualquier tipo en una bandeja común, resolución con
 * acciones (descartar, ocultar/borrar, advertir, suspender), historial, notas internas, estadísticas
 * y revisión de textos contra las palabras prohibidas.
 */
export class ModeracionService extends BaseService<ReporteContenido, ReporteContenidoRepository> {
  private readonly proveedores = new Map<TipoContenidoReportable, ProveedorContenido>();

  constructor(
    repository: ReporteContenidoRepository,
    private readonly acciones: AccionModeracionRepository,
    private readonly notas: NotaModeracionRepository,
    private readonly reportesPublicaciones: ReporteService,
    private readonly reportesAnteriores: ReportePublicacionRepository,
    private readonly suspensiones: SuspensionService,
    private readonly palabras: PalabrasService,
    private readonly notificaciones: NotificacionService,
    private readonly logs: LogSeguridadRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly db: Sequelize,
    proveedores: ProveedorContenido[],
  ) {
    super(repository);
    proveedores.forEach((p) => this.registrarProveedor(p));
  }

  /** Agrega (o reemplaza) cómo se lee/borra un tipo de contenido. Lo usa el módulo de canales. */
  registrarProveedor(proveedor: ProveedorContenido): void {
    this.proveedores.set(proveedor.tipo, proveedor);
  }

  tiposDisponibles(): TipoContenidoReportable[] {
    return TIPOS_CONTENIDO_REPORTABLE.filter((t) => this.proveedores.has(t));
  }

  // ---------- Reportar ----------

  /**
   * Un reporte por persona y contenido, con copia del contenido. Las publicaciones pasan por ReporteService
   * (conservan el ocultado automático a los 5 reportes) y quedan también en la bandeja común.
   */
  async reportar(usuarioId: number, { tipo, id, motivo, descripcion }: CrearReporteContenidoDto): Promise<ResultadoReporteContenido> {
    if (tipo === 'publicacion') {
      const r = await this.reportesPublicaciones.crear(usuarioId, { publicacion_id: id, motivo, descripcion });
      return { reporte: r.reporte_moderacion, total_reportes: r.total_reportes, publicacion_oculta: r.publicacion_oculta };
    }

    const contenido = await this.proveedor(tipo).paraReportar(id, usuarioId);
    if (contenido.autor_id === usuarioId) {
      throw new BadRequestError(tipo === 'usuario' ? 'No puedes reportarte a ti mismo' : 'No puedes reportar tu propio contenido');
    }
    if (await this.repository.exists({ tipo, contenido_id: id, usuario_id: usuarioId })) {
      throw new ConflictError('Ya reportaste este contenido');
    }

    const reporte = await this.repository.create({
      tipo,
      contenido_id: id,
      usuario_id: usuarioId,
      autor_id: contenido.autor_id,
      motivo,
      descripcion: descripcion ?? null,
      copia: contenido.copia,
    });
    return { reporte, total_reportes: await this.repository.contarPendientesDe({ tipo, contenido_id: id }) };
  }

  // ---------- Bandeja ----------

  async bandeja(filtros: FiltrosBandeja, paginacion: Paginacion): Promise<Page<ContenidoReportado>> {
    const { filas, total } = await this.repository.gruposPaginados(filtros, paginacion);
    const reportes = await this.repository.deContenidos(filas, filtros.estado);
    return { items: await this.armar(filas, reportes, () => filtros.estado), total, ...paginacion };
  }

  /** Todo sobre un contenido: reportes (de cualquier estado), notas internas e historial de acciones. */
  async detalle(contenido: ClaveContenido): Promise<DetalleContenidoReportado> {
    const reportes = await this.repository.deContenidos([contenido]);
    if (!reportes.length) throw new NotFoundError('Contenido reportado', 'Ese contenido no tiene reportes');
    const [resumen] = await this.armar([contenido], reportes, (lista) =>
      lista.some((r) => r.estado === 'pendiente') ? 'pendiente' : lista[0].estado,
    );
    const [notas, historial] = await Promise.all([this.notas.deContenido(contenido), this.acciones.deContenido(contenido)]);
    return { ...resumen, reportes, notas, historial };
  }

  // ---------- Resolver ----------

  async resolver(adminId: number, contenido: ClaveContenido, datos: ResolverDto, contexto: ContextoPeticion): Promise<ResultadoResolucion> {
    const pendientes = await this.repository.pendientesDe(contenido);
    if (!pendientes.length) throw new ConflictError('Este contenido no tiene reportes pendientes');

    const acciones = new Set(datos.acciones);
    const proveedor = this.proveedores.get(contenido.tipo) ?? null;
    for (const accion of ['ocultar', 'borrar'] as const) {
      if (acciones.has(accion) && !proveedor?.acciones.includes(accion)) {
        throw new BadRequestError(`No se puede ${accion} ${NOMBRE_TIPO[contenido.tipo]} desde la moderación`);
      }
    }
    const autorId = pendientes.find((r) => r.autor_id)?.autor_id ?? null;
    if ((acciones.has('advertir') || acciones.has('suspender')) && !autorId) {
      throw new BadRequestError('Este contenido no tiene un autor al que advertir o suspender');
    }
    if (acciones.has('suspender') && autorId === adminId) throw new BadRequestError('No puedes suspenderte a ti mismo');

    // 1) El contenido (si ya no existe, se da por borrado).
    let borrado = false;
    if (acciones.has('borrar')) borrado = await this.ignorarSiNoExiste(() => proveedor!.borrar!(contenido.contenido_id, adminId));
    if (acciones.has('ocultar')) await this.ignorarSiNoExiste(() => proveedor!.ocultar!(contenido.contenido_id, adminId));

    // 2) Reportes, historial, nota y suspensión en una transacción.
    const estado = acciones.has('descartar') ? 'descartado' : 'resuelto';
    let suspension: EstadoSuspension | null = null;
    const cerrados = await this.db.transaction(async (t) => {
      const cambiados = await this.repository.cerrarPendientes(contenido, estado, adminId, t);
      for (const accion of datos.acciones) {
        await this.acciones.create(
          { admin_id: adminId, accion, ...contenido, autor_id: autorId, detalle: this.detalleDe(accion, datos) },
          t,
        );
      }
      if (datos.nota) await this.notas.create({ admin_id: adminId, ...contenido, texto: datos.nota }, t);
      if (acciones.has('borrar')) {
        await this.logs.registrar(adminId, EVENTOS_MODERACION.borrarContenido, { ...contenido, autorId }, contexto, t);
      }
      if (acciones.has('suspender') && autorId) {
        const motivo = datos.mensaje ?? `Reportes: ${[...new Set(pendientes.map((r) => r.motivo))].join(', ')}`;
        suspension = await this.suspensiones.suspender(autorId, { adminId, dias: datos.dias ?? null, motivo }, t);
        await this.logs.registrar(
          adminId,
          EVENTOS_MODERACION.suspender,
          { targetUserId: autorId, motivo, dias: datos.dias ?? null, ...contenido },
          contexto,
          t,
        );
      }
      return cambiados;
    });

    // 3) Avisos (después de guardar).
    const entidad = borrado ? {} : this.entidadDe(contenido, pendientes[0]?.copia ?? null);
    if (acciones.has('advertir') && autorId) {
      await this.notificaciones.notificar({
        usuario_id: autorId,
        de_usuario_id: adminId,
        tipo: 'reporte_resuelto',
        mensaje: `Advertencia de moderación: ${datos.mensaje}`,
        ...entidad,
      });
    }
    let avisados = 0;
    if (datos.avisar_reportantes) {
      const mensaje =
        estado === 'descartado'
          ? `Revisamos tu reporte sobre ${NOMBRE_TIPO[contenido.tipo]} y no encontramos una falta a las normas de la comunidad.`
          : `Revisamos tu reporte sobre ${NOMBRE_TIPO[contenido.tipo]} y tomamos medidas. ¡Gracias por ayudar a cuidar la comunidad!`;
      for (const usuarioId of new Set(pendientes.map((r) => r.usuario_id))) {
        if (usuarioId === autorId) continue;
        if (await this.notificaciones.notificar({ usuario_id: usuarioId, de_usuario_id: adminId, tipo: 'reporte_resuelto', mensaje })) avisados++;
      }
    }

    return { ...contenido, estado, acciones: datos.acciones, reportes_cerrados: cerrados, reportantes_avisados: avisados, suspension };
  }

  /** Nota interna sobre un contenido con reportes. */
  async agregarNota(adminId: number, contenido: ClaveContenido, texto: string): Promise<NotaModeracion> {
    if (!(await this.repository.exists({ tipo: contenido.tipo, contenido_id: contenido.contenido_id }))) {
      throw new NotFoundError('Contenido reportado', 'Ese contenido no tiene reportes');
    }
    const nota = await this.notas.create({ admin_id: adminId, ...contenido, texto });
    return this.notas.findByIdOrFail(nota.id);
  }

  historial(filtros: FiltrosHistorial, paginacion: Paginacion): Promise<Page<AccionModeracion>> {
    return this.acciones.listar(filtros, paginacion);
  }

  // ---------- Suspensiones directas ----------

  async suspenderUsuario(adminId: number, usuarioId: number, { dias, motivo }: SuspenderDto, contexto: ContextoPeticion): Promise<EstadoSuspension> {
    if (adminId === usuarioId) throw new BadRequestError('No puedes suspenderte a ti mismo');
    await this.usuarios.findByIdOrFail(usuarioId);
    return this.db.transaction(async (t) => {
      const estado = await this.suspensiones.suspender(usuarioId, { adminId, dias: dias ?? null, motivo: motivo ?? null }, t);
      await this.acciones.create(
        { admin_id: adminId, accion: 'suspender', tipo: 'usuario', contenido_id: usuarioId, autor_id: usuarioId, detalle: this.textoDias(dias) },
        t,
      );
      await this.logs.registrar(adminId, EVENTOS_MODERACION.suspender, { targetUserId: usuarioId, motivo: motivo ?? null, dias: dias ?? null }, contexto, t);
      return estado;
    });
  }

  async levantarSuspension(adminId: number, usuarioId: number, contexto: ContextoPeticion): Promise<EstadoSuspension> {
    const usuario = await this.usuarios.findByIdOrFail(usuarioId);
    if (!usuario.suspendido) throw new BadRequestError('El usuario no está suspendido');
    return this.db.transaction(async (t) => {
      const estado = await this.suspensiones.levantar(usuarioId, t);
      await this.acciones.create({ admin_id: adminId, accion: 'levantar_suspension', tipo: 'usuario', contenido_id: usuarioId, autor_id: usuarioId }, t);
      await this.logs.registrar(adminId, EVENTOS_MODERACION.reactivar, { targetUserId: usuarioId, motivo: null }, contexto, t);
      return estado;
    });
  }

  listarSuspensiones(soloActivas: boolean, paginacion: Paginacion): Promise<Page<Suspension>> {
    return this.suspensiones.listar(soloActivas, paginacion);
  }

  // ---------- Estadísticas ----------

  async estadisticas(dias: number, ahora: Date = new Date()): Promise<EstadisticasModeracion> {
    const hoy = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
    const desde = new Date(hoy - (dias - 1) * DIA_MS);
    const [reportesPendientes, porTipo, cerrados, motivos, usuarios] = await Promise.all([
      this.repository.count({ estado: 'pendiente' }),
      this.repository.pendientesPorTipo(),
      this.repository.cerradosDesde(desde),
      this.repository.conteoMotivos(),
      this.usuariosMasReportados(5),
    ]);

    const porDia = new Map<string, { resueltos: Set<string>; descartados: Set<string> }>();
    for (let i = 0; i < dias; i++) {
      porDia.set(new Date(desde.getTime() + i * DIA_MS).toISOString().slice(0, 10), { resueltos: new Set(), descartados: new Set() });
    }
    for (const r of cerrados) {
      const dia = r.fecha_resolucion ? porDia.get(new Date(r.fecha_resolucion).toISOString().slice(0, 10)) : undefined;
      dia?.[r.estado === 'descartado' ? 'descartados' : 'resueltos'].add(clave(r));
    }
    const resueltosPorDia = [...porDia].map(([fecha, d]) => ({ fecha, resueltos: d.resueltos.size, descartados: d.descartados.size }));

    return {
      pendientes: {
        reportes: reportesPendientes,
        contenidos: [...porTipo.values()].reduce((a, b) => a + b, 0),
        por_tipo: Object.fromEntries(TIPOS_CONTENIDO_REPORTABLE.map((t) => [t, porTipo.get(t) ?? 0])) as Record<TipoContenidoReportable, number>,
      },
      resueltos_por_dia: resueltosPorDia,
      total_resueltos: resueltosPorDia.reduce((a, d) => a + d.resueltos, 0),
      total_descartados: resueltosPorDia.reduce((a, d) => a + d.descartados, 0),
      motivos,
      usuarios_mas_reportados: usuarios,
    };
  }

  /** Autores con más reportes recibidos en cualquier contenido. */
  async usuariosMasReportados(limite: number): Promise<UsuarioMasReportado[]> {
    const filas = await this.repository.autoresMasReportados(limite);
    const ids = filas.map((f) => f.autor_id);
    if (!ids.length) return [];
    const [usuarios, pendientes, contenidos, suspensiones] = await Promise.all([
      this.usuarios.findAll({ id: { [Op.in]: ids } }, { attributes: [...ATRIBUTOS_USUARIO_MODERACION] }),
      this.repository.conteoPorAutor(ids, 'pendiente'),
      this.repository.contenidosPorAutor(ids),
      this.suspensiones.activasDe(ids),
    ]);
    const porId = new Map(usuarios.map((u) => [u.id, u]));
    return filas
      .filter((f) => porId.has(f.autor_id))
      .map((f) => ({
        usuario: this.autor(porId.get(f.autor_id)!, suspensiones.get(f.autor_id)),
        reportes: f.total,
        pendientes: pendientes.get(f.autor_id) ?? 0,
        contenidos_reportados: contenidos.get(f.autor_id) ?? 0,
      }));
  }

  // ---------- Palabras prohibidas y compatibilidad ----------

  /** Revisa un texto contra las palabras prohibidas (atajo de palabrasService). */
  revisarTexto(texto: string, contexto: ContextoTexto): Promise<ResultadoRevision> {
    return this.palabras.revisarTexto(texto, contexto);
  }

  /**
   * Copia a la bandeja común los reportes de publicaciones hechos antes de este módulo (idempotente).
   * Devuelve cuántos copió.
   */
  async importarReportesPublicaciones(): Promise<number> {
    const [anteriores, existentes] = await Promise.all([
      this.reportesAnteriores.todosConPublicacion(),
      this.repository.findAll({ tipo: 'publicacion' }, { attributes: ['contenido_id', 'usuario_id'], include: [] }),
    ]);
    const ya = new Set(existentes.map((r) => `${r.contenido_id}:${r.usuario_id}`));
    const nuevos = anteriores.filter((r) => r.publicacion && !ya.has(`${r.publicacion_id}:${r.usuario_id}`));
    await this.db.transaction(async (t) => {
      for (const r of nuevos) {
        const ocultada = r.publicacion!.oculto;
        await this.repository.create(
          {
            tipo: 'publicacion',
            contenido_id: r.publicacion_id,
            usuario_id: r.usuario_id,
            autor_id: r.publicacion!.usuario_id,
            motivo: r.motivo,
            descripcion: r.descripcion ?? null,
            copia: copiaPublicacion(r.publicacion!),
            estado: ocultada ? 'resuelto' : 'pendiente',
            fecha_resolucion: ocultada ? new Date() : null,
          },
          t,
        );
      }
    });
    return nuevos.length;
  }

  // ---------- Apoyo ----------

  private proveedor(tipo: TipoContenidoReportable): ProveedorContenido {
    const proveedor = this.proveedores.get(tipo);
    if (!proveedor) throw new BadRequestError(`Todavía no se puede reportar ${NOMBRE_TIPO[tipo]}`);
    return proveedor;
  }

  /** Arma las tarjetas en el orden de `claves`; `estadoDe` decide el estado mostrado de cada grupo. */
  private async armar(
    claves: ClaveContenido[],
    reportes: ReporteContenido[],
    estadoDe: (lista: ReporteContenido[]) => EstadoReporte,
  ): Promise<ContenidoReportado[]> {
    const porClave = new Map<string, ReporteContenido[]>();
    for (const r of reportes) porClave.set(clave(r), [...(porClave.get(clave(r)) ?? []), r]);

    const autorIds = [...new Set(reportes.map((r) => r.autor_id).filter((id): id is number => !!id))];
    const [suspensiones, existen] = await Promise.all([
      this.suspensiones.activasDe(autorIds),
      Promise.all(claves.map((c) => this.proveedores.get(c.tipo)?.existe(c.contenido_id) ?? Promise.resolve(true))),
    ]);

    return claves
      .map((c, i) => ({ c, lista: porClave.get(clave(c)) ?? [], existe: existen[i] }))
      .filter(({ lista }) => lista.length > 0)
      .map(({ c, lista, existe }) => {
        // `lista` viene del más reciente al más viejo.
        const motivos = new Map<MotivoReporte, number>();
        lista.forEach((r) => motivos.set(r.motivo, (motivos.get(r.motivo) ?? 0) + 1));
        const conAutor = lista.find((r) => r.autor);
        const proveedor = this.proveedores.get(c.tipo);
        return {
          tipo: c.tipo,
          contenido_id: c.contenido_id,
          estado: estadoDe(lista),
          total_reportes: lista.length,
          motivos: [...motivos].map(([motivo, total]) => ({ motivo, total })).sort((a, b) => b.total - a.total),
          primer_reporte: lista[lista.length - 1].fecha_creacion,
          ultimo_reporte: lista[0].fecha_creacion,
          copia: lista[0].copia ?? null,
          autor: conAutor?.autor ? this.autor(conAutor.autor, suspensiones.get(conAutor.autor.id)) : null,
          reportantes: lista
            .slice(0, MUESTRA_REPORTANTES)
            .map((r) => r.reportante)
            .filter((u): u is Usuario => !!u)
            .map((u) => u.toJSON() as UsuarioPublico),
          descripciones: lista
            .filter((r) => r.descripcion)
            .slice(0, MUESTRA_REPORTANTES)
            .map((r) => ({
              usuario: r.reportante ? (r.reportante.toJSON() as UsuarioPublico) : null,
              motivo: r.motivo,
              descripcion: r.descripcion!,
              fecha: r.fecha_creacion,
            })),
          existe,
          acciones: this.accionesDe(c.tipo, existe, !!conAutor?.autor_id, proveedor),
        };
      });
  }

  private accionesDe(tipo: TipoContenidoReportable, existe: boolean, conAutor: boolean, proveedor?: ProveedorContenido): AccionResolver[] {
    const sobreContenido = existe ? (proveedor?.acciones ?? []) : [];
    return ['descartar', ...sobreContenido, ...(conAutor ? (['advertir', 'suspender'] as const) : [])].filter(
      (a, i, lista) => lista.indexOf(a) === i && (tipo !== 'usuario' || a !== 'ocultar'),
    ) as AccionResolver[];
  }

  private autor(usuario: Usuario, suspension?: Suspension): AutorReportado {
    const datos = usuario.toJSON() as UsuarioPublico & { suspendido?: boolean };
    const publico = Object.fromEntries(ATRIBUTOS_USUARIO_PUBLICO.map((k) => [k, datos[k]])) as UsuarioPublico;
    return { ...publico, suspendido: !!datos.suspendido, suspension_hasta: suspension?.hasta ?? null };
  }

  /** A qué apunta la notificación al autor (para que al tocarla abra el contenido). */
  private entidadDe(
    { tipo, contenido_id }: ClaveContenido,
    copia: CopiaContenido | null,
  ): { publicacion_id?: number; entidad_tipo?: EntidadNotificacion; entidad_id?: number } {
    switch (tipo) {
      case 'publicacion':
        return { publicacion_id: contenido_id };
      case 'comentario': {
        const publicacionId = Number(copia?.contexto?.publicacion_id) || undefined;
        return { publicacion_id: publicacionId, entidad_tipo: 'comentario', entidad_id: contenido_id };
      }
      case 'usuario':
      case 'grupo':
      case 'evento':
        return { entidad_tipo: tipo, entidad_id: contenido_id };
      default:
        return {};
    }
  }

  private detalleDe(accion: AccionResolver, datos: ResolverDto): string | null {
    if (accion === 'advertir') return datos.mensaje ?? null;
    if (accion === 'suspender') return this.textoDias(datos.dias);
    return null;
  }

  private textoDias(dias: number | null | undefined): string {
    return dias ? `${dias} día(s)` : 'Permanente';
  }

  /** Ejecuta una acción sobre el contenido; si ya no existe, sigue como si se hubiera hecho. */
  private async ignorarSiNoExiste(accion: () => Promise<void>): Promise<boolean> {
    try {
      await accion();
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
    return true;
  }
}

export const moderacionService = new ModeracionService(
  reporteContenidoRepository,
  accionModeracionRepository,
  notaModeracionRepository,
  reporteService,
  reportePublicacionRepository,
  suspensionService,
  palabrasService,
  notificacionService,
  logSeguridadRepository,
  usuarioRepository,
  sequelize,
  proveedoresPorDefecto(),
);

/** Para otros módulos: devuelve el texto censurado o lanza 400 si hay que bloquearlo. */
export { asegurarTextoPermitido, revisarTexto } from './palabras.service';
