import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Like, Notificacion, Publicacion, type Visibilidad } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { likeRoutes } from '../src/modules/likes/like.routes';
import { mensajeReaccion, ordenarResumen } from '../src/modules/likes/reacciones';
import { publicacionRoutes } from '../src/modules/publicaciones/publicacion.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/likes': likeRoutes, '/publicaciones': publicacionRoutes }));
beforeEach(reiniciarBD);
afterEach(() => vi.restoreAllMocks());

const publicar = (usuario_id: number, visibilidad: Visibilidad = 'publico') =>
  Publicacion.create({ usuario_id, contenido: 'Publicación de prueba', visibilidad });

const reaccionar = (u: UsuarioPrueba, publicacion_id: number, tipo: string) =>
  api().post('/api/likes/reaccion').set(bearer(u)).send({ publicacion_id, tipo });

describe('reacciones: poner, cambiar y quitar', () => {
  it('pone una reacción, la cambia sin duplicar el contador y la quita', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const pub = await publicar(ana.id);
    const emitir = vi.spyOn(realtime, 'aTodos');

    const puesta = await reaccionar(beto, pub.id, 'jaja');
    expect(puesta.status).toBe(200);
    expect(puesta.body.data).toEqual({
      publicacion_id: pub.id,
      mi_reaccion: 'jaja',
      usuario_dio_like: true,
      total_likes: 1,
      reacciones: [{ tipo: 'jaja', total: 1 }],
    });
    expect((await Publicacion.findByPk(pub.id))!.total_likes).toBe(1);
    expect(emitir).toHaveBeenCalledWith('like_update', {
      publicacion_id: pub.id,
      total: 1,
      usuario_id: beto.id,
      tipo: 'jaja',
      reacciones: [{ tipo: 'jaja', total: 1 }],
    });

    const avisos = await Notificacion.findAll({ where: { usuario_id: ana.id } });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ tipo: 'reaccion', de_usuario_id: beto.id, publicacion_id: pub.id, mensaje: 'reaccionó 😂 a tu publicación' });

    // Cambiar a me_gusta: mismo registro, mismo contador y la notificación pasa a 'like'
    const cambio = await reaccionar(beto, pub.id, 'me_gusta');
    expect(cambio.body.data).toMatchObject({ mi_reaccion: 'me_gusta', total_likes: 1, reacciones: [{ tipo: 'me_gusta', total: 1 }] });
    expect(await Like.count()).toBe(1);
    expect((await Publicacion.findByPk(pub.id))!.total_likes).toBe(1);
    const tras = await Notificacion.findAll({ where: { usuario_id: ana.id } });
    expect(tras.map((n) => n.tipo)).toEqual(['like']);
    expect(tras[0].mensaje).toBe('le gustó tu publicación');

    // Repetir la misma no cambia nada ni vuelve a avisar
    emitir.mockClear();
    expect((await reaccionar(beto, pub.id, 'me_gusta')).body.data.total_likes).toBe(1);
    expect(emitir).not.toHaveBeenCalled();
    expect(await Notificacion.count()).toBe(1);

    const quitada = await api().delete(`/api/likes/reaccion/${pub.id}`).set(bearer(beto));
    expect(quitada.status).toBe(200);
    expect(quitada.body.data).toEqual({ publicacion_id: pub.id, mi_reaccion: null, usuario_dio_like: false, total_likes: 0, reacciones: [] });
    expect((await Publicacion.findByPk(pub.id))!.total_likes).toBe(0);
    expect(await Notificacion.count()).toBe(0);
    expect(emitir).toHaveBeenLastCalledWith('like_update', expect.objectContaining({ publicacion_id: pub.id, total: 0, tipo: null }));

    expect((await api().delete(`/api/likes/reaccion/${pub.id}`).set(bearer(beto))).status).toBe(404);
  });

  it('valida el tipo, exige sesión y respeta la visibilidad', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const privada = await publicar(ana.id, 'privado');
    const publica = await publicar(ana.id);

    const invalida = await reaccionar(beto, publica.id, 'risa');
    expect(invalida.status).toBe(400);
    expect(invalida.body.errores[0].campo).toBe('tipo');
    expect((await api().post('/api/likes/reaccion').send({ publicacion_id: publica.id, tipo: 'jaja' })).status).toBe(401);
    expect((await reaccionar(beto, privada.id, 'jaja')).status).toBe(404);
    expect((await api().get(`/api/likes/${privada.id}/reacciones`).set(bearer(beto))).status).toBe(404);
    expect((await api().get(`/api/likes/${privada.id}/resumen`)).status).toBe(404);
    expect(await Like.count()).toBe(0);
  });

  it('las rutas viejas cuentan como me_gusta y conviven con las reacciones', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const pub = await publicar(ana.id);

    await reaccionar(beto, pub.id, 'enojo');
    // Ya tiene reacción: agregar es 409 y toggle la quita
    expect((await api().post('/api/likes/agregar').set(bearer(beto)).send({ publicacion_id: pub.id })).status).toBe(409);
    const toggle = await api().post('/api/likes/toggle').set(bearer(beto)).send({ publicacion_id: pub.id });
    expect(toggle.status).toBe(200);
    expect(toggle.body.data).toEqual({ publicacion_id: pub.id, liked: false, usuario_dio_like: false, total_likes: 0 });

    const otra = await api().post('/api/likes/toggle').set(bearer(beto)).send({ publicacion_id: pub.id });
    expect(otra.status).toBe(201);
    expect((await Like.findOne())!.tipo).toBe('me_gusta');
  });
});

