import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { Publicacion } from '../src/infrastructure/database/models';
import { fileStorage } from '../src/infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido } from '../src/infrastructure/storage/FileStorage';
import { publicacionRoutes } from '../src/modules/publicaciones/publicacion.routes';
import { publicacionService } from '../src/modules/publicaciones/publicacion.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos } from './helpers';

beforeAll(() => usarModulos({ '/publicaciones': publicacionRoutes }));
let eliminarArchivo: MockInstance<typeof fileStorage.eliminar>;

beforeEach(async () => {
  await reiniciarBD();
  eliminarArchivo = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

/** Archivo "ya subido" falso: en pruebas nunca se sube nada a Cloudinary. */
const archivo = (id: string, mimetype = 'video/mp4'): ArchivoSubido => ({
  url: `https://res.cloudinary.com/demo/video/upload/${id}.mp4`,
  id,
  nombreOriginal: `${id}.mp4`,
  mimetype,
  tamano: 1000,
});
const base = { contenido: 'Mi video', categoria: 'Ocio' as const, visibilidad: 'publico' as const };

describe('publicaciones con video', () => {
  it('crea con video y duración; aparece con ?tipo=video', async () => {
    const ana = await crearUsuario('ana');
    const conVideo = await publicacionService.crear(ana.id, { ...base, video_duracion: 42 }, { video: archivo('trino/v1') });
    expect(conVideo).toMatchObject({ video_url: expect.stringContaining('trino/v1'), video_s3: 'trino/v1', video_duracion: 42, total_vistas: 0, imagen_url: null });
    const texto = await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'solo texto' });

    const videos = await api().get('/api/publicaciones?tipo=video');
    expect(videos.body.data.map((p: { id: number }) => p.id)).toEqual([conVideo.id]);
    const todo = await api().get('/api/publicaciones');
    expect(todo.body.data.map((p: { id: number }) => p.id)).toEqual([texto.body.data.id, conVideo.id]);
    expect((await api().get('/api/publicaciones?tipo=gif')).status).toBe(400);
  });

  it('valida: imagen y video juntos (400), video sin duración (400) y duración fuera de 1-180', async () => {
    const ana = await crearUsuario('ana');
    await expect(
      publicacionService.crear(ana.id, { ...base, video_duracion: 10 }, { video: archivo('v'), imagen: archivo('i', 'image/png') }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Una publicación lleva imagen o video, no ambos' });
    await expect(publicacionService.crear(ana.id, base, { video: archivo('v') })).rejects.toMatchObject({ statusCode: 400 });

    const largo = await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'x', video_duracion: 181 });
    expect(largo.status).toBe(400);
    expect(largo.body.errores[0].campo).toBe('video_duracion');
    expect((await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'x', video_duracion: 0 })).status).toBe(400);
    // Sin video la duración se ignora
    const sinVideo = await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'x', video_duracion: '30' });
    expect(sinVideo.body.data.video_duracion).toBeNull();
    expect(await Publicacion.count()).toBe(1);
  });

  it('editar reemplaza el video (borra el anterior), una imagen reemplaza al video y quitar_video lo quita', async () => {
    const ana = await crearUsuario('ana');
    const pub = await publicacionService.crear(ana.id, { ...base, video_duracion: 20 }, { video: archivo('trino/v1') });

    const nuevo = await publicacionService.actualizar(pub.id, ana.id, { video_duracion: 30 }, { video: archivo('trino/v2') });
    expect(nuevo).toMatchObject({ video_s3: 'trino/v2', video_duracion: 30 });
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/v1');

    const conImagen = await publicacionService.actualizar(pub.id, ana.id, {}, { imagen: archivo('trino/i1', 'image/png') });
    expect(conImagen).toMatchObject({ imagen_s3: 'trino/i1', video_url: null, video_s3: null, video_duracion: null });
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/v2');

    await publicacionService.actualizar(pub.id, ana.id, { video_duracion: 5 }, { video: archivo('trino/v3') });
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/i1');
    const quitado = await api().put(`/api/publicaciones/${pub.id}`).set(bearer(ana)).send({ quitar_video: 'true' });
    expect(quitado.status).toBe(200);
    expect(quitado.body.data).toMatchObject({ video_url: null, video_s3: null, imagen_url: null });
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/v3');

    await expect(publicacionService.actualizar(pub.id, ana.id, {}, { video: archivo('v4') })).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      publicacionService.actualizar(pub.id, ana.id, {}, { documentos: [archivo('d', 'application/pdf')] }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('borrar la publicación borra el video del almacenamiento', async () => {
    const ana = await crearUsuario('ana');
    const pub = await publicacionService.crear(ana.id, { ...base, video_duracion: 20 }, { video: archivo('trino/v9') });
    expect((await api().delete(`/api/publicaciones/${pub.id}`).set(bearer(ana))).status).toBe(200);
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/v9');
  });
});

describe('publicas(ids, usuarioId)', () => {
  it('devuelve solo las visibles, enriquecidas y en el orden pedido', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const p1 = await publicacionService.crear(beto.id, base);
    const privada = await publicacionService.crear(beto.id, { ...base, visibilidad: 'privado' });
    const p3 = await publicacionService.crear(beto.id, base);

    const vistas = await publicacionService.publicas([p3.id, privada.id, 9999, p1.id, p3.id], ana.id);
    expect(vistas.map((p) => p.id)).toEqual([p3.id, p1.id]);
    expect(vistas[0]).toMatchObject({ documentos: [], usuario_dio_like: false, autor: expect.objectContaining({ id: beto.id }) });
    expect((await publicacionService.publicas([privada.id], beto.id)).map((p) => p.id)).toEqual([privada.id]);
    expect(await publicacionService.publicas([])).toEqual([]);
  });
});
