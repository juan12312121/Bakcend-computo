import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { BadRequestError } from '../src/core/errors';
import { Historia, HistoriaVista, Seguidor } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { fileStorage } from '../src/infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido } from '../src/infrastructure/storage/FileStorage';
import { historiaRoutes } from '../src/modules/historias/historia.routes';
import { historiaService, programarLimpieza } from '../src/modules/historias/historia.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/historias': historiaRoutes }));
let eliminarArchivo: MockInstance<typeof fileStorage.eliminar>;

beforeEach(async () => {
  await reiniciarBD();
  // Nunca se llama a Cloudinary en pruebas: solo se verifica qué se pidió borrar
  eliminarArchivo = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const seguir = (seguidor: UsuarioPrueba, seguido: UsuarioPrueba) =>
  Seguidor.create({ seguidor_id: seguidor.id, siguiendo_id: seguido.id });

/** Publica una historia de texto por la API. */
async function publicar(u: UsuarioPrueba, texto = 'Hola') {
  const res = await api().post('/api/historias').set(bearer(u)).send({ tipo: 'texto', texto });
  if (res.status !== 201) throw new Error(`No se pudo publicar: ${JSON.stringify(res.body)}`);
  return res.body.data as { id: number; [k: string]: unknown };
}

const vencer = (id: number) => Historia.update({ expira_en: new Date(Date.now() - 60_000) }, { where: { id } });

/** Archivo falso como lo dejaría multer (sin subir nada). */
const archivoFalso = (mimetype: string): ArchivoSubido => ({
  url: 'https://res.cloudinary.com/demo/image/upload/v1/trino/historias/media-1.jpg',
  id: 'trino/historias/media-1',
  nombreOriginal: 'x',
  mimetype,
  tamano: 1000,
});

const campos = (body: { errores?: { campo: string }[] }) => (body.errores ?? []).map((e) => e.campo);

describe('historias: crear', () => {
  it('crea una de texto con JSON, con valores por defecto, y avisa a los seguidores', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await seguir(beto, ana);
    const aviso = vi.spyOn(realtime, 'aUsuario');

    const antes = Date.now();
    const res = await api().post('/api/historias').set(bearer(ana)).send({ tipo: 'texto', texto: '  Buenos días  ' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      usuario_id: ana.id,
      tipo: 'texto',
      texto: 'Buenos días',
      fondo: 'from-orange-500 to-pink-500',
      duracion_seg: 5,
      total_vistas: 0,
      media_url: null,
      vista_por_mi: true,
    });
    expect(res.body.data.media_s3).toBeUndefined();
    const expira = new Date(res.body.data.expira_en).getTime();
    expect(expira - antes).toBeGreaterThanOrEqual(24 * 3600_000 - 1000);
    expect(expira - antes).toBeLessThanOrEqual(24 * 3600_000 + 5000);
    expect(aviso).toHaveBeenCalledWith(beto.id, 'nueva_historia', { usuario_id: ana.id });
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it('acepta fondo y duración válidos', async () => {
    const ana = await crearUsuario('ana');
    const res = await api()
      .post('/api/historias')
      .set(bearer(ana))
      .send({ tipo: 'texto', texto: 'Hey', fondo: 'from-blue-500 to-cyan-400', duracion_seg: 8 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ fondo: 'from-blue-500 to-cyan-400', duracion_seg: 8 });
  });

  it('lista los fondos permitidos', async () => {
    const ana = await crearUsuario('ana');
    const res = await api().get('/api/historias/fondos').set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.data).toContain('from-orange-500 to-pink-500');
  });

  it('valida texto, fondo, tipo, duración y archivo con 400', async () => {
    const ana = await crearUsuario('ana');
    const enviar = (body: Record<string, unknown>) => api().post('/api/historias').set(bearer(ana)).send(body);

    const sinTexto = await enviar({ tipo: 'texto', texto: '   ' });
    expect(sinTexto.status).toBe(400);
    expect(campos(sinTexto.body)).toContain('texto');

    const largo = await enviar({ tipo: 'texto', texto: 'x'.repeat(501) });
    expect(campos(largo.body)).toContain('texto');

    const fondo = await enviar({ tipo: 'texto', texto: 'Hola', fondo: 'bg-red-500' });
    expect(fondo.status).toBe(400);
    expect(campos(fondo.body)).toEqual(['fondo']);

    const tipo = await enviar({ tipo: 'audio' });
    expect(campos(tipo.body)).toContain('tipo');

    const imagenSinArchivo = await enviar({ tipo: 'imagen' });
    expect(imagenSinArchivo.status).toBe(400);
    expect(imagenSinArchivo.body.mensaje).toMatch(/requiere un archivo/);

    const videoSinDuracion = await enviar({ tipo: 'video' });
    expect(campos(videoSinDuracion.body)).toEqual(['duracion_seg']);

    const muyLargo = await enviar({ tipo: 'video', duracion_seg: 61 });
    expect(campos(muyLargo.body)).toEqual(['duracion_seg']);

    expect(await Historia.count()).toBe(0);
  });

  it('multipart: imagen sin archivo → 400 y archivo de tipo no permitido → 400 (sin subir nada)', async () => {
    const ana = await crearUsuario('ana');

    const sinArchivo = await api().post('/api/historias').set(bearer(ana)).field('tipo', 'imagen').field('duracion_seg', '');
    expect(sinArchivo.status).toBe(400);
    expect(sinArchivo.body.mensaje).toMatch(/requiere un archivo/);

    const pdf = await api()
      .post('/api/historias')
      .set(bearer(ana))
      .field('tipo', 'imagen')
      .attach('media', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(400);
    expect(pdf.body.mensaje).toMatch(/Solo se permiten imágenes/);
  });

  it('el servicio revisa la coherencia tipo ↔ archivo', async () => {
    const ana = await crearUsuario('ana');
    await expect(historiaService.crear(ana.id, { tipo: 'video', duracion_seg: 10 }, archivoFalso('image/png'))).rejects.toThrow(
      BadRequestError,
    );
    await expect(historiaService.crear(ana.id, { tipo: 'imagen' }, archivoFalso('video/mp4'))).rejects.toThrow('no es una imagen');
    await expect(historiaService.crear(ana.id, { tipo: 'texto', texto: 'x' }, archivoFalso('image/png'))).rejects.toThrow(
      'no llevan archivo',
    );

    const imagen = await historiaService.crear(ana.id, { tipo: 'imagen', fondo: 'from-blue-500 to-cyan-400' }, archivoFalso('image/jpeg'));
    expect(imagen).toMatchObject({ tipo: 'imagen', media_url: expect.stringContaining('cloudinary'), fondo: null, duracion_seg: 5 });
    const video = await historiaService.crear(ana.id, { tipo: 'video', duracion_seg: 42 }, archivoFalso('video/mp4'));
    expect(video).toMatchObject({ tipo: 'video', duracion_seg: 42 });
    expect((await Historia.findByPk(video.id))!.media_s3).toBe('trino/historias/media-1');
  });
});

describe('historias: bandeja y visibilidad', () => {
  it('agrupa por usuario: mías primero, luego no vistas, luego vistas; sin cuentas que no sigo', async () => {
    const [ana, beto, caro, dani] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro'), await crearUsuario('dani')];
    await seguir(ana, beto);
    await seguir(ana, caro);

    const b1 = await publicar(beto, 'b1');
    const b2 = await publicar(beto, 'b2');
    const c1 = await publicar(caro, 'c1');
    await publicar(dani, 'no la sigo');
    const a1 = await publicar(ana, 'mía');

    // Ana ve la de Caro: Caro pasa al final aunque es más reciente que las de Beto
    await api().post(`/api/historias/${c1.id}/vista`).set(bearer(ana)).expect(200);

    const res = await api().get('/api/historias').set(bearer(ana));
    expect(res.status).toBe(200);
    const grupos = res.body.data as {
      usuario: { id: number; nombre_usuario: string; contrasena?: string };
      es_mio: boolean;
      todas_vistas: boolean;
      ultima: string;
      historias: { id: number; vista_por_mi: boolean }[];
    }[];

    expect(grupos.map((g) => g.usuario.nombre_usuario)).toEqual(['ana', 'beto', 'caro']);
    expect(grupos[0]).toMatchObject({ es_mio: true, todas_vistas: true, historias: [{ id: a1.id, vista_por_mi: true }] });
    expect(grupos[1]).toMatchObject({ es_mio: false, todas_vistas: false });
    expect(grupos[1].historias.map((h) => h.id)).toEqual([b1.id, b2.id]); // por fecha ascendente
    expect(grupos[1].historias.every((h) => !h.vista_por_mi)).toBe(true);
    expect(new Date(grupos[1].ultima).getTime()).toBe(new Date(b2.fecha_creacion as string).getTime());
    expect(grupos[2]).toMatchObject({ todas_vistas: true, historias: [{ id: c1.id, vista_por_mi: true }] });
    expect(grupos[1].usuario.contrasena).toBeUndefined();
  });

  it('un grupo con una vista y otra sin ver sigue contando como no visto', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    await seguir(ana, beto);
    const b1 = await publicar(beto, 'b1');
    await publicar(beto, 'b2');
    await api().post(`/api/historias/${b1.id}/vista`).set(bearer(ana)).expect(200);

    const res = await api().get('/api/historias').set(bearer(ana));
    expect(res.body.data[0].todas_vistas).toBe(false);
    expect(res.body.data[0].historias.map((h: { vista_por_mi: boolean }) => h.vista_por_mi)).toEqual([true, false]);
  });

  it('las vencidas no aparecen en ningún lado', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    await seguir(ana, beto);
    const vieja = await publicar(beto, 'vieja');
    const nueva = await publicar(beto, 'nueva');
    await vencer(vieja.id);

    const bandeja = await api().get('/api/historias').set(bearer(ana));
    expect(bandeja.body.data[0].historias.map((h: { id: number }) => h.id)).toEqual([nueva.id]);

    const deBeto = await api().get(`/api/historias/usuario/${beto.id}`).set(bearer(ana));
    expect(deBeto.body.data.historias.map((h: { id: number }) => h.id)).toEqual([nueva.id]);

    expect((await api().post(`/api/historias/${vieja.id}/vista`).set(bearer(ana))).status).toBe(404);

    await vencer(nueva.id);
    expect((await api().get('/api/historias').set(bearer(ana))).body.data).toEqual([]);
  });

  it('historias de un usuario: el dueño y sus seguidores; 403 a los demás; 404 si no existe', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    await seguir(caro, ana);
    const a1 = await publicar(ana);

    const propia = await api().get(`/api/historias/usuario/${ana.id}`).set(bearer(ana));
    expect(propia.status).toBe(200);
    expect(propia.body.data).toMatchObject({ es_mio: true, usuario: { id: ana.id }, historias: [{ id: a1.id }] });

    const seguidora = await api().get(`/api/historias/usuario/${ana.id}`).set(bearer(caro));
    expect(seguidora.status).toBe(200);
    expect(seguidora.body.data).toMatchObject({ es_mio: false, todas_vistas: false, historias: [{ id: a1.id, vista_por_mi: false }] });

    expect((await api().get(`/api/historias/usuario/${ana.id}`).set(bearer(beto))).status).toBe(403);
    expect((await api().get('/api/historias/usuario/9999').set(bearer(ana))).status).toBe(404);
    expect((await api().get('/api/historias/usuario/abc').set(bearer(ana))).status).toBe(400);
  });

  it('pide sesión', async () => {
    expect((await api().get('/api/historias')).status).toBe(401);
    expect((await api().post('/api/historias').send({ tipo: 'texto', texto: 'x' })).status).toBe(401);
  });
});