describe('reacciones: quién reaccionó y resumen', () => {
  it('lista paginada con tipo, filtra por tipo y resume de más a menos', async () => {
    const ana = await crearUsuario();
    const u1 = await crearUsuario();
    const u2 = await crearUsuario();
    const u3 = await crearUsuario();
    const u4 = await crearUsuario();
    const pub = await publicar(ana.id);
    await reaccionar(u1, pub.id, 'aplauso');
    await reaccionar(u2, pub.id, 'jaja');
    await reaccionar(u3, pub.id, 'jaja');
    await reaccionar(u4, pub.id, 'me_encanta');

    const todas = await api().get(`/api/likes/${pub.id}/reacciones?limit=2`);
    expect(todas.status).toBe(200);
    expect(todas.body.meta).toEqual({ total: 4, limit: 2, offset: 0, hayMas: true });
    expect(todas.body.data[0]).toMatchObject({ tipo: 'me_encanta', usuario: { id: u4.id } });
    expect(todas.body.data[0].usuario.contrasena).toBeUndefined();

    const jaja = await api().get(`/api/likes/${pub.id}/reacciones?tipo=jaja`);
    expect(jaja.body.meta.total).toBe(2);
    expect(jaja.body.data.every((l: { tipo: string }) => l.tipo === 'jaja')).toBe(true);
    expect((await api().get(`/api/likes/${pub.id}/reacciones?tipo=otra`)).status).toBe(400);

    const resumen = await api().get(`/api/likes/${pub.id}/resumen`).set(bearer(u2));
    expect(resumen.body.data).toEqual({
      publicacion_id: pub.id,
      mi_reaccion: 'jaja',
      usuario_dio_like: true,
      total_likes: 4,
      reacciones: [
        { tipo: 'jaja', total: 2 },
        { tipo: 'me_encanta', total: 1 },
        { tipo: 'aplauso', total: 1 },
      ],
    });
    expect((await api().get(`/api/likes/${pub.id}/resumen`)).body.data.mi_reaccion).toBeNull();
  });

  it('el feed y el detalle traen mi_reaccion y el resumen', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const pub = await publicar(ana.id);
    await reaccionar(beto, pub.id, 'asombro');

    const detalle = await api().get(`/api/publicaciones/${pub.id}`).set(bearer(beto));
    expect(detalle.body.data).toMatchObject({ mi_reaccion: 'asombro', usuario_dio_like: true, reacciones: [{ tipo: 'asombro', total: 1 }] });
    const anonimo = await api().get(`/api/publicaciones/${pub.id}`);
    expect(anonimo.body.data).toMatchObject({ mi_reaccion: null, usuario_dio_like: false, reacciones: [{ tipo: 'asombro', total: 1 }] });
  });
});

describe('reacciones: utilidades', () => {
  it('ordena el resumen de más a menos y omite los tipos en cero', () => {
    expect(ordenarResumen({ triste: 1, jaja: 3, me_gusta: 1, enojo: 0 })).toEqual([
      { tipo: 'jaja', total: 3 },
      { tipo: 'me_gusta', total: 1 },
      { tipo: 'triste', total: 1 },
    ]);
    expect(mensajeReaccion('aplauso')).toBe('reaccionó 👏 a tu publicación');
  });
});
