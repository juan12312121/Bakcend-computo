import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Asignacion, Entrega, Grupo, GrupoMiembro, Notificacion } from '../src/infrastructure/database/models';
import { fileStorage, motorCloudinary } from '../src/infrastructure/storage/CloudinaryStorage';
import { aCsv, celdaCsv, nombreArchivo } from '../src/modules/aula/aula.csv';
import { aulaRoutes } from '../src/modules/aula/aula.routes';
import { enviarRecordatoriosEntregas, programarRecordatoriosEntregas } from '../src/modules/aula/asignaciones/asignacion.service';
import { armarLibreta, filasLibretaCsv, puedeEntregar } from '../src/modules/aula/asignaciones/libreta';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/aula': aulaRoutes }));
beforeEach(reiniciarBD);
afterEach(() => vi.restoreAllMocks());

const HORA = 60 * 60 * 1000;
const enHoras = (h: number) => new Date(Date.now() + h * HORA).toISOString();

/** Multer "sube" a una URL falsa de Cloudinary sin salir a internet. */
function simularSubidas(): void {
  vi.spyOn(motorCloudinary, '_handleFile').mockImplementation(async (_req, file, cb) => {
    file.stream.on('end', () =>
      cb(null, { path: `https://res.cloudinary.com/demo/raw/upload/v1/trino/aula/${file.originalname}`, filename: `trino/aula/${file.originalname}`, size: 5 }),
    );
    file.stream.resume();
  });
}

interface Escenario {
  grupoId: number;
  profe: UsuarioPrueba; // admin = maestro
  mod: UsuarioPrueba; // moderador = maestro
  ana: UsuarioPrueba; // alumna
  beto: UsuarioPrueba; // alumno
  caro: UsuarioPrueba; // solicitud pendiente
  dani: UsuarioPrueba; // de fuera
}

async function escenario(): Promise<Escenario> {
  const [profe, mod, ana, beto, caro, dani] = [
    await crearUsuario('profe'),
    await crearUsuario('mod'),
    await crearUsuario('ana'),
    await crearUsuario('beto'),
    await crearUsuario('caro'),
    await crearUsuario('dani'),
  ];
  const grupo = await Grupo.create({ nombre: 'Matemáticas 3°', creador_id: profe.id, tipo: 'escuela' });
  await GrupoMiembro.bulkCreate([
    { grupo_id: grupo.id, usuario_id: profe.id, rol: 'admin', estado: 'activo' },
    { grupo_id: grupo.id, usuario_id: mod.id, rol: 'moderador', estado: 'activo' },
    { grupo_id: grupo.id, usuario_id: ana.id, rol: 'miembro', estado: 'activo' },
    { grupo_id: grupo.id, usuario_id: beto.id, rol: 'miembro', estado: 'activo' },
    { grupo_id: grupo.id, usuario_id: caro.id, rol: 'miembro', estado: 'pendiente' },
  ]);
  return { grupoId: grupo.id, profe, mod, ana, beto, caro, dani };
}

