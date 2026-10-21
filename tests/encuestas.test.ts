import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Encuesta, EncuestaOpcion, EncuestaVoto, Like, Publicacion, PublicacionGuardada, sequelize, type Visibilidad } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { encuestaRoutes } from '../src/modules/encuestas/encuesta.routes';
import { vistaEncuesta } from '../src/modules/encuestas/encuesta.vista';
import { publicacionExtras } from '../src/modules/publicaciones/publicacion-extras';
import { publicacionRoutes } from '../src/modules/publicaciones/publicacion.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/encuestas': encuestaRoutes, '/publicaciones': publicacionRoutes }));
beforeEach(reiniciarBD);
afterEach(() => vi.restoreAllMocks());

const publicar = (usuario_id: number, visibilidad: Visibilidad = 'publico') =>
  Publicacion.create({ usuario_id, contenido: '¿Qué prefieren?', visibilidad });

const crearEncuesta = (u: UsuarioPrueba, body: Record<string, unknown>) => api().post('/api/encuestas').set(bearer(u)).send(body);

const votar = (u: UsuarioPrueba, id: number, opcion_ids: number[]) =>
  api().post(`/api/encuestas/${id}/votar`).set(bearer(u)).send({ opcion_ids });

describe('encuestas: crear', () => {
  it('el autor crea una encuesta con opciones en orden; solo una por publicación', async () => {
    const ana = await crearUsuario();
    const pub = await publicar(ana.id);
    const emitir = vi.spyOn(realtime, 'aTodos');

    const res = await crearEncuesta(ana, { publicacion_id: pub.id, opciones: [' Café ', 'Té', 'Agua'] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ multiple: false, cierra_en: null, cerrada: false, total_votos: 0, mis_votos: [] });
    expect(res.body.data.opciones.map((o: { texto: string }) => o.texto)).toEqual(['Café', 'Té', 'Agua']);
    expect(res.body.data.opciones[0]).toMatchObject({ total_votos: 0, porcentaje: 0 });
    expect(emitir).toHaveBeenCalledWith('encuesta_actualizada', {
      publicacion_id: pub.id,
      encuesta: expect.not.objectContaining({ mis_votos: expect.anything() }),
    });

    expect((await crearEncuesta(ana, { publicacion_id: pub.id, opciones: ['a', 'b'] })).status).toBe(409);
  });

  it('solo el autor (403), la publicación debe existir (404) y valida las opciones', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const pub = await publicar(ana.id);

    expect((await crearEncuesta(beto, { publicacion_id: pub.id, opciones: ['a', 'b'] })).status).toBe(403);
    expect((await crearEncuesta(ana, { publicacion_id: 999, opciones: ['a', 'b'] })).status).toBe(404);
    expect((await crearEncuesta(ana, { publicacion_id: pub.id, opciones: ['solo una'] })).status).toBe(400);
    expect((await crearEncuesta(ana, { publicacion_id: pub.id, opciones: ['1', '2', '3', '4', '5', '6', '7'] })).status).toBe(400);
    const repetidas = await crearEncuesta(ana, { publicacion_id: pub.id, opciones: ['Sí', 'sí'] });
    expect(repetidas.status).toBe(400);
    expect(repetidas.body.errores[0].campo).toBe('opciones');
    expect((await crearEncuesta(ana, { publicacion_id: pub.id, opciones: ['a', ' '] })).status).toBe(400);
    const pasada = await crearEncuesta(ana, { publicacion_id: pub.id, opciones: ['a', 'b'], cierra_en: '2020-01-01T00:00:00Z' });
    expect(pasada.status).toBe(400);
    expect(await Encuesta.count()).toBe(0);
  });
});

