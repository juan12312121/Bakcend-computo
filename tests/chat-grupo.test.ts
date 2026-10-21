import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Grupo, GrupoMiembro, MensajeGrupo } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { fileStorage, motorCloudinary } from '../src/infrastructure/storage/CloudinaryStorage';
import { chatGrupoRoutes } from '../src/modules/chat-grupo/chat-grupo.routes';
import { dispositivoService } from '../src/modules/dispositivos/dispositivo.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/grupos-chat': chatGrupoRoutes }));
beforeEach(reiniciarBD);
afterEach(() => vi.restoreAllMocks());

/** Multer "sube" a una URL falsa de Cloudinary sin salir a internet. */
function simularSubidas(): void {
  vi.spyOn(motorCloudinary, '_handleFile').mockImplementation(async (_req, file, cb) => {
    file.stream.on('end', () =>
      cb(null, { path: `https://res.cloudinary.com/demo/video/upload/v1/trino/chat/${file.originalname}`, filename: `trino/chat/${file.originalname}`, size: 5 }),
    );
    file.stream.resume();
  });
}

interface Escenario {
  grupoId: number;
  ana: UsuarioPrueba; // creadora (admin)
  beto: UsuarioPrueba; // miembro activo
  caro: UsuarioPrueba; // solicitud pendiente
  dani: UsuarioPrueba; // no es miembro
}

/** Grupo "Club" con una admin, un miembro activo, una pendiente y alguien de fuera. */
async function escenario(): Promise<Escenario> {
  const [ana, beto, caro, dani] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro'), await crearUsuario('dani')];
  const grupo = await Grupo.create({ nombre: 'Club', creador_id: ana.id });
  await GrupoMiembro.bulkCreate([
    { grupo_id: grupo.id, usuario_id: ana.id, rol: 'admin', estado: 'activo' },
    { grupo_id: grupo.id, usuario_id: beto.id, rol: 'miembro', estado: 'activo' },
    { grupo_id: grupo.id, usuario_id: caro.id, rol: 'miembro', estado: 'pendiente' },
  ]);
  return { grupoId: grupo.id, ana, beto, caro, dani };
}

const enviar = (de: UsuarioPrueba, grupoId: number, texto: string) =>
  api().post(`/api/grupos-chat/${grupoId}/mensajes`).set(bearer(de)).send({ texto });
const mensajes = (de: UsuarioPrueba, grupoId: number, query = '') => api().get(`/api/grupos-chat/${grupoId}/mensajes${query}`).set(bearer(de));
const noLeidos = (de: UsuarioPrueba) => api().get('/api/grupos-chat/no-leidos').set(bearer(de));

describe('chat de grupo: permisos', () => {
  it('solo los miembros activos leen y escriben; grupo inexistente 404; sin sesión 401', async () => {
    const { grupoId, caro, dani, beto } = await escenario();

    expect((await mensajes(caro, grupoId)).status).toBe(403);
    expect((await mensajes(dani, grupoId)).status).toBe(403);
    expect((await enviar(dani, grupoId, 'hola')).status).toBe(403);
    expect((await api().put(`/api/grupos-chat/${grupoId}/leer`).set(bearer(caro))).status).toBe(403);
    expect((await mensajes(beto, 999)).status).toBe(404);
    expect((await api().get(`/api/grupos-chat/${grupoId}/mensajes`)).status).toBe(401);
    expect((await mensajes(beto, grupoId)).status).toBe(200);
  });

  it('valida: sin texto ni archivo 400, ids y limit inválidos 400', async () => {
    const { grupoId, beto } = await escenario();
    expect((await enviar(beto, grupoId, '   ')).status).toBe(400);
    expect((await mensajes(beto, grupoId, '?limit=500')).status).toBe(400);
    expect((await mensajes(beto, 0)).status).toBe(400);
  });
});