async function crearAsignacion(u: UsuarioPrueba, grupoId: number, datos: Record<string, unknown> = {}) {
  const res = await api()
    .post(`/api/aula/grupos/${grupoId}/asignaciones`)
    .set(bearer(u))
    .send({ titulo: 'Ejercicios 1', fecha_entrega: enHoras(48), ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: number; puntos_maximos: number };
}

const entregar = (u: UsuarioPrueba, id: number, comentario = 'Aquí va') =>
  api().post(`/api/aula/asignaciones/${id}/entrega`).set(bearer(u)).send({ comentario });
const calificar = (u: UsuarioPrueba, id: number, alumnoId: number, cuerpo: Record<string, unknown>) =>
  api().post(`/api/aula/asignaciones/${id}/entregas/${alumnoId}/calificar`).set(bearer(u)).send(cuerpo);
const devolver = (u: UsuarioPrueba, id: number, alumnoId: number, retroalimentacion = 'Corrige el 3') =>
  api().post(`/api/aula/asignaciones/${id}/entregas/${alumnoId}/devolver`).set(bearer(u)).send({ retroalimentacion });
const vencer = (id: number, horas = -2) => Asignacion.update({ fecha_entrega: new Date(Date.now() + horas * HORA) }, { where: { id } });
const notificaciones = (usuarioId: number, tipo: string) => Notificacion.findAll({ where: { usuario_id: usuarioId, tipo } });

describe('asignaciones: piezas puras', () => {
  it('puedeEntregar: a tiempo, tardías, devuelta y calificada', () => {
    const ahora = new Date('2026-10-16T12:00:00Z');
    const futura = { fecha_entrega: new Date('2026-10-17T00:00:00Z'), acepta_tardias: false };
    const vencida = { fecha_entrega: new Date('2026-10-15T00:00:00Z'), acepta_tardias: false };
    expect(puedeEntregar(futura, null, ahora)).toBe(true);
    expect(puedeEntregar(vencida, null, ahora)).toBe(false);
    expect(puedeEntregar({ ...vencida, acepta_tardias: true }, null, ahora)).toBe(true);
    expect(puedeEntregar(vencida, { estado: 'devuelta' }, ahora)).toBe(true);
    expect(puedeEntregar(futura, { estado: 'calificada' }, ahora)).toBe(false);
  });

  it('armarLibreta: promedio ponderado de lo calificado, faltantes y promedio del grupo', () => {
    const ahora = new Date('2026-10-16T12:00:00Z');
    const asignaciones = [
      { id: 1, titulo: 'A', fecha_entrega: new Date('2026-10-10T00:00:00Z'), puntos_maximos: 10 },
      { id: 2, titulo: 'B', fecha_entrega: new Date('2026-10-12T00:00:00Z'), puntos_maximos: 30 },
      { id: 3, titulo: 'C', fecha_entrega: new Date('2026-10-30T00:00:00Z'), puntos_maximos: 10 },
    ];
    const alumno = (id: number, nombre: string) => ({ id, nombre_usuario: nombre, nombre_completo: nombre, foto_perfil_url: null, carrera: null });
    const libreta = armarLibreta(
      asignaciones,
      [alumno(1, 'Ana'), alumno(2, 'Beto')],
      [
        { asignacion_id: 1, alumno_id: 1, estado: 'calificada', puntos: 10, fue_tarde: false },
        { asignacion_id: 2, alumno_id: 1, estado: 'calificada', puntos: 15, fue_tarde: true },
        { asignacion_id: 1, alumno_id: 2, estado: 'calificada', puntos: 5, fue_tarde: false },
        { asignacion_id: 3, alumno_id: 2, estado: 'entregada', puntos: null, fue_tarde: false },
      ],
      ahora,
    );
    const [ana, beto] = libreta.alumnos;
    expect(ana).toMatchObject({ puntos_obtenidos: 25, puntos_posibles: 40, promedio: 62.5, entregadas: 2, faltantes: 0 });
    expect(ana.celdas[1]).toEqual({ asignacion_id: 2, estado: 'calificada', puntos: 15, fue_tarde: true });
    expect(beto).toMatchObject({ promedio: 50, entregadas: 2, faltantes: 1 });
    expect(libreta.promedio_grupo).toBe(56.3);
    expect(libreta.por_asignacion[0]).toEqual({ asignacion_id: 1, promedio: 75, entregadas: 2, calificadas: 2 });
    expect(libreta.por_asignacion[2]).toEqual({ asignacion_id: 3, promedio: null, entregadas: 1, calificadas: 0 });

    const filas = filasLibretaCsv(libreta);
    expect(filas[0]).toEqual(['Alumno', 'Usuario', 'A (/10)', 'B (/30)', 'C (/10)', 'Promedio %', 'Entregadas', 'Faltantes']);
    expect(filas[2]).toEqual(['Beto', 'Beto', 5, '', 'Entregada', 50, 2, 1]);
    expect(filas[3][0]).toBe('Promedio del grupo');
  });

  it('CSV: comillas, BOM, fórmulas neutralizadas y nombres de archivo', () => {
    expect(celdaCsv('Hola, "mundo"')).toBe('"Hola, ""mundo"""');
    expect(celdaCsv('=SUMA(A1)')).toBe("'=SUMA(A1)");
    expect(celdaCsv(-3)).toBe('-3');
    expect(celdaCsv(true)).toBe('Sí');
    expect(celdaCsv(null)).toBe('');
    expect(aCsv([['a', 1]])).toBe('﻿a,1\r\n');
    expect(nombreArchivo('Matemáticas 3° (A)')).toBe('matematicas-3-a');
  });
});

describe('asignaciones: permisos', () => {
  it('solo maestros (admin/moderador) crean; alumnos, pendientes y de fuera no', async () => {
    const { grupoId, mod, ana, caro, dani } = await escenario();
    const cuerpo = { titulo: 'X', fecha_entrega: enHoras(5) };
    expect((await api().post(`/api/aula/grupos/${grupoId}/asignaciones`).set(bearer(ana)).send(cuerpo)).status).toBe(403);
    expect((await api().post(`/api/aula/grupos/${grupoId}/asignaciones`).set(bearer(caro)).send(cuerpo)).status).toBe(403);
    expect((await api().post(`/api/aula/grupos/${grupoId}/asignaciones`).set(bearer(dani)).send(cuerpo)).status).toBe(403);
    expect((await api().post('/api/aula/grupos/999/asignaciones').set(bearer(mod)).send(cuerpo)).status).toBe(404);
    expect((await api().post(`/api/aula/grupos/${grupoId}/asignaciones`).send(cuerpo)).status).toBe(401);
    expect((await api().post(`/api/aula/grupos/${grupoId}/asignaciones`).set(bearer(mod)).send(cuerpo)).status).toBe(201);
  });

  it('valida título, fecha pasada y puntos', async () => {
    const { grupoId, profe } = await escenario();
    const crear = (cuerpo: Record<string, unknown>) => api().post(`/api/aula/grupos/${grupoId}/asignaciones`).set(bearer(profe)).send(cuerpo);
    expect((await crear({ fecha_entrega: enHoras(5) })).status).toBe(400);
    expect((await crear({ titulo: 'X', fecha_entrega: 'mañana' })).status).toBe(400);
    expect((await crear({ titulo: 'X', fecha_entrega: enHoras(-5) })).status).toBe(400);
    expect((await crear({ titulo: 'X', fecha_entrega: enHoras(5), puntos_maximos: 0 })).status).toBe(400);
  });

  it('el resumen del aula dice mi rol; de fuera 403', async () => {
    const { grupoId, profe, ana, dani } = await escenario();
    await crearAsignacion(profe, grupoId);
    const comoProfe = await api().get(`/api/aula/grupos/${grupoId}`).set(bearer(profe));
    expect(comoProfe.body.data).toMatchObject({ mi_rol: 'maestro', total_alumnos: 2, total_asignaciones: 1, por_calificar: 0, grupo: { tipo: 'escuela' } });
    const comoAna = await api().get(`/api/aula/grupos/${grupoId}`).set(bearer(ana));
    expect(comoAna.body.data).toMatchObject({ mi_rol: 'alumno', pendientes: 1 });
    expect((await api().get(`/api/aula/grupos/${grupoId}`).set(bearer(dani))).status).toBe(403);
  });
});

describe('asignaciones: crear, ver, editar y borrar', () => {
  it('crear avisa a cada alumno (no a maestros ni pendientes) y la vista cambia según el rol', async () => {
    const { grupoId, profe, mod, ana, beto, caro } = await escenario();
    const asignacion = await crearAsignacion(profe, grupoId, { instrucciones: 'Del libro', puntos_maximos: 20, acepta_tardias: false });
    expect(asignacion).toMatchObject({ titulo: 'Ejercicios 1', puntos_maximos: 20, acepta_tardias: false, archivo_url: null, mi_rol: 'maestro' });
    expect(asignacion).not.toHaveProperty('archivo_id');

    for (const u of [ana, beto]) {
      const [aviso] = await notificaciones(u.id, 'asignacion_nueva');
      expect(aviso).toMatchObject({ de_usuario_id: profe.id, entidad_tipo: 'asignacion', entidad_id: asignacion.id });
      expect(aviso.mensaje).toContain('Matemáticas 3°');
    }
    for (const u of [mod, caro, profe]) expect(await notificaciones(u.id, 'asignacion_nueva')).toHaveLength(0);

    const comoAlumno = await api().get(`/api/aula/asignaciones/${asignacion.id}`).set(bearer(ana));
    expect(comoAlumno.body.data).toMatchObject({ mi_rol: 'alumno', mi_estado: 'pendiente', mi_entrega: null, puede_entregar: true, resumen: null, vencida: false });
    const comoMaestro = await api().get(`/api/aula/asignaciones/${asignacion.id}`).set(bearer(mod));
    expect(comoMaestro.body.data).toMatchObject({ mi_estado: null, puede_entregar: false, resumen: { total_alumnos: 2, sin_entregar: 2, por_calificar: 0 } });
    expect((await api().get(`/api/aula/asignaciones/${asignacion.id}`).set(bearer(caro))).status).toBe(403);
  });

  it('con archivo de apoyo (multipart) y al quitarlo se borra del almacenamiento', async () => {
    simularSubidas();
    const borrar = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
    const { grupoId, profe } = await escenario();
    const res = await api()
      .post(`/api/aula/grupos/${grupoId}/asignaciones`)
      .set(bearer(profe))
      .field('titulo', 'Lectura')
      .field('fecha_entrega', enHoras(24))
      .field('puntos_maximos', '50')
      .field('acepta_tardias', 'false')
      .attach('archivo', Buffer.from('%PDF'), { filename: 'guia.pdf', contentType: 'application/pdf' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ archivo_nombre: 'guia.pdf', archivo_tipo: 'application/pdf', puntos_maximos: 50, acepta_tardias: false });
    expect(res.body.data.archivo_url).toContain('guia.pdf');

    const sinArchivo = await api().put(`/api/aula/asignaciones/${res.body.data.id}`).set(bearer(profe)).send({ quitar_archivo: true });
    expect(sinArchivo.body.data.archivo_url).toBeNull();
    expect(borrar).toHaveBeenCalledWith('trino/aula/guia.pdf');
  });

  it('listar: próximas y pasadas, paginado', async () => {
    const { grupoId, profe, ana } = await escenario();
    const a = await crearAsignacion(profe, grupoId, { titulo: 'Lejana', fecha_entrega: enHoras(72) });
    const b = await crearAsignacion(profe, grupoId, { titulo: 'Cercana', fecha_entrega: enHoras(2) });
    const c = await crearAsignacion(profe, grupoId, { titulo: 'Vieja' });
    await vencer(c.id);

    const todas = await api().get(`/api/aula/grupos/${grupoId}/asignaciones`).set(bearer(ana));
    expect(todas.body.data.map((x: { id: number }) => x.id)).toEqual([c.id, b.id, a.id]);
    expect(todas.body.meta).toMatchObject({ total: 3 });
    const proximas = await api().get(`/api/aula/grupos/${grupoId}/asignaciones?cuando=proximas&limit=1`).set(bearer(ana));
    expect(proximas.body.data.map((x: { titulo: string }) => x.titulo)).toEqual(['Cercana']);
    expect(proximas.body.meta.hayMas).toBe(true);
    const pasadas = await api().get(`/api/aula/grupos/${grupoId}/asignaciones?cuando=pasadas`).set(bearer(ana));
    expect(pasadas.body.data[0]).toMatchObject({ titulo: 'Vieja', vencida: true });
    expect((await api().get(`/api/aula/grupos/${grupoId}/asignaciones?cuando=ayer`).set(bearer(ana))).status).toBe(400);
  });

  it('editar: solo maestros; no se pueden bajar los puntos por debajo de una calificación; nueva fecha reactiva el recordatorio', async () => {
    const { grupoId, profe, mod, ana } = await escenario();
    const { id } = await crearAsignacion(profe, grupoId);
    expect((await api().put(`/api/aula/asignaciones/${id}`).set(bearer(ana)).send({ titulo: 'Mía' })).status).toBe(403);
    expect((await api().put(`/api/aula/asignaciones/${id}`).set(bearer(mod)).send({})).status).toBe(400);

    await entregar(ana, id).expect(200);
    await calificar(profe, id, ana.id, { puntos: 80 }).expect(200);
    const bajar = await api().put(`/api/aula/asignaciones/${id}`).set(bearer(mod)).send({ puntos_maximos: 50 });
    expect(bajar.status).toBe(400);

    await Asignacion.update({ recordatorio_enviado: true }, { where: { id } });
    const res = await api().put(`/api/aula/asignaciones/${id}`).set(bearer(mod)).send({ titulo: 'Ejercicios 1 y 2', puntos_maximos: 90, fecha_entrega: enHoras(30) });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ titulo: 'Ejercicios 1 y 2', puntos_maximos: 90 });
    expect((await Asignacion.findByPk(id))?.recordatorio_enviado).toBe(false);
  });

  it('borrar: solo maestros; se van las entregas y sus archivos', async () => {
    simularSubidas();
    const borrar = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
    const { grupoId, profe, ana } = await escenario();
    const { id } = await crearAsignacion(profe, grupoId);
    await api()
      .post(`/api/aula/asignaciones/${id}/entrega`)
      .set(bearer(ana))
      .attach('archivo', Buffer.from('x'), { filename: 'tarea-ana.pdf', contentType: 'application/pdf' })
      .expect(200);

    expect((await api().delete(`/api/aula/asignaciones/${id}`).set(bearer(ana))).status).toBe(403);
    expect((await api().delete(`/api/aula/asignaciones/${id}`).set(bearer(profe))).status).toBe(200);
    expect(await Asignacion.count()).toBe(0);
    expect(await Entrega.count()).toBe(0);
    expect(borrar).toHaveBeenCalledWith('trino/aula/tarea-ana.pdf');
    expect((await api().get(`/api/aula/asignaciones/${id}`).set(bearer(profe))).status).toBe(404);
  });
});

