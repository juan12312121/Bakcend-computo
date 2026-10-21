import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { Bloqueo, Historia, HistoriaDestacada, HistoriaDestacadaItem, Seguidor, Usuario } from '../src/infrastructure/database/models';
import { fileStorage, motorCloudinary } from '../src/infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido } from '../src/infrastructure/storage/FileStorage';
import { destacadaRoutes } from '../src/modules/destacados/destacada.routes';
import { portadaDeHistoria } from '../src/modules/destacados/destacada.service';
import { historiaRoutes } from '../src/modules/historias/historia.routes';
import { historiaService } from '../src/modules/historias/historia.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/destacadas': destacadaRoutes, '/historias': historiaRoutes }));
let eliminarArchivo: MockInstance<typeof fileStorage.eliminar>;

beforeEach(async () => {
  await reiniciarBD();
  eliminarArchivo = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
  vi.spyOn(motorCloudinary, '_handleFile').mockImplementation(async (_req, file, cb) => {
    file.stream.on('end', () =>
      cb(null, { path: `https://res.cloudinary.com/demo/image/upload/v1/trino/eventos/${file.originalname}`, filename: `trino/eventos/${file.originalname}`, size: 5 }),
    );
    file.stream.resume();
  });
});
afterEach(() => vi.restoreAllMocks());

const imagen = (n: number): ArchivoSubido => ({
  url: `https://res.cloudinary.com/demo/image/upload/v1/trino/historias/media-${n}.jpg`,
  id: `trino/historias/media-${n}`,
  nombreOriginal: 'x',
  mimetype: 'image/jpeg',
  tamano: 100,
});
const historiaDe = async (u: UsuarioPrueba, n = 1) => historiaService.crear(u.id, { tipo: 'imagen' }, imagen(n));
const vencer = (id: number) => Historia.update({ expira_en: new Date(Date.now() - 60_000) }, { where: { id } });

async function crearDestacada(u: UsuarioPrueba, historiaIds: number[], titulo = 'Viajes') {
  const res = await api().post('/api/destacadas').set(bearer(u)).send({ titulo, historia_ids: historiaIds });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.data as { id: number; historias: { id: number }[]; portada: { tipo: string; url?: string }; usuario: { id: number } };
}

