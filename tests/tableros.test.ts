import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Grupo, GrupoMiembro, Notificacion, Tablero, TableroColumna, Tarea, TareaActividad } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { calcularAcceso } from '../src/modules/tableros/tablero.permisos';
import { generarClave } from '../src/modules/tableros/tablero.plantillas';
import { tableroRepository } from '../src/modules/tableros/tablero.repository';
import { tableroRoutes } from '../src/modules/tableros/tablero.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/tableros': tableroRoutes }));
beforeEach(reiniciarBD);
afterEach(() => vi.restoreAllMocks());

interface ColumnaRes {
  id: number;
  nombre: string;
  es_final: boolean;
  tareas: { id: number; clave: string }[];
}

async function crearTablero(u: UsuarioPrueba, datos: Record<string, unknown> = {}) {
  const res = await api()
    .post('/api/tableros')
    .set(bearer(u))
    .send({ nombre: 'Trino Web', ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: number; clave: string; columnas: ColumnaRes[] };
}

async function crearTarea(u: UsuarioPrueba, tableroId: number, datos: Record<string, unknown> = {}) {
  const res = await api()
    .post(`/api/tableros/${tableroId}/tareas`)
    .set(bearer(u))
    .send({ titulo: 'Diseñar login', ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: number; clave: string; numero: number; columna_id: number };
}

/** Grupo con su creador como admin activo; `otros` entran con el rol/estado indicado. */
async function crearGrupo(creador: UsuarioPrueba, otros: { u: UsuarioPrueba; rol?: 'miembro' | 'admin' | 'moderador'; estado?: 'activo' | 'pendiente' }[] = []) {
  const grupo = await Grupo.create({ nombre: 'Equipo', creador_id: creador.id });
  await GrupoMiembro.create({ grupo_id: grupo.id, usuario_id: creador.id, rol: 'admin', estado: 'activo' });
  for (const { u, rol = 'miembro', estado = 'activo' } of otros) {
    await GrupoMiembro.create({ grupo_id: grupo.id, usuario_id: u.id, rol, estado });
  }
  return grupo;
}

describe('tableros: piezas puras', () => {
  it('genera la clave estilo Jira sin acentos', () => {
    expect(generarClave('Trino')).toBe('TRI');
    expect(generarClave('Proyecto final web')).toBe('PFW');
    expect(generarClave('Diseño de la app')).toBe('DA');
    expect(generarClave('Árbol')).toBe('ARB');
    expect(generarClave('Uno dos tres cuatro cinco')).toBe('UDTC');
    expect(generarClave('Ñ')).toBe('NX');
    expect(generarClave('2026')).toBe('TAB');
  });

  it('calcula permisos: miembro, observador, grupo y ajeno', () => {
    const personal = { creador_id: 1, grupo_id: null };
    const deGrupo = { creador_id: 1, grupo_id: 9 };
    expect(calcularAcceso(personal, 1, 'admin', null)).toMatchObject({ ver: true, editar: true, administrar: true });
    expect(calcularAcceso(personal, 2, 'miembro', null)).toMatchObject({ ver: true, editar: true, administrar: false });
    expect(calcularAcceso(personal, 3, 'observador', null)).toMatchObject({ ver: true, editar: false, administrar: false });
    expect(calcularAcceso(personal, 4, null, null)).toMatchObject({ ver: false, editar: false, administrar: false });
    expect(calcularAcceso(deGrupo, 5, null, 'miembro')).toMatchObject({ ver: true, editar: true, administrar: false, rol: null });
    expect(calcularAcceso(deGrupo, 6, null, 'moderador')).toMatchObject({ ver: true, administrar: true });
    expect(calcularAcceso(deGrupo, 7, 'observador', 'admin')).toMatchObject({ ver: true, editar: false, administrar: true });
  });
});

describe('tableros: crear, listar y detalle', () => {
  it('crea con clave, columnas de la plantilla y al creador como admin', async () => {
    const ana = await crearUsuario('ana');
    const kanban = await crearTablero(ana, { nombre: 'Trinoflow', color: 'from-sky-400 to-sky-600' });
    expect(kanban).toMatchObject({
      clave: 'TRI',
      color: 'from-sky-400 to-sky-600',
      creador_id: ana.id,
      mi_rol: 'admin',
      puede_editar: true,
      puede_administrar: true,
      total_tareas: 0,
      sprint_activo: null,
    });
    expect(kanban.columnas.map((c) => [c.nombre, c.es_final])).toEqual([
      ['Por hacer', false],
      ['En progreso', false],
      ['En revisión', false],
      ['Hecho', true],
    ]);

    const escuela = await crearTablero(ana, { nombre: 'Tareas de química', plantilla: 'escuela' });
    expect(escuela.clave).toBe('TQ');
    expect(escuela.columnas.map((c) => c.nombre)).toEqual(['Pendiente', 'Haciendo', 'Entregado']);

    const personal = await crearTablero(ana, { nombre: 'Casa', plantilla: 'personal' });
    expect(personal.columnas.map((c) => c.nombre)).toEqual(['Por hacer', 'Haciendo', 'Listo']);
    expect(await TareaActividad.count({ where: { tablero_id: kanban.id, accion: 'creo_tablero' } })).toBe(1);
  });

  it('valida el cuerpo, exige sesión y valida ids', async () => {
    const ana = await crearUsuario('ana');
    const res = await api().post('/api/tableros').set(bearer(ana)).send({ nombre: ' ', plantilla: 'otra', color: 'rojo' });
    expect(res.status).toBe(400);
    expect(res.body.errores.map((e: { campo: string }) => e.campo)).toEqual(expect.arrayContaining(['nombre', 'plantilla', 'color']));
    expect((await api().get('/api/tableros')).status).toBe(401);
    expect((await api().get('/api/tableros/abc').set(bearer(ana))).status).toBe(400);
    expect((await api().get('/api/tableros/999').set(bearer(ana))).status).toBe(404);
  });

  it('lista los personales donde soy miembro y los de mis grupos activos, con filtro por grupo y archivados', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const grupo = await crearGrupo(ana, [{ u: beto }, { u: caro, estado: 'pendiente' }]);
    const personal = await crearTablero(ana, { nombre: 'Personal' });
    const delGrupo = await crearTablero(ana, { nombre: 'Del grupo', grupo_id: grupo.id });
    const archivado = await crearTablero(ana, { nombre: 'Viejo', grupo_id: grupo.id });
    await api().post(`/api/tableros/${archivado.id}/archivar`).set(bearer(ana)).expect(200);

    const deAna = await api().get('/api/tableros').set(bearer(ana));
    expect(deAna.body.data.map((t: { id: number }) => t.id).sort()).toEqual([personal.id, delGrupo.id].sort());

    const deBeto = await api().get('/api/tableros').set(bearer(beto));
    expect(deBeto.body.data).toHaveLength(1);
    expect(deBeto.body.data[0]).toMatchObject({ id: delGrupo.id, mi_rol: null, puede_editar: true, puede_administrar: false, grupo: { id: grupo.id } });

    expect((await api().get('/api/tableros').set(bearer(caro))).body.data).toEqual([]);

    const filtrado = await api().get(`/api/tableros?grupo_id=${grupo.id}`).set(bearer(ana));
    expect(filtrado.body.data.map((t: { id: number }) => t.id)).toEqual([delGrupo.id]);
    const archivados = await api().get('/api/tableros?archivados=true').set(bearer(ana));
    expect(archivados.body.data.map((t: { id: number }) => t.id)).toEqual([archivado.id]);
  });

  it('no deja crear un tablero en un grupo ajeno (403) ni inexistente (404)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const grupo = await crearGrupo(ana);
    expect((await api().post('/api/tableros').set(bearer(beto)).send({ nombre: 'X', grupo_id: grupo.id })).status).toBe(403);
    expect((await api().post('/api/tableros').set(bearer(ana)).send({ nombre: 'X', grupo_id: 999 })).status).toBe(404);
  });

  it('el detalle trae columnas con tareas ordenadas, miembros, etiquetas y contadores', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana);
    const [porHacer, , , hecho] = t.columnas;
    const a = await crearTarea(ana, t.id, { titulo: 'A' });
    const b = await crearTarea(ana, t.id, { titulo: 'B' });
    await crearTarea(ana, t.id, { titulo: 'C', columna_id: hecho.id });

    const res = await api().get(`/api/tableros/${t.id}`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.data.columnas[0]).toMatchObject({ id: porHacer.id, total_tareas: 2 });
    expect(res.body.data.columnas[0].tareas.map((x: { id: number }) => x.id)).toEqual([a.id, b.id]);
    expect(res.body.data.columnas[3].tareas[0]).toMatchObject({ clave: 'TW-3', completada_en: expect.any(String) });
    expect(res.body.data).toMatchObject({ total_tareas: 3, tareas_completadas: 1, miembros: [{ usuario_id: ana.id, rol: 'admin', usuario: { id: ana.id } }] });
  });
});

