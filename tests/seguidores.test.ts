import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Notificacion, Seguidor, Usuario } from '../src/infrastructure/database/models';
import { seguidorRoutes } from '../src/modules/seguidores/seguidor.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos } from './helpers';

beforeAll(() => usarModulos({ '/seguidores': seguidorRoutes }));
beforeEach(reiniciarBD);

const totales = async (id: number) => {
  const u = await Usuario.findByPk(id);
  return { seguidores: u!.total_seguidores, siguiendo: u!.total_siguiendo };
};

describe('seguidores', () => {
  it('seguir: crea la relación, ajusta contadores y notifica', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');

    const res = await api().post('/api/seguidores/seguir').set(bearer(ana)).send({ seguido_id: beto.id });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ siguiendo: true, estado: 'aceptado', total_seguidores: 1 });

    expect(await totales(ana.id)).toEqual({ seguidores: 0, siguiendo: 1 });
    expect(await totales(beto.id)).toEqual({ seguidores: 1, siguiendo: 0 });

    const notificaciones = await Notificacion.findAll({ where: { usuario_id: beto.id } });
    expect(notificaciones).toHaveLength(1);
    expect(notificaciones[0]).toMatchObject({ tipo: 'follow', de_usuario_id: ana.id });
  });

  it('seguir dos veces → 409; seguirse a sí mismo → 400; usuario inexistente → 404', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await api().post('/api/seguidores/seguir').set(bearer(ana)).send({ seguido_id: beto.id });

    const dup = await api().post('/api/seguidores/seguir').set(bearer(ana)).send({ seguido_id: beto.id });
    expect(dup.status).toBe(409);
    expect(await totales(beto.id)).toEqual({ seguidores: 1, siguiendo: 0 });

    const yo = await api().post('/api/seguidores/seguir').set(bearer(ana)).send({ seguido_id: ana.id });
    expect(yo.status).toBe(400);
    expect(yo.body.mensaje).toBe('No puedes seguirte a ti mismo');

    const nadie = await api().post('/api/seguidores/seguir').set(bearer(ana)).send({ seguido_id: 9999 });
    expect(nadie.status).toBe(404);
  });

  it('no se puede seguir una cuenta desactivada', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await Usuario.update({ activo: false }, { where: { id: beto.id } });
    const res = await api().post('/api/seguidores/seguir').set(bearer(ana)).send({ seguido_id: beto.id });
    expect(res.status).toBe(404);
  });

  it('dejar de seguir: borra relación, contadores y la notificación', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await api().post('/api/seguidores/seguir').set(bearer(ana)).send({ seguido_id: beto.id });

    const res = await api().delete('/api/seguidores/dejar-de-seguir').set(bearer(ana)).send({ seguido_id: beto.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ siguiendo: false, estado: null, total_seguidores: 0 });
    expect(await totales(ana.id)).toEqual({ seguidores: 0, siguiendo: 0 });
    expect(await Notificacion.count({ where: { usuario_id: beto.id } })).toBe(0);

    const otraVez = await api().delete('/api/seguidores/dejar-de-seguir').set(bearer(ana)).send({ seguido_id: beto.id });
    expect(otraVez.status).toBe(404);
  });

  it('toggle alterna seguir / dejar de seguir', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');

    const uno = await api().post('/api/seguidores/toggle').set(bearer(ana)).send({ seguido_id: beto.id });
    expect(uno.status).toBe(201);
    expect(uno.body.data.siguiendo).toBe(true);

    const dos = await api().post('/api/seguidores/toggle').set(bearer(ana)).send({ seguido_id: beto.id });
    expect(dos.status).toBe(200);
    expect(dos.body.data.siguiendo).toBe(false);
    expect(await Seguidor.count()).toBe(0);
    expect(await totales(beto.id)).toEqual({ seguidores: 0, siguiendo: 0 });

    const yo = await api().post('/api/seguidores/toggle').set(bearer(ana)).send({ seguido_id: ana.id });
    expect(yo.status).toBe(400);
  });

  it('valida el body y los params', async () => {
    const ana = await crearUsuario('ana');
    const sinId = await api().post('/api/seguidores/seguir').set(bearer(ana)).send({});
    expect(sinId.status).toBe(400);
    expect(sinId.body.errores[0].campo).toBe('seguido_id');

    const malo = await api().get('/api/seguidores/seguidores/abc').set(bearer(ana));
    expect(malo.status).toBe(400);

    const sinToken = await api().get(`/api/seguidores/verificar/${ana.id}`);
    expect(sinToken.status).toBe(401);
  });

  it('listados paginados con datos públicos y lo_sigo', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const carla = await crearUsuario('carla');
    // beto y carla siguen a ana; ana sigue a carla
    await Seguidor.bulkCreate([
      { seguidor_id: beto.id, siguiendo_id: ana.id },
      { seguidor_id: carla.id, siguiendo_id: ana.id },
      { seguidor_id: ana.id, siguiendo_id: carla.id },
    ]);

    const res = await api().get(`/api/seguidores/seguidores/${ana.id}?limit=1`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 2, limit: 1, offset: 0, hayMas: true });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].email).toBeUndefined();
    expect(res.body.data[0].siguiendo_desde).toBeDefined();

    const todos = await api().get(`/api/seguidores/seguidores/${ana.id}`).set(bearer(ana));
    const loSigo = Object.fromEntries(todos.body.data.map((u: { nombre_usuario: string; lo_sigo: boolean }) => [u.nombre_usuario, u.lo_sigo]));
    expect(loSigo).toEqual({ beto: false, carla: true });

    // Una cuenta eliminada (activo = false) deja de aparecer
    await Usuario.update({ activo: false }, { where: { id: beto.id } });
    const sinBeto = await api().get(`/api/seguidores/seguidores/${ana.id}`).set(bearer(ana));
    expect(sinBeto.body.meta.total).toBe(1);
    expect(sinBeto.body.data[0].id).toBe(carla.id);

    for (const ruta of ['seguidos', 'siguiendo']) {
      const seguidos = await api().get(`/api/seguidores/${ruta}/${ana.id}`).set(bearer(carla));
      expect(seguidos.body.data.map((u: { id: number }) => u.id)).toEqual([carla.id]);
    }
  });

  it('estadísticas y verificar', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await api().post('/api/seguidores/seguir').set(bearer(ana)).send({ seguido_id: beto.id });

    const stats = await api().get(`/api/seguidores/estadisticas/${beto.id}`).set(bearer(ana));
    expect(stats.body.data).toEqual({ seguidores: 1, seguidos: 0 });

    const si = await api().get(`/api/seguidores/verificar/${beto.id}`).set(bearer(ana));
    expect(si.body.data).toEqual({ siguiendo: true, solicitud_pendiente: false });
    const no = await api().get(`/api/seguidores/verificar/${ana.id}`).set(bearer(beto));
    expect(no.body.data).toEqual({ siguiendo: false, solicitud_pendiente: false });

    const nadie = await api().get('/api/seguidores/estadisticas/9999').set(bearer(ana));
    expect(nadie.status).toBe(404);
  });
});
