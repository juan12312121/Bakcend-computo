import type { CreationAttributes } from 'sequelize';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Publicacion, Seguidor } from '../src/infrastructure/database/models';
import { fileStorage } from '../src/infrastructure/storage/CloudinaryStorage';
import { publicacionRoutes } from '../src/modules/publicaciones/publicacion.routes';
import { puntuacionReel } from '../src/modules/publicaciones/publicacion.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/publicaciones': publicacionRoutes }));
beforeEach(async () => {
  await reiniciarBD();
  vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

/** Publicación con video creada directo en la base (sin subir nada). */
function reel(u: UsuarioPrueba, extra: Partial<CreationAttributes<Publicacion>> = {}) {
  return Publicacion.create({
    usuario_id: u.id,
    contenido: 'Reel',
    video_url: 'https://res.cloudinary.com/demo/video/upload/r.mp4',
    video_s3: 'trino/r',
    video_duracion: 15,
    ...extra,
  });
}

const ids = (body: { data: { id: number }[] }) => body.data.map((p) => p.id);

describe('puntuacionReel', () => {
  const ahora = Date.parse('2026-10-14T12:00:00Z');
  const hace = (horas: number) => new Date(ahora - horas * 3_600_000);

  it('a igual antigüedad gana el más popular y a igual interacción gana el más nuevo', () => {
    const base = { total_likes: 0, total_comentarios: 0, total_vistas: 0 };
    expect(puntuacionReel({ ...base, total_likes: 5, fecha_creacion: hace(1) }, ahora)).toBeGreaterThan(
      puntuacionReel({ ...base, fecha_creacion: hace(1) }, ahora),
    );
    expect(puntuacionReel({ ...base, fecha_creacion: hace(1) }, ahora)).toBeGreaterThan(
      puntuacionReel({ ...base, fecha_creacion: hace(48) }, ahora),
    );
  });

  it('mezcla: un video popular de hace unas horas supera a uno nuevo sin interacción, pero no uno viejísimo', () => {
    const nuevo = puntuacionReel({ total_likes: 0, total_comentarios: 0, total_vistas: 0, fecha_creacion: hace(0) }, ahora);
    const popular = puntuacionReel({ total_likes: 30, total_comentarios: 10, total_vistas: 500, fecha_creacion: hace(10) }, ahora);
    const viejo = puntuacionReel({ total_likes: 30, total_comentarios: 10, total_vistas: 500, fecha_creacion: hace(2000) }, ahora);
    expect(popular).toBeGreaterThan(nuevo);
    expect(nuevo).toBeGreaterThan(viejo);
  });
});

describe('GET /publicaciones/reels', () => {
  it('solo videos visibles, ordenados por puntuación y paginados', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const tranquilo = await reel(beto);
    const popular = await reel(beto, { total_likes: 40, total_comentarios: 5 });
    await reel(beto, { visibilidad: 'privado' });
    const deSeguidores = await reel(beto, { visibilidad: 'seguidores' });
    await Publicacion.create({ usuario_id: beto.id, contenido: 'sin video' });

    const anonimo = await api().get('/api/publicaciones/reels');
    expect(anonimo.status).toBe(200);
    expect(ids(anonimo.body)).toEqual([popular.id, tranquilo.id]);
    expect(anonimo.body.data[0]).toMatchObject({ video_duracion: 15, autor: { id: beto.id }, usuario_dio_like: false });

    await Seguidor.create({ seguidor_id: ana.id, siguiendo_id: beto.id });
    const deAna = await api().get('/api/publicaciones/reels?limit=2').set(bearer(ana));
    expect(ids(deAna.body)).toEqual([popular.id, deSeguidores.id]);
    expect(deAna.body.meta).toEqual({ total: 3, limit: 2, offset: 0, hayMas: true });

    const segunda = await api().get('/api/publicaciones/reels?limit=2&offset=2').set(bearer(ana));
    expect(ids(segunda.body)).toEqual([tranquilo.id]);
    expect(segunda.body.meta.hayMas).toBe(false);

    expect((await api().get('/api/publicaciones/reels?limit=0')).status).toBe(400);
  });
});

describe('POST /publicaciones/:id/vista', () => {
  it('suma vistas con o sin sesión y responde el total', async () => {
    const ana = await crearUsuario('ana');
    const pub = await reel(ana);

    const primera = await api().post(`/api/publicaciones/${pub.id}/vista`);
    expect(primera.status).toBe(200);
    expect(primera.body.data).toEqual({ publicacion_id: pub.id, total_vistas: 1 });
    const segunda = await api().post(`/api/publicaciones/${pub.id}/vista`).set(bearer(ana));
    expect(segunda.body.data.total_vistas).toBe(2);
    expect((await Publicacion.findByPk(pub.id))!.total_vistas).toBe(2);
  });

  it('404 si no se puede ver y 400 si no tiene video', async () => {
    const ana = await crearUsuario('ana');
    const privada = await reel(ana, { visibilidad: 'privado' });
    const texto = await Publicacion.create({ usuario_id: ana.id, contenido: 'texto' });

    expect((await api().post(`/api/publicaciones/${privada.id}/vista`)).status).toBe(404);
    expect((await api().post(`/api/publicaciones/${privada.id}/vista`).set(bearer(ana))).status).toBe(200);
    expect((await api().post(`/api/publicaciones/${texto.id}/vista`)).status).toBe(400);
    expect((await api().post('/api/publicaciones/9999/vista')).status).toBe(404);
  });
});

describe('GET /publicaciones?orden=populares&con_media=true', () => {
  it('ordena el feed por puntuación, combina filtros y valida', async () => {
    const ana = await crearUsuario('ana');
    const texto = await Publicacion.create({ usuario_id: ana.id, contenido: 'texto', total_likes: 100 });
    const foto = await Publicacion.create({ usuario_id: ana.id, contenido: 'foto', imagen_url: 'https://res.cloudinary.com/demo/image/upload/f.jpg', total_likes: 3, categoria: 'Ocio' });
    const video = await reel(ana, { total_likes: 10, categoria: 'Ocio' });
    const nuevo = await Publicacion.create({ usuario_id: ana.id, contenido: 'nuevo' });

    const recientes = await api().get('/api/publicaciones');
    expect(ids(recientes.body)).toEqual([nuevo.id, video.id, foto.id, texto.id]);

    const populares = await api().get('/api/publicaciones?orden=populares');
    expect(ids(populares.body)).toEqual([texto.id, video.id, foto.id, nuevo.id]);
    expect(populares.body.meta).toMatchObject({ total: 4, hayMas: false });

    const conMedia = await api().get('/api/publicaciones?orden=populares&con_media=true');
    expect(ids(conMedia.body)).toEqual([video.id, foto.id]);
    const ocioRecientes = await api().get('/api/publicaciones?con_media=true&categoria=Ocio&limit=1');
    expect(ids(ocioRecientes.body)).toEqual([video.id]);
    expect(ocioRecientes.body.meta).toMatchObject({ total: 2, hayMas: true });
    const soloVideo = await api().get('/api/publicaciones?orden=populares&tipo=video');
    expect(ids(soloVideo.body)).toEqual([video.id]);

    expect((await api().get('/api/publicaciones?orden=viejos')).status).toBe(400);
  });
});