describe('tableros: permisos', () => {
  it('ajeno: 403 al ver, crear tareas o entrar a la sala', async () => {
    const ana = await crearUsuario('ana');
    const intruso = await crearUsuario('intruso');
    const t = await crearTablero(ana);
    expect((await api().get(`/api/tableros/${t.id}`).set(bearer(intruso))).status).toBe(403);
    expect((await api().post(`/api/tableros/${t.id}/tareas`).set(bearer(intruso)).send({ titulo: 'x' })).status).toBe(403);
    expect(await tableroRepository.puedeVer(t.id, intruso.id)).toBe(false);
    expect(await tableroRepository.puedeVer(t.id, ana.id)).toBe(true);
    expect(await tableroRepository.puedeVer(999, ana.id)).toBe(false);
  });

  it('observador: ve y comenta, pero no edita', async () => {
    const ana = await crearUsuario('ana');
    const obs = await crearUsuario('obs');
    const t = await crearTablero(ana);
    await api().post(`/api/tableros/${t.id}/miembros`).set(bearer(ana)).send({ usuario_id: obs.id, rol: 'observador' }).expect(201);
    const tarea = await crearTarea(ana, t.id);

    const detalle = await api().get(`/api/tableros/${t.id}`).set(bearer(obs));
    expect(detalle.body.data).toMatchObject({ mi_rol: 'observador', puede_editar: false, puede_administrar: false });
    expect((await api().post(`/api/tableros/${t.id}/tareas`).set(bearer(obs)).send({ titulo: 'x' })).status).toBe(403);
    expect((await api().put(`/api/tableros/tareas/${tarea.id}`).set(bearer(obs)).send({ titulo: 'x' })).status).toBe(403);
    expect((await api().post(`/api/tableros/tareas/${tarea.id}/comentarios`).set(bearer(obs)).send({ texto: 'Se ve bien' })).status).toBe(201);
  });

  it('miembro activo del grupo edita; admin/moderador del grupo administra; pendiente no entra', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const mod = await crearUsuario('mod');
    const pend = await crearUsuario('pend');
    const grupo = await crearGrupo(ana, [{ u: beto }, { u: mod, rol: 'moderador' }, { u: pend, estado: 'pendiente' }]);
    const t = await crearTablero(ana, { grupo_id: grupo.id });

    await crearTarea(beto, t.id, { titulo: 'De Beto' });
    expect((await api().put(`/api/tableros/${t.id}`).set(bearer(beto)).send({ nombre: 'Nuevo' })).status).toBe(403);
    const editado = await api().put(`/api/tableros/${t.id}`).set(bearer(mod)).send({ nombre: 'Nuevo' });
    expect(editado.status).toBe(200);
    expect(editado.body.data).toMatchObject({ nombre: 'Nuevo', puede_administrar: true });
    expect((await api().get(`/api/tableros/${t.id}`).set(bearer(pend))).status).toBe(403);
    expect(await tableroRepository.puedeVer(t.id, beto.id)).toBe(true);
  });

  it('archivar y eliminar: solo administradores; eliminar borra todo', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const t = await crearTablero(ana);
    await api().post(`/api/tableros/${t.id}/miembros`).set(bearer(ana)).send({ usuario_id: beto.id }).expect(201);
    await crearTarea(ana, t.id);

    expect((await api().post(`/api/tableros/${t.id}/archivar`).set(bearer(beto))).status).toBe(403);
    expect((await api().delete(`/api/tableros/${t.id}`).set(bearer(beto))).status).toBe(403);
    const archivado = await api().post(`/api/tableros/${t.id}/archivar`).set(bearer(ana));
    expect(archivado.body.data.archivado).toBe(true);
    expect((await api().post(`/api/tableros/${t.id}/desarchivar`).set(bearer(ana))).body.data.archivado).toBe(false);

    const sala = vi.spyOn(realtime, 'aSala');
    expect((await api().delete(`/api/tableros/${t.id}`).set(bearer(ana))).status).toBe(200);
    expect(await Tablero.count()).toBe(0);
    expect(await Tarea.count()).toBe(0);
    expect(await TableroColumna.count()).toBe(0);
    expect(sala).toHaveBeenCalledWith(`board_${t.id}`, 'tablero_actualizado', expect.objectContaining({ motivo: 'eliminado', por_usuario_id: ana.id }));
  });
});

