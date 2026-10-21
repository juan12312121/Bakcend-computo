import type { InferAttributes, Sequelize, Transaction } from 'sequelize';
import { BaseService } from '../../../core/domain/BaseService';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../core/errors';
import { sequelize, type RegistroHoras, type Tablero, type Tarea } from '../../../infrastructure/database/models';
import { realtime, salas, type RealtimeGateway } from '../../../infrastructure/realtime/RealtimeGateway';
import { accesoTableros, type AccesoTableros } from '../../tableros/tablero.acceso';
import type { NivelAcceso } from '../../tableros/tablero.permisos';
import { claveDeTarea } from '../../tableros/tablero.plantillas';
import { tableroRepository, type TableroRepository } from '../../tableros/tablero.repository';
import { tareaRepository, type TareaRepository } from '../../tableros/tarea.repository';
import type { UsuarioPublico } from '../aula.acceso';
import { aCsv, nombreArchivo, type ArchivoTexto, type CeldaCsv } from '../aula.csv';
import { MONEDA_POR_DEFECTO, registroHorasRepository, tarifaRepository, type RegistroHorasRepository, type TarifaRepository } from './hora.repository';
import { LIMITES_HORAS, TOLERANCIA_FUTURO_MS, type EditarRegistroDto, type IniciarDto, type RegistrarDto, type ResumenQuery, type TarifaDto } from './hora.schemas';
import {
  aCentavos,
  aMoneda,
  armarResumen,
  importeDe,
  minutosDe,
  minutosEntre,
  tarifaDe,
  type ResumenHoras,
  type TareaResumen,
} from './horas.resumen';

const MS_MINUTO = 60_000;

/** Eventos de Socket.IO del control de horas. */
export const EVENTOS_HORAS = {
  /** A la sala del tablero: alguien registró / cambió / borró tiempo (la pestaña "Horas" se recarga). */
  horas: 'horas_actualizadas',
  /** A la sala personal: mi cronómetro arrancó o se detuvo (otras pestañas / el teléfono se enteran). */
  cronometro: 'cronometro_actualizado',
} as const;

type TareaVista = TareaResumen & { tablero: { id: number; nombre: string; clave: string; color: string } | null };

export type RegistroVista = Omit<InferAttributes<RegistroHoras>, 'cronometro_de'> & {
  corriendo: boolean;
  usuario: UsuarioPublico | null;
  tarea?: TareaVista;
};

export interface TiempoDeTarea {
  registros: RegistroVista[];
  total_minutos: number;
  facturable_minutos: number;
  mis_minutos: number;
  /** Mi cronómetro si corre en ESTA tarea. */
  activo: RegistroVista | null;
  puede_registrar: boolean;
}

export interface ResultadoInicio {
  registro: RegistroVista;
  /** El cronómetro que se detuvo solo al iniciar este (solo hay uno por persona). */
  detenido: RegistroVista | null;
}

export interface TarifasVista {
  moneda: string;
  /** Por hora, en la moneda. */
  tablero: number | null;
  miembros: { usuario_id: number; tarifa: number }[];
}

interface TareaCargada {
  tarea: Tarea;
  tablero: Tablero;
}

type RegistroCargado = RegistroHoras & {
  usuario?: UsuarioPublico;
  tarea?: Tarea & { tablero?: Tablero };
};

function vista(registro: RegistroCargado, ahora: Date = new Date()): RegistroVista {
  const { cronometro_de: _cronometro, usuario, tarea, ...datos } = registro.get({ plain: true }) as InferAttributes<RegistroHoras> & {
    usuario?: UsuarioPublico;
    tarea?: InferAttributes<Tarea> & { tablero?: InferAttributes<Tablero> };
  };
  const resultado: RegistroVista = { ...datos, minutos: minutosDe(registro, ahora), corriendo: !registro.fin, usuario: usuario ?? null };
  if (tarea) {
    resultado.tarea = {
      id: tarea.id,
      titulo: tarea.titulo,
      clave: tarea.tablero ? claveDeTarea(tarea.tablero.clave, tarea.numero) : `#${tarea.numero}`,
      tablero: tarea.tablero ? { id: tarea.tablero.id, nombre: tarea.tablero.nombre, clave: tarea.tablero.clave, color: tarea.tablero.color } : null,
    };
  }
  return resultado;
}

