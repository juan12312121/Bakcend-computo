import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notificacion, Tarea, TareaActividad } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { dispositivoService } from '../src/modules/dispositivos/dispositivo.service';
import { tableroRoutes } from '../src/modules/tableros/tablero.routes';
import { armarReporte, burndown } from '../src/modules/tableros/tablero.reporte';
import { necesitaRenumerar, posicionEntre } from '../src/modules/tableros/tarea.posicion';
import type { TareaTarjeta } from '../src/modules/tableros/tarea.repository';
import { enviarRecordatoriosTareas, programarRecordatoriosTareas, tareaService } from '../src/modules/tableros/tarea.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/tableros': tableroRoutes }));
beforeEach(reiniciarBD);
afterEach(() => vi.restoreAllMocks());

const HORA = 60 * 60 * 1000;

interface TableroRes {
  id: number;
  clave: string;
  columnas: { id: number; nombre: string; tareas: { id: number }[] }[];
}

interface TarjetaRes {
  id: number;
  clave: string;
  numero: number;
  columna_id: number;
  posicion: number;
  sprint_id: number | null;
  completada_en: string | null;
}

async function crearTablero(u: UsuarioPrueba, datos: Record<string, unknown> = {}): Promise<TableroRes> {
  const res = await api()
    .post('/api/tableros')
    .set(bearer(u))
    .send({ nombre: 'Trino', ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

async function crearTarea(u: UsuarioPrueba, tableroId: number, datos: Record<string, unknown> = {}): Promise<TarjetaRes> {
  const res = await api()
    .post(`/api/tableros/${tableroId}/tareas`)
    .set(bearer(u))
    .send({ titulo: 'Tarea', ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

async function invitar(admin: UsuarioPrueba, tableroId: number, u: UsuarioPrueba, rol = 'miembro') {
  await api().post(`/api/tableros/${tableroId}/miembros`).set(bearer(admin)).send({ usuario_id: u.id, rol }).expect(201);
}

const mover = (u: UsuarioPrueba, tareaId: number, cuerpo: Record<string, unknown>) =>
  api().post(`/api/tableros/tareas/${tareaId}/mover`).set(bearer(u)).send(cuerpo);

const notificaciones = (usuarioId: number, tipo: string) => Notificacion.findAll({ where: { usuario_id: usuarioId, tipo } });

const tarjeta = (extra: Partial<TareaTarjeta>): TareaTarjeta =>
  ({ id: 1, numero: 1, columna_id: 1, prioridad: 'media', asignados: [], completada_en: null, puntos: null, fecha_limite: null, sprint_id: null, ...extra }) as TareaTarjeta;

describe('tareas: piezas puras', () => {
  it('calcula la posición entre vecinas', () => {
    expect(posicionEntre(1, 2, null)).toBe(1.5);
    expect(posicionEntre(3, null, null)).toBe(4);
    expect(posicionEntre(null, 1, null)).toBe(0);
    expect(posicionEntre(null, null, 7)).toBe(8);
    expect(posicionEntre(null, null, null)).toBe(1);
    expect(necesitaRenumerar(1, 1 + 1e-9)).toBe(true);
    expect(necesitaRenumerar(1, 2)).toBe(false);
  });

  it('agrupa el reporte y arma el burndown por días', () => {
    const ana = { id: 1, nombre_usuario: 'ana', nombre_completo: 'Ana', foto_perfil_url: null, carrera: null };
    const ahora = new Date('2026-10-03T12:00:00Z');
    const tareas = [
      tarjeta({ id: 1, columna_id: 1, prioridad: 'alta', asignados: [ana], puntos: 3, sprint_id: 9, fecha_limite: new Date('2026-10-01T00:00:00Z') }),
      tarjeta({ id: 2, columna_id: 2, prioridad: 'alta', asignados: [ana], puntos: 5, sprint_id: 9, completada_en: new Date('2026-10-02T10:00:00Z') }),
      tarjeta({ id: 3, columna_id: 1, prioridad: 'baja' }),
    ];
    const sprint = { id: 9, nombre: 'S1', inicio: new Date('2026-10-01T08:00:00Z'), fin: new Date('2026-10-05T08:00:00Z'), fecha_creacion: new Date('2026-09-30') };
    const reporte = armarReporte(
      [
        { id: 1, nombre: 'Por hacer', es_final: false },
        { id: 2, nombre: 'Hecho', es_final: true },
      ],
      tareas,
      { sprint, tareas: tareas.filter((t) => t.sprint_id === 9) },
      ahora,
    );
    expect(reporte).toMatchObject({ total: 3, completadas: 1 });
    expect(reporte.por_columna.map((c) => c.total)).toEqual([2, 1]);
    expect(reporte.por_responsable).toEqual([
      { usuario: ana, total: 2, completadas: 1 },
      { usuario: null, total: 1, completadas: 0 },
    ]);
    expect(reporte.por_prioridad).toEqual([
      { prioridad: 'baja', total: 1 },
      { prioridad: 'media', total: 0 },
      { prioridad: 'alta', total: 2 },
      { prioridad: 'urgente', total: 0 },
    ]);
    expect(reporte.vencidas.map((t) => t.id)).toEqual([1]);
    expect(reporte.sprint).toMatchObject({ unidad: 'puntos', puntos_total: 8, puntos_completados: 5, tareas_total: 2, tareas_completadas: 1 });
    expect(reporte.sprint?.burndown).toEqual([
      { fecha: '2026-10-01', restantes: 8, ideal: 8 },
      { fecha: '2026-10-02', restantes: 3, ideal: 6 },
      { fecha: '2026-10-03', restantes: 3, ideal: 4 },
      { fecha: '2026-10-04', restantes: null, ideal: 2 },
      { fecha: '2026-10-05', restantes: null, ideal: 0 },
    ]);

    const sinPuntos = burndown({ ...sprint, fin: null }, [tarjeta({ id: 4 }), tarjeta({ id: 5 })], ahora);
    expect(sinPuntos).toMatchObject({ unidad: 'tareas', puntos_total: 2 });
    expect(sinPuntos.burndown).toHaveLength(14);
  });
});

describe('tareas: crear y numerar', () => {
  it('numera sin huecos (TRI-1, TRI-2...) y pone cada tarea al final de su columna', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana);
    const sala = vi.spyOn(realtime, 'aSala');
    const a = await crearTarea(ana, t.id);
    const b = await crearTarea(ana, t.id);
    const c = await crearTarea(ana, t.id, { columna_id: t.columnas[1].id });
    expect([a.clave, b.clave, c.clave]).toEqual(['TRI-1', 'TRI-2', 'TRI-3']);
    expect([a.columna_id, b.columna_id, c.columna_id]).toEqual([t.columnas[0].id, t.columnas[0].id, t.columnas[1].id]);
    expect(b.posicion).toBeGreaterThan(a.posicion);
    expect(sala).toHaveBeenCalledWith(`board_${t.id}`, 'tarea_creada', expect.objectContaining({ tarea: expect.objectContaining({ id: a.id }), por_usuario_id: ana.id }));

    // Borrar no reutiliza números.
    await api().delete(`/api/tableros/tareas/${c.id}`).set(bearer(ana)).expect(200);
    expect((await crearTarea(ana, t.id)).clave).toBe('TRI-4');
  });

  it('valida relaciones: columna de otro tablero, épica no épica, sprint cerrado, responsable sin acceso', async () => {
    const ana = await crearUsuario('ana');
    const ajeno = await crearUsuario('ajeno');
    const t = await crearTablero(ana);
    const otro = await crearTablero(ana, { nombre: 'Otro' });
    const normal = await crearTarea(ana, t.id);
    const base = `/api/tableros/${t.id}/tareas`;
    expect((await api().post(base).set(bearer(ana)).send({ titulo: 'x', columna_id: otro.columnas[0].id })).status).toBe(404);
    expect((await api().post(base).set(bearer(ana)).send({ titulo: 'x', epica_id: normal.id })).status).toBe(400);
    expect((await api().post(base).set(bearer(ana)).send({ titulo: 'x', asignados: [ajeno.id] })).status).toBe(400);
    expect((await api().post(base).set(bearer(ana)).send({ titulo: '', tipo: 'otro', prioridad: 'x', fecha_limite: 'mañana' })).status).toBe(400);

    const epica = await crearTarea(ana, t.id, { titulo: 'Login', tipo: 'epica' });
    const hija = await crearTarea(ana, t.id, { titulo: 'Form', epica_id: epica.id });
    const detalle = await api().get(`/api/tableros/tareas/${hija.id}`).set(bearer(ana));
    expect(detalle.body.data.epica).toMatchObject({ id: epica.id, clave: epica.clave });
  });

  it('editar registra actividad legible y reinicia el recordatorio al cambiar la fecha', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana);
    const tarea = await crearTarea(ana, t.id);
    await Tarea.update({ recordatorio_enviado: true }, { where: { id: tarea.id } });

    const res = await api()
      .put(`/api/tableros/tareas/${tarea.id}`)
      .set(bearer(ana))
      .send({ prioridad: 'urgente', fecha_limite: '2026-12-01T10:00:00Z', puntos: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ prioridad: 'urgente', puntos: 5, recordatorio_enviado: false });
    const actividad = await TareaActividad.findOne({ where: { tarea_id: tarea.id, accion: 'edito' } });
    expect(actividad?.detalle).toBe('editó TRI-1: prioridad, puntos, fecha límite');

    expect((await api().put(`/api/tableros/tareas/${tarea.id}`).set(bearer(ana)).send({})).status).toBe(400);
    const borrarFecha = await api().put(`/api/tableros/tareas/${tarea.id}`).set(bearer(ana)).send({ fecha_limite: null });
    expect(borrarFecha.body.data.fecha_limite).toBeNull();
  });
});

describe('tareas: mover', () => {
  it('inserta entre dos vecinas, respeta el orden y avisa a la sala', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana);
    const [col] = t.columnas;
    const a = await crearTarea(ana, t.id);
    const b = await crearTarea(ana, t.id);
    const c = await crearTarea(ana, t.id);
    const sala = vi.spyOn(realtime, 'aSala');

    const res = await mover(ana, c.id, { columna_id: col.id, anterior_id: a.id, siguiente_id: b.id });
    expect(res.status).toBe(200);
    expect(res.body.data.posicion).toBe((a.posicion + b.posicion) / 2);
    expect(sala).toHaveBeenCalledWith(`board_${t.id}`, 'tarea_movida', expect.objectContaining({ columna_origen_id: col.id }));

    await mover(ana, a.id, { columna_id: col.id, anterior_id: b.id }).expect(200);
    const detalle = await api().get(`/api/tableros/${t.id}`).set(bearer(ana));
    expect(detalle.body.data.columnas[0].tareas.map((x: { id: number }) => x.id)).toEqual([c.id, b.id, a.id]);

    expect((await mover(ana, a.id, { columna_id: col.id, anterior_id: a.id })).status).toBe(400);
    expect((await mover(ana, a.id, { columna_id: t.columnas[1].id, anterior_id: b.id })).status).toBe(400);
  });

  it('renumera la columna cuando dos vecinas quedan demasiado juntas', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana);
    const [col] = t.columnas;
    const a = await crearTarea(ana, t.id);
    const b = await crearTarea(ana, t.id);
    const c = await crearTarea(ana, t.id);
    await Tarea.update({ posicion: 1.0000000001 }, { where: { id: b.id } });
    await Tarea.update({ posicion: 1 }, { where: { id: a.id } });

    await mover(ana, c.id, { columna_id: col.id, anterior_id: a.id, siguiente_id: b.id }).expect(200);
    const detalle = await api().get(`/api/tableros/${t.id}`).set(bearer(ana));
    expect(detalle.body.data.columnas[0].tareas.map((x: { id: number }) => x.id)).toEqual([a.id, c.id, b.id]);
  });

  it('respeta el límite WIP (409) y marca/limpia completada_en con la columna final', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana);
    const [porHacer, enProgreso, , hecho] = t.columnas;
    await api().put(`/api/tableros/${t.id}/columnas/${enProgreso.id}`).set(bearer(ana)).send({ limite_wip: 1 }).expect(200);
    const a = await crearTarea(ana, t.id);
    const b = await crearTarea(ana, t.id);

    await mover(ana, a.id, { columna_id: enProgreso.id }).expect(200);
    const lleno = await mover(ana, b.id, { columna_id: enProgreso.id });
    expect(lleno.status).toBe(409);
    expect((await api().post(`/api/tableros/${t.id}/tareas`).set(bearer(ana)).send({ titulo: 'x', columna_id: enProgreso.id })).status).toBe(409);
    // Reordenar dentro de la misma columna no cuenta contra el límite.
    await mover(ana, a.id, { columna_id: enProgreso.id }).expect(200);

    const terminada = await mover(ana, a.id, { columna_id: hecho.id });
    expect(terminada.body.data.completada_en).toEqual(expect.any(String));
    const actividad = await TareaActividad.findOne({ where: { tarea_id: a.id, accion: 'movio' }, order: [['id', 'DESC']] });
    expect(actividad?.detalle).toBe('movió TRI-1 a Hecho');

    const reabierta = await mover(ana, a.id, { columna_id: porHacer.id });
    expect(reabierta.body.data.completada_en).toBeNull();
  });

  it('notifica "tarea_movida" a los responsables cuando otro la mueve', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const t = await crearTablero(ana);
    await invitar(ana, t.id, beto);
    const tarea = await crearTarea(ana, t.id, { titulo: 'Login', asignados: [ana.id, beto.id] });

    await mover(beto, tarea.id, { columna_id: t.columnas[1].id }).expect(200);
    const avisos = await notificaciones(ana.id, 'tarea_movida');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ de_usuario_id: beto.id, entidad_tipo: 'tarea', entidad_id: tarea.id, mensaje: 'movió la tarea TRI-1 «Login» a En progreso' });
    expect(await notificaciones(beto.id, 'tarea_movida')).toHaveLength(0);
  });
});

