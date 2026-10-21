import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { Historia, Publicacion, type EdicionVideo } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { fileStorage, motorCloudinary } from '../src/infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido } from '../src/infrastructure/storage/FileStorage';
import { historiaRoutes } from '../src/modules/historias/historia.routes';
import { historiaService } from '../src/modules/historias/historia.service';
import {
  SIN_EDICION,
  componentesEdicion,
  miniaturaVideo,
  textoParaCloudinary,
  urlReproduccion,
} from '../src/modules/publicaciones/edicion-video';
import { publicacionRoutes } from '../src/modules/publicaciones/publicacion.routes';
import { publicacionService } from '../src/modules/publicaciones/publicacion.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos } from './helpers';

beforeAll(() => usarModulos({ '/publicaciones': publicacionRoutes, '/historias': historiaRoutes }));
let eliminarArchivo: MockInstance<typeof fileStorage.eliminar>;

/** Multer "sube" a Cloudinary sin red: devuelve una URL y un public_id con el nombre del archivo. */
function simularSubida(): void {
  vi.spyOn(motorCloudinary, '_handleFile').mockImplementation(async (_req, file, cb) => {
    file.stream.on('end', () =>
      cb(null, { path: `https://res.cloudinary.com/demo/video/upload/v1/trino/chat/${file.originalname}`, filename: `trino/chat/${file.originalname}`, size: 5 }),
    );
    file.stream.resume();
  });
}

beforeEach(async () => {
  await reiniciarBD();
  eliminarArchivo = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
  simularSubida();
});
afterEach(() => vi.restoreAllMocks());

const ORIGINAL = 'https://res.cloudinary.com/demo/video/upload/v123/trino/videos/video-1.mp4';
const video = (): ArchivoSubido => ({ url: ORIGINAL, id: 'trino/videos/video-1', nombreOriginal: 'v.mp4', mimetype: 'video/mp4', tamano: 1000 });
const base = { contenido: 'Mi video', categoria: 'Ocio' as const, visibilidad: 'publico' as const, video_duracion: 40 };
const edicion = (cambios: Partial<EdicionVideo>): EdicionVideo => ({ ...SIN_EDICION, ...cambios });

describe('edición de video: URL de reproducción', () => {
  it('sin ajustes o fuera de Cloudinary devuelve la original', () => {
    expect(urlReproduccion(ORIGINAL, null)).toBe(ORIGINAL);
    expect(urlReproduccion(ORIGINAL, edicion({}))).toBe(ORIGINAL);
    expect(urlReproduccion('https://otro.com/v.mp4', edicion({ silenciar: true }))).toBe('https://otro.com/v.mp4');
  });

  it('recorte, silencio, música con volumen y texto, en ese orden', () => {
    const url = urlReproduccion(
      ORIGINAL,
      edicion({
        recorte_inicio: 2.5,
        recorte_fin: 12,
        silenciar: true,
        musica_s3: 'trino/chat/archivo-1',
        musica_volumen: 60,
        texto: { contenido: 'Hola, mundo/2', color: '#FFCC00', tamano: 70, x: 0.5, y: 0.8 },
      }),
    );
    expect(url).toBe(
      'https://res.cloudinary.com/demo/video/upload/so_2.5,eo_12/e_volume:mute/l_audio:trino:chat:archivo-1/du_9.5,e_volume:-40/fl_layer_apply,so_0/' +
        'l_text:Arial_70_bold:Hola%252C%20mundo%252F2,co_rgb:ffcc00/fl_layer_apply,g_center,x_0,y_0.3/v123/trino/videos/video-1.mp4',
    );
  });

  it('solo inicio o solo fin; música sin recorte no lleva duración', () => {
    expect(componentesEdicion(edicion({ recorte_inicio: 3 }))).toEqual(['so_3']);
    expect(componentesEdicion(edicion({ recorte_fin: 8 }))).toEqual(['eo_8']);
    expect(componentesEdicion(edicion({ musica_s3: 'm', musica_volumen: 100 }))).toEqual(['l_audio:m', 'e_volume:0', 'fl_layer_apply,so_0']);
    expect(textoParaCloudinary('a,b/c d')).toBe('a%252Cb%252Fc%20d');
  });

  it('miniatura del primer cuadro', () => {
    expect(miniaturaVideo(ORIGINAL)).toBe('https://res.cloudinary.com/demo/video/upload/so_0/v123/trino/videos/video-1.jpg');
    expect(miniaturaVideo('https://otro.com/a.mp4')).toBeNull();
  });
});