const fechaZona = (fecha: Date, zona: string): string =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(fecha);

export class HoraService extends BaseService<RegistroHoras, RegistroHorasRepository> {
  constructor(
    repository: RegistroHorasRepository,
    private readonly tarifas: TarifaRepository,
    private readonly tareas: TareaRepository,
    private readonly tableros: TableroRepository,
    private readonly acceso: AccesoTableros,
    private readonly tiempoReal: RealtimeGateway,
    private readonly db: Sequelize,
  ) {
    super(repository);
  }

  // ---------- Cronómetro ----------

  /** Mi cronómetro corriendo (en cualquier tablero) o null. */
  async activo(usuarioId: number): Promise<RegistroVista | null> {
    const registro = await this.repository.activoDe(usuarioId);
    return registro ? vista(registro) : null;
  }

  /** Arranca el cronómetro en la tarea; si había otro corriendo, lo detiene (uno activo por persona). */
  async iniciar(tareaId: number, usuarioId: number, datos: IniciarDto, ahora: Date = new Date()): Promise<ResultadoInicio> {
    const { tarea } = await this.cargar(tareaId, usuarioId, 'editar');
    const { id, detenido } = await this.db.transaction(async (t) => {
      const corriendo = await this.repository.activoDe(usuarioId, t);
      if (corriendo?.tarea_id === tareaId) throw new ConflictError('El cronómetro ya está corriendo en esta tarea');
      if (corriendo) await this.cerrar(corriendo, ahora, t);
      const nuevo = await this.repository.create(
        {
          tarea_id: tarea.id,
          tablero_id: tarea.tablero_id,
          usuario_id: usuarioId,
          inicio: ahora,
          nota: datos.nota || null,
          facturable: datos.facturable ?? true,
          cronometro_de: usuarioId,
        },
        t,
      );
      return { id: nuevo.id, detenido: corriendo };
    });
    const registro = vista(await this.repository.completo(id), ahora);
    this.avisarCronometro(usuarioId, registro);
    this.avisarTablero(tarea.tablero_id, tarea.id, usuarioId);
    if (detenido && detenido.tablero_id !== tarea.tablero_id) this.avisarTablero(detenido.tablero_id, detenido.tarea_id, usuarioId);
    return { registro, detenido: detenido ? vista(await this.repository.completo(detenido.id), ahora) : null };
  }

  /** Detiene mi cronómetro (404 si no hay ninguno corriendo). */
  async detener(usuarioId: number, ahora: Date = new Date()): Promise<RegistroVista> {
    const corriendo = await this.repository.activoDe(usuarioId);
    if (!corriendo) throw new NotFoundError('Cronómetro', 'No tienes un cronómetro corriendo');
    await this.cerrar(corriendo, ahora);
    this.avisarCronometro(usuarioId, null);
    this.avisarTablero(corriendo.tablero_id, corriendo.tarea_id, usuarioId);
    return vista(await this.repository.completo(corriendo.id), ahora);
  }

  // ---------- Registros ----------

  /** Tiempo de una tarea: registros de todos, totales y mi cronómetro si corre en ella. */
  async deTarea(tareaId: number, usuarioId: number, ahora: Date = new Date()): Promise<TiempoDeTarea> {
    const { tablero } = await this.cargar(tareaId, usuarioId, 'ver');
    const registros = (await this.repository.deTarea(tareaId)).map((r) => vista(r, ahora));
    const suma = (lista: RegistroVista[]) => lista.reduce((total, r) => total + r.minutos, 0);
    const { editar } = await this.tableros.acceso(tablero, usuarioId);
    return {
      registros,
      total_minutos: suma(registros),
      facturable_minutos: suma(registros.filter((r) => r.facturable)),
      mis_minutos: suma(registros.filter((r) => r.usuario_id === usuarioId)),
      activo: registros.find((r) => r.corriendo && r.usuario_id === usuarioId) ?? null,
      puede_registrar: editar && !tablero.archivado,
    };
  }

