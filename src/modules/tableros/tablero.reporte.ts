/** Agrupaciones del reporte de un tablero y serie del burndown (funciones puras, fáciles de probar). */
import { PRIORIDADES_TAREA, type PrioridadTarea } from '../../infrastructure/database/models';
import type { TareaTarjeta, UsuarioPublico } from './tarea.repository';

const MS_DIA = 24 * 60 * 60 * 1000;
/** Tope de días de la serie (un sprint nunca debería ser más largo). */
const MAX_DIAS_BURNDOWN = 90;
/** Duración supuesta de un sprint sin fecha de fin. */
const DIAS_SPRINT_POR_DEFECTO = 14;

export interface ColumnaReporte {
  id: number;
  nombre: string;
  es_final: boolean;
}

export interface SprintReporte {
  id: number;
  nombre: string;
  inicio: Date | null;
  fin: Date | null;
  fecha_creacion: Date;
}

export interface PuntoBurndown {
  /** Día "YYYY-MM-DD" (UTC). */
  fecha: string;
  /** Lo que faltaba al terminar ese día; null en días futuros. */
  restantes: number | null;
  /** Línea ideal (de total a 0). */
  ideal: number;
}

export interface ReporteSprint {
  id: number;
  nombre: string;
  inicio: string;
  fin: string;
  /** "puntos" si alguna tarea del sprint tiene estimación; si no, se cuentan tareas. */
  unidad: 'puntos' | 'tareas';
  puntos_total: number;
  puntos_completados: number;
  tareas_total: number;
  tareas_completadas: number;
  burndown: PuntoBurndown[];
}

export interface ReporteTablero {
  total: number;
  completadas: number;
  por_columna: (ColumnaReporte & { total: number })[];
  /** `usuario: null` = sin responsable. */
  por_responsable: { usuario: UsuarioPublico | null; total: number; completadas: number }[];
  por_prioridad: { prioridad: PrioridadTarea; total: number }[];
  vencidas: TareaTarjeta[];
  sprint: ReporteSprint | null;
}

const terminada = (t: Pick<TareaTarjeta, 'completada_en'>) => t.completada_en !== null && t.completada_en !== undefined;
const aFecha = (valor: Date | string) => (valor instanceof Date ? valor : new Date(valor));
const diaUtc = (fecha: Date) => fecha.toISOString().slice(0, 10);
const inicioDelDia = (fecha: Date) => Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
const redondear = (n: number) => Math.round(n * 100) / 100;

export function porColumna(columnas: ColumnaReporte[], tareas: TareaTarjeta[]): ReporteTablero['por_columna'] {
  return columnas.map((c) => ({ ...c, total: tareas.filter((t) => t.columna_id === c.id).length }));
}

/** Una tarea con dos responsables cuenta para ambos. Ordenado por total descendente; "sin responsable" al final. */
export function porResponsable(tareas: TareaTarjeta[]): ReporteTablero['por_responsable'] {
  const mapa = new Map<number, { usuario: UsuarioPublico; total: number; completadas: number }>();
  const sinResponsable = { usuario: null, total: 0, completadas: 0 };
  for (const tarea of tareas) {
    if (!tarea.asignados.length) {
      sinResponsable.total++;
      if (terminada(tarea)) sinResponsable.completadas++;
    }
    for (const usuario of tarea.asignados) {
      const fila = mapa.get(usuario.id) ?? { usuario, total: 0, completadas: 0 };
      fila.total++;
      if (terminada(tarea)) fila.completadas++;
      mapa.set(usuario.id, fila);
    }
  }
  const filas: ReporteTablero['por_responsable'] = [...mapa.values()].sort((a, b) => b.total - a.total);
  if (sinResponsable.total) filas.push(sinResponsable);
  return filas;
}

export function porPrioridad(tareas: TareaTarjeta[]): ReporteTablero['por_prioridad'] {
  return PRIORIDADES_TAREA.map((prioridad) => ({ prioridad, total: tareas.filter((t) => t.prioridad === prioridad).length }));
}

export function vencidas(tareas: TareaTarjeta[], ahora: Date): TareaTarjeta[] {
  return tareas
    .filter((t) => !terminada(t) && t.fecha_limite && aFecha(t.fecha_limite).getTime() < ahora.getTime())
    .sort((a, b) => aFecha(a.fecha_limite as Date).getTime() - aFecha(b.fecha_limite as Date).getTime());
}

/**
 * Serie diaria del sprint: para cada día, lo que faltaba al terminar ese día
 * (total menos lo completado hasta entonces) y la línea ideal.
 */
export function burndown(sprint: SprintReporte, tareas: TareaTarjeta[], ahora: Date): ReporteSprint {
  const usaPuntos = tareas.some((t) => (t.puntos ?? 0) > 0);
  const peso = (t: TareaTarjeta) => (usaPuntos ? (t.puntos ?? 0) : 1);
  const total = tareas.reduce((suma, t) => suma + peso(t), 0);
  const completadas = tareas.filter(terminada);

  const inicio = aFecha(sprint.inicio ?? sprint.fecha_creacion);
  const finPlaneado = sprint.fin ? aFecha(sprint.fin) : new Date(inicio.getTime() + (DIAS_SPRINT_POR_DEFECTO - 1) * MS_DIA);
  const primerDia = inicioDelDia(inicio);
  const dias = Math.min(MAX_DIAS_BURNDOWN, Math.max(1, Math.round((inicioDelDia(finPlaneado) - primerDia) / MS_DIA) + 1));
  const hoy = inicioDelDia(ahora);

  const serie: PuntoBurndown[] = [];
  for (let i = 0; i < dias; i++) {
    const dia = primerDia + i * MS_DIA;
    const finDelDia = dia + MS_DIA;
    const hecho = completadas.filter((t) => aFecha(t.completada_en as Date).getTime() < finDelDia).reduce((s, t) => s + peso(t), 0);
    serie.push({
      fecha: diaUtc(new Date(dia)),
      restantes: dia > hoy ? null : total - hecho,
      ideal: dias === 1 ? 0 : redondear(total - (total * i) / (dias - 1)),
    });
  }

  return {
    id: sprint.id,
    nombre: sprint.nombre,
    inicio: diaUtc(new Date(primerDia)),
    fin: diaUtc(new Date(primerDia + (dias - 1) * MS_DIA)),
    unidad: usaPuntos ? 'puntos' : 'tareas',
    puntos_total: total,
    puntos_completados: completadas.reduce((s, t) => s + peso(t), 0),
    tareas_total: tareas.length,
    tareas_completadas: completadas.length,
    burndown: serie,
  };
}

export function armarReporte(
  columnas: ColumnaReporte[],
  tareas: TareaTarjeta[],
  sprint: { sprint: SprintReporte; tareas: TareaTarjeta[] } | null,
  ahora: Date = new Date(),
): ReporteTablero {
  return {
    total: tareas.length,
    completadas: tareas.filter(terminada).length,
    por_columna: porColumna(columnas, tareas),
    por_responsable: porResponsable(tareas),
    por_prioridad: porPrioridad(tareas),
    vencidas: vencidas(tareas, ahora),
    sprint: sprint ? burndown(sprint.sprint, sprint.tareas, ahora) : null,
  };
}
