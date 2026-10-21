import http from 'http';
import type { AddressInfo } from 'net';
import { io as conectar, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/app';
import { Canal, CanalMiembro, type CanalPublicacion } from '../src/infrastructure/database/models';
import { SocketGateway, type PermisosDeSalas } from '../src/infrastructure/realtime/RealtimeGateway';
import { tokenService } from '../src/infrastructure/security/TokenService';
import { DifusorCanal, type EnviadorPush, type TokensDifusionRepository } from '../src/modules/canales/canal.difusion';
import { manejadorCanales, salaCanal, type RespuestaEntrarCanal } from '../src/modules/canales/canal.socket';
import type { NotificacionService } from '../src/modules/notificaciones/notificacion.service';
import { crearUsuario, reiniciarBD, type UsuarioPrueba } from './helpers';

const permisos: PermisosDeSalas = {
  puedeEntrarAChat: async () => false,
  puedeEntrarAGrupo: async () => false,
  puedeEntrarATablero: async () => false,
};

let server: http.Server;
let gateway: SocketGateway;
let url: string;
const abiertos: Socket[] = [];

beforeAll(async () => {
  server = http.createServer(crearApp());
  gateway = new SocketGateway(tokenService);
  gateway.usar(manejadorCanales);
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

function esperar<T>(socket: Socket, evento: string, ms = 300): Promise<T | null> {
  return new Promise((ok) => {
    const t = setTimeout(() => ok(null), ms);
    socket.once(evento, (data: T) => {
      clearTimeout(t);
      ok(data);
    });
  });
}

const entrar = (socket: Socket, canalId: number) =>
  socket.timeout(2000).emitWithAck('join_canal', canalId) as Promise<RespuestaEntrarCanal>;

describe('canales: sala de Socket.IO', () => {
  it('a un canal público entra cualquiera (también sin sesión) y recibe lo que se emite en la sala', async () => {
    const ana = await crearUsuario('ana');
    const canal = await Canal.create({ creador_id: ana.id, nombre: 'Abierto', codigo_invitacion: 'abc123abc123' });
    const anonimo = await cliente();

    expect(await entrar(anonimo, canal.id)).toEqual({ ok: true });
    const llegada = esperar(anonimo, 'canal_publicacion');
    gateway.aSala(salaCanal(canal.id), 'canal_publicacion', { id: 1 });
    expect(await llegada).toEqual({ id: 1 });

    anonimo.emit('leave_canal', canal.id);
    await new Promise((r) => setTimeout(r, 100));
    const despues = esperar(anonimo, 'canal_publicacion');
    gateway.aSala(salaCanal(canal.id), 'canal_publicacion', { id: 2 });
    expect(await despues).toBeNull();
  });

  it('a uno privado solo entran sus miembros; los demás reciben sala_denegada', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const canal = await Canal.create({ creador_id: ana.id, nombre: 'VIP', privacidad: 'privado', codigo_invitacion: 'vip123vip123' });
    await CanalMiembro.create({ canal_id: canal.id, usuario_id: ana.id, rol: 'propietario' });
    const [sAna, sBeto, sAnonimo] = await Promise.all([cliente(ana), cliente(beto), cliente()]);

    expect(await entrar(sAna, canal.id)).toEqual({ ok: true });
    const denegado = esperar(sBeto, 'sala_denegada');
    expect(await entrar(sBeto, canal.id)).toEqual({ ok: false });
    expect(await denegado).toEqual({ sala: 'canal', id: canal.id });
    expect(await entrar(sAnonimo, canal.id)).toEqual({ ok: false });
    expect(await entrar(sAna, 999)).toEqual({ ok: false });

    const paraAna = esperar(sAna, 'canal_reaccion');
    const paraBeto = esperar(sBeto, 'canal_reaccion');
    gateway.aSala(salaCanal(canal.id), 'canal_reaccion', { ok: 1 });
    expect(await paraAna).toEqual({ ok: 1 });
    expect(await paraBeto).toBeNull();
  });
});

describe('DifusorCanal', () => {
  const canal = { id: 7, nombre: 'Avisos' } as Canal;
  const publicacion = { id: 1, autor_id: 99, texto: 'x'.repeat(200), tipo_archivo: null } as unknown as CanalPublicacion;

  function difusor(limite: number, lote: number) {
    const notificaciones = { notificar: vi.fn().mockResolvedValue(null) };
    const tokens = { tokensDe: vi.fn(async (ids: readonly number[]) => ids.map((id) => `t${id}`)) };
    const enviador: EnviadorPush = { enviar: vi.fn().mockResolvedValue(undefined) };
    const instancia = new DifusorCanal(
      notificaciones as unknown as NotificacionService,
      tokens as unknown as TokensDifusionRepository,
      enviador,
      { limiteNotificaciones: limite, tokensPorLote: lote },
    );
    return { instancia, notificaciones, tokens, enviador };
  }

  it('hasta el límite guarda una notificación por persona', async () => {
    const { instancia, notificaciones, enviador } = difusor(3, 2);
    expect(await instancia.difundir(canal, publicacion, [1, 2, 3])).toEqual({ modo: 'notificaciones', destinatarios: 3 });
    expect(notificaciones.notificar).toHaveBeenCalledTimes(3);
    expect(notificaciones.notificar).toHaveBeenCalledWith(
      expect.objectContaining({ usuario_id: 2, de_usuario_id: 99, tipo: 'canal_publicacion', entidad_tipo: 'canal', entidad_id: 7 }),
    );
    expect(enviador.enviar).not.toHaveBeenCalled();
  });

  it('sobre el límite solo manda push: lee tokens por lotes de usuarios y envía por lotes de tokens', async () => {
    const { instancia, notificaciones, tokens, enviador } = difusor(3, 2);
    expect(await instancia.difundir(canal, publicacion, [1, 2, 3, 4, 5])).toEqual({ modo: 'push', destinatarios: 5 });
    expect(notificaciones.notificar).not.toHaveBeenCalled();
    expect(tokens.tokensDe.mock.calls).toEqual([[[1, 2]], [[3, 4]], [[5]]]);
    expect(enviador.enviar).toHaveBeenCalledTimes(3);
    const mensaje = (enviador.enviar as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(mensaje.titulo).toBe('Avisos');
    expect(mensaje.cuerpo).toHaveLength(140);
    expect(mensaje.cuerpo.endsWith('…')).toBe(true);
  });

  it('sin destinatarios no hace nada', async () => {
    const { instancia, notificaciones, enviador } = difusor(3, 2);
    expect(await instancia.difundir(canal, publicacion, [])).toEqual({ modo: 'nadie', destinatarios: 0 });
    expect(notificaciones.notificar).not.toHaveBeenCalled();
    expect(enviador.enviar).not.toHaveBeenCalled();
  });
});
