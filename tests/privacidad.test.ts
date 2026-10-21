import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Notificacion, Seguidor, Usuario } from '../src/infrastructure/database/models';
import { seguidorRoutes } from '../src/modules/seguidores/seguidor.routes';
import { usuarioRoutes } from '../src/modules/usuarios/usuario.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/seguidores': seguidorRoutes, '/usuarios': usuarioRoutes }));
beforeEach(reiniciarBD);

const seguir = (quien: UsuarioPrueba, a: UsuarioPrueba) => api().post('/api/seguidores/seguir').set(bearer(quien)).send({ seguido_id: a.id });
const hacerPrivada = (u: UsuarioPrueba) => api().put('/api/usuarios/me').set(bearer(u)).send({ cuenta_privada: true });

const totales = async (id: number) => {
  const u = await Usuario.findByPk(id);
  return { seguidores: u!.total_seguidores, siguiendo: u!.total_siguiendo };
};

describe('cuenta privada', () => {
  it('PUT /usuarios/me cambia cuenta_privada (también como texto en multipart)', async () => {
    const ana = await crearUsuario('ana');
    const res = await hacerPrivada(ana);
    expect(res.status).toBe(200);
    expect(res.body.data.cuenta_privada).toBe(true);

    const texto = await api().put('/api/usuarios/me').set(bearer(ana)).field('cuenta_privada', 'false');
    expect(texto.status).toBe(200);
    expect(texto.body.data.cuenta_privada).toBe(false);

    const malo = await api().put('/api/usuarios/me').set(bearer(ana)).send({ cuenta_privada: 'tal vez' });
    expect(malo.status).toBe(400);
    expect(malo.body.errores[0].campo).toBe('cuenta_privada');
  });

  it('seguir una cuenta privada crea una solicitud pendiente, notifica y no cuenta', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await hacerPrivada(ana);

    const res = await seguir(beto, ana);
    expect(res.status).toBe(201);
    expect(res.body.mensaje).toBe('Solicitud de seguimiento enviada');
    expect(res.body.data).toEqual({ siguiendo: false, estado: 'pendiente', total_seguidores: 0 });
    expect(await totales(ana.id)).toEqual({ seguidores: 0, siguiendo: 0 });
    expect(await totales(beto.id)).toEqual({ seguidores: 0, siguiendo: 0 });

    const notificaciones = await Notificacion.findAll({ where: { usuario_id: ana.id } });
    expect(notificaciones).toHaveLength(1);
    expect(notificaciones[0]).toMatchObject({ tipo: 'solicitud_seguimiento', de_usuario_id: beto.id, entidad_tipo: 'usuario', entidad_id: beto.id });

    const dup = await seguir(beto, ana);
    expect(dup.status).toBe(409);
    expect(dup.body.mensaje).toBe('Ya le enviaste una solicitud a este usuario');

    const verificar = await api().get(`/api/seguidores/verificar/${ana.id}`).set(bearer(beto));
    expect(verificar.body.data).toEqual({ siguiendo: false, solicitud_pendiente: true });

    // Las pendientes no aparecen en listados ni estadísticas
    const stats = await api().get(`/api/seguidores/estadisticas/${ana.id}`).set(bearer(ana));
    expect(stats.body.data).toEqual({ seguidores: 0, seguidos: 0 });
    const lista = await api().get(`/api/seguidores/seguidores/${ana.id}`).set(bearer(ana));
    expect(lista.body.meta.total).toBe(0);
  });

  it('dejar de seguir (o toggle) cancela la solicitud pendiente y retira la notificación', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await hacerPrivada(ana);
    await seguir(beto, ana);

    const cancelar = await api().delete('/api/seguidores/dejar-de-seguir').set(bearer(beto)).send({ seguido_id: ana.id });
    expect(cancelar.status).toBe(200);
    expect(cancelar.body.data).toEqual({ siguiendo: false, estado: null, total_seguidores: 0 });
    expect(await Seguidor.count()).toBe(0);
    expect(await Notificacion.count({ where: { usuario_id: ana.id } })).toBe(0);

    const pedir = await api().post('/api/seguidores/toggle').set(bearer(beto)).send({ seguido_id: ana.id });
    expect(pedir.status).toBe(201);
    expect(pedir.body.data.estado).toBe('pendiente');
    const otraVez = await api().post('/api/seguidores/toggle').set(bearer(beto)).send({ seguido_id: ana.id });
    expect(otraVez.status).toBe(200);
    expect(otraVez.body.data.estado).toBeNull();
    expect(await Seguidor.count()).toBe(0);
  });

  it('las listas de una cuenta privada que no sigo → 403; si la sigo, 200', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const carla = await crearUsuario('carla');
    await seguir(carla, ana);
    await hacerPrivada(ana);

    const res = await api().get(`/api/seguidores/seguidores/${ana.id}`).set(bearer(beto));
    expect(res.status).toBe(403);
    expect(res.body.mensaje).toBe('Esta cuenta es privada');

    expect((await api().get(`/api/seguidores/seguidos/${ana.id}`).set(bearer(carla))).status).toBe(200);
    expect((await api().get(`/api/seguidores/seguidores/${ana.id}`).set(bearer(ana))).status).toBe(200);
  });

  it('al pasar a pública se aceptan las solicitudes pendientes (contadores y notificación)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const carla = await crearUsuario('carla');
    await hacerPrivada(ana);
    await seguir(beto, ana);
    await seguir(carla, ana);

    const res = await api().put('/api/usuarios/me').set(bearer(ana)).send({ cuenta_privada: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ cuenta_privada: false, total_seguidores: 2 });
    expect(await Seguidor.count({ where: { estado: 'aceptado' } })).toBe(2);
    expect(await totales(beto.id)).toEqual({ seguidores: 0, siguiendo: 1 });

    expect(await Notificacion.count({ where: { tipo: 'seguimiento_aceptado', de_usuario_id: ana.id } })).toBe(2);
    expect(await Notificacion.count({ where: { tipo: 'solicitud_seguimiento' } })).toBe(0);
  });
});