describe('encuestas: votar', () => {
  it('vota, cambia el voto sin contar dos veces y lo retira; porcentajes sobre votantes', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const carla = await crearUsuario();
    const pub = await publicar(ana.id);
    const { body } = await crearEncuesta(ana, { publicacion_id: pub.id, opciones: ['A', 'B', 'C'] });
    const [a, b, c] = body.data.opciones.map((o: { id: number }) => o.id);
    const id = body.data.id;

    expect((await votar(beto, id, [a])).body.data).toMatchObject({ total_votos: 1, mis_votos: [a] });
    const voto = await votar(carla, id, [b]);
    expect(voto.body.data.total_votos).toBe(2);
    expect(voto.body.data.opciones.map((o: { porcentaje: number }) => o.porcentaje)).toEqual([50, 50, 0]);

    // Beto cambia su voto: sigue habiendo 2 votantes
    const cambio = await votar(beto, id, [c]);
    expect(cambio.body.data).toMatchObject({ total_votos: 2, mis_votos: [c] });
    expect(cambio.body.data.opciones.map((o: { total_votos: number }) => o.total_votos)).toEqual([0, 1, 1]);
    expect(await EncuestaVoto.count()).toBe(2);

    // No múltiple: una sola opción
    expect((await votar(beto, id, [a, b])).status).toBe(400);

    const retirado = await api().delete(`/api/encuestas/${id}/voto`).set(bearer(beto));
    expect(retirado.status).toBe(200);
    expect(retirado.body.data).toMatchObject({ total_votos: 1, mis_votos: [] });
    expect((await api().delete(`/api/encuestas/${id}/voto`).set(bearer(beto))).status).toBe(404);

    const vista = await api().get(`/api/encuestas/${id}`).set(bearer(carla));
    expect(vista.body.data).toMatchObject({ total_votos: 1, mis_votos: [b] });
    expect(vista.body.data.opciones.map((o: { porcentaje: number }) => o.porcentaje)).toEqual([0, 100, 0]);
  });

  it('opción múltiple: varias opciones y porcentajes que pueden sumar más de 100', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const carla = await crearUsuario();
    const pub = await publicar(ana.id);
    const { body } = await crearEncuesta(ana, { publicacion_id: pub.id, opciones: ['A', 'B'], multiple: true });
    const [a, b] = body.data.opciones.map((o: { id: number }) => o.id);

    await votar(beto, body.data.id, [b, a]);
    const res = await votar(carla, body.data.id, [a]);
    expect(res.body.data.total_votos).toBe(2);
    expect(res.body.data.opciones.map((o: { porcentaje: number }) => o.porcentaje)).toEqual([100, 50]);
    expect((await api().get(`/api/encuestas/${body.data.id}`).set(bearer(beto))).body.data.mis_votos).toEqual([a, b]);
  });

  it('rechaza opciones ajenas, encuestas cerradas y publicaciones que no puedo ver; emite sin mis_votos', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const pub = await publicar(ana.id);
    const privada = await publicar(ana.id, 'privado');
    const { body } = await crearEncuesta(ana, { publicacion_id: pub.id, opciones: ['A', 'B'] });
    const otra = await crearEncuesta(ana, { publicacion_id: privada.id, opciones: ['X', 'Y'] });

    expect((await votar(beto, body.data.id, [otra.body.data.opciones[0].id])).status).toBe(400);
    expect((await votar(beto, otra.body.data.id, [otra.body.data.opciones[0].id])).status).toBe(404);
    expect((await api().get(`/api/encuestas/${otra.body.data.id}`)).status).toBe(404);
    expect((await votar(beto, body.data.id, [])).status).toBe(400);

    const emitir = vi.spyOn(realtime, 'aTodos');
    await votar(beto, body.data.id, [body.data.opciones[0].id]);
    const [, datos] = emitir.mock.calls.find(([evento]) => evento === 'encuesta_actualizada')!;
    expect(datos).toMatchObject({ publicacion_id: pub.id, encuesta: { id: body.data.id, total_votos: 1 } });
    expect((datos as { encuesta: object }).encuesta).not.toHaveProperty('mis_votos');

    await Encuesta.update({ cierra_en: new Date(Date.now() - 1000) }, { where: { id: body.data.id } });
    const cerrada = await votar(beto, body.data.id, [body.data.opciones[1].id]);
    expect(cerrada.status).toBe(400);
    expect((await api().delete(`/api/encuestas/${body.data.id}/voto`).set(bearer(beto))).status).toBe(400);
    expect((await api().get(`/api/encuestas/${body.data.id}`)).body.data.cerrada).toBe(true);
  });
});