describe('tareas: responsables, checklist, comentarios y borrado', () => {
  it('asignar notifica al responsable; duplicado 409; quitar', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const ajeno = await crearUsuario('ajeno');
    const t = await crearTablero(ana);
    await invitar(ana, t.id, beto);
    const tarea = await crearTarea(ana, t.id, { titulo: 'Diseñar login' });

    const res = await api().post(`/api/tableros/tareas/${tarea.id}/asignados`).set(bearer(ana)).send({ usuario_id: beto.id });
    expect(res.status).toBe(200);
    expect(res.body.data.asignados.map((u: { id: number }) => u.id)).toEqual([beto.id]);
    const [aviso] = await notificaciones(beto.id, 'tarea_asignada');
    expect(aviso).toMatchObject({ entidad_tipo: 'tarea', entidad_id: tarea.id, mensaje: 'te asignó la tarea TRI-1 «Diseñar login»' });

    expect((await api().post(`/api/tableros/tareas/${tarea.id}/asignados`).set(bearer(ana)).send({ usuario_id: beto.id })).status).toBe(409);
    expect((await api().post(`/api/tableros/tareas/${tarea.id}/asignados`).set(bearer(ana)).send({ usuario_id: ajeno.id })).status).toBe(400);

    const quitado = await api().delete(`/api/tableros/tareas/${tarea.id}/asignados/${beto.id}`).set(bearer(ana));
    expect(quitado.body.data.asignados).toEqual([]);
    expect((await api().delete(`/api/tableros/tareas/${tarea.id}/asignados/${beto.id}`).set(bearer(ana))).status).toBe(404);
  });

  it('checklist: agregar, marcar y borrar; la tarjeta muestra el progreso', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana);
    const tarea = await crearTarea(ana, t.id);
    const base = `/api/tableros/tareas/${tarea.id}/checklist`;
    await api().post(base).set(bearer(ana)).send({ texto: 'Maqueta' }).expect(201);
    const lista = (await api().post(base).set(bearer(ana)).send({ texto: 'Pruebas' })).body.data;
    expect(lista.map((i: { texto: string }) => i.texto)).toEqual(['Maqueta', 'Pruebas']);

    const marcada = await api().put(`${base}/${lista[0].id}`).set(bearer(ana)).send({ hecho: true });
    expect(marcada.body.data[0].hecho).toBe(true);
    const detalle = await api().get(`/api/tableros/${t.id}`).set(bearer(ana));
    expect(detalle.body.data.columnas[0].tareas[0]).toMatchObject({ checklist_total: 2, checklist_hechos: 1 });

    await api().delete(`${base}/${lista[1].id}`).set(bearer(ana)).expect(200);
    expect((await api().delete(`${base}/${lista[1].id}`).set(bearer(ana))).status).toBe(404);
  });

  it('comentar avisa a responsables y creador (menos el autor); solo el autor edita', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const t = await crearTablero(ana);
    await invitar(ana, t.id, beto);
    await invitar(ana, t.id, caro);
    const tarea = await crearTarea(ana, t.id, { titulo: 'Login', asignados: [beto.id, caro.id] });

    const res = await api().post(`/api/tableros/tareas/${tarea.id}/comentarios`).set(bearer(beto)).send({ texto: 'Listo el diseño' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ texto: 'Listo el diseño', autor: { id: beto.id } });
    expect(await notificaciones(ana.id, 'tarea_comentario')).toHaveLength(1);
    expect(await notificaciones(caro.id, 'tarea_comentario')).toHaveLength(1);
    expect(await notificaciones(beto.id, 'tarea_comentario')).toHaveLength(0);

    const id = res.body.data.id;
    expect((await api().put(`/api/tableros/tareas/${tarea.id}/comentarios/${id}`).set(bearer(caro)).send({ texto: 'x' })).status).toBe(403);
    expect((await api().put(`/api/tableros/tareas/${tarea.id}/comentarios/${id}`).set(bearer(beto)).send({ texto: 'Editado' })).body.data.texto).toBe('Editado');
    expect((await api().delete(`/api/tableros/tareas/${tarea.id}/comentarios/${id}`).set(bearer(caro))).status).toBe(403);
    // El admin del tablero sí puede borrarlo.
    await api().delete(`/api/tableros/tareas/${tarea.id}/comentarios/${id}`).set(bearer(ana)).expect(200);

    const detalle = await api().get(`/api/tableros/tareas/${tarea.id}`).set(bearer(ana));
    expect(detalle.body.data).toMatchObject({ comentarios: [], total_comentarios: 0, columna: { nombre: 'Por hacer' }, puede_editar: true });
    expect(detalle.body.data.actividad.map((a: { accion: string }) => a.accion)).toEqual(expect.arrayContaining(['creo', 'comento']));
    const actividad = await api().get(`/api/tableros/tareas/${tarea.id}/actividad?limit=1`).set(bearer(ana));
    expect(actividad.body.meta).toMatchObject({ limit: 1, hayMas: true });
  });

  it('archivar la saca del tablero; eliminar solo el creador o un admin', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const t = await crearTablero(ana);
    await invitar(ana, t.id, beto);
    const tarea = await crearTarea(ana, t.id);

    await api().post(`/api/tableros/tareas/${tarea.id}/archivar`).set(bearer(beto)).expect(200);
    expect((await api().get(`/api/tableros/${t.id}`).set(bearer(ana))).body.data.columnas[0].tareas).toEqual([]);
    await api().post(`/api/tableros/tareas/${tarea.id}/desarchivar`).set(bearer(beto)).expect(200);

    expect((await api().delete(`/api/tableros/tareas/${tarea.id}`).set(bearer(beto))).status).toBe(403);
    const sala = vi.spyOn(realtime, 'aSala');
    await api().delete(`/api/tableros/tareas/${tarea.id}`).set(bearer(ana)).expect(200);
    expect(sala).toHaveBeenCalledWith(`board_${t.id}`, 'tarea_eliminada', expect.objectContaining({ tarea_id: tarea.id, por_usuario_id: ana.id }));
    expect((await api().get(`/api/tableros/tareas/${tarea.id}`).set(bearer(ana))).status).toBe(404);
  });
});

