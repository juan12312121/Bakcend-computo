import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Chat,
  Grupo,
  GrupoMiembro,
  MensajeChat,
  MensajeGrupo,
  ReaccionMensajeChat,
  ReaccionMensajeGrupo,
} from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { fileStorage } from '../src/infrastructure/storage/CloudinaryStorage';
import { chatGrupoRoutes } from '../src/modules/chat-grupo/chat-grupo.routes';
import { limpiezaMensajesTemporales, programarLimpiezaMensajes } from '../src/modules/chat/limpieza-mensajes';
import { chatRoutes } from '../src/modules/chat/chat.routes';
import { DURACION_TEMPORAL_MS, expiraEn, textoAvisoTemporales } from '../src/modules/chat/mensajes-temporales';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/chat': chatRoutes, '/grupos-chat': chatGrupoRoutes }));
beforeEach(reiniciarBD);
afterEach(() => vi.restoreAllMocks());

const HORA = 60 * 60 * 1000;
const enPasado = () => new Date(Date.now() - 1000);

async function chatEntre(a: UsuarioPrueba, b: UsuarioPrueba): Promise<number> {
  const res = await api().post('/api/chat/iniciar').set(bearer(a)).send({ receptorId: b.id });
  return res.body.data.id;
}

const enviar = (de: UsuarioPrueba, chatId: number, texto: string) => api().post('/api/chat/enviar').set(bearer(de)).send({ chatId, texto });
const temporales = (de: UsuarioPrueba, chatId: number, opcion: unknown) =>
  api().put(`/api/chat/${chatId}/temporales`).set(bearer(de)).send({ mensajes_temporales: opcion });

describe('mensajes temporales: reglas', () => {
  it('expiraEn suma 24 h o 7 días; apagado no vence', () => {
    const desde = new Date('2026-10-16T12:00:00.000Z');
    expect(expiraEn('apagado', desde)).toBeNull();
    expect(expiraEn('24h', desde)?.toISOString()).toBe('2026-10-17T12:00:00.000Z');
    expect(expiraEn('7d', desde)?.getTime()).toBe(desde.getTime() + DURACION_TEMPORAL_MS['7d']);
    expect(textoAvisoTemporales('Ana', 'apagado')).toBe('Ana desactivó los mensajes temporales.');
    expect(textoAvisoTemporales('Ana', '24h')).toContain('24 horas');
  });
});

describe('mensajes temporales: chat directo', () => {
  it('cualquiera de los dos los activa: queda un aviso, se emite el cambio y los nuevos llevan expira_en', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const chatId = await chatEntre(ana, beto);
    const sala = vi.spyOn(realtime, 'aSala');
    const personal = vi.spyOn(realtime, 'aUsuario');

    const res = await temporales(beto, chatId, '24h');
    expect(res.status).toBe(200);
    const cambio = { tipo: 'chat', id: chatId, mensajes_temporales: '24h', usuario_id: beto.id };
    expect(res.body.data).toMatchObject({ ...cambio, aviso: { es_aviso: true, emisor_id: beto.id, expira_en: null, reacciones: [] } });
    expect(res.body.data.aviso.texto).toBe(textoAvisoTemporales('Usuario beto', '24h'));
    expect(sala).toHaveBeenCalledWith(`chat_${chatId}`, 'mensajes_temporales', cambio);
    expect(personal).toHaveBeenCalledWith(ana.id, 'mensajes_temporales', cambio);
    expect(personal).toHaveBeenCalledWith(ana.id, 'new_message', expect.objectContaining({ es_aviso: true, is_global_notif: true }));
    expect((await Chat.findByPk(chatId))?.mensajes_temporales).toBe('24h');

    const antes = Date.now();
    const mensaje = (await enviar(ana, chatId, 'se va a borrar')).body.data;
    const vence = new Date(mensaje.expira_en).getTime();
    expect(vence).toBeGreaterThanOrEqual(antes + 24 * HORA - 1000);
    expect(vence).toBeLessThanOrEqual(Date.now() + 24 * HORA);

    // La misma opción otra vez no deja otro aviso
    const igual = await temporales(ana, chatId, '24h');
    expect(igual.body.data.aviso).toBeNull();
    expect(await MensajeChat.count({ where: { es_aviso: true } })).toBe(1);

    // Apagarlos: los nuevos ya no vencen
    expect((await temporales(ana, chatId, 'apagado')).body.data.aviso.texto).toBe('Usuario ana desactivó los mensajes temporales.');
    expect((await enviar(beto, chatId, 'permanente')).body.data.expira_en).toBeNull();

    const lista = await api().get('/api/chat/lista').set(bearer(ana));
    expect(lista.body.data[0]).toMatchObject({ mensajes_temporales: 'apagado', ultimo_mensaje: { texto: 'permanente', es_aviso: false } });
  });

  it('valida la opción (400), solo participantes (403) y chat inexistente (404)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const chatId = await chatEntre(ana, beto);
    expect((await temporales(ana, chatId, '1h')).status).toBe(400);
    expect((await temporales(ana, chatId, undefined)).status).toBe(400);
    expect((await temporales(caro, chatId, '7d')).status).toBe(403);
    expect((await temporales(ana, 999, '7d')).status).toBe(404);
  });

  it('nunca devuelve mensajes vencidos: ni en la conversación, ni en el último mensaje, ni en no leídos', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const chatId = await chatEntre(ana, beto);
    await enviar(ana, chatId, 'queda');
    const vencido = (await enviar(ana, chatId, 'vencido')).body.data;
    await MensajeChat.update({ expira_en: enPasado() }, { where: { id: vencido.id } });

    const lista = await api().get('/api/chat/lista').set(bearer(beto));
    expect(lista.body.data[0]).toMatchObject({ no_leidos: 1, ultimo_mensaje: { texto: 'queda' } });

    const mensajes = await api().get(`/api/chat/mensajes/${chatId}`).set(bearer(beto));
    expect(mensajes.body.data.map((m: { texto: string }) => m.texto)).toEqual(['queda']);
    expect(mensajes.body.meta.total).toBe(1);

    // Tampoco se puede reaccionar a uno vencido
    expect((await api().put(`/api/chat/mensajes/${vencido.id}/reaccion`).set(bearer(beto)).send({ emoji: '👍' })).status).toBe(404);
  });
});