describe('historias: vistas', () => {
  it('marcar vista es idempotente, suma una sola vez y no cuenta la propia', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    await seguir(beto, ana);
    const h = await publicar(ana);

    const primera = await api().post(`/api/historias/${h.id}/vista`).set(bearer(beto));
    expect(primera.status).toBe(200);
    expect(primera.body.data).toEqual({ historia_id: h.id, registrada: true, propia: false });

    const segunda = await api().post(`/api/historias/${h.id}/vista`).set(bearer(beto));
    expect(segunda.body.data).toEqual({ historia_id: h.id, registrada: false, propia: false });

    const propia = await api().post(`/api/historias/${h.id}/vista`).set(bearer(ana));
    expect(propia.body.data).toEqual({ historia_id: h.id, registrada: false, propia: true });

    expect((await Historia.findByPk(h.id))!.total_vistas).toBe(1);
    expect(await HistoriaVista.count({ where: { historia_id: h.id } })).toBe(1);
  });

  it('no se puede marcar la historia de quien no sigo (403) ni una inexistente (404)', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const h = await publicar(ana);
    expect((await api().post(`/api/historias/${h.id}/vista`).set(bearer(beto))).status).toBe(403);
    expect((await api().post('/api/historias/9999/vista').set(bearer(beto))).status).toBe(404);
    expect(await HistoriaVista.count()).toBe(0);
  });

  it('solo el autor ve quién la vio (paginado, usuarios públicos)', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    await seguir(beto, ana);
    await seguir(caro, ana);
    const h = await publicar(ana);
    await api().post(`/api/historias/${h.id}/vista`).set(bearer(beto)).expect(200);
    await api().post(`/api/historias/${h.id}/vista`).set(bearer(caro)).expect(200);

    const res = await api().get(`/api/historias/${h.id}/vistas?limit=1`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 2, limit: 1, offset: 0, hayMas: true });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].usuario).toMatchObject({ nombre_usuario: expect.any(String) });
    expect(res.body.data[0].usuario.email).toBeUndefined();
    expect(res.body.data[0].vista_en).toEqual(expect.any(String));

    const ajena = await api().get(`/api/historias/${h.id}/vistas`).set(bearer(beto));
    expect(ajena.status).toBe(403);
  });
});