describe('tareas: filtros y mis tareas', () => {
  it('filtra por texto, clave, asignado (yo), etiqueta, tipo, prioridad y vencidas', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana);
    const etiqueta = (await api().post(`/api/tableros/${t.id}/etiquetas`).set(bearer(ana)).send({ nombre: 'UI' })).body.data[0];
    const login = await crearTarea(ana, t.id, { titulo: 'Pantalla de login', asignados: [ana.id], etiquetas: [etiqueta.id] });
    const bug = await crearTarea(ana, t.id, { titulo: 'Error al guardar', tipo: 'bug', prioridad: 'urgente', fecha_limite: new Date(Date.now() - HORA).toISOString() });
    await crearTarea(ana, t.id, { titulo: 'Documentar' });

    const ids = async (query: string) => {
      const res = await api().get(`/api/tableros/${t.id}?${query}`).set(bearer(ana));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.columnas.flatMap((c: { tareas: { id: number }[] }) => c.tareas.map((x) => x.id));
    };
    expect(await ids('q=login')).toEqual([login.id]);
    expect(await ids('q=TRI-2')).toEqual([bug.id]);
    expect(await ids('asignado=yo')).toEqual([login.id]);
    expect(await ids(`etiqueta=${etiqueta.id}`)).toEqual([login.id]);
    expect(await ids('tipo=bug')).toEqual([bug.id]);
    expect(await ids('prioridad=urgente')).toEqual([bug.id]);
    expect(await ids('vencidas=true')).toEqual([bug.id]);

    const lista = await api().get(`/api/tableros/${t.id}/tareas?limit=2&prioridad=media`).set(bearer(ana));
    expect(lista.body.data.map((x: { clave: string }) => x.clave)).toEqual(['TRI-3', 'TRI-1']);
    expect(lista.body.meta).toMatchObject({ total: 2, hayMas: false });
  });

  it('mis tareas: asignadas sin terminar de tableros que veo, por fecha límite (sin fecha al final)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const t = await crearTablero(ana, { color: 'from-pink-400 to-pink-600' });
    const otro = await crearTablero(beto, { nombre: 'Beto' });
    await invitar(beto, otro.id, ana);

    const sinFecha = await crearTarea(ana, t.id, { titulo: 'Sin fecha', asignados: [ana.id] });
    const tarde = await crearTarea(ana, t.id, { titulo: 'Tarde', asignados: [ana.id], fecha_limite: '2026-12-20T00:00:00Z' });
    const pronto = await crearTarea(beto, otro.id, { titulo: 'Pronto', asignados: [ana.id], fecha_limite: '2026-11-01T00:00:00Z' });
    const hecha = await crearTarea(ana, t.id, { titulo: 'Hecha', asignados: [ana.id] });
    await mover(ana, hecha.id, { columna_id: t.columnas[3].id }).expect(200);
    await crearTarea(ana, t.id, { titulo: 'Ajena', asignados: [] });

    const res = await api().get('/api/tableros/mis-tareas').set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.data.map((x: { id: number }) => x.id)).toEqual([pronto.id, tarde.id, sinFecha.id]);
    expect(res.body.data[1]).toMatchObject({ clave: 'TRI-2', tablero: { id: t.id, nombre: 'Trino', clave: 'TRI', color: 'from-pink-400 to-pink-600' } });

    // Si sale del tablero de Beto, esa tarea ya no aparece.
    await api().post(`/api/tableros/${otro.id}/salir`).set(bearer(ana)).expect(200);
    const despues = await api().get('/api/tableros/mis-tareas').set(bearer(ana));
    expect(despues.body.data.map((x: { id: number }) => x.id)).toEqual([tarde.id, sinFecha.id]);
  });
});