describe('mensajes temporales: chat de grupo', () => {
  async function escenario() {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    const grupo = await Grupo.create({ nombre: 'Club', creador_id: ana.id });
    await GrupoMiembro.bulkCreate([
      { grupo_id: grupo.id, usuario_id: ana.id, rol: 'admin', estado: 'activo' },
      { grupo_id: grupo.id, usuario_id: beto.id, rol: 'miembro', estado: 'activo' },
      { grupo_id: grupo.id, usuario_id: caro.id, rol: 'moderador', estado: 'pendiente' },
    ]);
    return { grupoId: grupo.id, ana, beto, caro };
  }
  const cambiar = (de: UsuarioPrueba, grupoId: number, opcion: string) =>
    api().put(`/api/grupos-chat/${grupoId}/temporales`).set(bearer(de)).send({ mensajes_temporales: opcion });

  it('solo admin/moderador activo los cambia; ajustes dice quién puede', async () => {
    const { grupoId, ana, beto, caro } = await escenario();
    expect((await api().get(`/api/grupos-chat/${grupoId}/ajustes`).set(bearer(beto))).body.data).toEqual({
      grupo_id: grupoId,
      mensajes_temporales: 'apagado',
      puede_cambiar: false,
    });
    expect((await api().get(`/api/grupos-chat/${grupoId}/ajustes`).set(bearer(ana))).body.data.puede_cambiar).toBe(true);
    expect((await api().get(`/api/grupos-chat/${grupoId}/ajustes`).set(bearer(caro))).status).toBe(403);

    expect((await cambiar(beto, grupoId, '7d')).status).toBe(403);
    expect((await cambiar(caro, grupoId, '7d')).status).toBe(403);
    expect((await cambiar(ana, grupoId, 'siempre')).status).toBe(400);
    expect((await cambiar(ana, 999, '7d')).status).toBe(404);
  });

  it('al activarlos avisa a cada miembro activo y los mensajes nuevos vencen a los 7 días', async () => {
    const { grupoId, ana, beto, caro } = await escenario();
    const personal = vi.spyOn(realtime, 'aUsuario');

    const res = await cambiar(ana, grupoId, '7d');
    expect(res.status).toBe(200);
    expect(res.body.data.aviso).toMatchObject({ es_aviso: true, grupo_id: grupoId, texto: textoAvisoTemporales('Usuario ana', '7d') });
    const cambio = { tipo: 'grupo', id: grupoId, mensajes_temporales: '7d', usuario_id: ana.id };
    expect(personal).toHaveBeenCalledWith(beto.id, 'mensajes_temporales', cambio);
    expect(personal).toHaveBeenCalledWith(beto.id, 'mensaje_grupo', expect.objectContaining({ es_aviso: true }));
    expect(personal).not.toHaveBeenCalledWith(caro.id, 'mensajes_temporales', expect.anything());
    expect((await Grupo.findByPk(grupoId))?.mensajes_temporales).toBe('7d');

    const mensaje = (await api().post(`/api/grupos-chat/${grupoId}/mensajes`).set(bearer(beto)).send({ texto: 'hola' })).body.data;
    expect(new Date(mensaje.expira_en).getTime()).toBeGreaterThan(Date.now() + 7 * 24 * HORA - 60_000);

    const resumen = (await api().get('/api/grupos-chat/no-leidos').set(bearer(ana))).body.data[0];
    expect(resumen.grupo).toMatchObject({ mensajes_temporales: '7d' });
  });

  it('los vencidos no salen en la página, el último mensaje ni los no leídos', async () => {
    const { grupoId, ana, beto } = await escenario();
    const enviarGrupo = (texto: string) => api().post(`/api/grupos-chat/${grupoId}/mensajes`).set(bearer(ana)).send({ texto });
    await enviarGrupo('queda');
    const vencido = (await enviarGrupo('vencido')).body.data;
    await MensajeGrupo.update({ expira_en: enPasado() }, { where: { id: vencido.id } });

    const pagina = await api().get(`/api/grupos-chat/${grupoId}/mensajes`).set(bearer(beto));
    expect(pagina.body.data.map((m: { texto: string }) => m.texto)).toEqual(['queda']);
    const resumen = (await api().get('/api/grupos-chat/no-leidos').set(bearer(beto))).body.data[0];
    expect(resumen).toMatchObject({ no_leidos: 1, ultimo_mensaje: { texto: 'queda' } });
  });
});