describe('historias: borrar y limpiar', () => {
  it('solo el autor borra; se borran sus vistas y el archivo de Cloudinary', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    await seguir(beto, ana);
    const h = await historiaService.crear(ana.id, { tipo: 'imagen' }, archivoFalso('image/png'));
    await api().post(`/api/historias/${h.id}/vista`).set(bearer(beto)).expect(200);

    expect((await api().delete(`/api/historias/${h.id}`).set(bearer(beto))).status).toBe(403);
    expect(await Historia.count()).toBe(1);

    const res = await api().delete(`/api/historias/${h.id}`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.mensaje).toBe('Historia eliminada');
    expect(await Historia.count()).toBe(0);
    expect(await HistoriaVista.count()).toBe(0);
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/historias/media-1');

    expect((await api().delete(`/api/historias/${h.id}`).set(bearer(ana))).status).toBe(404);
  });

  it('borrar una de texto no llama a Cloudinary', async () => {
    const ana = await crearUsuario('ana');
    const h = await publicar(ana);
    await api().delete(`/api/historias/${h.id}`).set(bearer(ana)).expect(200);
    expect(eliminarArchivo).not.toHaveBeenCalled();
  });

  it('limpiarVencidas ya no borra: pasa las vencidas al archivo y conserva vistas y archivos', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    await seguir(beto, ana);
    const conArchivo = await historiaService.crear(ana.id, { tipo: 'video', duracion_seg: 12 }, archivoFalso('video/mp4'));
    const deTexto = await publicar(ana, 'texto');
    const vigente = await publicar(ana, 'sigue');
    await api().post(`/api/historias/${conArchivo.id}/vista`).set(bearer(beto)).expect(200);
    await vencer(conArchivo.id);
    await vencer(deTexto.id);

    expect(await historiaService.limpiarVencidas()).toBe(2);

    expect(await Historia.count()).toBe(3);
    const archivadas = (await Historia.findAll({ where: { archivada: true } })).map((h) => h.id).sort();
    expect(archivadas).toEqual([conArchivo.id, deTexto.id].sort());
    expect(await HistoriaVista.count()).toBe(1);
    expect(eliminarArchivo).not.toHaveBeenCalled();
    // Ya no salen en la bandeja
    const bandeja = await api().get('/api/historias').set(bearer(ana));
    expect(bandeja.body.data[0].historias.map((h: { id: number }) => h.id)).toEqual([vigente.id]);

    expect(await historiaService.limpiarVencidas()).toBe(0);
  });

  it('programarLimpieza corre cada 30 minutos', async () => {
    vi.useFakeTimers();
    const limpiar = vi.spyOn(historiaService, 'limpiarVencidas').mockResolvedValue(0);
    const temporizador = programarLimpieza();

    vi.advanceTimersByTime(29 * 60_000);
    expect(limpiar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(limpiar).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30 * 60_000);
    expect(limpiar).toHaveBeenCalledTimes(2);
    clearInterval(temporizador);
  });
});