describe('sprints y backlog', () => {
  it('crear, iniciar (solo uno activo), backlog y cerrar mandando lo pendiente al backlog', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana, { plantilla: 'scrum' });
    const s1 = (await api().post(`/api/tableros/${t.id}/sprints`).set(bearer(ana)).send({ nombre: 'Sprint 1', objetivo: 'Login' })).body.data;
    const s2 = (await api().post(`/api/tableros/${t.id}/sprints`).set(bearer(ana)).send({ nombre: 'Sprint 2' })).body.data;
    expect(s1).toMatchObject({ estado: 'planeado', objetivo: 'Login' });

    const a = await crearTarea(ana, t.id, { sprint_id: s1.id, puntos: 3 });
    const b = await crearTarea(ana, t.id, { sprint_id: s1.id, puntos: 5 });
    const suelta = await crearTarea(ana, t.id);

    const iniciado = await api().post(`/api/tableros/sprints/${s1.id}/iniciar`).set(bearer(ana)).send({});
    expect(iniciado.status).toBe(200);
    expect(iniciado.body.data).toMatchObject({ estado: 'activo', inicio: expect.any(String), fin: expect.any(String) });
    expect((await api().post(`/api/tableros/sprints/${s2.id}/iniciar`).set(bearer(ana)).send({})).status).toBe(409);
    expect((await api().post(`/api/tableros/sprints/${s1.id}/iniciar`).set(bearer(ana)).send({})).status).toBe(400);

    const backlog = await api().get(`/api/tableros/${t.id}/backlog`).set(bearer(ana));
    expect(backlog.body.data.sprints.map((s: { id: number }) => s.id)).toEqual([s1.id, s2.id]);
    expect(backlog.body.data.sprints[0]).toMatchObject({ puntos_total: 8, puntos_completados: 0 });
    expect(backlog.body.data.backlog.map((x: { id: number }) => x.id)).toEqual([suelta.id]);

    const activo = await api().get(`/api/tableros/${t.id}?sprint=activo`).set(bearer(ana));
    expect(activo.body.data.sprint_activo.id).toBe(s1.id);
    expect(activo.body.data.columnas[0].tareas.map((x: { id: number }) => x.id)).toEqual([a.id, b.id]);

    await mover(ana, a.id, { columna_id: t.columnas[3].id }).expect(200);
    const reporte = await api().get(`/api/tableros/${t.id}/reporte`).set(bearer(ana));
    expect(reporte.body.data.sprint).toMatchObject({ id: s1.id, puntos_total: 8, puntos_completados: 3, unidad: 'puntos' });
    expect(reporte.body.data.sprint.burndown.length).toBeGreaterThan(1);

    const cierre = await api().post(`/api/tableros/sprints/${s1.id}/cerrar`).set(bearer(ana)).send({});
    expect(cierre.status).toBe(200);
    expect(cierre.body.data).toMatchObject({ sprint: { estado: 'cerrado' }, tareas_movidas: 1, destino_sprint_id: null });
    expect(await Tarea.findByPk(b.id)).toMatchObject({ sprint_id: null });
    expect(await Tarea.findByPk(a.id)).toMatchObject({ sprint_id: s1.id });
    expect((await api().post(`/api/tableros/sprints/${s1.id}/cerrar`).set(bearer(ana)).send({})).status).toBe(400);
    expect((await api().put(`/api/tableros/tareas/${b.id}`).set(bearer(ana)).send({ sprint_id: s1.id })).status).toBe(400);
  });

  it('cerrar pasando lo pendiente a otro sprint planeado; eliminar devuelve sus tareas al backlog', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana);
    const s1 = (await api().post(`/api/tableros/${t.id}/sprints`).set(bearer(ana)).send({ nombre: 'S1' })).body.data;
    const s2 = (await api().post(`/api/tableros/${t.id}/sprints`).set(bearer(ana)).send({ nombre: 'S2' })).body.data;
    const tarea = await crearTarea(ana, t.id, { sprint_id: s1.id });
    await api().post(`/api/tableros/sprints/${s1.id}/iniciar`).set(bearer(ana)).send({}).expect(200);

    expect((await api().delete(`/api/tableros/sprints/${s1.id}`).set(bearer(ana))).status).toBe(400);
    expect((await api().post(`/api/tableros/sprints/${s1.id}/cerrar`).set(bearer(ana)).send({ mover_a_sprint_id: s1.id })).status).toBe(400);
    const cierre = await api().post(`/api/tableros/sprints/${s1.id}/cerrar`).set(bearer(ana)).send({ mover_a_sprint_id: s2.id });
    expect(cierre.body.data).toMatchObject({ tareas_movidas: 1, destino_sprint_id: s2.id });
    expect(await Tarea.findByPk(tarea.id)).toMatchObject({ sprint_id: s2.id });

    await api().delete(`/api/tableros/sprints/${s2.id}`).set(bearer(ana)).expect(200);
    expect(await Tarea.findByPk(tarea.id)).toMatchObject({ sprint_id: null });
    const sprints = await api().get(`/api/tableros/${t.id}/sprints`).set(bearer(ana));
    expect(sprints.body.data.map((s: { nombre: string }) => s.nombre)).toEqual(['S1']);
  });

  it('valida fechas del sprint y permisos de observador', async () => {
    const ana = await crearUsuario('ana');
    const obs = await crearUsuario('obs');
    const t = await crearTablero(ana);
    await invitar(ana, t.id, obs, 'observador');
    const mal = await api().post(`/api/tableros/${t.id}/sprints`).set(bearer(ana)).send({ nombre: 'X', inicio: '2026-10-10', fin: '2026-10-01' });
    expect(mal.status).toBe(400);
    expect((await api().post(`/api/tableros/${t.id}/sprints`).set(bearer(obs)).send({ nombre: 'X' })).status).toBe(403);
    expect((await api().get(`/api/tableros/${t.id}/backlog`).set(bearer(obs))).status).toBe(200);
  });
});