describe('tableros: miembros', () => {
  it('invitar notifica con entidad tablero; duplicado 409; usuario inexistente 404', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const t = await crearTablero(ana, { nombre: 'Feria' });

    const res = await api().post(`/api/tableros/${t.id}/miembros`).set(bearer(ana)).send({ usuario_id: beto.id });
    expect(res.status).toBe(201);
    expect(res.body.data.map((m: { usuario_id: number; rol: string }) => [m.usuario_id, m.rol])).toEqual([
      [ana.id, 'admin'],
      [beto.id, 'miembro'],
    ]);
    const notificacion = await Notificacion.findOne({ where: { usuario_id: beto.id } });
    expect(notificacion).toMatchObject({ tipo: 'invitacion_grupo', entidad_tipo: 'tablero', entidad_id: t.id, mensaje: 'te agregó al tablero «Feria»' });

    expect((await api().post(`/api/tableros/${t.id}/miembros`).set(bearer(ana)).send({ usuario_id: beto.id })).status).toBe(409);
    expect((await api().post(`/api/tableros/${t.id}/miembros`).set(bearer(ana)).send({ usuario_id: 999 })).status).toBe(404);
    expect((await api().post(`/api/tableros/${t.id}/miembros`).set(bearer(beto)).send({ usuario_id: ana.id })).status).toBe(403);
  });

  it('cambiar rol, quitar (no al creador) y salir; al perder acceso deja de ser responsable', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const t = await crearTablero(ana);
    for (const u of [beto, caro]) await api().post(`/api/tableros/${t.id}/miembros`).set(bearer(ana)).send({ usuario_id: u.id }).expect(201);
    const tarea = await crearTarea(ana, t.id, { asignados: [beto.id] });

    const rol = await api().put(`/api/tableros/${t.id}/miembros/${beto.id}`).set(bearer(ana)).send({ rol: 'admin' });
    expect(rol.body.data.find((m: { usuario_id: number }) => m.usuario_id === beto.id).rol).toBe('admin');
    expect((await api().put(`/api/tableros/${t.id}/miembros/${ana.id}`).set(bearer(beto)).send({ rol: 'miembro' })).status).toBe(400);
    expect((await api().delete(`/api/tableros/${t.id}/miembros/${ana.id}`).set(bearer(beto))).status).toBe(400);

    expect((await api().delete(`/api/tableros/${t.id}/miembros/${beto.id}`).set(bearer(ana))).status).toBe(200);
    const detalle = await api().get(`/api/tableros/tareas/${tarea.id}`).set(bearer(ana));
    expect(detalle.body.data.asignados).toEqual([]);

    expect((await api().post(`/api/tableros/${t.id}/salir`).set(bearer(caro))).status).toBe(200);
    expect((await api().post(`/api/tableros/${t.id}/salir`).set(bearer(caro))).status).toBe(404);
    expect((await api().post(`/api/tableros/${t.id}/salir`).set(bearer(ana))).status).toBe(400);
  });
});