describe('destacadas: crear y ver', () => {
  it('crea con historias propias en orden; la portada es la primera; aparece en el perfil', async () => {
    const ana = await crearUsuario('ana');
    const [h1, h2] = [await historiaDe(ana, 1), await historiaDe(ana, 2)];

    const d = await crearDestacada(ana, [h2.id, h1.id]);
    expect(d.historias.map((h) => h.id)).toEqual([h2.id, h1.id]);
    expect(d.portada).toEqual({ tipo: 'imagen', url: imagen(2).url });
    expect(d).toMatchObject({ titulo: 'Viajes', total_historias: 2, historia_ids: [h2.id, h1.id], portada_subida: false, orden: 0 });
    expect(d).toMatchObject({ usuario: { id: ana.id, nombre_usuario: 'ana' } });

    const perfil = await api().get(`/api/destacadas/usuario/${ana.id}`);
    expect(perfil.status).toBe(200);
    expect(perfil.body.data.map((x: { id: number }) => x.id)).toEqual([d.id]);
    expect((await api().get('/api/destacadas/mias').set(bearer(ana))).body.data).toHaveLength(1);
  });

  it('acepta la lista como texto (multipart) con portada subida y portada elegida', async () => {
    const ana = await crearUsuario('ana');
    const [h1, h2] = [await historiaDe(ana, 1), await historiaDe(ana, 2)];
    const res = await api()
      .post('/api/destacadas')
      .set(bearer(ana))
      .field('titulo', 'Playa')
      .field('historia_ids', `${h1.id},${h2.id}`)
      .field('portada_historia_id', String(h2.id))
      .attach('portada', Buffer.from('x'), { filename: 'portada.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ portada_subida: true, portada_historia_id: h2.id, portada: { tipo: 'imagen', url: expect.stringContaining('portada.png') } });
  });

  it('valida: historias ajenas o inexistentes, portada fuera de la lista, título y lista vacía (400)', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const mia = await historiaDe(ana);
    const ajena = await historiaDe(beto, 2);
    expect((await api().post('/api/destacadas').set(bearer(ana)).send({ titulo: 'x', historia_ids: [mia.id, ajena.id] })).status).toBe(400);
    expect((await api().post('/api/destacadas').set(bearer(ana)).send({ titulo: 'x', historia_ids: [999] })).status).toBe(400);
    expect((await api().post('/api/destacadas').set(bearer(ana)).send({ titulo: 'x', historia_ids: [] })).status).toBe(400);
    expect((await api().post('/api/destacadas').set(bearer(ana)).send({ titulo: '', historia_ids: [mia.id] })).status).toBe(400);
    const portada = await api().post('/api/destacadas').set(bearer(ana)).send({ titulo: 'x', historia_ids: [mia.id], portada_historia_id: ajena.id });
    expect(portada.status).toBe(400);
    expect((await api().post('/api/destacadas').send({ titulo: 'x', historia_ids: [mia.id] })).status).toBe(401);
  });

  it('privacidad: cuenta privada solo para seguidores; bloqueo 403; vacías solo las ve el dueño', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    const d = await crearDestacada(ana, [(await historiaDe(ana)).id]);
    await api().post('/api/destacadas').set(bearer(ana)).send({ titulo: 'Vacía', historia_ids: [(await historiaDe(ana, 3)).id] });
    const vacia = await HistoriaDestacada.findOne({ where: { titulo: 'Vacía' } });
    await HistoriaDestacadaItem.destroy({ where: { destacada_id: vacia!.id } });

    expect((await api().get(`/api/destacadas/usuario/${ana.id}`).set(bearer(beto))).body.data).toHaveLength(1);
    expect((await api().get('/api/destacadas/mias').set(bearer(ana))).body.data).toHaveLength(2);

    await Usuario.update({ cuenta_privada: true }, { where: { id: ana.id } });
    expect((await api().get(`/api/destacadas/usuario/${ana.id}`).set(bearer(beto))).status).toBe(403);
    expect((await api().get(`/api/destacadas/${d.id}`)).status).toBe(403);
    await Seguidor.create({ seguidor_id: beto.id, siguiendo_id: ana.id });
    expect((await api().get(`/api/destacadas/${d.id}`).set(bearer(beto))).status).toBe(200);

    await Usuario.update({ cuenta_privada: false }, { where: { id: ana.id } });
    await Bloqueo.create({ bloqueador_id: ana.id, bloqueado_id: caro.id });
    expect((await api().get(`/api/destacadas/usuario/${ana.id}`).set(bearer(caro))).status).toBe(403);
    expect((await api().get('/api/destacadas/usuario/9999')).status).toBe(404);
  });
});

describe('destacadas: archivo y vencimiento', () => {
  it('una historia vencida sale de la bandeja pero sigue en su destacada y en el archivo', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    await Seguidor.create({ seguidor_id: beto.id, siguiendo_id: ana.id });
    const h = await historiaDe(ana);
    const suelta = await historiaDe(ana, 2);
    const d = await crearDestacada(ana, [h.id]);
    await vencer(h.id);
    await vencer(suelta.id);
    expect(await historiaService.limpiarVencidas()).toBe(2);

    expect((await api().get('/api/historias').set(bearer(beto))).body.data).toEqual([]);
    const abierta = await api().get(`/api/destacadas/${d.id}`).set(bearer(beto));
    expect(abierta.body.data.historias.map((x: { id: number; media_url: string }) => x.media_url)).toEqual([imagen(1).url]);
    expect(eliminarArchivo).not.toHaveBeenCalled();

    const archivo = await api().get('/api/historias/archivo').set(bearer(ana));
    expect(archivo.status).toBe(200);
    expect(archivo.body.data.map((x: { id: number; vigente: boolean; destacada_ids: number[] }) => [x.id, x.vigente, x.destacada_ids])).toEqual([
      [suelta.id, false, []],
      [h.id, false, [d.id]],
    ]);
    // Del archivo se puede agregar a una destacada
    const agregada = await api().post(`/api/destacadas/${d.id}/historias`).set(bearer(ana)).send({ historia_id: suelta.id });
    expect(agregada.body.data.historia_ids).toEqual([h.id, suelta.id]);
  });

  it('borrar la historia la saca de las destacadas y deja de ser portada', async () => {
    const ana = await crearUsuario('ana');
    const [h1, h2] = [await historiaDe(ana, 1), await historiaDe(ana, 2)];
    const d = await crearDestacada(ana, [h1.id, h2.id]);
    await api().put(`/api/destacadas/${d.id}`).set(bearer(ana)).send({ portada_historia_id: h2.id }).expect(200);

    await api().delete(`/api/historias/${h2.id}`).set(bearer(ana)).expect(200);
    const res = await api().get(`/api/destacadas/${d.id}`).set(bearer(ana));
    expect(res.body.data).toMatchObject({ historia_ids: [h1.id], portada_historia_id: null, portada: { tipo: 'imagen', url: imagen(1).url } });
  });
});