describe('asignaciones: entregas y estados', () => {
  it('el alumno entrega con archivo y comentario; avisa al maestro; puede reentregar antes de calificar', async () => {
    simularSubidas();
    const borrar = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
    const { grupoId, profe, ana } = await escenario();
    const { id } = await crearAsignacion(profe, grupoId);

    const primera = await api()
      .post(`/api/aula/asignaciones/${id}/entrega`)
      .set(bearer(ana))
      .field('comentario', 'Mi tarea')
      .attach('archivo', Buffer.from('x'), { filename: 'v1.pdf', contentType: 'application/pdf' });
    expect(primera.status, JSON.stringify(primera.body)).toBe(200);
    expect(primera.body.mensaje).toBe('Tarea entregada');
    expect(primera.body.data).toMatchObject({ mi_estado: 'entregada', puede_entregar: true });
    expect(primera.body.data.mi_entrega).toMatchObject({ comentario: 'Mi tarea', archivo_nombre: 'v1.pdf', intentos: 1, fue_tarde: false });
    expect(primera.body.data.mi_entrega).not.toHaveProperty('archivo_id');
    const [aviso] = await notificaciones(profe.id, 'entrega_recibida');
    expect(aviso).toMatchObject({ de_usuario_id: ana.id, entidad_tipo: 'asignacion', entidad_id: id });

    const segunda = await api()
      .post(`/api/aula/asignaciones/${id}/entrega`)
      .set(bearer(ana))
      .attach('archivo', Buffer.from('y'), { filename: 'v2.pdf', contentType: 'application/pdf' });
    expect(segunda.body.data.mi_entrega).toMatchObject({ archivo_nombre: 'v2.pdf', intentos: 2, comentario: null });
    expect(borrar).toHaveBeenCalledWith('trino/aula/v1.pdf');
    expect((await notificaciones(profe.id, 'entrega_recibida')).map((n) => n.mensaje)).toContain('volvió a entregar «Ejercicios 1»');

    // Reentregar solo con comentario conserva el archivo anterior.
    const tercera = await entregar(ana, id, 'Olvidé decir algo');
    expect(tercera.body.data.mi_entrega).toMatchObject({ archivo_nombre: 'v2.pdf', comentario: 'Olvidé decir algo', intentos: 3 });
  });

  it('sin archivo ni comentario 400; maestros no entregan; pendientes y de fuera tampoco', async () => {
    const { grupoId, profe, mod, ana, caro, dani } = await escenario();
    const { id } = await crearAsignacion(profe, grupoId);
    expect((await api().post(`/api/aula/asignaciones/${id}/entrega`).set(bearer(ana)).send({})).status).toBe(400);
    expect((await entregar(mod, id)).status).toBe(403);
    expect((await entregar(caro, id)).status).toBe(403);
    expect((await entregar(dani, id)).status).toBe(403);
    expect((await entregar(ana, 999)).status).toBe(404);
  });

  it('tardías: se marcan "tarde" si se aceptan; si no, 400 (salvo que el maestro la haya devuelto)', async () => {
    const { grupoId, profe, ana, beto } = await escenario();
    const aceptaTarde = await crearAsignacion(profe, grupoId, { titulo: 'Flexible' });
    const estricta = await crearAsignacion(profe, grupoId, { titulo: 'Estricta', acepta_tardias: false });

    await entregar(beto, estricta.id).expect(200);
    await vencer(aceptaTarde.id);
    await vencer(estricta.id);

    const tarde = await entregar(ana, aceptaTarde.id);
    expect(tarde.body.mensaje).toBe('Tarea entregada (tarde)');
    expect(tarde.body.data).toMatchObject({ mi_estado: 'tarde', vencida: true, mi_entrega: { fue_tarde: true } });
    expect((await notificaciones(profe.id, 'entrega_recibida')).some((n) => n.mensaje?.includes('(tarde)'))).toBe(true);

    const rechazada = await entregar(ana, estricta.id);
    expect(rechazada.status).toBe(400);
    const vista = await api().get(`/api/aula/asignaciones/${estricta.id}`).set(bearer(ana));
    expect(vista.body.data).toMatchObject({ mi_estado: 'pendiente', puede_entregar: false });

    await devolver(profe, estricta.id, beto.id).expect(200);
    const corregida = await entregar(beto, estricta.id, 'Ya corregí');
    expect(corregida.status).toBe(200);
    expect(corregida.body.data).toMatchObject({ mi_estado: 'tarde', mi_entrega: { intentos: 2, retroalimentacion: 'Corrige el 3' } });
  });

  it('calificar: solo maestros, máximo los puntos de la tarea; calificada ya no se reentrega; avisa al alumno', async () => {
    const { grupoId, profe, mod, ana, beto, dani } = await escenario();
    const { id } = await crearAsignacion(profe, grupoId, { puntos_maximos: 10 });
    await entregar(ana, id).expect(200);

    expect((await calificar(beto, id, ana.id, { puntos: 10 })).status).toBe(403);
    expect((await calificar(mod, id, ana.id, { puntos: 11 })).status).toBe(400);
    expect((await calificar(mod, id, ana.id, { puntos: -1 })).status).toBe(400);
    expect((await calificar(mod, id, dani.id, { puntos: 5 })).status).toBe(403);
    expect((await calificar(mod, id, mod.id, { puntos: 5 })).status).toBe(403);

    const ok = await calificar(mod, id, ana.id, { puntos: 8.5, retroalimentacion: 'Bien' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ estado: 'calificada', alumno: { id: ana.id }, entrega: { puntos: 8.5, retroalimentacion: 'Bien', calificada_por: mod.id } });
    const [aviso] = await notificaciones(ana.id, 'entrega_calificada');
    expect(aviso).toMatchObject({ de_usuario_id: mod.id, entidad_tipo: 'asignacion', entidad_id: id });
    expect(aviso.mensaje).toContain('8.5/10');

    expect((await entregar(ana, id)).status).toBe(409);
    const vista = await api().get(`/api/aula/asignaciones/${id}`).set(bearer(ana));
    expect(vista.body.data).toMatchObject({ mi_estado: 'calificada', puede_entregar: false, mi_entrega: { puntos: 8.5 } });

    // Se puede calificar a quien no entregó (p. ej. un 0).
    const cero = await calificar(profe, id, beto.id, { puntos: 0 });
    expect(cero.body.data).toMatchObject({ estado: 'calificada', entrega: { puntos: 0, entregada_en: null, intentos: 0 } });
  });

  it('devolver: exige que haya entregado; quita los puntos y deja reentregar', async () => {
    const { grupoId, profe, ana, beto } = await escenario();
    const { id } = await crearAsignacion(profe, grupoId);
    expect((await devolver(profe, id, beto.id)).status).toBe(400);
    expect((await api().post(`/api/aula/asignaciones/${id}/entregas/${ana.id}/devolver`).set(bearer(profe)).send({})).status).toBe(400);

    await entregar(ana, id).expect(200);
    await calificar(profe, id, ana.id, { puntos: 40 }).expect(200);
    const devuelta = await devolver(profe, id, ana.id, 'Falta el procedimiento');
    expect(devuelta.body.data).toMatchObject({ estado: 'devuelta', entrega: { puntos: null, retroalimentacion: 'Falta el procedimiento' } });
    expect((await notificaciones(ana.id, 'entrega_calificada')).map((n) => n.mensaje)).toContain('te devolvió «Ejercicios 1» para corregir');
    expect((await entregar(ana, id, 'Corregida')).body.data).toMatchObject({ mi_estado: 'entregada', mi_entrega: { intentos: 2 } });
  });

  it('el maestro ve a cada alumno con su estado (quién falta) y el conteo', async () => {
    const { grupoId, profe, ana, beto } = await escenario();
    const { id } = await crearAsignacion(profe, grupoId);
    await entregar(beto, id).expect(200);

    expect((await api().get(`/api/aula/asignaciones/${id}/entregas`).set(bearer(ana))).status).toBe(403);
    const res = await api().get(`/api/aula/asignaciones/${id}/entregas`).set(bearer(profe));
    expect(res.status).toBe(200);
    expect(res.body.data.map((f: { alumno: { nombre_usuario: string }; estado: string }) => [f.alumno.nombre_usuario, f.estado])).toEqual([
      ['ana', 'pendiente'],
      ['beto', 'entregada'],
    ]);
    expect(res.body.data[0].entrega).toBeNull();

    const detalle = await api().get(`/api/aula/asignaciones/${id}`).set(bearer(profe));
    expect(detalle.body.data.resumen).toEqual({ total_alumnos: 2, por_calificar: 1, calificadas: 0, devueltas: 0, sin_entregar: 1, tarde: 0 });
    expect((await api().get(`/api/aula/grupos/${grupoId}`).set(bearer(profe))).body.data.por_calificar).toBe(1);
  });
});