describe('tableros: columnas y etiquetas', () => {
  it('crea, renombra, reordena y avisa a la sala', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana);
    const sala = vi.spyOn(realtime, 'aSala');

    const creada = await api().post(`/api/tableros/${t.id}/columnas`).set(bearer(ana)).send({ nombre: 'QA', limite_wip: 2 });
    expect(creada.status).toBe(201);
    const qa = creada.body.data.at(-1);
    expect(qa).toMatchObject({ nombre: 'QA', posicion: 4, limite_wip: 2, total_tareas: 0 });
    expect(sala).toHaveBeenCalledWith(`board_${t.id}`, 'columnas_actualizadas', expect.objectContaining({ por_usuario_id: ana.id }));

    const renombrada = await api().put(`/api/tableros/${t.id}/columnas/${qa.id}`).set(bearer(ana)).send({ nombre: 'Pruebas', limite_wip: null });
    expect(renombrada.body.data.at(-1)).toMatchObject({ nombre: 'Pruebas', limite_wip: null });

    const ids = [qa.id, ...t.columnas.map((c) => c.id)];
    const orden = await api().put(`/api/tableros/${t.id}/columnas/orden`).set(bearer(ana)).send({ columnas: ids });
    expect(orden.body.data.map((c: { id: number }) => c.id)).toEqual(ids);
    expect((await api().put(`/api/tableros/${t.id}/columnas/orden`).set(bearer(ana)).send({ columnas: [qa.id] })).status).toBe(400);
  });

  it('borrar una columna con tareas exige mover_a; marcar final completa sus tareas', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana);
    const [porHacer, enProgreso] = t.columnas;
    const tarea = await crearTarea(ana, t.id, { columna_id: enProgreso.id });

    expect((await api().delete(`/api/tableros/${t.id}/columnas/${enProgreso.id}`).set(bearer(ana))).status).toBe(400);
    expect((await api().delete(`/api/tableros/${t.id}/columnas/${enProgreso.id}?mover_a=${enProgreso.id}`).set(bearer(ana))).status).toBe(400);
    const borrada = await api().delete(`/api/tableros/${t.id}/columnas/${enProgreso.id}?mover_a=${porHacer.id}`).set(bearer(ana));
    expect(borrada.status).toBe(200);
    expect(borrada.body.data).toHaveLength(3);
    expect(await Tarea.findByPk(tarea.id)).toMatchObject({ columna_id: porHacer.id });

    await api().put(`/api/tableros/${t.id}/columnas/${porHacer.id}`).set(bearer(ana)).send({ es_final: true }).expect(200);
    expect((await Tarea.findByPk(tarea.id))?.completada_en).toBeInstanceOf(Date);
    await api().put(`/api/tableros/${t.id}/columnas/${porHacer.id}`).set(bearer(ana)).send({ es_final: false }).expect(200);
    expect((await Tarea.findByPk(tarea.id))?.completada_en).toBeNull();
  });

  it('no deja borrar la última columna', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana, { plantilla: 'personal' });
    const [a, b, c] = t.columnas;
    await api().delete(`/api/tableros/${t.id}/columnas/${a.id}`).set(bearer(ana)).expect(200);
    await api().delete(`/api/tableros/${t.id}/columnas/${b.id}`).set(bearer(ana)).expect(200);
    expect((await api().delete(`/api/tableros/${t.id}/columnas/${c.id}`).set(bearer(ana))).status).toBe(400);
  });

  it('etiquetas: CRUD, nombre único y se quitan de las tareas al borrarse', async () => {
    const ana = await crearUsuario('ana');
    const t = await crearTablero(ana);
    const creada = await api().post(`/api/tableros/${t.id}/etiquetas`).set(bearer(ana)).send({ nombre: 'Frontend', color: 'bg-sky-500' });
    expect(creada.status).toBe(201);
    const etiqueta = creada.body.data[0];
    expect((await api().post(`/api/tableros/${t.id}/etiquetas`).set(bearer(ana)).send({ nombre: 'Frontend' })).status).toBe(409);
    expect((await api().post(`/api/tableros/${t.id}/etiquetas`).set(bearer(ana)).send({ nombre: 'X', color: 'azul' })).status).toBe(400);

    const tarea = await crearTarea(ana, t.id);
    const conEtiqueta = await api().post(`/api/tableros/tareas/${tarea.id}/etiquetas`).set(bearer(ana)).send({ etiqueta_id: etiqueta.id });
    expect(conEtiqueta.body.data.etiquetas).toEqual([expect.objectContaining({ nombre: 'Frontend', color: 'bg-sky-500' })]);
    expect((await api().post(`/api/tableros/tareas/${tarea.id}/etiquetas`).set(bearer(ana)).send({ etiqueta_id: etiqueta.id })).status).toBe(409);

    const editada = await api().put(`/api/tableros/${t.id}/etiquetas/${etiqueta.id}`).set(bearer(ana)).send({ color: 'bg-red-500' });
    expect(editada.body.data[0].color).toBe('bg-red-500');
    await api().delete(`/api/tableros/${t.id}/etiquetas/${etiqueta.id}`).set(bearer(ana)).expect(200);
    const detalle = await api().get(`/api/tableros/tareas/${tarea.id}`).set(bearer(ana));
    expect(detalle.body.data.etiquetas).toEqual([]);
  });
});