  /** Registro a mano: { inicio, fin } o { minutos, inicio? }. */
  async registrar(tareaId: number, usuarioId: number, datos: RegistrarDto, ahora: Date = new Date()): Promise<RegistroVista> {
    const { tarea } = await this.cargar(tareaId, usuarioId, 'editar');
    const { inicio, fin } = this.intervalo(datos, ahora);
    const creado = await this.repository.create({
      tarea_id: tarea.id,
      tablero_id: tarea.tablero_id,
      usuario_id: usuarioId,
      inicio,
      fin,
      minutos: minutosEntre(inicio, fin),
      nota: datos.nota || null,
      facturable: datos.facturable ?? true,
    });
    this.avisarTablero(tarea.tablero_id, tarea.id, usuarioId);
    return vista(await this.repository.completo(creado.id), ahora);
  }

  /** Solo los propios. Mientras corre solo se cambian nota, facturable e inicio. */
  async editar(id: number, usuarioId: number, datos: EditarRegistroDto, ahora: Date = new Date()): Promise<RegistroVista> {
    const registro = await this.propio(id, usuarioId);
    const cambios: Partial<InferAttributes<RegistroHoras>> = {};
    if (datos.nota !== undefined) cambios.nota = datos.nota || null;
    if (datos.facturable !== undefined) cambios.facturable = datos.facturable;

    if (!registro.fin) {
      if (datos.fin || datos.minutos !== undefined) throw new BadRequestError('Detén el cronómetro antes de cambiar su duración');
      if (datos.inicio) {
        if (datos.inicio.getTime() > ahora.getTime()) throw new BadRequestError('El inicio no puede ser en el futuro');
        cambios.inicio = datos.inicio;
      }
    } else if (datos.inicio || datos.fin || datos.minutos !== undefined) {
      const inicio = datos.inicio ?? new Date(registro.inicio);
      // Si solo cambia el inicio se conserva la duración.
      const minutos = datos.minutos ?? (datos.fin ? undefined : registro.minutos);
      const { fin } = this.intervalo({ inicio, fin: datos.fin, minutos }, ahora);
      Object.assign(cambios, { inicio, fin, minutos: minutosEntre(inicio, fin) });
    }
    await this.repository.update(registro, cambios);
    this.avisarTablero(registro.tablero_id, registro.tarea_id, usuarioId);
    return vista(await this.repository.completo(id), ahora);
  }

  async eliminar(id: number, usuarioId: number): Promise<void> {
    const registro = await this.propio(id, usuarioId);
    const corria = !registro.fin;
    await this.repository.delete(registro.id);
    if (corria) this.avisarCronometro(usuarioId, null);
    this.avisarTablero(registro.tablero_id, registro.tarea_id, usuarioId);
  }

  // ---------- Resúmenes ----------

  /** Totales del tablero en el rango: por persona y por tarea, con importe si hay tarifas. */
  async resumen(tableroId: number, usuarioId: number, filtro: ResumenQuery, ahora: Date = new Date()): Promise<ResumenHoras> {
    const { tablero } = await this.acceso.exigir(tableroId, usuarioId, 'ver');
    const { registros, tarifas, usuarios, tareas } = await this.datosResumen(tablero, filtro);
    return armarResumen(registros, tarifas, { desde: filtro.desde, hasta: filtro.hasta, usuarios, tareas }, ahora);
  }

