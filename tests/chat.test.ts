import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chat, MensajeChat, Seguidor } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { fileStorage, motorCloudinary } from '../src/infrastructure/storage/CloudinaryStorage';
import { chatRoutes } from '../src/modules/chat/chat.routes';
import { dispositivoService } from '../src/modules/dispositivos/dispositivo.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/chat': chatRoutes }));
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

const iniciar = (de: UsuarioPrueba, para: UsuarioPrueba) => api().post('/api/chat/iniciar').set(bearer(de)).send({ receptorId: para.id });
const enviar = (de: UsuarioPrueba, chatId: number, texto: string) => api().post('/api/chat/enviar').set(bearer(de)).send({ chatId, texto });

describe('chat: iniciar', () => {
  it('sin seguirse mutuamente nace pending; guarda el id menor primero', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');

    const res = await iniciar(beto, ana);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ estado: 'pending', usuario1_id: ana.id, usuario2_id: beto.id, otro_usuario: { id: ana.id } });
    expect(res.body.data.usuario1).toBeUndefined();

    // Un solo chat por par, sin importar quién lo inicie.
    const otraVez = await iniciar(ana, beto);
    expect(otraVez.status).toBe(200);
    expect(otraVez.body.data.id).toBe(res.body.data.id);
    expect(otraVez.body.data.otro_usuario.id).toBe(beto.id);
    expect(await Chat.count()).toBe(1);
  });

  it('si se siguen mutuamente nace accepted', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await Seguidor.bulkCreate([
      { seguidor_id: ana.id, siguiendo_id: beto.id },
      { seguidor_id: beto.id, siguiendo_id: ana.id },
    ]);
    const res = await iniciar(ana, beto);
    expect(res.body.data.estado).toBe('accepted');
  });

  it('seguir en un solo sentido no basta', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await Seguidor.create({ seguidor_id: beto.id, siguiendo_id: ana.id });
    const res = await iniciar(ana, beto);
    expect(res.body.data.estado).toBe('pending');
  });

  it('valida: consigo mismo 400, receptor inexistente 404, sin receptor 400', async () => {
    const ana = await crearUsuario('ana');
    expect((await iniciar(ana, ana)).status).toBe(400);
    expect((await api().post('/api/chat/iniciar').set(bearer(ana)).send({ receptorId: 999 })).status).toBe(404);
    expect((await api().post('/api/chat/iniciar').set(bearer(ana)).send({})).status).toBe(400);
    expect((await api().get('/api/chat/lista')).status).toBe(401);
  });
});

describe('chat: mensajes', () => {
  it('envía texto, lista con último mensaje y no leídos, y al leer los marca', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const chat = (await iniciar(ana, beto)).body.data;

    const m1 = await enviar(ana, chat.id, 'Hola Beto');
    expect(m1.status).toBe(201);
    expect(m1.body.data).toMatchObject({ chat_id: chat.id, emisor_id: ana.id, texto: 'Hola Beto', leido: false, emisor: { id: ana.id } });
    await enviar(ana, chat.id, '¿Cómo estás?');

    const lista = await api().get('/api/chat/lista').set(bearer(beto));
    expect(lista.status).toBe(200);
    expect(lista.body.meta.total).toBe(1);
    expect(lista.body.data[0]).toMatchObject({
      id: chat.id,
      otro_usuario: { id: ana.id },
      ultimo_mensaje: { texto: '¿Cómo estás?', emisor_id: ana.id },
      no_leidos: 2,
    });

    const mensajes = await api().get(`/api/chat/mensajes/${chat.id}`).set(bearer(beto));
    expect(mensajes.status).toBe(200);
    expect(mensajes.body.data.map((m: { texto: string }) => m.texto)).toEqual(['Hola Beto', '¿Cómo estás?']);
    expect(await MensajeChat.count({ where: { leido: true } })).toBe(2);

    const despues = await api().get('/api/chat/lista').set(bearer(beto));
    expect(despues.body.data[0].no_leidos).toBe(0);
  });

  it('pagina desde lo más reciente', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const chat = (await iniciar(ana, beto)).body.data;
    for (const t of ['uno', 'dos', 'tres']) await enviar(ana, chat.id, t);

    const res = await api().get(`/api/chat/mensajes/${chat.id}?limit=2`).set(bearer(ana));
    expect(res.body.data.map((m: { texto: string }) => m.texto)).toEqual(['dos', 'tres']);
    expect(res.body.meta).toMatchObject({ total: 3, hayMas: true });
  });

  it('un ajeno no lee ni escribe (403) y un chat inexistente da 404', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const chat = (await iniciar(ana, beto)).body.data;

    expect((await api().get(`/api/chat/mensajes/${chat.id}`).set(bearer(caro))).status).toBe(403);
    expect((await enviar(caro, chat.id, 'intruso')).status).toBe(403);
    expect((await api().get('/api/chat/mensajes/999').set(bearer(ana))).status).toBe(404);
    expect((await enviar(ana, 999, 'hola')).status).toBe(404);
  });

  it('valida el envío: sin chatId o sin texto ni archivo → 400', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const chat = (await iniciar(ana, beto)).body.data;
    expect((await api().post('/api/chat/enviar').set(bearer(ana)).send({ texto: 'hola' })).status).toBe(400);
    expect((await enviar(ana, chat.id, '   ')).status).toBe(400);
    expect((await api().get('/api/chat/mensajes/abc').set(bearer(ana))).status).toBe(400);
  });
});

