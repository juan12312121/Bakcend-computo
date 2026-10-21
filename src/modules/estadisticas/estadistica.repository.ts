import { Op, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import {
  Comentario,
  Compartido,
  EstadisticaPerfilDiaria,
  EstadisticaPublicacionDiaria,
  EventoEstadistica,
  Grupo,
  GrupoMiembro,
  Like,
  Publicacion,
  PublicacionGuardada,
  Seguidor,
  Usuario,
  fechaDia,
  sumarAlDia,
  type CampoPerfilDiario,
  type CampoPublicacionDiaria,
  type TipoEventoEstadistica,
  type TipoReaccion,
} from '../../infrastructure/database/models';

/** Una interacción con una publicación (para sumar por día y por hora). */
export interface Interaccion {
  tipo: 'reaccion' | 'comentario' | 'compartido' | 'guardado';
  publicacion_id: number;
  fecha: Date;
  reaccion?: TipoReaccion;
}

/** Datos públicos de un seguidor que sirven para la audiencia. */
export interface DatosAudiencia {
  ubicacion: string | null;
  carrera: string | null;
}

/**
 * Consultas y escrituras de estadísticas. Las escrituras suman a las tablas diarias (rápidas de leer);
 * los eventos crudos sirven para no duplicar y para contar personas únicas.
 * Las lecturas de interacciones salen de sus propias tablas (likes, comentarios, compartidos, guardados).
 */
export class EstadisticaRepository extends BaseRepository<EventoEstadistica> {
  protected readonly entidad = 'Estadística';

  constructor() {
    super(EventoEstadistica);
  }

  // ---------- Escritura ----------

  sumarPublicacion(publicacionId: number, autorId: number, campo: CampoPublicacionDiaria, delta = 1): Promise<void> {
    return sumarAlDia(
      EstadisticaPublicacionDiaria,
      { publicacion_id: publicacionId, usuario_id: autorId, fecha: fechaDia(new Date()) },
      campo,
      delta,
    );
  }

  sumarPerfil(usuarioId: number, campo: CampoPerfilDiario, delta = 1): Promise<void> {
    return EstadisticaPerfilDiaria.sumar(usuarioId, campo, delta);
  }

  /** De `publicacionIds`, cuáles ya tienen un evento de ese tipo de esa persona desde `desde`. */
  async conEventoDesde(tipo: TipoEventoEstadistica, usuarioId: number, publicacionIds: number[], desde: Date): Promise<Set<number>> {
    if (!publicacionIds.length) return new Set();
    const filas = await EventoEstadistica.findAll({
      where: { tipo, usuario_id: usuarioId, publicacion_id: { [Op.in]: publicacionIds }, fecha_creacion: { [Op.gte]: desde } },
      attributes: ['publicacion_id'],
    });
    return new Set(filas.map((f) => f.publicacion_id as number));
  }

  /** ¿Hay un evento de ese tipo de esa persona sobre ese dueño (sin publicación) desde `desde`? (visitas al perfil) */
  async hayEventoDePerfil(tipo: TipoEventoEstadistica, usuarioId: number, duenoId: number, desde: Date): Promise<boolean> {
    return (await EventoEstadistica.count({ where: { tipo, usuario_id: usuarioId, dueno_id: duenoId, fecha_creacion: { [Op.gte]: desde } } })) > 0;
  }

  registrarEventos(eventos: { tipo: TipoEventoEstadistica; dueno_id: number; usuario_id: number; publicacion_id: number | null }[]): Promise<EventoEstadistica[]> {
    return EventoEstadistica.bulkCreate(eventos);
  }

  /** Borra los eventos crudos más viejos que `antes` (los totales diarios se quedan). */
  limpiarEventos(antes: Date): Promise<number> {
    return this.delete({ fecha_creacion: { [Op.lt]: antes } });
  }

  // ---------- Lectura: totales diarios ----------

  diariasDePublicaciones(autorId: number, desde: string, hasta: string): Promise<EstadisticaPublicacionDiaria[]> {
    return EstadisticaPublicacionDiaria.findAll({ where: { usuario_id: autorId, fecha: { [Op.between]: [desde, hasta] } } });
  }

  diariasDePublicacion(publicacionId: number, desde?: string): Promise<EstadisticaPublicacionDiaria[]> {
    const where: WhereOptions<EstadisticaPublicacionDiaria> = desde ? { publicacion_id: publicacionId, fecha: { [Op.gte]: desde } } : { publicacion_id: publicacionId };
    return EstadisticaPublicacionDiaria.findAll({ where, order: [['fecha', 'ASC']] });
  }

  diariasDePerfil(usuarioId: number, desde: string, hasta: string): Promise<EstadisticaPerfilDiaria[]> {
    return EstadisticaPerfilDiaria.findAll({ where: { usuario_id: usuarioId, fecha: { [Op.between]: [desde, hasta] } } });
  }

  // ---------- Lectura: eventos crudos ----------

  /** Personas distintas que vieron algo del dueño (o de una publicación) desde `desde`. */
  async alcanceUnico(duenoId: number, desde: Date, hasta: Date): Promise<number>;
  async alcanceUnico(duenoId: number, desde: Date, hasta: Date, publicacionId: number): Promise<number>;
  async alcanceUnico(duenoId: number, desde: Date, hasta: Date, publicacionId?: number): Promise<number> {
    return EventoEstadistica.count({
      where: {
        tipo: 'impresion',
        dueno_id: duenoId,
        fecha_creacion: { [Op.between]: [desde, hasta] },
        ...(publicacionId ? { publicacion_id: publicacionId } : {}),
      },
      distinct: true,
      col: 'usuario_id',
    });
  }

  /** Momentos de las impresiones del dueño en el rango (para las mejores horas y días). */
  async momentosImpresiones(duenoId: number, desde: Date, hasta: Date): Promise<Date[]> {
    const filas = await EventoEstadistica.findAll({
      where: { tipo: 'impresion', dueno_id: duenoId, fecha_creacion: { [Op.between]: [desde, hasta] } },
      attributes: ['fecha_creacion'],
    });
    return filas.map((f) => f.fecha_creacion);
  }

  /** Quiénes vieron una publicación (ids únicos). */
  async espectadoresDe(publicacionId: number): Promise<number[]> {
    const filas = await EventoEstadistica.findAll({
      where: { tipo: 'impresion', publicacion_id: publicacionId },
      attributes: ['usuario_id'],
      group: ['usuario_id'],
    });
    return filas.map((f) => f.usuario_id);
  }

  // ---------- Lectura: interacciones (de sus propias tablas) ----------

  /** Reacciones, comentarios, compartidos y guardados de otras personas sobre `publicacionIds` en el rango. */
  async interacciones(publicacionIds: number[], autorId: number, desde: Date, hasta: Date): Promise<Interaccion[]> {
    if (!publicacionIds.length) return [];
    const where = {
      publicacion_id: { [Op.in]: publicacionIds },
      usuario_id: { [Op.ne]: autorId },
      fecha_creacion: { [Op.between]: [desde, hasta] },
    };
    const atributos = ['publicacion_id', 'fecha_creacion'];
    const [likes, comentarios, compartidos, guardados] = await Promise.all([
      Like.findAll({ where, attributes: [...atributos, 'tipo'] }),
      Comentario.findAll({ where, attributes: atributos }),
      Compartido.findAll({ where, attributes: atributos }),
      PublicacionGuardada.findAll({ where, attributes: atributos }),
    ]);
    return [
      ...likes.map((l) => ({ tipo: 'reaccion' as const, publicacion_id: l.publicacion_id, fecha: l.fecha_creacion, reaccion: l.tipo })),
      ...comentarios.map((c) => ({ tipo: 'comentario' as const, publicacion_id: c.publicacion_id, fecha: c.fecha_creacion })),
      ...compartidos.map((c) => ({ tipo: 'compartido' as const, publicacion_id: c.publicacion_id, fecha: c.fecha_creacion })),
      ...guardados.map((g) => ({ tipo: 'guardado' as const, publicacion_id: g.publicacion_id, fecha: g.fecha_creacion })),
    ];
  }

  // ---------- Lectura: publicaciones y audiencia ----------

  /** Publicaciones publicadas del autor (solo lo necesario para el panel). */
  publicacionesDe(autorId: number): Promise<Publicacion[]> {
    return Publicacion.findAll({
      where: { usuario_id: autorId, estado: 'publicada' },
      attributes: [
        'id',
        'contenido',
        'imagen_url',
        'video_url',
        'video_original_url',
        'categoria',
        'visibilidad',
        'grupo_id',
        'total_likes',
        'total_comentarios',
        'total_compartidos',
        'total_vistas',
        'fecha_creacion',
      ],
      order: [['fecha_creacion', 'DESC']],
    });
  }

  /** Ids de quienes siguen al usuario (aceptados). */
  async idsSeguidores(usuarioId: number): Promise<number[]> {
    const filas = await Seguidor.findAll({ where: { siguiendo_id: usuarioId, estado: 'aceptado' }, attributes: ['seguidor_id'] });
    return filas.map((f) => f.seguidor_id);
  }

  /** Ubicación y carrera de los seguidores activos. */
  async datosDe(usuarioIds: number[]): Promise<DatosAudiencia[]> {
    if (!usuarioIds.length) return [];
    const filas = await Usuario.findAll({ where: { id: { [Op.in]: usuarioIds }, activo: true }, attributes: ['ubicacion', 'carrera'] });
    return filas.map((u) => ({ ubicacion: u.ubicacion, carrera: u.carrera }));
  }

  /** Grupos con más seguidores del usuario como miembros activos. */
  async gruposDe(usuarioIds: number[], limite: number): Promise<{ grupo_id: number; nombre: string; total: number }[]> {
    if (!usuarioIds.length) return [];
    const membresias = await GrupoMiembro.findAll({
      where: { usuario_id: { [Op.in]: usuarioIds }, estado: 'activo' },
      attributes: ['grupo_id'],
    });
    const conteo = new Map<number, number>();
    for (const m of membresias) conteo.set(m.grupo_id, (conteo.get(m.grupo_id) ?? 0) + 1);
    const top = [...conteo.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limite);
    if (!top.length) return [];
    const grupos = await Grupo.findAll({ where: { id: { [Op.in]: top.map(([id]) => id) } }, attributes: ['id', 'nombre'] });
    const nombres = new Map(grupos.map((g) => [g.id, g.nombre]));
    return top.filter(([id]) => nombres.has(id)).map(([grupo_id, total]) => ({ grupo_id, nombre: nombres.get(grupo_id) as string, total }));
  }
}

export const estadisticaRepository = new EstadisticaRepository();