describe('recordatorios de tareas por vencer', () => {
  it('avisa "tarea_vence" a los responsables una sola vez y solo si vence en menos de 24 h', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const t = await crearTablero(ana);
    await invitar(ana, t.id, beto);
    const ahora = new Date();
    const pronto = await crearTarea(ana, t.id, { titulo: 'Entrega', asignados: [beto.id], fecha_limite: new Date(ahora.getTime() + 3 * HORA).toISOString() });
    await crearTarea(ana, t.id, { titulo: 'Lejos', asignados: [beto.id], fecha_limite: new Date(ahora.getTime() + 48 * HORA).toISOString() });
    await crearTarea(ana, t.id, { titulo: 'Vencida', asignados: [beto.id], fecha_limite: new Date(ahora.getTime() - HORA).toISOString() });
    const hecha = await crearTarea(ana, t.id, { titulo: 'Hecha', asignados: [beto.id], fecha_limite: new Date(ahora.getTime() + HORA).toISOString() });
    await mover(ana, hecha.id, { columna_id: t.columnas[3].id }).expect(200);

    expect(await enviarRecordatoriosTareas(ahora)).toBe(1);
    const avisos = await notificaciones(beto.id, 'tarea_vence');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ de_usuario_id: ana.id, entidad_tipo: 'tarea', entidad_id: pronto.id });
    expect(avisos[0].mensaje).toContain('TRI-1 «Entrega»');
    expect(await Tarea.findByPk(pronto.id)).toMatchObject({ recordatorio_enviado: true });

    expect(await enviarRecordatoriosTareas(ahora)).toBe(0);
  });

  it('si el responsable es el único posible emisor, manda solo la push', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana);
    const push = vi.spyOn(dispositivoService, 'avisar').mockResolvedValue(undefined);
    await crearTarea(ana, t.id, { titulo: 'Mía', asignados: [ana.id], fecha_limite: new Date(Date.now() + HORA).toISOString() });

    expect(await enviarRecordatoriosTareas()).toBe(1);
    expect(push).toHaveBeenCalledWith(ana.id, expect.objectContaining({ datos: expect.objectContaining({ tipo: 'tarea_vence', entidad_tipo: 'tarea' }) }));
    expect(await notificaciones(ana.id, 'tarea_vence')).toHaveLength(0);
  });

  it('programarRecordatoriosTareas corre una pasada cada 15 minutos', async () => {
    vi.useFakeTimers();
    const pasada = vi.spyOn(tareaService, 'enviarRecordatorios').mockResolvedValue(0);
    const temporizador = programarRecordatoriosTareas();
    vi.advanceTimersByTime(14 * 60_000);
    expect(pasada).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(pasada).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15 * 60_000);
    expect(pasada).toHaveBeenCalledTimes(2);
    clearInterval(temporizador);
    vi.useRealTimers();
  });
});
