import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Grupo, GrupoMiembro, ReaccionMensajeChat, ReaccionMensajeGrupo } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { fileStorage } from '../src/infrastructure/storage/CloudinaryStorage';
import { chatGrupoRoutes } from '../src/modules/chat-grupo/chat-grupo.routes';
import { chatRoutes } from '../src/modules/chat/chat.routes';
import { resumirReacciones } from '../src/modules/chat/reacciones';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/chat': chatRoutes, '/grupos-chat': chatGrupoRoutes }));
beforeEach(reiniciarBD);
afterEach(() => vi.restoreAllMocks());

describe('resumirReacciones', () => {
  it('agrupa por mensaje, marca la mía y ordena por total y luego por la lista', () => {
    const resumen = resumirReacciones(
      [
        { objetivo_id: 1, emoji: '🔥', total: 1 },
        { objetivo_id: 1, emoji: '❤️', total: 1 },
        { objetivo_id: 1, emoji: '😂', total: 3 },
        { objetivo_id: 2, emoji: '👍', total: 2 },
      ],
      new Map([[1, '🔥']]),
    );
    expect(resumen.get(1)).toEqual([
      { emoji: '😂', total: 3, mia: false },
      { emoji: '❤️', total: 1, mia: false },
      { emoji: '🔥', total: 1, mia: true },
    ]);
    expect(resumen.get(2)).toEqual([{ emoji: '👍', total: 2, mia: false }]);
  });
});

describe('reacciones: chat directo', () => {
  async function conversacion() {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const chatId = (await api().post('/api/chat/iniciar').set(bearer(ana)).send({ receptorId: beto.id })).body.data.id as number;
    const mensaje = (await api().post('/api/chat/enviar').set(bearer(ana)).send({ chatId, texto: 'Hola' })).body.data;
    return { ana, beto, chatId, mensajeId: mensaje.id as number };
  }
  const reaccionar = (de: UsuarioPrueba, mensajeId: number, emoji: unknown) =>
    api().put(`/api/chat/mensajes/${mensajeId}/reaccion`).set(bearer(de)).send({ emoji });
  const quitar = (de: UsuarioPrueba, mensajeId: number) => api().delete(`/api/chat/mensajes/${mensajeId}/reaccion`).set(bearer(de));

  it('una por persona: poner, cambiar y quitar; se devuelven agrupadas en cada mensaje', async () => {
    const { ana, beto, chatId, mensajeId } = await conversacion();

    const puesta = await reaccionar(beto, mensajeId, '❤️');
    expect(puesta.status).toBe(200);
    expect(puesta.body.data).toEqual({ chat_id: chatId, mensaje_id: mensajeId, reacciones: [{ emoji: '❤️', total: 1, mia: true }] });

    // Cambiar reemplaza (sigue habiendo una sola de beto)
    expect((await reaccionar(beto, mensajeId, '🔥')).body.data.reacciones).toEqual([{ emoji: '🔥', total: 1, mia: true }]);
    await reaccionar(ana, mensajeId, '🔥');
    expect(await ReaccionMensajeChat.count()).toBe(2);

    const deAna = await api().get(`/api/chat/mensajes/${chatId}`).set(bearer(ana));
    expect(deAna.body.data[0].reacciones).toEqual([{ emoji: '🔥', total: 2, mia: true }]);

    const quitada = await quitar(beto, mensajeId);
    expect(quitada.status).toBe(200);
    expect(quitada.body.data.reacciones).toEqual([{ emoji: '🔥', total: 1, mia: false }]);
    // Quitar otra vez no falla
    expect((await quitar(beto, mensajeId)).body.data.reacciones).toEqual([{ emoji: '🔥', total: 1, mia: false }]);

    // Un mensaje nuevo viaja con reacciones vacías
    const nuevo = await api().post('/api/chat/enviar').set(bearer(beto)).send({ chatId, texto: 'otro' });
    expect(nuevo.body.data.reacciones).toEqual([]);
  });

  it('avisa en tiempo real a la sala del chat y al otro, sin `mia`', async () => {
    const { ana, beto, chatId, mensajeId } = await conversacion();
    const sala = vi.spyOn(realtime, 'aSala');
    const personal = vi.spyOn(realtime, 'aUsuario');

    await reaccionar(beto, mensajeId, '😂');
    const aviso = { chat_id: chatId, mensaje_id: mensajeId, usuario_id: beto.id, emoji: '😂', reacciones: [{ emoji: '😂', total: 1 }] };
    expect(sala).toHaveBeenCalledWith(`chat_${chatId}`, 'reaccion_mensaje', aviso);
    expect(personal).toHaveBeenCalledWith(ana.id, 'reaccion_mensaje', aviso);

    await quitar(beto, mensajeId);
    expect(personal).toHaveBeenLastCalledWith(ana.id, 'reaccion_mensaje', { ...aviso, emoji: null, reacciones: [] });
  });

  it('valida: emoji fuera de la lista 400 ("❤" sin variación vale), ajeno 403, inexistente 404, aviso 400', async () => {
    const { ana, beto, chatId, mensajeId } = await conversacion();
    const caro = await crearUsuario('caro');
    expect((await reaccionar(ana, mensajeId, '🍕')).status).toBe(400);
    expect((await reaccionar(ana, mensajeId, undefined)).status).toBe(400);
    expect((await reaccionar(ana, mensajeId, '❤')).body.data.reacciones).toEqual([{ emoji: '❤️', total: 1, mia: true }]);
    expect((await reaccionar(caro, mensajeId, '👍')).status).toBe(403);
    expect((await quitar(caro, mensajeId)).status).toBe(403);
    expect((await reaccionar(ana, 999, '👍')).status).toBe(404);

    const aviso = (await api().put(`/api/chat/${chatId}/temporales`).set(bearer(beto)).send({ mensajes_temporales: '24h' })).body.data.aviso;
    expect((await reaccionar(ana, aviso.id, '👍')).status).toBe(400);
  });

  it('al eliminar el mensaje se van sus reacciones', async () => {
    vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
    const { ana, beto, mensajeId } = await conversacion();
    await reaccionar(beto, mensajeId, '👍');
    expect((await api().delete(`/api/chat/mensajes/${mensajeId}`).set(bearer(ana))).status).toBe(200);
    expect(await ReaccionMensajeChat.count()).toBe(0);
  });
});