describe('asignaciones: libreta de calificaciones', () => {
  it('el maestro ve a todos con promedios; el alumno solo su fila; CSV solo maestros', async () => {
    const { grupoId, profe, ana, beto } = await escenario();
    const a = await crearAsignacion(profe, grupoId, { titulo: 'Examen', puntos_maximos: 10 });
    const b = await crearAsignacion(profe, grupoId, { titulo: 'Proyecto, final', puntos_maximos: 30, fecha_entrega: enHoras(72) });
    await entregar(ana, a.id).expect(200);
    await calificar(profe, a.id, ana.id, { puntos: 9 }).expect(200);
    await calificar(profe, a.id, beto.id, { puntos: 6 }).expect(200);
    await entregar(ana, b.id).expect(200);
    await calificar(profe, b.id, ana.id, { puntos: 27 }).expect(200);

    const libreta = await api().get(`/api/aula/grupos/${grupoId}/libreta`).set(bearer(profe));
    expect(libreta.status).toBe(200);
    expect(libreta.body.data.asignaciones.map((x: { titulo: string }) => x.titulo)).toEqual(['Examen', 'Proyecto, final']);
    expect(libreta.body.data.alumnos.map((f: { alumno: { nombre_usuario: string }; promedio: number }) => [f.alumno.nombre_usuario, f.promedio])).toEqual([
      ['ana', 90],
      ['beto', 60],
    ]);
    expect(libreta.body.data).toMatchObject({ promedio_grupo: 75, mi_rol: 'maestro' });

    const mia = await api().get(`/api/aula/grupos/${grupoId}/libreta`).set(bearer(beto));
    expect(mia.body.data.alumnos).toHaveLength(1);
    expect(mia.body.data).toMatchObject({ mi_rol: 'alumno', promedio_grupo: null, por_asignacion: [] });
    expect(mia.body.data.alumnos[0].alumno.id).toBe(beto.id);

    expect((await api().get(`/api/aula/grupos/${grupoId}/libreta/csv`).set(bearer(beto))).status).toBe(403);
    const csv = await api().get(`/api/aula/grupos/${grupoId}/libreta/csv`).set(bearer(profe));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('libreta-matematicas-3.csv');
    const lineas = csv.text.replace('﻿', '').trim().split('\r\n');
    expect(lineas[0]).toBe('Alumno,Usuario,Examen (/10),"Proyecto, final (/30)",Promedio %,Entregadas,Faltantes');
    expect(lineas[1]).toBe('Usuario ana,ana,9,27,90,2,0');
    expect(lineas[2]).toBe('Usuario beto,beto,6,,60,1,0');
  });
});