describe('solicitudes de seguimiento', () => {
  it('lista las pendientes que recibí, paginadas y con datos públicos', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const carla = await crearUsuario('carla');
    const dani = await crearUsuario('dani');
    await hacerPrivada(ana);
    await seguir(beto, ana);
    await seguir(carla, ana);
    await seguir(ana, dani); // la que yo mandé (dani es pública → aceptada) no cuenta

    const res = await api().get('/api/seguidores/solicitudes?limit=1').set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 2, limit: 1, offset: 0, hayMas: true });
    expect(res.body.data[0]).toMatchObject({ id: carla.id, nombre_usuario: 'carla' });
    expect(res.body.data[0].solicitado_en).toBeDefined();
    expect(res.body.data[0].email).toBeUndefined();

    const deBeto = await api().get('/api/seguidores/solicitudes').set(bearer(beto));
    expect(deBeto.body.meta.total).toBe(0);
  });

  it('aceptar: pasa a aceptado, cuenta, notifica y quita la solicitud de mi bandeja', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await hacerPrivada(ana);
    await seguir(beto, ana);

    const res = await api().post(`/api/seguidores/solicitudes/${beto.id}/aceptar`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ seguidor_id: beto.id, estado: 'aceptado', total_seguidores: 1 });
    expect(await totales(beto.id)).toEqual({ seguidores: 0, siguiendo: 1 });

    const aviso = await Notificacion.findOne({ where: { usuario_id: beto.id } });
    expect(aviso).toMatchObject({ tipo: 'seguimiento_aceptado', de_usuario_id: ana.id, entidad_tipo: 'usuario', entidad_id: ana.id });
    expect(await Notificacion.count({ where: { usuario_id: ana.id, tipo: 'solicitud_seguimiento' } })).toBe(0);

    // Ya no está pendiente
    expect((await api().post(`/api/seguidores/solicitudes/${beto.id}/aceptar`).set(bearer(ana))).status).toBe(404);
    const verificar = await api().get(`/api/seguidores/verificar/${ana.id}`).set(bearer(beto));
    expect(verificar.body.data).toEqual({ siguiendo: true, solicitud_pendiente: false });
  });

  it('rechazar borra la solicitud; sin solicitud → 404; ids inválidos → 400', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await hacerPrivada(ana);
    await seguir(beto, ana);

    const res = await api().delete(`/api/seguidores/solicitudes/${beto.id}`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.mensaje).toBe('Solicitud rechazada');
    expect(await Seguidor.count()).toBe(0);
    expect(await Notificacion.count({ where: { usuario_id: ana.id } })).toBe(0);

    expect((await api().delete(`/api/seguidores/solicitudes/${beto.id}`).set(bearer(ana))).status).toBe(404);
    expect((await api().post('/api/seguidores/solicitudes/abc/aceptar').set(bearer(ana))).status).toBe(400);
  });
});

describe('perfil con relación', () => {
  it('incluye cuenta_privada y relacion; no expone email_verificado ni email', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await seguir(ana, beto);
    await hacerPrivada(beto);
    await hacerPrivada(ana);
    const carla = await crearUsuario('carla');
    await seguir(carla, beto);

    const comoAna = await api().get(`/api/usuarios/${beto.id}`).set(bearer(ana));
    expect(comoAna.status).toBe(200);
    expect(comoAna.body.data.cuenta_privada).toBe(true);
    expect(comoAna.body.data.relacion).toEqual({ lo_sigo: true, solicitud_pendiente: false, me_sigue: false, bloqueado_por_mi: false });
    expect(comoAna.body.data).not.toHaveProperty('email');
    expect(comoAna.body.data).not.toHaveProperty('email_verificado');

    const comoBeto = await api().get(`/api/usuarios/${ana.id}`).set(bearer(beto));
    expect(comoBeto.body.data.relacion).toEqual({ lo_sigo: false, solicitud_pendiente: false, me_sigue: true, bloqueado_por_mi: false });

    const comoCarla = await api().get(`/api/usuarios/${beto.id}`).set(bearer(carla));
    expect(comoCarla.body.data.relacion.solicitud_pendiente).toBe(true);

    const propio = await api().get(`/api/usuarios/${ana.id}`).set(bearer(ana));
    expect(propio.body.data).toMatchObject({ email: 'ana@test.com', cuenta_privada: true, email_verificado: false });
    expect(propio.body.data.relacion).toBeUndefined();
  });

  it('seguidoresEnLinea solo cuenta seguidores aceptados', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await hacerPrivada(ana);
    await seguir(beto, ana);
    await api().post('/api/usuarios/me/heartbeat').set(bearer(beto));

    const antes = await api().get('/api/usuarios/me/seguidores/activos').set(bearer(ana));
    expect(antes.body.data).toHaveLength(0);

    await api().post(`/api/seguidores/solicitudes/${beto.id}/aceptar`).set(bearer(ana));
    const despues = await api().get('/api/usuarios/me/seguidores/activos').set(bearer(ana));
    expect(despues.body.data.map((u: { id: number }) => u.id)).toEqual([beto.id]);
  });
});