describe('reacciones: chat de grupo', () => {
  async function escenario() {
    const [ana, beto, caro, dani] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro'), await crearUsuario('dani')];
    const grupo = await Grupo.create({ nombre: 'Club', creador_id: ana.id });
    const otro = await Grupo.create({ nombre: 'Otro', creador_id: ana.id });
    await GrupoMiembro.bulkCreate([
      { grupo_id: grupo.id, usuario_id: ana.id, rol: 'admin', estado: 'activo' },
      { grupo_id: grupo.id, usuario_id: beto.id, rol: 'miembro', estado: 'activo' },
      { grupo_id: grupo.id, usuario_id: caro.id, rol: 'miembro', estado: 'activo' },
      { grupo_id: otro.id, usuario_id: ana.id, rol: 'admin', estado: 'activo' },
    ]);
    const mensaje = (await api().post(`/api/grupos-chat/${grupo.id}/mensajes`).set(bearer(ana)).send({ texto: 'Hola' })).body.data;
    return { grupoId: grupo.id, otroId: otro.id, ana, beto, caro, dani, mensajeId: mensaje.id as number };
  }
  const ruta = (grupoId: number, mensajeId: number) => `/api/grupos-chat/${grupoId}/mensajes/${mensajeId}/reaccion`;

  it('cada miembro reacciona una vez; la página trae las reacciones agrupadas con la mía', async () => {
    const { grupoId, beto, caro, mensajeId } = await escenario();
    await api().put(ruta(grupoId, mensajeId)).set(bearer(beto)).send({ emoji: '👍' });
    const res = await api().put(ruta(grupoId, mensajeId)).set(bearer(caro)).send({ emoji: '👍' });
    expect(res.body.data).toEqual({ grupo_id: grupoId, mensaje_id: mensajeId, reacciones: [{ emoji: '👍', total: 2, mia: true }] });
    await api().put(ruta(grupoId, mensajeId)).set(bearer(caro)).send({ emoji: '🙏' });

    const pagina = await api().get(`/api/grupos-chat/${grupoId}/mensajes`).set(bearer(beto));
    // Empate: van en el orden de la lista (🙏 antes que 👍)
    expect(pagina.body.data[0].reacciones).toEqual([
      { emoji: '🙏', total: 1, mia: false },
      { emoji: '👍', total: 1, mia: true },
    ]);
    expect(await ReaccionMensajeGrupo.count()).toBe(2);
  });

  it('avisa a cada miembro activo por su sala personal', async () => {
    const { grupoId, ana, beto, caro, dani, mensajeId } = await escenario();
    const personal = vi.spyOn(realtime, 'aUsuario');
    await api().put(ruta(grupoId, mensajeId)).set(bearer(beto)).send({ emoji: '😮' });
    const aviso = { grupo_id: grupoId, mensaje_id: mensajeId, usuario_id: beto.id, emoji: '😮', reacciones: [{ emoji: '😮', total: 1 }] };
    for (const u of [ana, beto, caro]) expect(personal).toHaveBeenCalledWith(u.id, 'reaccion_mensaje_grupo', aviso);
    expect(personal).not.toHaveBeenCalledWith(dani.id, 'reaccion_mensaje_grupo', expect.anything());

    await api().delete(ruta(grupoId, mensajeId)).set(bearer(beto));
    expect(personal).toHaveBeenLastCalledWith(expect.any(Number), 'reaccion_mensaje_grupo', { ...aviso, emoji: null, reacciones: [] });
  });

  it('solo miembros (403); el mensaje debe ser de ese grupo (404)', async () => {
    const { grupoId, otroId, ana, dani, mensajeId } = await escenario();
    expect((await api().put(ruta(grupoId, mensajeId)).set(bearer(dani)).send({ emoji: '👍' })).status).toBe(403);
    expect((await api().put(ruta(otroId, mensajeId)).set(bearer(ana)).send({ emoji: '👍' })).status).toBe(404);
    expect((await api().put(ruta(grupoId, mensajeId)).set(bearer(ana)).send({ emoji: 'x' })).status).toBe(400);
  });
});
