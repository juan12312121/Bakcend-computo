import http from 'http';
import type { AddressInfo } from 'net';
import { io as conectar, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { Chat } from '../src/infrastructure/database/models';
import { SocketGateway, salas, type PermisosDeSalas } from '../src/infrastructure/realtime/RealtimeGateway';
import { tokenService } from '../src/infrastructure/security/TokenService';
import { chatRepository } from '../src/modules/chat/chat.repository';
import { crearUsuario, reiniciarBD, type UsuarioPrueba } from './helpers';

const permisos: PermisosDeSalas = {
  puedeEntrarAChat: (chatId, usuarioId) => chatRepository.esParticipante(chatId, usuarioId),
  puedeEntrarAGrupo: async () => false,
  puedeEntrarATablero: async (tableroId) => tableroId === 7,
};

let server: http.Server;
let gateway: SocketGateway;
let url: string;
const abiertos: Socket[] = [];

beforeAll(async () => {
  server = http.createServer(crearApp());
  gateway = new SocketGateway(tokenService);
  gateway.adjuntar(server, permisos);
  await new Promise<void>((ok) => server.listen(0, ok));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(reiniciarBD);
afterEach(() => abiertos.splice(0).forEach((s) => s.disconnect()));

function cliente(usuario?: UsuarioPrueba): Promise<Socket> {
  const socket = conectar(url, { auth: usuario ? { token: usuario.token } : {}, transports: ['websocket'], forceNew: true });
  abiertos.push(socket);
  return new Promise((ok, mal) => {
    socket.on('connect', () => ok(socket));
    socket.on('connect_error', mal);
  });
}

/** Espera un evento; si no llega en `ms`, resuelve null. */
function esperar<T>(socket: Socket, evento: string, ms = 300): Promise<T | null> {
  return new Promise((ok) => {
    const t = setTimeout(() => ok(null), ms);
    socket.once(evento, (data: T) => {
      clearTimeout(t);
      ok(data);
    });
  });
}

describe('Socket.IO autenticado', () => {
  it('rechaza un token inválido', async () => {
    await expect(cliente({ id: 1, token: 'no-es-un-jwt', nombre_usuario: 'x' })).rejects.toThrow('Token inválido');
  });

  it('cada quien recibe solo lo de su sala personal', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const [sAna, sBeto] = await Promise.all([cliente(ana), cliente(beto)]);

    const paraAna = esperar(sAna, 'aviso');
    const paraBeto = esperar(sBeto, 'aviso');
    gateway.aUsuario(ana.id, 'aviso', { hola: 'ana' });

    expect(await paraAna).toEqual({ hola: 'ana' });
    expect(await paraBeto).toBeNull();
  });

  it('solo los participantes pueden escuchar un chat', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const intruso = await crearUsuario('intruso');
    const chat = await Chat.create({ usuario1_id: ana.id, usuario2_id: beto.id, iniciador_id: ana.id, estado: 'accepted' });
    const [sAna, sIntruso, sAnonimo] = await Promise.all([cliente(ana), cliente(intruso), cliente()]);

    sAna.emit('join_chat', chat.id);
    const denegadoIntruso = esperar<{ sala: string }>(sIntruso, 'sala_denegada');
    sIntruso.emit('join_chat', chat.id);
    const denegadoAnonimo = esperar<{ sala: string }>(sAnonimo, 'sala_denegada');
    sAnonimo.emit('join_chat', chat.id);
    expect(await denegadoIntruso).toMatchObject({ sala: 'chat' });
    expect(await denegadoAnonimo).toMatchObject({ sala: 'chat' });

    const mensajeAna = esperar(sAna, 'new_message');
    const mensajeIntruso = esperar(sIntruso, 'new_message');
    gateway.aSala(salas.chat(chat.id), 'new_message', { texto: 'secreto' });

    expect(await mensajeAna).toEqual({ texto: 'secreto' });
    expect(await mensajeIntruso).toBeNull();
  });

  it('los eventos públicos llegan también sin sesión', async () => {
    const anonimo = await cliente();
    const llegada = esperar(anonimo, 'new_post');
    gateway.aTodos('new_post', { id: 1 });
    expect(await llegada).toEqual({ id: 1 });
  });

  it('"escribiendo" llega solo a los demás de la sala, y solo si quien escribe ya entró', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const intruso = await crearUsuario('intruso');
    const chat = await Chat.create({ usuario1_id: ana.id, usuario2_id: beto.id, iniciador_id: ana.id, estado: 'accepted' });
    const [sAna, sBeto, sIntruso] = await Promise.all([cliente(ana), cliente(beto), cliente(intruso)]);
    sAna.emit('join_chat', chat.id);
    sBeto.emit('join_chat', chat.id);
    await new Promise((r) => setTimeout(r, 100));

    const avisoBeto = esperar(sBeto, 'escribiendo');
    const ecoAna = esperar(sAna, 'escribiendo');
    sAna.emit('escribiendo', { tipo: 'chat', id: chat.id, activo: true });
    expect(await avisoBeto).toEqual({ tipo: 'chat', id: chat.id, activo: true, usuarioId: ana.id });
    expect(await ecoAna).toBeNull();

    // El intruso no entró a la sala: su aviso se ignora
    const falso = esperar(sBeto, 'escribiendo');
    sIntruso.emit('escribiendo', { tipo: 'chat', id: chat.id, activo: true });
    expect(await falso).toBeNull();
  });

  it('a la sala de un tablero solo entra quien tiene permiso', async () => {
    const ana = await crearUsuario('ana');
    const sAna = await cliente(ana);
    const denegado = esperar<{ sala: string; id: number }>(sAna, 'sala_denegada');
    sAna.emit('join_board', 8);
    expect(await denegado).toEqual({ sala: 'tablero', id: 8 });

    sAna.emit('join_board', 7);
    await new Promise((r) => setTimeout(r, 100));
    const aviso = esperar(sAna, 'tarea_movida');
    gateway.aSala(salas.tablero(7), 'tarea_movida', { id: 1 });
    expect(await aviso).toEqual({ id: 1 });
  });
});