describe('mensajes temporales: limpieza programada', () => {
  it('borra los vencidos de ambos chats con sus archivos y reacciones, y deja los vigentes', async () => {
    const eliminar = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const chat = await Chat.create({ usuario1_id: ana.id, usuario2_id: beto.id, iniciador_id: ana.id, estado: 'accepted' });
    const grupo = await Grupo.create({ nombre: 'Club', creador_id: ana.id });

    const viejoChat = await MensajeChat.create({ chat_id: chat.id, emisor_id: ana.id, texto: 'foto', archivo_url: 'https://cdn/x.png', expira_en: enPasado() });
    await MensajeChat.create({ chat_id: chat.id, emisor_id: ana.id, texto: 'vive', expira_en: new Date(Date.now() + HORA) });
    await MensajeChat.create({ chat_id: chat.id, emisor_id: ana.id, texto: 'permanente' });
    const viejoGrupo = await MensajeGrupo.create({ grupo_id: grupo.id, emisor_id: ana.id, texto: 'adios', expira_en: enPasado() });
    await ReaccionMensajeChat.create({ mensaje_id: viejoChat.id, usuario_id: beto.id, emoji: '🔥' });
    await ReaccionMensajeGrupo.create({ mensaje_id: viejoGrupo.id, usuario_id: beto.id, emoji: '👍' });

    expect(await limpiezaMensajesTemporales.limpiarVencidos()).toEqual({ chat: 1, grupo: 1 });
    expect(eliminar).toHaveBeenCalledTimes(1);
    expect(eliminar).toHaveBeenCalledWith('https://cdn/x.png');
    expect((await MensajeChat.findAll()).map((m) => m.texto).sort()).toEqual(['permanente', 'vive']);
    expect(await MensajeGrupo.count()).toBe(0);
    expect(await ReaccionMensajeChat.count()).toBe(0);
    expect(await ReaccionMensajeGrupo.count()).toBe(0);

    // Sin nada vencido no hace nada
    expect(await limpiezaMensajesTemporales.limpiarVencidos()).toEqual({ chat: 0, grupo: 0 });
  });

  it('programarLimpiezaMensajes deja un temporizador que no mantiene vivo el proceso', () => {
    const temporizador = programarLimpiezaMensajes(60_000);
    expect(temporizador.hasRef()).toBe(false);
    clearInterval(temporizador);
  });
});