describe('chat: aceptar solicitud', () => {
  it('solo el receptor acepta', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const chat = (await iniciar(ana, beto)).body.data;

    // Quien abrió el chat (iniciador_id) no puede aceptar su propia solicitud.
    expect(chat.iniciador_id ?? (await Chat.findByPk(chat.id))?.iniciador_id).toBe(ana.id);
    await enviar(ana, chat.id, 'Hola, ¿hablamos?');
    expect((await api().put(`/api/chat/aceptar/${chat.id}`).set(bearer(ana))).status).toBe(403);
    expect((await api().put(`/api/chat/aceptar/${chat.id}`).set(bearer(caro))).status).toBe(403);

    const ok = await api().put(`/api/chat/aceptar/${chat.id}`).set(bearer(beto));
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ id: chat.id, estado: 'accepted', otro_usuario: { id: ana.id } });
    expect((await Chat.findByPk(chat.id))?.estado).toBe('accepted');
  });
});

describe('chat: visto (palomitas azules)', () => {
  it('al abrir los mensajes marca leido_en y avisa mensajes_leidos al emisor una sola vez', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const chat = (await iniciar(ana, beto)).body.data;
    await enviar(ana, chat.id, 'uno');
    const m2 = (await enviar(ana, chat.id, 'dos')).body.data;
    await enviar(beto, chat.id, 'mío');

    const sala = vi.spyOn(realtime, 'aSala');
    const personal = vi.spyOn(realtime, 'aUsuario');
    const res = await api().get(`/api/chat/mensajes/${chat.id}`).set(bearer(beto));
    expect(res.status).toBe(200);

    const [uno, dos, mio] = res.body.data;
    expect(uno).toMatchObject({ texto: 'uno', leido: true });
    expect(dos.leido_en).toEqual(expect.any(String));
    // Lo que envió beto sigue sin leer (ana no lo ha abierto)
    expect(mio).toMatchObject({ texto: 'mío', leido: false, leido_en: null });

    const aviso = expect.objectContaining({ chat_id: chat.id, lector_id: beto.id, hasta_id: m2.id, marcados: 2 });
    expect(sala).toHaveBeenCalledWith(`chat_${chat.id}`, 'mensajes_leidos', aviso);
    expect(personal).toHaveBeenCalledWith(ana.id, 'mensajes_leidos', aviso);

    sala.mockClear();
    await api().get(`/api/chat/mensajes/${chat.id}`).set(bearer(beto));
    expect(sala).not.toHaveBeenCalledWith(expect.anything(), 'mensajes_leidos', expect.anything());
  });

  it('PUT /:chatId/leer marca sin pedir mensajes; sin nada pendiente responde marcados 0', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const chat = (await iniciar(ana, beto)).body.data;
    const m1 = (await enviar(ana, chat.id, 'hola')).body.data;

    const res = await api().put(`/api/chat/${chat.id}/leer`).set(bearer(beto));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ chat_id: chat.id, lector_id: beto.id, hasta_id: m1.id, marcados: 1 });
    expect((await MensajeChat.findByPk(m1.id))?.leido_en).toBeInstanceOf(Date);

    const otraVez = await api().put(`/api/chat/${chat.id}/leer`).set(bearer(beto));
    expect(otraVez.body.data).toMatchObject({ marcados: 0, hasta_id: null });

    expect((await api().put(`/api/chat/${chat.id}/leer`).set(bearer(caro))).status).toBe(403);
    expect((await api().put('/api/chat/999/leer').set(bearer(ana))).status).toBe(404);
  });
});

