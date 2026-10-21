import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { Publicacion, Usuario } from '../src/infrastructure/database/models';
import { fotoRoutes } from '../src/modules/fotos/foto.routes';
import { urlPublica } from '../src/modules/fotos/foto.url';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos } from './helpers';

beforeAll(() => usarModulos({ '/fotos': fotoRoutes }));
beforeEach(reiniciarBD);

const CLOUD = 'https://res.cloudinary.com/demo/image/upload/v1/trino';

describe('fotos', () => {
  it('construye URLs como el legacy', () => {
    const base = env.API_URL.replace(/\/+$/, '');
    expect(urlPublica(`${CLOUD}/a.jpg`)).toBe(`${CLOUD}/a.jpg`);
    expect(urlPublica('portadas/x.jpg', 'portada')).toBe(`${base}/uploads/portadas/x.jpg`);
    expect(urlPublica('/uploads/perfiles/y.jpg')).toBe(`${base}/uploads/perfiles/y.jpg`);
    expect(urlPublica('z.jpg', 'publicacion')).toBe(`${base}/uploads/publicaciones/z.jpg`);
    expect(urlPublica(null)).toBeNull();
  });

  it('galería de un usuario: perfil, portada y fotos de publicaciones visibles (imagen_url)', async () => {
    const dueno = await crearUsuario();
    const visitante = await crearUsuario();
    await Usuario.update({ foto_perfil_url: `${CLOUD}/perfil.jpg`, foto_portada_url: 'portadas/x.jpg' }, { where: { id: dueno.id } });
    const publica = await Publicacion.create({ usuario_id: dueno.id, contenido: 'a'.repeat(150), imagen_url: `${CLOUD}/p1.jpg` });
    await Publicacion.create({ usuario_id: dueno.id, contenido: 'privada', imagen_url: `${CLOUD}/p2.jpg`, visibilidad: 'privado' });
    await Publicacion.create({ usuario_id: dueno.id, contenido: 'sin imagen' });
    await Publicacion.create({ usuario_id: dueno.id, contenido: 'solo s3', imagen_url: '', imagen_s3: 'trino/x' });

    const res = await api().get(`/api/fotos/usuario/${dueno.id}`).set(bearer(visitante));
    expect(res.status).toBe(200);
    const { usuario, fotos, estadisticas, paginacion } = res.body.data;
    expect(usuario).toMatchObject({ id: dueno.id, nombre_usuario: dueno.nombre_usuario });
    expect(fotos.perfil_actual).toMatchObject({ url: `${CLOUD}/perfil.jpg`, tipo: 'perfil', es_actual: true });
    expect(fotos.portada_actual.url).toBe(`${env.API_URL.replace(/\/+$/, '')}/uploads/portadas/x.jpg`);
    expect(fotos.perfil_historial).toHaveLength(1);
    expect(fotos.publicaciones).toEqual([
      expect.objectContaining({ id: publica.id, url: `${CLOUD}/p1.jpg`, descripcion: 'a'.repeat(100), tipo: 'publicacion' }),
    ]);
    expect(estadisticas).toEqual({ total_fotos: 3, fotos_perfil_total: 1, fotos_portada_total: 1, fotos_publicaciones: 1 });
    expect(paginacion).toMatchObject({ total: 1, limit: 100, offset: 0, hayMas: false });

    const anonimo = await api().get(`/api/fotos/usuario/${dueno.id}`);
    expect(anonimo.body.data.fotos.publicaciones).toHaveLength(1);

    const mias = await api().get('/api/fotos/mis-fotos').set(bearer(dueno));
    expect(mias.status).toBe(200);
    expect(mias.body.data.fotos.publicaciones).toHaveLength(2);
  });

  it('usuario sin fotos y usuario inexistente', async () => {
    const u = await crearUsuario();
    const res = await api().get(`/api/fotos/usuario/${u.id}`);
    expect(res.body.data.fotos).toMatchObject({ perfil_actual: null, portada_actual: null, publicaciones: [] });
    expect(res.body.data.estadisticas.total_fotos).toBe(0);
    expect((await api().get('/api/fotos/usuario/999')).status).toBe(404);
    expect((await api().get('/api/fotos/mis-fotos')).status).toBe(401);
  });

  it('foto de perfil simple', async () => {
    const u = await crearUsuario();
    await Usuario.update({ foto_perfil_url: `${CLOUD}/yo.jpg` }, { where: { id: u.id } });
    const res = await api().get(`/api/fotos/usuario/${u.id}/foto-perfil-simple`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: u.id,
      nombre_completo: `Usuario ${u.nombre_usuario}`,
      nombre_usuario: u.nombre_usuario,
      foto_perfil_url: `${CLOUD}/yo.jpg`,
    });
    expect((await api().get('/api/fotos/usuario/999/foto-perfil-simple')).status).toBe(404);
  });

  it('fotos de perfil en lote ({ usuarios_ids })', async () => {
    const a = await crearUsuario();
    const b = await crearUsuario();
    const res = await api().post('/api/fotos/usuarios/fotos-batch').send({ usuarios_ids: [a.id, b.id, a.id, 999] });
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { id: number }) => u.id).sort()).toEqual([a.id, b.id].sort());
    expect(res.body.data[0].foto_perfil_url).toBeNull();
  });

  it('valida parámetros y cuerpo (400)', async () => {
    expect((await api().get('/api/fotos/usuario/abc')).status).toBe(400);
    expect((await api().get('/api/fotos/usuario/1?limit=0')).status).toBe(400);
    expect((await api().post('/api/fotos/usuarios/fotos-batch').send({})).status).toBe(400);
    expect((await api().post('/api/fotos/usuarios/fotos-batch').send({ usuarios_ids: [] })).status).toBe(400);
    expect((await api().post('/api/fotos/usuarios/fotos-batch').send({ usuarios_ids: ['x'] })).status).toBe(400);
  });
});