describe('destacadas: editar, ordenar y borrar', () => {
  it('editar título y contenido; quitar historia; solo el dueño', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const [h1, h2, h3] = [await historiaDe(ana, 1), await historiaDe(ana, 2), await historiaDe(ana, 3)];
    const d = await crearDestacada(ana, [h1.id]);

    expect((await api().put(`/api/destacadas/${d.id}`).set(bearer(beto)).send({ titulo: 'Mía' })).status).toBe(403);
    const editada = await api().put(`/api/destacadas/${d.id}`).set(bearer(ana)).send({ titulo: 'Verano', historia_ids: [h3.id, h2.id] });
    expect(editada.status).toBe(200);
    expect(editada.body.data).toMatchObject({ titulo: 'Verano', historia_ids: [h3.id, h2.id] });
    expect((await api().put(`/api/destacadas/${d.id}`).set(bearer(ana)).send({})).status).toBe(400);

    const sin = await api().delete(`/api/destacadas/${d.id}/historias/${h3.id}`).set(bearer(ana));
    expect(sin.body.data.historia_ids).toEqual([h2.id]);
    expect((await api().delete(`/api/destacadas/${d.id}/historias/${h3.id}`).set(bearer(ana))).status).toBe(404);
    expect((await api().post(`/api/destacadas/${d.id}/historias`).set(bearer(beto)).send({ historia_id: h1.id })).status).toBe(403);
  });

  it('reordena las destacadas del perfil y borra (con su portada subida), sin borrar las historias', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const h = await historiaDe(ana);
    const a = await crearDestacada(ana, [h.id], 'A');
    const b = await crearDestacada(ana, [h.id], 'B');
    const ajena = await crearDestacada(beto, [(await historiaDe(beto, 5)).id], 'X');

    const orden = await api().put('/api/destacadas/orden').set(bearer(ana)).send({ ids: [b.id, a.id] });
    expect(orden.body.data.map((x: { titulo: string }) => x.titulo)).toEqual(['B', 'A']);
    expect((await api().put('/api/destacadas/orden').set(bearer(ana)).send({ ids: [ajena.id] })).status).toBe(400);

    await HistoriaDestacada.update({ portada_url: 'https://res.cloudinary.com/demo/image/upload/p.png', portada_s3: 'trino/p' }, { where: { id: a.id } });
    await api().delete(`/api/destacadas/${a.id}`).set(bearer(ana)).expect(200);
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/p');
    expect(await HistoriaDestacada.count({ where: { usuario_id: ana.id } })).toBe(1);
    expect(await Historia.count({ where: { id: h.id } })).toBe(1);
  });

  it('portadaDeHistoria: imagen, miniatura de video y gradiente de texto', () => {
    expect(portadaDeHistoria({ tipo: 'imagen', media_url: 'https://a/i.jpg', media_original_url: null, texto: null, fondo: null })).toEqual({ tipo: 'imagen', url: 'https://a/i.jpg' });
    expect(
      portadaDeHistoria({ tipo: 'video', media_url: 'x', media_original_url: 'https://res.cloudinary.com/demo/video/upload/v1/h/v.mp4', texto: null, fondo: null }),
    ).toEqual({ tipo: 'imagen', url: 'https://res.cloudinary.com/demo/video/upload/so_0/v1/h/v.jpg' });
    expect(portadaDeHistoria({ tipo: 'texto', media_url: null, media_original_url: null, texto: 'Hola', fondo: 'from-a to-b' })).toEqual({ tipo: 'texto', texto: 'Hola', fondo: 'from-a to-b' });
    expect(portadaDeHistoria(null)).toEqual({ tipo: 'ninguna' });
  });
});