describe('chat de grupo: mensajes', () => {
  it('pagina con cursor: los más nuevos primero y antes_de para los anteriores', async () => {
    const { grupoId, ana, beto } = await escenario();
    const ids: number[] = [];
    for (const texto of ['uno', 'dos', 'tres']) ids.push((await enviar(ana, grupoId, texto)).body.data.id);

    const primera = await mensajes(beto, grupoId, '?limit=2');
    expect(primera.status).toBe(200);
    expect(primera.body.data.map((m: { texto: string }) => m.texto)).toEqual(['tres', 'dos']);
    expect(primera.body.data[0]).toMatchObject({ grupo_id: grupoId, emisor_id: ana.id, emisor: { id: ana.id, nombre_usuario: 'ana' } });
    expect(primera.body.meta).toMatchObject({ total: 3, hayMas: true });

    const anteriores = await mensajes(beto, grupoId, `?limit=2&antes_de=${ids[1]}`);
    expect(anteriores.body.data.map((m: { texto: string }) => m.texto)).toEqual(['uno']);
    expect(anteriores.body.meta.hayMas).toBe(false);
  });

  it('avisa por tiempo real a los miembros activos y manda push a los demás', async () => {
    const { grupoId, ana, beto, caro } = await escenario();
    const personal = vi.spyOn(realtime, 'aUsuario');
    const avisar = vi.spyOn(dispositivoService, 'avisar');

    const res = await enviar(ana, grupoId, 'Hola equipo');
    expect(res.status).toBe(201);
    const mensaje = expect.objectContaining({ id: res.body.data.id, texto: 'Hola equipo', emisor: expect.objectContaining({ id: ana.id }) });

    expect(personal).toHaveBeenCalledWith(ana.id, 'mensaje_grupo', mensaje);
    expect(personal).toHaveBeenCalledWith(beto.id, 'mensaje_grupo', mensaje);
    expect(personal).not.toHaveBeenCalledWith(caro.id, 'mensaje_grupo', expect.anything());

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar).toHaveBeenCalledWith(beto.id, {
      titulo: 'Club · Usuario ana',
      cuerpo: 'Hola equipo',
      datos: { tipo: 'mensaje_grupo', grupo_id: String(grupoId) },
    });
  });

  it('notas de voz e imágenes: tipo de archivo, duración y texto de la push', async () => {
    simularSubidas();
    const { grupoId, ana, beto } = await escenario();
    const avisar = vi.spyOn(dispositivoService, 'avisar');

    const audio = await api()
      .post(`/api/grupos-chat/${grupoId}/mensajes`)
      .set(bearer(beto))
      .field('duracion_seg', '42')
      .attach('archivo', Buffer.from('audio'), { filename: 'nota-voz.webm', contentType: 'audio/webm' });
    expect(audio.status).toBe(201);
    expect(audio.body.data).toMatchObject({ tipo_archivo: 'audio', duracion_seg: 42, archivo_url: expect.stringContaining('nota-voz.webm') });
    expect(avisar).toHaveBeenLastCalledWith(ana.id, expect.objectContaining({ cuerpo: '🎤 Nota de voz' }));

    const foto = await api()
      .post(`/api/grupos-chat/${grupoId}/mensajes`)
      .set(bearer(beto))
      .attach('archivo', Buffer.from('png'), { filename: 'foto.png', contentType: 'image/png' });
    expect(foto.body.data).toMatchObject({ tipo_archivo: 'image', duracion_seg: null });
    expect(avisar).toHaveBeenLastCalledWith(ana.id, expect.objectContaining({ cuerpo: '📷 Foto' }));

    const eliminar = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
    const sinDuracion = await api()
      .post(`/api/grupos-chat/${grupoId}/mensajes`)
      .set(bearer(beto))
      .attach('archivo', Buffer.from('audio'), { filename: 'nota-voz.webm', contentType: 'audio/webm' });
    expect(sinDuracion.status).toBe(400);
    expect(eliminar).toHaveBeenCalledWith('trino/chat/nota-voz.webm');
  });
});

describe('chat de grupo: no leídos', () => {
  it('cuenta lo de otros desde la última lectura; leer lo pone en 0 y devuelve lo anterior', async () => {
    const { grupoId, ana, beto } = await escenario();
    await enviar(ana, grupoId, 'uno');
    const dos = (await enviar(ana, grupoId, 'dos')).body.data;

    const deBeto = await noLeidos(beto);
    expect(deBeto.status).toBe(200);
    expect(deBeto.body.data).toEqual([
      expect.objectContaining({
        grupo_id: grupoId,
        no_leidos: 2,
        grupo: expect.objectContaining({ id: grupoId, nombre: 'Club' }),
        ultimo_mensaje: expect.objectContaining({ id: dos.id, texto: 'dos', emisor: expect.objectContaining({ id: ana.id }) }),
      }),
    ]);
    // Lo propio no cuenta
    expect((await noLeidos(ana)).body.data[0].no_leidos).toBe(0);

    const lectura = await api().put(`/api/grupos-chat/${grupoId}/leer`).set(bearer(beto));
    expect(lectura.status).toBe(200);
    expect(lectura.body.data).toEqual({ grupo_id: grupoId, anterior_leido_id: null, ultimo_mensaje_leido_id: dos.id });
    expect((await noLeidos(beto)).body.data[0].no_leidos).toBe(0);

    const tres = (await enviar(ana, grupoId, 'tres')).body.data;
    expect((await noLeidos(beto)).body.data[0]).toMatchObject({ no_leidos: 1, ultimo_mensaje_leido_id: dos.id });
    const otra = await api().put(`/api/grupos-chat/${grupoId}/leer`).set(bearer(beto));
    expect(otra.body.data).toEqual({ grupo_id: grupoId, anterior_leido_id: dos.id, ultimo_mensaje_leido_id: tres.id });
  });

  it('no incluye grupos donde no soy miembro activo y ordena por actividad', async () => {
    const { grupoId, ana, caro } = await escenario();
    const otro = await Grupo.create({ nombre: 'Otro', creador_id: ana.id });
    await GrupoMiembro.create({ grupo_id: otro.id, usuario_id: ana.id, rol: 'admin', estado: 'activo' });
    await enviar(ana, grupoId, 'viejo');
    await enviar(ana, otro.id, 'nuevo');

    expect((await noLeidos(ana)).body.data.map((g: { grupo_id: number }) => g.grupo_id)).toEqual([otro.id, grupoId]);
    expect((await noLeidos(caro)).body.data).toEqual([]);
  });
});

describe('chat de grupo: eliminar', () => {
  it('el autor o un admin eliminan para todos; un miembro no borra lo ajeno', async () => {
    vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
    const { grupoId, ana, beto } = await escenario();
    const deAna = (await enviar(ana, grupoId, 'de ana')).body.data;
    const deBeto = (await enviar(beto, grupoId, 'de beto')).body.data;
    const borrar = (quien: UsuarioPrueba, id: number) => api().delete(`/api/grupos-chat/${grupoId}/mensajes/${id}`).set(bearer(quien));

    expect((await borrar(beto, deAna.id)).status).toBe(403);
    const personal = vi.spyOn(realtime, 'aUsuario');
    const res = await borrar(ana, deBeto.id);
    expect(res.status).toBe(200);
    expect(personal).toHaveBeenCalledWith(beto.id, 'mensaje_grupo_eliminado', { grupo_id: grupoId, mensaje_id: deBeto.id });
    expect((await borrar(ana, deAna.id)).status).toBe(200);
    expect((await borrar(ana, deAna.id)).status).toBe(404);
    expect(await MensajeGrupo.count()).toBe(0);
  });
});
