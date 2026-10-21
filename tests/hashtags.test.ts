import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hashtag, PublicacionHashtag } from '../src/infrastructure/database/models';
import { fileStorage } from '../src/infrastructure/storage/CloudinaryStorage';
import { extraerHashtags } from '../src/modules/hashtags/extraer-hashtags';
import { hashtagRoutes } from '../src/modules/hashtags/hashtag.routes';
import { publicacionRoutes } from '../src/modules/publicaciones/publicacion.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/publicaciones': publicacionRoutes, '/hashtags': hashtagRoutes }));
beforeEach(async () => {
  await reiniciarBD();
  vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

async function publicar(u: UsuarioPrueba, contenido: string, extra: Record<string, unknown> = {}) {
  const res = await api().post('/api/publicaciones').set(bearer(u)).send({ contenido, ...extra });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.data as { id: number };
}

const total = async (nombre: string) => (await Hashtag.findOne({ where: { nombre } }))?.total_publicaciones;
const enc = encodeURIComponent;

describe('extraerHashtags', () => {
  it('minúsculas, acentos/ñ, dígitos y _, 2-50 caracteres, sin repetir ni tomar URLs', () => {
    expect(extraerHashtags('Vamos #Fútbol #fútbol #AÑO_2026 #a #x1 a#b https://sitio.mx/#ancla')).toEqual(['fútbol', 'año_2026', 'x1']);
    expect(extraerHashtags(`#${'a'.repeat(51)} #${'b'.repeat(50)}`)).toEqual(['b'.repeat(50)]);
    expect(extraerHashtags('')).toEqual([]);
  });
});

describe('hashtags al crear, editar y borrar publicaciones', () => {
  it('crea los que faltan, enlaza y mantiene total_publicaciones', async () => {
    const ana = await crearUsuario('ana');
    const p1 = await publicar(ana, 'Partido hoy #Fútbol #liga');
    const p2 = await publicar(ana, 'Otro #futbol? no, #FÚTBOL');
    expect(await total('fútbol')).toBe(2);
    expect(await total('liga')).toBe(1);
    expect(await total('futbol')).toBe(1);
    expect(await PublicacionHashtag.count()).toBe(4);

    // Editar: quita #liga y agrega #tenis
    const editada = await api().put(`/api/publicaciones/${p1.id}`).set(bearer(ana)).send({ contenido: 'Ahora #fútbol y #tenis' });
    expect(editada.status).toBe(200);
    expect(await total('liga')).toBe(0);
    expect(await total('tenis')).toBe(1);
    expect(await total('fútbol')).toBe(2);

    // Borrar: descuenta todos sus temas
    await api().delete(`/api/publicaciones/${p2.id}`).set(bearer(ana));
    expect(await total('fútbol')).toBe(1);
    expect(await total('futbol')).toBe(0);
    expect(await PublicacionHashtag.count({ where: { publicacion_id: p2.id } })).toBe(0);
  });
});

describe('API /hashtags', () => {
  it('info y publicaciones visibles del tema (404 si no existe, 400 si es inválido)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const publica = await publicar(ana, 'Hola #Ñandú');
    await publicar(ana, 'secreto #ñandú', { visibilidad: 'privado' });

    const info = await api().get(`/api/hashtags/${enc('#Ñandú')}`);
    expect(info.status).toBe(200);
    expect(info.body.data).toMatchObject({ nombre: 'ñandú', total_publicaciones: 2 });

    const deBeto = await api().get(`/api/hashtags/${enc('ñandú')}/publicaciones`).set(bearer(beto));
    expect(deBeto.body.data.map((p: { id: number }) => p.id)).toEqual([publica.id]);
    expect(deBeto.body.meta).toMatchObject({ total: 1, hayMas: false });
    const deAna = await api().get(`/api/hashtags/${enc('ñandú')}/publicaciones?limit=1`).set(bearer(ana));
    expect(deAna.body.meta).toMatchObject({ total: 2, limit: 1, hayMas: true });

    expect((await api().get('/api/hashtags/noexiste')).status).toBe(404);
    expect((await api().get('/api/hashtags/noexiste/publicaciones')).status).toBe(404);
    expect((await api().get('/api/hashtags/a')).status).toBe(400);
  });

  it('buscar autocompleta por prefijo (máx 8, los más usados primero)', async () => {
    const ana = await crearUsuario('ana');
    await publicar(ana, '#tecno #tecnologia');
    await publicar(ana, '#tecnologia #teatro');
    for (let i = 0; i < 9; i++) await publicar(ana, `#tema${i}`);

    const res = await api().get('/api/hashtags/buscar?q=%23TEC');
    expect(res.body.data.map((h: { nombre: string }) => h.nombre)).toEqual(['tecnologia', 'tecno']);
    expect((await api().get('/api/hashtags/buscar?q=tema')).body.data).toHaveLength(8);
    expect((await api().get('/api/hashtags/buscar')).body.data).toHaveLength(8);
    expect((await api().get('/api/hashtags/buscar?q=zzz')).body.data).toEqual([]);
  });

  it('tendencias: por publicaciones públicas recientes y con respaldo al total', async () => {
    const ana = await crearUsuario('ana');
    await publicar(ana, '#uno #dos');
    await publicar(ana, '#dos');
    await publicar(ana, '#oculto', { visibilidad: 'privado' });
    await publicar(ana, '#oculto', { visibilidad: 'privado' });
    await publicar(ana, '#oculto', { visibilidad: 'privado' });

    const res = await api().get('/api/hashtags/tendencias');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({ nombre: 'dos', recientes: 2, total_publicaciones: 2 }),
      expect.objectContaining({ nombre: 'uno', recientes: 1 }),
      // Respaldo: no cuenta como reciente (es privado) pero sí por total
      expect.objectContaining({ nombre: 'oculto', recientes: 0, total_publicaciones: 3 }),
    ]);
  });
});