  /** CSV con un renglón por registro (fechas en la zona indicada, UTC por defecto). */
  async csv(tableroId: number, usuarioId: number, filtro: ResumenQuery, ahora: Date = new Date()): Promise<ArchivoTexto> {
    const { tablero } = await this.acceso.exigir(tableroId, usuarioId, 'ver');
    const { registros, tarifas, usuarios, tareas } = await this.datosResumen(tablero, filtro);
    const zona = filtro.zona ?? 'UTC';
    const filas: CeldaCsv[][] = [
      ['Inicio', 'Fin', 'Persona', 'Usuario', 'Tarea', 'Título', 'Nota', 'Minutos', 'Horas', 'Facturable', `Tarifa/h (${tarifas.moneda})`, `Importe (${tarifas.moneda})`],
    ];
    let minutosTotales = 0;
    let centavosTotales = 0;
    for (const registro of registros) {
      const minutos = minutosDe(registro, ahora);
      const persona = usuarios.get(registro.usuario_id);
      const tarea = tareas.get(registro.tarea_id);
      const tarifa = tarifaDe(tarifas, registro.usuario_id);
      const importe = importeDe(registro, tarifas, ahora);
      minutosTotales += minutos;
      centavosTotales += importe ?? 0;
      filas.push([
        fechaZona(new Date(registro.inicio), zona),
        registro.fin ? fechaZona(new Date(registro.fin), zona) : 'En curso',
        persona?.nombre_completo ?? '',
        persona?.nombre_usuario ?? '',
        tarea?.clave ?? '',
        tarea?.titulo ?? '',
        registro.nota ?? '',
        minutos,
        Math.round((minutos / 60) * 100) / 100,
        registro.facturable,
        tarifa === null ? null : aMoneda(tarifa),
        importe === null ? null : aMoneda(importe),
      ]);
    }
    filas.push(['Total', '', '', '', '', '', '', minutosTotales, Math.round((minutosTotales / 60) * 100) / 100, '', '', aMoneda(centavosTotales)]);
    const desde = filtro.desde.toISOString().slice(0, 10);
    const hasta = filtro.hasta.toISOString().slice(0, 10);
    return { nombre: `horas-${nombreArchivo(tablero.clave)}-${desde}-a-${hasta}.csv`, tipo: 'text/csv; charset=utf-8', contenido: aCsv(filas) };
  }

  // ---------- Tarifas ----------

  async verTarifas(tableroId: number, usuarioId: number): Promise<TarifasVista> {
    await this.acceso.exigir(tableroId, usuarioId, 'ver');
    return this.tarifasVista(tableroId);
  }

  /** Tarifa del tablero (sin usuario_id) o de un miembro; null la quita. Solo administradores del tablero. */
  async fijarTarifa(tableroId: number, usuarioId: number, { usuario_id, tarifa, moneda }: TarifaDto): Promise<TarifasVista> {
    const { tablero } = await this.acceso.exigir(tableroId, usuarioId, 'administrar');
    if (usuario_id && !(await this.tableros.acceso(tablero, usuario_id)).ver) throw new BadRequestError('Esa persona no tiene acceso al tablero');
    const actual = await this.tarifas.deTablero(tableroId);
    await this.tarifas.fijar(tableroId, usuario_id ?? null, tarifa === null ? null : aCentavos(tarifa), moneda ?? actual.moneda ?? MONEDA_POR_DEFECTO);
    this.avisarTablero(tableroId, null, usuarioId);
    return this.tarifasVista(tableroId);
  }

  // ---------- Apoyo ----------

  private async tarifasVista(tableroId: number): Promise<TarifasVista> {
    const tarifas = await this.tarifas.deTablero(tableroId);
    return {
      moneda: tarifas.moneda,
      tablero: tarifas.tablero === null ? null : aMoneda(tarifas.tablero),
      miembros: [...tarifas.porUsuario.entries()].map(([id, centavos]) => ({ usuario_id: id, tarifa: aMoneda(centavos) })),
    };
  }

