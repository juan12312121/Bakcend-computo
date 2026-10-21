/**
 * Libreta de calificaciones (alumno × asignación) y su CSV. Funciones puras: reciben lo ya leído de la base.
 * Promedio de un alumno = puntos obtenidos / puntos posibles de lo CALIFICADO × 100 (lo no calificado no cuenta).
 */
import type { Asignacion, Entrega, EstadoEntrega } from '../../../infrastructure/database/models';
import type { UsuarioPublico } from '../aula.acceso';
import { redondear, type CeldaCsv } from '../aula.csv';

/** Estado visible para el alumno: "pendiente" = no ha entregado. */
export type EstadoAlumno = 'pendiente' | EstadoEntrega;

export function estadoDeAlumno(entrega: Pick<Entrega, 'estado'> | null | undefined): EstadoAlumno {
  return entrega?.estado ?? 'pendiente';
}

/** ¿Puede entregar ahora? (a tiempo, tardía aceptada, o devuelta para corregir; nunca si ya está calificada). */
export function puedeEntregar(
  asignacion: Pick<Asignacion, 'fecha_entrega' | 'acepta_tardias'>,
  entrega: Pick<Entrega, 'estado'> | null | undefined,
  ahora: Date = new Date(),
): boolean {
  if (entrega?.estado === 'calificada') return false;
  if (entrega?.estado === 'devuelta') return true;
  return ahora.getTime() <= new Date(asignacion.fecha_entrega).getTime() || asignacion.acepta_tardias;
}

export type AsignacionLibreta = Pick<Asignacion, 'id' | 'titulo' | 'fecha_entrega' | 'puntos_maximos'>;
type EntregaLibreta = Pick<Entrega, 'asignacion_id' | 'alumno_id' | 'estado' | 'puntos' | 'fue_tarde'>;

export interface CeldaLibreta {
  asignacion_id: number;
  estado: EstadoAlumno;
  puntos: number | null;
  fue_tarde: boolean;
}

export interface FilaLibreta {
  alumno: UsuarioPublico;
  celdas: CeldaLibreta[];
  puntos_obtenidos: number;
  puntos_posibles: number;
  /** 0-100 con un decimal; null si aún no tiene nada calificado. */
  promedio: number | null;
  /** Asignaciones con algo entregado (cualquier estado menos pendiente). */
  entregadas: number;
  /** Asignaciones vencidas sin entregar. */
  faltantes: number;
}

export interface ResumenAsignacionLibreta {
  asignacion_id: number;
  /** Promedio (0-100) de lo calificado; null si nada. */
  promedio: number | null;
  entregadas: number;
  calificadas: number;
}

export interface Libreta {
  asignaciones: AsignacionLibreta[];
  alumnos: FilaLibreta[];
  promedio_grupo: number | null;
  por_asignacion: ResumenAsignacionLibreta[];
}

const media = (valores: number[]): number | null => (valores.length ? redondear(valores.reduce((a, b) => a + b, 0) / valores.length, 1) : null);

export function armarLibreta(
  asignaciones: AsignacionLibreta[],
  alumnos: UsuarioPublico[],
  entregas: EntregaLibreta[],
  ahora: Date = new Date(),
): Libreta {
  const porClave = new Map(entregas.map((e) => [`${e.asignacion_id}:${e.alumno_id}`, e]));

  const filas: FilaLibreta[] = alumnos.map((alumno) => {
    let obtenidos = 0;
    let posibles = 0;
    let entregadas = 0;
    let faltantes = 0;
    const celdas = asignaciones.map((a): CeldaLibreta => {
      const entrega = porClave.get(`${a.id}:${alumno.id}`);
      const estado = estadoDeAlumno(entrega);
      if (estado === 'pendiente') {
        if (new Date(a.fecha_entrega).getTime() < ahora.getTime()) faltantes++;
      } else {
        entregadas++;
      }
      if (estado === 'calificada' && entrega?.puntos !== null && entrega?.puntos !== undefined) {
        obtenidos += entrega.puntos;
        posibles += a.puntos_maximos;
      }
      return { asignacion_id: a.id, estado, puntos: estado === 'calificada' ? (entrega?.puntos ?? null) : null, fue_tarde: !!entrega?.fue_tarde };
    });
    return {
      alumno,
      celdas,
      puntos_obtenidos: redondear(obtenidos),
      puntos_posibles: posibles,
      promedio: posibles ? redondear((obtenidos / posibles) * 100, 1) : null,
      entregadas,
      faltantes,
    };
  });

  const porAsignacion = asignaciones.map((a, i): ResumenAsignacionLibreta => {
    const celdas = filas.map((f) => f.celdas[i]);
    const calificadas = celdas.filter((c) => c.estado === 'calificada' && c.puntos !== null);
    return {
      asignacion_id: a.id,
      promedio: media(calificadas.map((c) => ((c.puntos ?? 0) / a.puntos_maximos) * 100)),
      entregadas: celdas.filter((c) => c.estado !== 'pendiente').length,
      calificadas: calificadas.length,
    };
  });

  return {
    asignaciones,
    alumnos: filas,
    promedio_grupo: media(filas.map((f) => f.promedio).filter((p): p is number => p !== null)),
    por_asignacion: porAsignacion,
  };
}

const TEXTO_ESTADO: Readonly<Record<EstadoAlumno, string>> = {
  pendiente: '',
  entregada: 'Entregada',
  tarde: 'Tarde',
  calificada: '',
  devuelta: 'Devuelta',
};

/** Filas del CSV: Alumno, Usuario, una columna por asignación ("Título (/máx)"), Promedio %, Entregadas, Faltantes. */
export function filasLibretaCsv(libreta: Libreta): CeldaCsv[][] {
  const encabezado: CeldaCsv[] = [
    'Alumno',
    'Usuario',
    ...libreta.asignaciones.map((a) => `${a.titulo} (/${a.puntos_maximos})`),
    'Promedio %',
    'Entregadas',
    'Faltantes',
  ];
  const filas = libreta.alumnos.map((fila): CeldaCsv[] => [
    fila.alumno.nombre_completo,
    fila.alumno.nombre_usuario,
    ...fila.celdas.map((c) => (c.estado === 'calificada' ? c.puntos : TEXTO_ESTADO[c.estado])),
    fila.promedio,
    fila.entregadas,
    fila.faltantes,
  ]);
  const promedios: CeldaCsv[] = ['Promedio del grupo', '', ...libreta.por_asignacion.map((p) => (p.promedio === null ? '' : `${p.promedio}%`)), libreta.promedio_grupo, '', ''];
  return [encabezado, ...filas, promedios];
}