describe('asignaciones: recordatorio 24 h antes', () => {
  it('avisa una vez a quien no ha entregado (o la tiene devuelta) y marca la asignación', async () => {
    const { grupoId, profe, ana, beto } = await escenario();
    const pronto = await crearAsignacion(profe, grupoId, { titulo: 'Pronto', fecha_entrega: enHoras(10) });
    await crearAsignacion(profe, grupoId, { titulo: 'Lejos', fecha_entrega: enHoras(60) });
    await entregar(beto, pronto.id).expect(200);

    expect(await enviarRecordatoriosEntregas()).toBe(1);
    const avisos = await notificaciones(ana.id, 'tarea_vence');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ entidad_tipo: 'asignacion', entidad_id: pronto.id, de_usuario_id: profe.id });
    expect(await notificaciones(beto.id, 'tarea_vence')).toHaveLength(0);
    expect((await Asignacion.findByPk(pronto.id))?.recordatorio_enviado).toBe(true);

    expect(await enviarRecordatoriosEntregas()).toBe(0);
  });

  it('programarRecordatoriosEntregas arma un temporizador que no retiene el proceso', () => {
    const temporizador = programarRecordatoriosEntregas(60_000);
    expect(temporizador.hasRef()).toBe(false);
    clearInterval(temporizador);
  });
});