describe('chat: notas de voz', () => {
  it('un audio con duracion_seg se guarda como tipo audio y la push dice «Nota de voz»', async () => {
    simularSubidas();
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const chat = (await iniciar(ana, beto)).body.data;
    const avisar = vi.spyOn(dispositivoService, 'avisar');

    const res = await api()
      .post('/api/chat/enviar')
      .set(bearer(ana))
      .field('chatId', String(chat.id))
      .field('duracion_seg', '12')
      .attach('archivo', Buffer.from('audio'), { filename: 'nota-voz.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ tipo_archivo: 'audio', duracion_seg: 12, texto: '', archivo_url: expect.stringContaining('nota-voz.webm') });
    expect(avisar).toHaveBeenCalledWith(beto.id, { titulo: 'Usuario ana', cuerpo: '🎤 Nota de voz', datos: { tipo: 'mensaje', chat_id: String(chat.id) } });

    const lista = await api().get('/api/chat/lista').set(bearer(beto));
    expect(lista.body.data[0].ultimo_mensaje).toMatchObject({ tipo_archivo: 'audio', duracion_seg: 12 });
  });

  it('valida la duración: falta, 0 o más de 300 → 400 (y el archivo subido se borra)', async () => {
    simularSubidas();
    const eliminar = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const chat = (await iniciar(ana, beto)).body.data;
    const audio = (duracion?: string) => {
      const peticion = api().post('/api/chat/enviar').set(bearer(ana)).field('chatId', String(chat.id));
      if (duracion !== undefined) void peticion.field('duracion_seg', duracion);
      return peticion.attach('archivo', Buffer.from('audio'), { filename: 'nota-voz.m4a', contentType: 'audio/mp4' });
    };

    expect((await audio()).status).toBe(400);
    expect((await audio('301')).status).toBe(400);
    expect((await audio('0')).status).toBe(400);
    expect(eliminar).toHaveBeenCalledTimes(3);
    expect(await MensajeChat.count()).toBe(0);
  });

  it('una imagen ignora duracion_seg', async () => {
    simularSubidas();
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const chat = (await iniciar(ana, beto)).body.data;
    const res = await api()
      .post('/api/chat/enviar')
      .set(bearer(ana))
      .field('chatId', String(chat.id))
      .field('duracion_seg', '5')
      .attach('archivo', Buffer.from('png'), { filename: 'foto.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ tipo_archivo: 'image', duracion_seg: null });
  });
});

describe('chat: eliminar para todos', () => {
  it('solo el autor elimina; borra el archivo y avisa mensaje_eliminado', async () => {
    const eliminarArchivo = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const chat = (await iniciar(ana, beto)).body.data;
    const mensaje = (await enviar(ana, chat.id, 'ups')).body.data;

    expect((await api().delete(`/api/chat/mensajes/${mensaje.id}`).set(bearer(beto))).status).toBe(403);

    const personal = vi.spyOn(realtime, 'aUsuario');
    const res = await api().delete(`/api/chat/mensajes/${mensaje.id}`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ chat_id: chat.id, mensaje_id: mensaje.id });
    expect(personal).toHaveBeenCalledWith(beto.id, 'mensaje_eliminado', { chat_id: chat.id, mensaje_id: mensaje.id });
    expect(eliminarArchivo).toHaveBeenCalledWith(null);
    expect(await MensajeChat.count()).toBe(0);

    expect((await api().delete(`/api/chat/mensajes/${mensaje.id}`).set(bearer(ana))).status).toBe(404);
  });
});