describe('extras de publicaciones (publicacionExtras.para)', () => {
  async function escenario() {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const carla = await crearUsuario();
    const pubs: Publicacion[] = [];
    for (let i = 0; i < 6; i++) pubs.push(await publicar(ana.id));
    const [p1, p2, p3] = pubs;
    await Like.bulkCreate([
      { publicacion_id: p1.id, usuario_id: beto.id, tipo: 'jaja' },
      { publicacion_id: p1.id, usuario_id: carla.id, tipo: 'me_encanta' },
      { publicacion_id: p1.id, usuario_id: ana.id, tipo: 'me_encanta' },
      { publicacion_id: p2.id, usuario_id: carla.id, tipo: 'aplauso' },
    ]);
    await PublicacionGuardada.create({ usuario_id: beto.id, publicacion_id: p2.id });
    const encuesta = await Encuesta.create({ publicacion_id: p3.id, total_votos: 2 });
    const [si, no] = await EncuestaOpcion.bulkCreate([
      { encuesta_id: encuesta.id, texto: 'Sí', posicion: 0, total_votos: 1 },
      { encuesta_id: encuesta.id, texto: 'No', posicion: 1, total_votos: 1 },
    ]);
    await EncuestaVoto.bulkCreate([
      { encuesta_id: encuesta.id, opcion_id: si.id, usuario_id: beto.id },
      { encuesta_id: encuesta.id, opcion_id: no.id, usuario_id: carla.id },
    ]);
    return { beto, pubs, p1, p2, p3, si, no };
  }

  it('resuelve reacciones, guardadas y encuestas de varias publicaciones según quién mira', async () => {
    const { beto, pubs, p1, p2, p3, si } = await escenario();
    const extras = await publicacionExtras.para(pubs.map((p) => p.id), beto.id);

    expect(extras.size).toBe(6);
    expect(extras.get(p1.id)).toEqual({
      mi_reaccion: 'jaja',
      reacciones: [
        { tipo: 'me_encanta', total: 2 },
        { tipo: 'jaja', total: 1 },
      ],
      guardada: false,
      encuesta: null,
    });
    expect(extras.get(p2.id)).toMatchObject({ mi_reaccion: null, reacciones: [{ tipo: 'aplauso', total: 1 }], guardada: true });
    expect(extras.get(p3.id)!.encuesta).toMatchObject({
      total_votos: 2,
      cerrada: false,
      mis_votos: [si.id],
      opciones: [
        { texto: 'Sí', porcentaje: 50 },
        { texto: 'No', porcentaje: 50 },
      ],
    });
    expect(extras.get(pubs[5].id)).toEqual({ mi_reaccion: null, reacciones: [], guardada: false, encuesta: null });
  });

  it('sin sesión: sin mi_reaccion, guardada ni mis_votos, pero con resúmenes y encuesta', async () => {
    const { pubs, p1, p2, p3 } = await escenario();
    const extras = await publicacionExtras.para(pubs.map((p) => p.id));
    expect(extras.get(p1.id)).toMatchObject({ mi_reaccion: null, guardada: false });
    expect(extras.get(p1.id)!.reacciones).toHaveLength(2);
    expect(extras.get(p2.id)!.guardada).toBe(false);
    expect(extras.get(p3.id)!.encuesta).toMatchObject({ total_votos: 2, mis_votos: [] });
    expect((await publicacionExtras.para([])).size).toBe(0);
  });

  it('hace las mismas pocas consultas para 3 que para 6 publicaciones', async () => {
    const { beto, pubs } = await escenario();
    const consulta = vi.spyOn(sequelize, 'query');

    await publicacionExtras.para(pubs.slice(0, 3).map((p) => p.id), beto.id);
    const conTres = consulta.mock.calls.length;
    consulta.mockClear();
    await publicacionExtras.para(pubs.map((p) => p.id), beto.id);
    expect(consulta.mock.calls.length).toBe(conTres);
    expect(conTres).toBeLessThanOrEqual(5);

    consulta.mockClear();
    await publicacionExtras.para(pubs.map((p) => p.id));
    expect(consulta.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('el feed llega con los extras de cada publicación', async () => {
    const { beto, p2, p3 } = await escenario();
    const feed = await api().get('/api/publicaciones').set(bearer(beto));
    const porId = new Map(feed.body.data.map((p: { id: number }) => [p.id, p]));
    expect(porId.get(p2.id)).toMatchObject({ guardada: true, reacciones: [{ tipo: 'aplauso', total: 1 }] });
    expect(porId.get(p3.id)).toMatchObject({ encuesta: { total_votos: 2 } });
  });

  it('vistaEncuesta marca cerrada y evita dividir entre cero', () => {
    const encuesta = Encuesta.build({ id: 1, publicacion_id: 1, total_votos: 0, multiple: false, cierra_en: new Date('2026-01-01T00:00:00Z') });
    const vista = vistaEncuesta(encuesta, [], new Date('2026-02-01T00:00:00Z'));
    expect(vista).toMatchObject({ cerrada: true, total_votos: 0, opciones: [], mis_votos: [] });
  });
});
