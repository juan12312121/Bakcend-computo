import http from 'http';
import type { AddressInfo } from 'net';
import { io as conectar, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { Bloqueo, Grupo, GrupoMiembro, Notificacion, Seguidor, Transmision, TransmisionComentario, Usuario } from '../src/infrastructure/database/models';
import { SocketGateway, type PermisosDeSalas } from '../src/infrastructure/realtime/RealtimeGateway';
import { tokenService } from '../src/infrastructure/security/TokenService';
import type { RespuestaSocket } from '../src/modules/llamadas/socket.utils';
import { registroTransmisiones } from '../src/modules/transmisiones/transmision.registro';
import { transmisionRoutes } from '../src/modules/transmisiones/transmision.routes';
import {
  EVENTOS_TRANSMISION as E,
  manejadorTransmisiones,
  senalizacionTransmisiones,
  type EntradaAnfitrion,
  type EntradaEspectador,
} from '../src/modules/transmisiones/transmision.senalizacion';
import { transmisionService } from '../src/modules/transmisiones/transmision.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

const permisos: PermisosDeSalas = {
  puedeEntrarAChat: async () => false,
  puedeEntrarAGrupo: async () => false,
  puedeEntrarATablero: async () => false,
};

let server: http.Server;
let url: string;
const abiertos: Socket[] = [];

beforeAll(async () => {
  usarModulos({ '/transmisiones': transmisionRoutes });
  server = http.createServer(crearApp());
  const gateway = new SocketGateway(tokenService);
  gateway.usar(manejadorTransmisiones);
  gateway.adjuntar(server, permisos);
  await new Promise<void>((ok) => server.listen(0, ok));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(async () => {
  await reiniciarBD();
  registroTransmisiones.reiniciar();
  senalizacionTransmisiones.ajustar({ maximoEspectadores: 20, graciaAnfitrionMs: 30_000, msEntreComentarios: 0 });
});
afterEach(() => abiertos.splice(0).forEach((s) => s.disconnect()));

function cliente(usuario: UsuarioPrueba): Promise<Socket> {
  const socket = conectar(url, { auth: { token: usuario.token }, transports: ['websocket'], forceNew: true });
  abiertos.push(socket);
  return new Promise((ok, mal) => {
    socket.on('connect', () => ok(socket));
    socket.on('connect_error', mal);
  });
}

function pedir<T>(socket: Socket, evento: string, datos: unknown): Promise<RespuestaSocket<T>> {
  return new Promise((ok) => socket.emit(evento, datos, ok));
}

async function pedirOk<T>(socket: Socket, evento: string, datos: unknown): Promise<T> {
  const respuesta = await pedir<T>(socket, evento, datos);
  if (!respuesta.ok) throw new Error(`${evento} falló: ${respuesta.error}`);
  return respuesta.data;
}

function esperar<T>(socket: Socket, evento: string, ms = 600): Promise<T | null> {
  return new Promise((ok) => {
    const t = setTimeout(() => ok(null), ms);
    socket.once(evento, (data: T) => {
      clearTimeout(t);
      ok(data);
    });
  });
}

async function iniciar(usuario: UsuarioPrueba, cuerpo: object = { titulo: 'Probando en vivo' }): Promise<number> {
  const res = await api().post('/api/transmisiones').set(bearer(usuario)).send(cuerpo);
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.data.id;
}

describe('Transmisiones: iniciar y quién las ve', () => {
  it('avisa solo a seguidores aceptados y no deja dos a la vez', async () => {
    const [ana, beto, carla, bloqueado] = await Promise.all(['ana', 'beto', 'carla', 'bloqueado'].map((n) => crearUsuario(n)));
    await Seguidor.create({ seguidor_id: beto.id, siguiendo_id: ana.id, estado: 'aceptado' });
    await Seguidor.create({ seguidor_id: carla.id, siguiendo_id: ana.id, estado: 'pendiente' });
    await Seguidor.create({ seguidor_id: bloqueado.id, siguiendo_id: ana.id, estado: 'aceptado' });
    await Bloqueo.create({ bloqueador_id: ana.id, bloqueado_id: bloqueado.id });

    const res = await api().post('/api/transmisiones').set(bearer(ana)).send({ titulo: '  Clase en vivo  ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ titulo: 'Clase en vivo', estado: 'en_vivo', espectadores: 0, soy_anfitrion: true, grupo: null });
    expect(res.body.data.anfitrion).not.toHaveProperty('cuenta_privada');

    const avisos = await Notificacion.findAll({ where: { tipo: 'transmision_en_vivo' } });
    expect(avisos.map((n) => n.usuario_id)).toEqual([beto.id]);
    expect(avisos[0]).toMatchObject({ entidad_tipo: 'transmision', entidad_id: res.body.data.id, de_usuario_id: ana.id });

    expect((await api().post('/api/transmisiones').set(bearer(ana)).send({ titulo: 'Otra' })).status).toBe(409);
    expect((await api().post('/api/transmisiones').set(bearer(ana)).send({ titulo: '' })).status).toBe(400);
  });

  it('listado y detalle respetan cuenta privada, bloqueos y grupos', async () => {
    const [ana, beto, carla, dani] = await Promise.all(['ana', 'beto', 'carla', 'dani'].map((n) => crearUsuario(n)));
    await Usuario.update({ cuenta_privada: true }, { where: { id: ana.id } });
    await Seguidor.create({ seguidor_id: beto.id, siguiendo_id: ana.id, estado: 'aceptado' });
    const deAna = await iniciar(ana);

    const grupo = await Grupo.create({ nombre: 'Club', creador_id: carla.id });
    await GrupoMiembro.create({ grupo_id: grupo.id, usuario_id: carla.id, rol: 'admin', estado: 'activo' });
    await GrupoMiembro.create({ grupo_id: grupo.id, usuario_id: dani.id, rol: 'miembro', estado: 'activo' });
    const delGrupo = await iniciar(carla, { titulo: 'Ensayo', grupo_id: grupo.id });
    expect(await Notificacion.count({ where: { usuario_id: dani.id, tipo: 'transmision_en_vivo' } })).toBe(1);
    // Para transmitir en un grupo hay que ser miembro
    expect((await api().post('/api/transmisiones').set(bearer(beto)).send({ titulo: 'x', grupo_id: grupo.id })).status).toBe(403);

    const ids = async (u: UsuarioPrueba) => (await api().get('/api/transmisiones').set(bearer(u))).body.data.map((t: { id: number }) => t.id);
    expect(await ids(beto)).toEqual([deAna]);
    expect(await ids(dani)).toEqual([delGrupo]);
    expect((await ids(ana)).sort()).toEqual([deAna]);
    expect((await api().get(`/api/transmisiones?grupo_id=${grupo.id}`).set(bearer(carla))).body.data).toHaveLength(1);

    expect((await api().get(`/api/transmisiones/${deAna}`).set(bearer(dani))).status).toBe(403);
    expect((await api().get(`/api/transmisiones/${delGrupo}`).set(bearer(beto))).status).toBe(403);
    await Bloqueo.create({ bloqueador_id: beto.id, bloqueado_id: ana.id });
    expect(await ids(beto)).toEqual([]);
    expect((await api().get(`/api/transmisiones/${deAna}`).set(bearer(beto))).status).toBe(404);
    expect((await api().get('/api/transmisiones')).status).toBe(401);
  });
});

describe('Transmisiones: en vivo por Socket.IO', () => {
  it('espectador entra, el anfitrión negocia con él, comentarios, reacciones y terminar', async () => {
    const [ana, beto, carla] = await Promise.all(['ana', 'beto', 'carla'].map((n) => crearUsuario(n)));
    const id = await iniciar(ana);
    const [sAna, sBeto, sCarla] = await Promise.all([cliente(ana), cliente(beto), cliente(carla)]);

    const comoAnfitrion = await pedirOk<EntradaAnfitrion>(sAna, E.anfitrion, { transmision_id: id });
    expect(comoAnfitrion.espectadores).toEqual([]);
    expect(await pedir(sBeto, E.anfitrion, { transmision_id: id })).toMatchObject({ ok: false, codigo: 'prohibido' });

    const nuevo = esperar<{ usuario: { id: number } }>(sAna, E.espectador);
    const contador = esperar<{ espectadores: number }>(sAna, E.contador);
    const entrada = await pedirOk<EntradaEspectador>(sBeto, E.unirse, { transmision_id: id });
    expect(entrada).toMatchObject({ espectadores: 1, comentarios: [], transmision: { id, soy_anfitrion: false } });
    expect((await nuevo)?.usuario.id).toBe(beto.id);
    expect(await contador).toEqual({ transmision_id: id, espectadores: 1 });

    // El anfitrión le manda la oferta a Beto y Beto contesta
    const oferta = esperar(sBeto, E.senal);
    await pedirOk(sAna, E.senal, { transmision_id: id, para: beto.id, tipo: 'oferta', sdp: 'oferta en vivo' });
    expect(await oferta).toEqual({ transmision_id: id, de: ana.id, tipo: 'oferta', sdp: 'oferta en vivo' });
    const respuesta = esperar(sAna, E.senal);
    await pedirOk(sBeto, E.senal, { transmision_id: id, para: ana.id, tipo: 'respuesta', sdp: 'respuesta' });
    expect(await respuesta).toMatchObject({ de: beto.id, tipo: 'respuesta' });

    // Carla no está viendo: ni señales ni comentarios
    expect(await pedir(sCarla, E.senal, { transmision_id: id, para: ana.id, tipo: 'respuesta', sdp: 'x' })).toMatchObject({ ok: false, codigo: 'prohibido' });
    expect(await pedir(sCarla, E.comentar, { transmision_id: id, texto: 'hola' })).toMatchObject({ ok: false, codigo: 'prohibido' });
    // Un espectador solo habla con el anfitrión
    expect(await pedir(sBeto, E.senal, { transmision_id: id, para: carla.id, tipo: 'oferta', sdp: 'x' })).toMatchObject({ ok: false, codigo: 'no_encontrado' });

    const comentarioAna = esperar<{ comentario: { texto: string; usuario: { id: number } } }>(sAna, E.comentario);
    const comentario = await pedirOk<{ id: number }>(sBeto, E.comentar, { transmision_id: id, texto: '¡Saludos!' });
    expect((await comentarioAna)?.comentario).toMatchObject({ id: comentario.id, texto: '¡Saludos!', usuario: { id: beto.id } });
    const reaccion = esperar(sAna, E.reaccion);
    await pedirOk(sBeto, E.reaccion, { transmision_id: id, tipo: 'corazon' });
    expect(await reaccion).toEqual({ transmision_id: id, usuario_id: beto.id, tipo: 'corazon' });

    const lista = await api().get(`/api/transmisiones/${id}/espectadores`).set(bearer(ana));
    expect(lista.body.data.map((u: { id: number }) => u.id)).toEqual([beto.id]);
    expect((await api().get(`/api/transmisiones/${id}/espectadores`).set(bearer(beto))).status).toBe(403);
    expect((await api().get('/api/transmisiones').set(bearer(beto))).body.data[0]).toMatchObject({ id, espectadores: 1 });

    // Quien entra tarde recibe los comentarios recientes
    const tarde = await pedirOk<EntradaEspectador>(sCarla, E.unirse, { transmision_id: id });
    expect(tarde.comentarios.map((c) => c.texto)).toEqual(['¡Saludos!']);
    const comentarios = await api().get(`/api/transmisiones/${id}/comentarios`).set(bearer(carla));
    expect(comentarios.body.meta.total).toBe(1);

    const salio = esperar(sAna, E.espectadorSalio);
    await pedirOk(sCarla, E.salir, { transmision_id: id });
    expect(await salio).toEqual({ transmision_id: id, usuario_id: carla.id });

    expect((await api().post(`/api/transmisiones/${id}/terminar`).set(bearer(beto))).status).toBe(403);
    const terminada = esperar(sBeto, E.terminada);
    const fin = await api().post(`/api/transmisiones/${id}/terminar`).set(bearer(ana));
    expect(fin.status).toBe(200);
    expect(fin.body.data).toMatchObject({ estado: 'terminada', espectadores: 0 });
    expect(await terminada).toEqual({ transmision_id: id, motivo: 'anfitrion' });

    expect(await Transmision.findByPk(id)).toMatchObject({ estado: 'terminada', max_espectadores: 2, total_espectadores: 2, total_comentarios: 1, total_reacciones: 1 });
    expect(await TransmisionComentario.count({ where: { transmision_id: id } })).toBe(1);
    expect(await pedir(sBeto, E.unirse, { transmision_id: id })).toMatchObject({ ok: false, codigo: 'invalido' });
  });

  it('respeta el máximo de espectadores y la privacidad del grupo', async () => {
    senalizacionTransmisiones.ajustar({ maximoEspectadores: 1 });
    const [ana, beto, carla, externo] = await Promise.all(['ana', 'beto', 'carla', 'externo'].map((n) => crearUsuario(n)));
    const grupo = await Grupo.create({ nombre: 'Club', creador_id: ana.id });
    for (const u of [ana, beto, carla]) await GrupoMiembro.create({ grupo_id: grupo.id, usuario_id: u.id, rol: 'miembro', estado: 'activo' });
    const id = await iniciar(ana, { titulo: 'Solo el club', grupo_id: grupo.id });
    const [sBeto, sCarla, sExterno] = await Promise.all([cliente(beto), cliente(carla), cliente(externo)]);

    expect(await pedir(sExterno, E.unirse, { transmision_id: id })).toMatchObject({ ok: false, codigo: 'prohibido' });
    await pedirOk(sBeto, E.unirse, { transmision_id: id });
    expect(await pedir(sCarla, E.unirse, { transmision_id: id })).toMatchObject({ ok: false, codigo: 'llena' });
  });

  it('si el anfitrión se desconecta y no vuelve, la transmisión termina sola', async () => {
    senalizacionTransmisiones.ajustar({ graciaAnfitrionMs: 250 });
    const [ana, beto] = await Promise.all([crearUsuario('ana'), crearUsuario('beto')]);
    const id = await iniciar(ana);
    const [sAna, sBeto] = await Promise.all([cliente(ana), cliente(beto)]);
    await pedirOk(sAna, E.anfitrion, { transmision_id: id });
    await pedirOk(sBeto, E.unirse, { transmision_id: id });

    const reconectando = esperar(sBeto, E.anfitrionReconectando);
    const terminada = esperar(sBeto, E.terminada, 1500);
    sAna.disconnect();
    expect(await reconectando).toEqual({ transmision_id: id });
    expect(await terminada).toEqual({ transmision_id: id, motivo: 'desconexion' });
    expect(await Transmision.findByPk(id)).toMatchObject({ estado: 'terminada', max_espectadores: 1 });
  });

  it('cerrarHuerfanas termina las que quedaron en vivo', async () => {
    const ana = await crearUsuario('ana');
    await Transmision.create({ anfitrion_id: ana.id, titulo: 'Vieja', inicio: new Date() });
    expect(await transmisionService.cerrarHuerfanas()).toBe(1);
    expect(await Transmision.count({ where: { estado: 'en_vivo' } })).toBe(0);
  });
});
