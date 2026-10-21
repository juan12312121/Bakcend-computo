import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Publicacion, PublicacionGuardada, type Visibilidad } from '../src/infrastructure/database/models';
import { guardadoRoutes } from '../src/modules/guardados/guardado.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/guardados': guardadoRoutes }));
beforeEach(reiniciarBD);

const publicar = (usuario_id: number, contenido = 'Publicación', visibilidad: Visibilidad = 'publico') =>
  Publicacion.create({ usuario_id, contenido, visibilidad });

const alternar = (u: UsuarioPrueba, id: number) => api().post(`/api/guardados/${id}`).set(bearer(u));

describe('guardados', () => {
  it('guarda y quita (toggle) con 201/200', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const pub = await publicar(ana.id);

    const guardar = await alternar(beto, pub.id);
    expect(guardar.status).toBe(201);
    expect(guardar.body.data).toEqual({ publicacion_id: pub.id, guardada: true });
    expect(await PublicacionGuardada.count()).toBe(1);

    const quitar = await alternar(beto, pub.id);
    expect(quitar.status).toBe(200);
    expect(quitar.body.data).toEqual({ publicacion_id: pub.id, guardada: false });
    expect(await PublicacionGuardada.count()).toBe(0);
  });

  it('no se puede guardar lo que no se ve (404) ni sin sesión (401)', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const privada = await publicar(ana.id, 'secreta', 'privado');

    expect((await alternar(beto, privada.id)).status).toBe(404);
    expect((await alternar(beto, 999)).status).toBe(404);
    expect((await api().post(`/api/guardados/${privada.id}`)).status).toBe(401);
    expect((await api().get('/api/guardados')).status).toBe(401);
    expect((await api().post('/api/guardados/abc').set(bearer(beto))).status).toBe(400);
  });

  it('lista mis guardadas como PublicacionVista, más recientes primero y paginadas', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const primera = await publicar(ana.id, 'primera');
    const segunda = await publicar(ana.id, 'segunda');
    const tercera = await publicar(ana.id, 'tercera');
    for (const p of [segunda, primera, tercera]) await alternar(beto, p.id);

    const res = await api().get('/api/guardados?limit=2').set(bearer(beto));
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 3, limit: 2, offset: 0, hayMas: true });
    expect(res.body.data.map((p: { contenido: string }) => p.contenido)).toEqual(['tercera', 'primera']);
    expect(res.body.data[0]).toMatchObject({ guardada: true, autor: { id: ana.id }, documentos: [], mi_reaccion: null });

    const resto = await api().get('/api/guardados?limit=2&offset=2').set(bearer(beto));
    expect(resto.body.data.map((p: { contenido: string }) => p.contenido)).toEqual(['segunda']);

    // Las de otros usuarios no aparecen
    expect((await api().get('/api/guardados').set(bearer(ana))).body.meta.total).toBe(0);
  });

  it('si una guardada deja de ser visible no se lista, pero se puede quitar', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const pub = await publicar(ana.id);
    await alternar(beto, pub.id);
    await pub.update({ visibilidad: 'privado' });

    const res = await api().get('/api/guardados').set(bearer(beto));
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
    expect((await alternar(beto, pub.id)).body.data.guardada).toBe(false);
  });
});