  private async datosResumen(tablero: Tablero, filtro: ResumenQuery) {
    const [registros, tarifas] = await Promise.all([
      this.repository.delTablero({ tablero_id: tablero.id, desde: filtro.desde, hasta: filtro.hasta, usuario_id: filtro.usuario_id, facturable: filtro.facturable }),
      this.tarifas.deTablero(tablero.id),
    ]);
    const usuarios = new Map<number, UsuarioPublico>();
    const tareas = new Map<number, TareaResumen>();
    for (const registro of registros as RegistroCargado[]) {
      if (registro.usuario) usuarios.set(registro.usuario_id, registro.usuario);
      if (registro.tarea) tareas.set(registro.tarea_id, { id: registro.tarea.id, clave: claveDeTarea(tablero.clave, registro.tarea.numero), titulo: registro.tarea.titulo });
    }
    return { registros, tarifas, usuarios, tareas };
  }

  /** Carga la tarea, exige el permiso en su tablero y, para escribir, que el tablero no esté archivado. */
  private async cargar(tareaId: number, usuarioId: number, nivel: NivelAcceso): Promise<TareaCargada> {
    const tarea = await this.tareas.findByIdOrFail(tareaId);
    const { tablero } = await this.acceso.exigir(tarea.tablero_id, usuarioId, nivel);
    if (nivel !== 'ver' && tablero.archivado) throw new BadRequestError('El tablero está archivado: no se puede registrar tiempo');
    return { tarea, tablero };
  }

  /** Registro propio (403 si es de otra persona) en un tablero donde aún puedo editar. */
  private async propio(id: number, usuarioId: number): Promise<RegistroHoras> {
    const registro = await this.repository.findByIdOrFail(id);
    if (registro.usuario_id !== usuarioId) throw new ForbiddenError('Solo puedes cambiar tus propios registros de tiempo');
    await this.acceso.exigir(registro.tablero_id, usuarioId, 'editar');
    return registro;
  }

  /** Intervalo de un registro a mano, validado: dura de 1 min a 24 h y no termina en el futuro. */
  private intervalo(datos: { inicio?: Date; fin?: Date; minutos?: number }, ahora: Date): { inicio: Date; fin: Date } {
    let inicio: Date;
    let fin: Date;
    if (datos.minutos !== undefined) {
      inicio = datos.inicio ?? new Date(ahora.getTime() - datos.minutos * MS_MINUTO);
      fin = new Date(inicio.getTime() + datos.minutos * MS_MINUTO);
    } else if (datos.inicio && datos.fin) {
      inicio = datos.inicio;
      fin = datos.fin;
    } else {
      throw new BadRequestError('Indica los minutos o el inicio y el fin');
    }
    const minutos = minutosEntre(inicio, fin);
    if (fin.getTime() <= inicio.getTime() || minutos < 1) throw new BadRequestError('El fin debe ser al menos un minuto después del inicio');
    if (minutos > LIMITES_HORAS.minutosPorRegistro) throw new BadRequestError('Un registro no puede pasar de 24 horas');
    if (fin.getTime() > ahora.getTime() + TOLERANCIA_FUTURO_MS) throw new BadRequestError('No puedes registrar tiempo en el futuro');
    return { inicio, fin };
  }

  private cerrar(registro: RegistroHoras, ahora: Date, transaction?: Transaction) {
    return this.repository.update(registro, { fin: ahora, minutos: minutosEntre(new Date(registro.inicio), ahora), cronometro_de: null }, transaction);
  }

  private avisarCronometro(usuarioId: number, activo: RegistroVista | null): void {
    this.tiempoReal.aUsuario(usuarioId, EVENTOS_HORAS.cronometro, { activo });
  }

  private avisarTablero(tableroId: number, tareaId: number | null, usuarioId: number): void {
    this.tiempoReal.aSala(salas.tablero(tableroId), EVENTOS_HORAS.horas, { tablero_id: tableroId, tarea_id: tareaId, por_usuario_id: usuarioId });
  }
}

export const horaService = new HoraService(registroHorasRepository, tarifaRepository, tareaRepository, tableroRepository, accesoTableros, realtime, sequelize);
