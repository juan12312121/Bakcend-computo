/**
 * Cálculos del control de horas (puros): minutos de un registro (también mientras corre), tarifa aplicable
 * (la del miembro gana a la del tablero), importes y el resumen por persona y por tarea.
 * El importe solo cuenta lo facturable. Las tarifas viajan en centavos y los importes salen en la moneda (2 decimales).
 */
import type { UsuarioPublico } from '../aula.acceso';
import { redondear } from '../aula.csv';

const MS_MINUTO = 60_000;

export interface RegistroResumible {
  tarea_id: number;
  usuario_id: number;
  inicio: Date;
  fin: Date | null;
  minutos: number;
  facturable: boolean;
}

export interface Tarifas {
  moneda: string;
  /** Centavos por hora del tablero (null = sin tarifa). */
  tablero: number | null;
  /** Centavos por hora de cada miembro. */
  porUsuario: Map<number, number>;
}

export interface TareaResumen {
  id: number;
  clave: string;
  titulo: string;
}

export interface FilaPersona {
  usuario: UsuarioPublico;
  minutos: number;
  facturable_minutos: number;
  /** Por hora, en la moneda; null si no hay tarifa. */
  tarifa: number | null;
  importe: number | null;
}

export interface FilaTarea {
  tarea: TareaResumen;
  minutos: number;
  facturable_minutos: number;
  importe: number | null;
}

export interface ResumenHoras {
  desde: Date;
  hasta: Date;
  moneda: string;
  registros: number;
  total_minutos: number;
  facturable_minutos: number;
  /** null si no hay ninguna tarifa configurada. */
  importe_total: number | null;
  por_persona: FilaPersona[];
  por_tarea: FilaTarea[];
}

/** Minutos de un registro; si el cronómetro sigue corriendo, los que lleva hasta `ahora`. */
export function minutosDe(registro: Pick<RegistroResumible, 'inicio' | 'fin' | 'minutos'>, ahora: Date = new Date()): number {
  if (registro.fin) return registro.minutos;
  return Math.max(0, Math.round((ahora.getTime() - new Date(registro.inicio).getTime()) / MS_MINUTO));
}

/** Minutos entre dos fechas (redondeo al minuto). */
export function minutosEntre(inicio: Date, fin: Date): number {
  return Math.max(0, Math.round((fin.getTime() - inicio.getTime()) / MS_MINUTO));
}

export function tarifaDe(tarifas: Tarifas, usuarioId: number): number | null {
  return tarifas.porUsuario.get(usuarioId) ?? tarifas.tablero;
}

export const importeCentavos = (minutos: number, tarifaCentavos: number): number => Math.round((minutos * tarifaCentavos) / 60);
export const aMoneda = (centavos: number): number => redondear(centavos / 100);
export const aCentavos = (monto: number): number => Math.round(monto * 100);

/** Importe (centavos) de un registro: 0 si no es facturable; null si nadie tiene tarifa. */
export function importeDe(registro: RegistroResumible, tarifas: Tarifas, ahora: Date = new Date()): number | null {
  const tarifa = tarifaDe(tarifas, registro.usuario_id);
  if (tarifa === null) return null;
  return registro.facturable ? importeCentavos(minutosDe(registro, ahora), tarifa) : 0;
}

interface Acumulado {
  minutos: number;
  facturable: number;
  centavos: number;
  conTarifa: boolean;
}

const nuevo = (): Acumulado => ({ minutos: 0, facturable: 0, centavos: 0, conTarifa: false });

function sumar(acumulado: Acumulado, registro: RegistroResumible, tarifas: Tarifas, ahora: Date): void {
  const minutos = minutosDe(registro, ahora);
  acumulado.minutos += minutos;
  if (registro.facturable) acumulado.facturable += minutos;
  const importe = importeDe(registro, tarifas, ahora);
  if (importe !== null) {
    acumulado.centavos += importe;
    acumulado.conTarifa = true;
  }
}

export function armarResumen(
  registros: RegistroResumible[],
  tarifas: Tarifas,
  contexto: { desde: Date; hasta: Date; usuarios: Map<number, UsuarioPublico>; tareas: Map<number, TareaResumen> },
  ahora: Date = new Date(),
): ResumenHoras {
  const total = nuevo();
  const porPersona = new Map<number, Acumulado>();
  const porTarea = new Map<number, Acumulado>();
  for (const registro of registros) {
    sumar(total, registro, tarifas, ahora);
    if (!porPersona.has(registro.usuario_id)) porPersona.set(registro.usuario_id, nuevo());
    if (!porTarea.has(registro.tarea_id)) porTarea.set(registro.tarea_id, nuevo());
    sumar(porPersona.get(registro.usuario_id) as Acumulado, registro, tarifas, ahora);
    sumar(porTarea.get(registro.tarea_id) as Acumulado, registro, tarifas, ahora);
  }

  const personas: FilaPersona[] = [...porPersona.entries()]
    .map(([usuarioId, a]) => {
      const tarifa = tarifaDe(tarifas, usuarioId);
      return {
        usuario: contexto.usuarios.get(usuarioId) ?? ({ id: usuarioId, nombre_usuario: '', nombre_completo: 'Usuario', foto_perfil_url: null, carrera: null } as UsuarioPublico),
        minutos: a.minutos,
        facturable_minutos: a.facturable,
        tarifa: tarifa === null ? null : aMoneda(tarifa),
        importe: a.conTarifa ? aMoneda(a.centavos) : null,
      };
    })
    .sort((x, y) => y.minutos - x.minutos || x.usuario.nombre_completo.localeCompare(y.usuario.nombre_completo, 'es'));

  const tareas: FilaTarea[] = [...porTarea.entries()]
    .map(([tareaId, a]) => ({
      tarea: contexto.tareas.get(tareaId) ?? { id: tareaId, clave: `#${tareaId}`, titulo: 'Tarea eliminada' },
      minutos: a.minutos,
      facturable_minutos: a.facturable,
      importe: a.conTarifa ? aMoneda(a.centavos) : null,
    }))
    .sort((x, y) => y.minutos - x.minutos || x.tarea.id - y.tarea.id);

  return {
    desde: contexto.desde,
    hasta: contexto.hasta,
    moneda: tarifas.moneda,
    registros: registros.length,
    total_minutos: total.minutos,
    facturable_minutos: total.facturable,
    importe_total: total.conTarifa ? aMoneda(total.centavos) : null,
    por_persona: personas,
    por_tarea: tareas,
  };
}