describe('edición de video: publicaciones', () => {
  it('al crear con `edicion` (JSON) guarda los ajustes, la original y la duración recortada', async () => {
    const ana = await crearUsuario('ana');
    const p = await publicacionService.crear(
      ana.id,
      { ...base, edicion: { recorte_inicio: 5, recorte_fin: 20, silenciar: true } },
      { video: video() },
    );
    expect(p.video_original_url).toBe(ORIGINAL);
    expect(p.video_url).toBe('https://res.cloudinary.com/demo/video/upload/so_5,eo_20/e_volume:mute/v123/trino/videos/video-1.mp4');
    expect(p.video_duracion).toBe(15);
    expect(p.edicion).toMatchObject({ recorte_inicio: 5, recorte_fin: 20, silenciar: true, musica_s3: null });
  });

  it('valida los ajustes al crear: sin video 400, recorte de menos de 1 s 400, recorte más largo que 180 s 400', async () => {
    const ana = await crearUsuario('ana');
    await expect(publicacionService.crear(ana.id, { ...base, edicion: { silenciar: true } })).rejects.toMatchObject({ statusCode: 400 });
    const corto = await api()
      .post('/api/publicaciones')
      .set(bearer(ana))
      .send({ contenido: 'x', edicion: JSON.stringify({ recorte_inicio: 3, recorte_fin: 3.5 }) });
    expect(corto.status).toBe(400);
    await expect(
      publicacionService.crear(ana.id, { ...base, edicion: { recorte_inicio: 0, recorte_fin: 400 } }, { video: video() }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('PUT /:id/edicion sube la música (multipart), la reemplaza borrando la anterior y la quita', async () => {
    const ana = await crearUsuario('ana');
    const p = await publicacionService.crear(ana.id, base, { video: video() });
    const aviso = vi.spyOn(realtime, 'aTodos');

    const conMusica = await api()
      .put(`/api/publicaciones/${p.id}/edicion`)
      .set(bearer(ana))
      .field('musica_volumen', '50')
      .field('recorte_fin', '30')
      .field('texto', JSON.stringify({ contenido: 'Hola', color: '#ffffff', tamano: 64, x: 0.5, y: 0.2 }))
      .attach('archivo', Buffer.from('ID3'), { filename: 'cancion.mp3', contentType: 'audio/mpeg' });
    expect(conMusica.status).toBe(200);
    expect(conMusica.body.data.edicion).toMatchObject({ musica_s3: 'trino/chat/cancion.mp3', musica_volumen: 50, recorte_fin: 30 });
    expect(conMusica.body.data.video_url).toContain('/l_audio:trino:chat:cancion.mp3/du_30,e_volume:-50/fl_layer_apply,so_0/');
    expect(conMusica.body.data.video_url).toContain('l_text:Arial_64_bold:Hola,co_rgb:ffffff/fl_layer_apply,g_center,x_0,y_-0.3');
    expect(conMusica.body.data.video_duracion).toBe(30);
    expect(aviso).toHaveBeenCalledWith('update_post', expect.objectContaining({ id: p.id }));

    const otra = await api()
      .put(`/api/publicaciones/${p.id}/edicion`)
      .set(bearer(ana))
      .attach('archivo', Buffer.from('ID3'), { filename: 'otra.mp3', contentType: 'audio/mpeg' });
    expect(otra.body.data.edicion.musica_s3).toBe('trino/chat/otra.mp3');
    // Los ajustes anteriores se conservan
    expect(otra.body.data.edicion.recorte_fin).toBe(30);
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/chat/cancion.mp3');

    const sin = await api().put(`/api/publicaciones/${p.id}/edicion`).set(bearer(ana)).send({ quitar_musica: true, recorte_fin: null, texto: null });
    expect(sin.body.data.edicion).toMatchObject({ musica_s3: null, recorte_fin: null, texto: null });
    expect(sin.body.data.video_url).toBe(ORIGINAL);
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/chat/otra.mp3');
  });

  it('edición: solo el autor (403), con video (400) y audio (400)', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const p = await publicacionService.crear(ana.id, base, { video: video() });
    const texto = await publicacionService.crear(ana.id, { contenido: 'solo texto', categoria: 'General', visibilidad: 'publico' });

    expect((await api().put(`/api/publicaciones/${p.id}/edicion`).set(bearer(beto)).send({ silenciar: true })).status).toBe(403);
    expect((await api().put(`/api/publicaciones/${texto.id}/edicion`).set(bearer(ana)).send({ silenciar: true })).status).toBe(400);
    const imagen = await api()
      .put(`/api/publicaciones/${p.id}/edicion`)
      .set(bearer(ana))
      .attach('archivo', Buffer.from('x'), { filename: 'foto.png', contentType: 'image/png' });
    expect(imagen.status).toBe(400);
    expect(imagen.body.mensaje).toBe('La música debe ser un archivo de audio');
  });

  it('cambiar el video por una imagen quita la edición y borra la música; borrar la publicación también la borra', async () => {
    const ana = await crearUsuario('ana');
    const p = await publicacionService.crear(ana.id, base, { video: video() });
    await publicacionService.editarVideo(p.id, ana.id, { quitar_musica: false }, { ...video(), url: 'https://x/m.mp3', id: 'trino/chat/m1', mimetype: 'audio/mpeg' });

    const imagen: ArchivoSubido = { url: 'https://res.cloudinary.com/demo/image/upload/i.png', id: 'trino/i', nombreOriginal: 'i', mimetype: 'image/png', tamano: 1 };
    const actualizada = await publicacionService.actualizar(p.id, ana.id, {}, { imagen });
    expect(actualizada).toMatchObject({ video_url: null, video_original_url: null, edicion: null });
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/chat/m1');

    const otra = await publicacionService.crear(ana.id, base, { video: video() });
    await publicacionService.editarVideo(otra.id, ana.id, { quitar_musica: false }, { ...video(), id: 'trino/chat/m2', mimetype: 'audio/mpeg' });
    await publicacionService.eliminar(otra.id, ana.id);
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/chat/m2');
    expect(await Publicacion.count()).toBe(1);
  });
});

describe('edición de video: historias', () => {
  it('al crear con `edicion` la duración es la del recorte (máx. 60 s) y se puede editar después', async () => {
    const ana = await crearUsuario('ana');
    const h = await historiaService.crear(
      ana.id,
      { tipo: 'video', duracion_seg: 50, edicion: { recorte_inicio: 10, recorte_fin: 25 } },
      { ...video(), url: ORIGINAL },
    );
    expect(h).toMatchObject({ duracion_seg: 15, media_original_url: ORIGINAL });
    expect(h.media_url).toContain('/so_10,eo_25/');
    await expect(
      historiaService.crear(ana.id, { tipo: 'video', duracion_seg: 50, edicion: { recorte_inicio: 0, recorte_fin: 90 } }, video()),
    ).rejects.toMatchObject({ statusCode: 400 });

    const res = await api()
      .put(`/api/historias/${h.id}/edicion`)
      .set(bearer(ana))
      .attach('archivo', Buffer.from('ID3'), { filename: 'tema.mp3', contentType: 'audio/mpeg' });
    expect(res.status).toBe(200);
    expect(res.body.data.media_url).toContain('l_audio:trino:chat:tema.mp3');
    expect(res.body.data.media_s3).toBeUndefined();

    const deTexto = await historiaService.crear(ana.id, { tipo: 'texto', texto: 'hola' });
    expect((await api().put(`/api/historias/${deTexto.id}/edicion`).set(bearer(ana)).send({ silenciar: true })).status).toBe(400);

    // Borrar la historia borra también su música
    await api().delete(`/api/historias/${h.id}`).set(bearer(ana)).expect(200);
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/chat/tema.mp3');
    expect(await Historia.count()).toBe(1);
  });

  it('los ajustes de video no aplican a historias de imagen o texto (400)', async () => {
    const ana = await crearUsuario('ana');
    const res = await api()
      .post('/api/historias')
      .set(bearer(ana))
      .send({ tipo: 'texto', texto: 'hola', edicion: { silenciar: true } });
    expect(res.status).toBe(400);
    expect(res.body.errores[0].campo).toBe('edicion');
  });
});
