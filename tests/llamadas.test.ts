import http from 'http';
import type { AddressInfo } from 'net';
import { io as conectar, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/app';
import { Bloqueo, Grupo, GrupoMiembro, Llamada, LlamadaParticipante, Notificacion, Seguidor, Usuario } from '../src/infrastructure/database/models';
import { SocketGateway, type PermisosDeSalas } from '../src/infrastructure/realtime/RealtimeGateway';
import { tokenService } from '../src/infrastructure/security/TokenService';
import { dispositivoService } from '../src/modules/dispositivos/dispositivo.service';
import { configuracionIce } from '../src/modules/llamadas/ice';
import { llamadaRoutes } from '../src/modules/llamadas/llamada.routes';
import { EVENTOS_LLAMADA as E, manejadorLlamadas, senalizacionLlamadas, type EntradaLlamada, type LlamadaEnVivo } from '../src/modules/llamadas/llamada.senalizacion';
import { llamadaService } from '../src/modules/llamadas/llamada.service';
import type { RespuestaSocket } from '../src/modules/llamadas/socket.utils';
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
  usarModulos({ '/llamadas': llamadaRoutes });
  server = http.createServer(crearApp());
  const gateway = new SocketGateway(tokenService);
  gateway.usar(manejadorLlamadas);
  gateway.adjuntar(server, permisos);
  await new Promise<void>((ok) => server.listen(0, ok));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(async () => {
  await reiniciarBD();
  senalizacionLlamadas.reiniciar();
  senalizacionLlamadas.ajustar({ tiempoLimiteMs: 400, graciaMs: 0, maximoParticipantes: 8 });
});
afterEach(() => {
  abiertos.splice(0).forEach((s) => s.disconnect());
  vi.restoreAllMocks();
});

function cliente(usuario?: UsuarioPrueba): Promise<Socket> {
  const socket = conectar(url, { auth: usuario ? { token: usuario.token } : {}, transports: ['websocket'], forceNew: true });
  abiertos.push(socket);
  return new Promise((ok, mal) => {
    socket.on('connect', () => ok(socket));
    socket.on('connect_error', mal);
  });
}

/** Emite con acuse y devuelve la respuesta { ok, data } | { ok: false, error, codigo }. */
function pedir<T>(socket: Socket, evento: string, datos: unknown): Promise<RespuestaSocket<T>> {
  return new Promise((ok) => socket.emit(evento, datos, ok));
}

async function pedirOk<T>(socket: Socket, evento: string, datos: unknown): Promise<T> {
  const respuesta = await pedir<T>(socket, evento, datos);
  if (!respuesta.ok) throw new Error(`${evento} falló: ${respuesta.error}`);
  return respuesta.data;
}

/** Espera un evento; si no llega en `ms`, resuelve null. */
function esperar<T>(socket: Socket, evento: string, ms = 600): Promise<T | null> {
  return new Promise((ok) => {
    const t = setTimeout(() => ok(null), ms);
    socket.once(evento, (data: T) => {
      clearTimeout(t);
      ok(data);
    });
  });
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ana llama a Beto y Beto contesta. */
async function llamadaEnCurso(ana: UsuarioPrueba, beto: UsuarioPrueba, sAna: Socket, sBeto: Socket): Promise<number> {
  const entrante = esperar<{ llamada: LlamadaEnVivo }>(sBeto, E.entrante);
  const { llamada } = await pedirOk<{ llamada: LlamadaEnVivo }>(sAna, E.iniciar, { usuario_id: beto.id, tipo: 'video' });
  await entrante;
  await pedirOk<EntradaLlamada>(sBeto, E.aceptar, { llamada_id: llamada.id });
  return llamada.id;
}

describe('Llamadas 1 a 1', () => {
  it('suena, contesta, intercambia SDP/ICE solo entre los dos y queda en el historial', async () => {
    const [ana, beto, intruso] = await Promise.all([crearUsuario('ana'), crearUsuario('beto'), crearUsuario('intruso')]);
    const [sAna, sBeto, sIntruso] = await Promise.all([cliente(ana), cliente(beto), cliente(intruso)]);
    const espia = vi.fn();
    sIntruso.onAny(espia);

    const entrante = esperar<{ llamada: LlamadaEnVivo }>(sBeto, E.entrante);
    const { llamada } = await pedirOk<{ llamada: LlamadaEnVivo }>(sAna, E.iniciar, { usuario_id: beto.id, tipo: 'video' });
    expect(llamada).toMatchObject({ tipo: 'video', estado: 'sonando', grupo: null, sonando: [beto.id], invitados: [{ id: beto.id, nombre_usuario: 'beto' }] });
    expect((await entrante)?.llamada).toMatchObject({ id: llamada.id, iniciador: { id: ana.id, nombre_usuario: 'ana' } });

    const sonando = esperar(sAna, E.sonando);
    sBeto.emit(E.sonando, { llamada_id: llamada.id });
    expect(await sonando).toEqual({ llamada_id: llamada.id, usuario_id: beto.id });

    const unido = esperar<{ usuario: { id: number } }>(sAna, E.unido);
    const entrada = await pedirOk<EntradaLlamada>(sBeto, E.aceptar, { llamada_id: llamada.id });
    expect(entrada.presentes.map((u) => u.id)).toEqual([ana.id]);
    expect(entrada.llamada.estado).toBe('en_curso');
    expect((await unido)?.usuario.id).toBe(beto.id);

    // Quien entra manda la oferta; la respuesta y los candidatos vuelven solo a quien corresponde
    const oferta = esperar(sAna, E.senal);
    await pedirOk(sBeto, E.senal, { llamada_id: llamada.id, para: ana.id, tipo: 'oferta', sdp: 'v=0 oferta' });
    expect(await oferta).toEqual({ llamada_id: llamada.id, de: beto.id, tipo: 'oferta', sdp: 'v=0 oferta' });

    const respuesta = esperar(sBeto, E.senal);
    await pedirOk(sAna, E.senal, { llamada_id: llamada.id, para: beto.id, tipo: 'respuesta', sdp: 'v=0 respuesta' });
    expect(await respuesta).toMatchObject({ de: ana.id, tipo: 'respuesta' });

    const candidato = { candidate: 'candidate:1 1 udp 2122260223 10.0.0.2 51000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    const ice = esperar(sBeto, E.senal);
    await pedirOk(sAna, E.senal, { llamada_id: llamada.id, para: beto.id, tipo: 'ice', candidato });
    expect(await ice).toMatchObject({ tipo: 'ice', candidato });

    // Nadie ajeno puede mandar señales ni meterse
    expect(await pedir(sIntruso, E.senal, { llamada_id: llamada.id, para: ana.id, tipo: 'oferta', sdp: 'x' })).toMatchObject({ ok: false, codigo: 'prohibido' });
    expect(await pedir(sIntruso, E.aceptar, { llamada_id: llamada.id })).toMatchObject({ ok: false, codigo: 'prohibido' });
    expect(espia).not.toHaveBeenCalled();

    await pausa(1100);
    const terminada = esperar<{ estado: string; duracion_seg: number }>(sBeto, E.terminada);
    await pedirOk(sAna, E.colgar, { llamada_id: llamada.id });
    expect(await terminada).toMatchObject({ llamada_id: llamada.id, estado: 'terminada', motivo: 'colgo' });

    const registro = await Llamada.findByPk(llamada.id);
    expect(registro).toMatchObject({ estado: 'terminada', tipo: 'video', destinatario_id: beto.id, max_participantes: 2 });
    expect(registro!.inicio).not.toBeNull();
    expect(registro!.duracion_seg).toBeGreaterThanOrEqual(1);

    const historial = await api().get('/api/llamadas').set(bearer(beto));
    expect(historial.status).toBe(200);
    expect(historial.body.meta.total).toBe(1);
    expect(historial.body.data[0]).toMatchObject({ direccion: 'entrante', mi_estado: 'salio', estado: 'terminada', otro: { id: ana.id } });
    const deAna = await api().get('/api/llamadas').set(bearer(ana));
    expect(deAna.body.data[0]).toMatchObject({ direccion: 'saliente', otro: { id: beto.id } });
    expect((await api().get('/api/llamadas').set(bearer(intruso))).body.meta.total).toBe(0);
  });

  it('rechazar termina la llamada para quien llama', async () => {
    const [ana, beto] = await Promise.all([crearUsuario('ana'), crearUsuario('beto')]);
    const [sAna, sBeto] = await Promise.all([cliente(ana), cliente(beto)]);
    const { llamada } = await pedirOk<{ llamada: LlamadaEnVivo }>(sAna, E.iniciar, { usuario_id: beto.id });
    expect(llamada.tipo).toBe('audio');

    const terminada = esperar(sAna, E.terminada);
    await pedirOk(sBeto, E.rechazar, { llamada_id: llamada.id });
    expect(await terminada).toMatchObject({ estado: 'rechazada', motivo: 'rechazada' });
    expect(await Llamada.findByPk(llamada.id)).toMatchObject({ estado: 'rechazada', duracion_seg: 0 });
    expect(await LlamadaParticipante.findOne({ where: { llamada_id: llamada.id, usuario_id: beto.id } })).toMatchObject({ estado: 'rechazo' });
  });

  it('no se puede llamar con un bloqueo de por medio ni a una cuenta privada que no te sigue', async () => {
    const [ana, beto, carla] = await Promise.all([crearUsuario('ana'), crearUsuario('beto'), crearUsuario('carla')]);
    const [sAna, sBeto] = await Promise.all([cliente(ana), cliente(beto)]);
    await Bloqueo.create({ bloqueador_id: ana.id, bloqueado_id: beto.id });

    expect(await pedir(sAna, E.iniciar, { usuario_id: beto.id })).toMatchObject({ ok: false, codigo: 'prohibido' });
    expect(await pedir(sBeto, E.iniciar, { usuario_id: ana.id })).toMatchObject({ ok: false, codigo: 'prohibido' });
    expect(await pedir(sAna, E.iniciar, { usuario_id: ana.id })).toMatchObject({ ok: false, codigo: 'invalido' });
    expect(await pedir(sAna, E.iniciar, { usuario_id: 9999 })).toMatchObject({ ok: false, codigo: 'no_encontrado' });

    await Usuario.update({ cuenta_privada: true }, { where: { id: carla.id } });
    expect(await pedir(sAna, E.iniciar, { usuario_id: carla.id })).toMatchObject({ ok: false, codigo: 'prohibido' });
    await Seguidor.create({ seguidor_id: ana.id, siguiendo_id: carla.id, estado: 'aceptado' });
    expect(await pedir(sAna, E.iniciar, { usuario_id: carla.id })).toMatchObject({ ok: true });
  });

  it('valida la sesión y los datos', async () => {
    const ana = await crearUsuario('ana');
    const [anonimo, sAna] = await Promise.all([cliente(), cliente(ana)]);
    expect(await pedir(anonimo, E.iniciar, { usuario_id: ana.id })).toMatchObject({ ok: false, codigo: 'sin_sesion' });
    expect(await pedir(sAna, E.iniciar, { usuario_id: 2, grupo_id: 3 })).toMatchObject({ ok: false, codigo: 'invalido' });
    expect(await pedir(sAna, E.aceptar, { llamada_id: 777 })).toMatchObject({ ok: false, codigo: 'no_encontrado' });
  });

  it('sin respuesta en el tiempo límite: perdida, notificación y push si no estaba conectado', async () => {
    const [ana, beto] = await Promise.all([crearUsuario('ana'), crearUsuario('beto')]);
    const avisar = vi.spyOn(dispositivoService, 'avisar');
    const sAna = await cliente(ana);

    const terminada = esperar<{ estado: string; motivo: string }>(sAna, E.terminada, 1500);
    const { llamada } = await pedirOk<{ llamada: LlamadaEnVivo }>(sAna, E.iniciar, { usuario_id: beto.id, tipo: 'video' });
    await pausa(80);
    expect(avisar).toHaveBeenCalledWith(beto.id, {
      titulo: 'Videollamada entrante',
      cuerpo: 'Usuario ana te está llamando',
      datos: { tipo: 'llamada', llamada_id: String(llamada.id), llamada_tipo: 'video' },
    });

    // Si abre la app mientras suena (p. ej. desde la push), le llega la llamada al conectarse
    const sBeto = conectar(url, { auth: { token: beto.token }, transports: ['websocket'], forceNew: true, autoConnect: false });
    abiertos.push(sBeto);
    const alConectar = esperar<{ llamada: LlamadaEnVivo }>(sBeto, E.entrante);
    sBeto.connect();
    expect((await alConectar)?.llamada.id).toBe(llamada.id);

    expect(await terminada).toMatchObject({ estado: 'perdida', motivo: 'sin_respuesta' });
    expect(await Llamada.findByPk(llamada.id)).toMatchObject({ estado: 'perdida' });
    const notificacion = await Notificacion.findOne({ where: { usuario_id: beto.id, tipo: 'llamada_perdida' } });
    expect(notificacion).toMatchObject({ de_usuario_id: ana.id, entidad_tipo: 'usuario', entidad_id: ana.id });

    const perdidas = await api().get('/api/llamadas?filtro=perdidas').set(bearer(beto));
    expect(perdidas.body.meta.total).toBe(1);
    expect(perdidas.body.data[0]).toMatchObject({ mi_estado: 'perdida', direccion: 'entrante' });
    expect((await api().get('/api/llamadas?filtro=perdidas').set(bearer(ana))).body.meta.total).toBe(0);
  });

  it('colgar antes de que contesten deja la llamada perdida y deja de sonar', async () => {
    const [ana, beto] = await Promise.all([crearUsuario('ana'), crearUsuario('beto')]);
    const [sAna, sBeto] = await Promise.all([cliente(ana), cliente(beto)]);
    const { llamada } = await pedirOk<{ llamada: LlamadaEnVivo }>(sAna, E.iniciar, { usuario_id: beto.id });
    await pausa(50);
    const cancelada = esperar(sBeto, E.cancelada);
    await pedirOk(sAna, E.colgar, { llamada_id: llamada.id });
    expect(await cancelada).toEqual({ llamada_id: llamada.id, motivo: 'colgo' });
    expect(await Llamada.findByPk(llamada.id)).toMatchObject({ estado: 'perdida' });
    expect(await Notificacion.count({ where: { usuario_id: beto.id, tipo: 'llamada_perdida' } })).toBe(1);
  });

  it('ocupado si ya está en otra llamada (y le queda como perdida)', async () => {
    const [ana, beto, carla] = await Promise.all([crearUsuario('ana'), crearUsuario('beto'), crearUsuario('carla')]);
    const [sAna, sBeto, sCarla] = await Promise.all([cliente(ana), cliente(beto), cliente(carla)]);
    await llamadaEnCurso(ana, beto, sAna, sBeto);

    expect(await pedir(sCarla, E.iniciar, { usuario_id: beto.id })).toMatchObject({ ok: false, codigo: 'ocupado', error: 'Usuario beto está en otra llamada' });
    expect(await pedir(sAna, E.iniciar, { usuario_id: carla.id })).toMatchObject({ ok: false, codigo: 'invalido', error: 'Ya estás en una llamada' });
    const notificacion = await Notificacion.findOne({ where: { usuario_id: beto.id, tipo: 'llamada_perdida' } });
    expect(notificacion?.mensaje).toContain('mientras estabas en otra llamada');
    expect(await Llamada.count({ where: { iniciador_id: carla.id, estado: 'perdida' } })).toBe(1);
  });

  it('contestar en un dispositivo deja de sonar en los otros', async () => {
    const [ana, beto] = await Promise.all([crearUsuario('ana'), crearUsuario('beto')]);
    const [sAna, telefono, compu] = await Promise.all([cliente(ana), cliente(beto), cliente(beto)]);
    const { llamada } = await pedirOk<{ llamada: LlamadaEnVivo }>(sAna, E.iniciar, { usuario_id: beto.id });
    await pausa(50);
    const enCompu = esperar(compu, E.cancelada);
    await pedirOk(telefono, E.aceptar, { llamada_id: llamada.id });
    expect(await enCompu).toEqual({ llamada_id: llamada.id, motivo: 'contestada_en_otro_dispositivo' });
    expect(await pedir(compu, E.aceptar, { llamada_id: llamada.id })).toMatchObject({ ok: false, codigo: 'invalido' });
    // La señal solo la manda el socket que está dentro
    expect(await pedir(compu, E.senal, { llamada_id: llamada.id, para: ana.id, tipo: 'oferta', sdp: 'x' })).toMatchObject({ ok: false, codigo: 'prohibido' });
  });

  it('si se cae el socket, espera a que retome; si no vuelve, la llamada termina', async () => {
    senalizacionLlamadas.ajustar({ graciaMs: 300 });
    const [ana, beto] = await Promise.all([crearUsuario('ana'), crearUsuario('beto')]);
    const [sAna, sBeto] = await Promise.all([cliente(ana), cliente(beto)]);
    const llamadaId = await llamadaEnCurso(ana, beto, sAna, sBeto);

    const reconectando = esperar(sAna, E.reconectando);
    sBeto.disconnect();
    expect(await reconectando).toEqual({ llamada_id: llamadaId, usuario_id: beto.id });

    const otraVez = await cliente(beto);
    const reconectado = esperar(sAna, E.reconectado);
    const entrada = await pedirOk<EntradaLlamada>(otraVez, E.retomar, { llamada_id: llamadaId });
    expect(entrada.presentes.map((u) => u.id)).toEqual([ana.id]);
    expect(await reconectado).toEqual({ llamada_id: llamadaId, usuario_id: beto.id });
    await pausa(400);
    expect(await pedir(otraVez, E.senal, { llamada_id: llamadaId, para: ana.id, tipo: 'oferta', sdp: 'reinicio ICE' })).toMatchObject({ ok: true });

    const terminada = esperar(sAna, E.terminada, 1000);
    otraVez.disconnect();
    expect(await terminada).toMatchObject({ estado: 'terminada', motivo: 'desconexion' });
  });
});

describe('Llamadas de grupo (malla)', () => {
  async function grupoCon(creador: UsuarioPrueba, miembros: UsuarioPrueba[]): Promise<Grupo> {
    const grupo = await Grupo.create({ nombre: 'Equipo', creador_id: creador.id });
    await GrupoMiembro.create({ grupo_id: grupo.id, usuario_id: creador.id, rol: 'admin', estado: 'activo' });
    for (const m of miembros) await GrupoMiembro.create({ grupo_id: grupo.id, usuario_id: m.id, rol: 'miembro', estado: 'activo' });
    return grupo;
  }

  it('suena a los miembros, quien entra recibe a los presentes y negocia con cada uno', async () => {
    senalizacionLlamadas.ajustar({ tiempoLimiteMs: 1200 });
    const [ana, beto, carla, dani, externo] = await Promise.all(['ana', 'beto', 'carla', 'dani', 'externo'].map((n) => crearUsuario(n)));
    const grupo = await grupoCon(ana, [beto, carla, dani]);
    const [sAna, sBeto, sCarla, sDani, sExterno] = await Promise.all([ana, beto, carla, dani, externo].map((u) => cliente(u)));

    expect(await pedir(sExterno, E.iniciar, { grupo_id: grupo.id })).toMatchObject({ ok: false, codigo: 'prohibido' });

    const nadaExterno = esperar(sExterno, E.entrante, 300);
    const paraDani = esperar<{ llamada: LlamadaEnVivo }>(sDani, E.entrante);
    const { llamada } = await pedirOk<{ llamada: LlamadaEnVivo }>(sAna, E.iniciar, { grupo_id: grupo.id, tipo: 'video' });
    expect(llamada.grupo).toMatchObject({ id: grupo.id, nombre: 'Equipo' });
    expect(llamada.sonando.sort()).toEqual([beto.id, carla.id, dani.id].sort());
    expect((await paraDani)?.llamada.id).toBe(llamada.id);
    expect(await nadaExterno).toBeNull();
    // Ya hay una en curso: no se puede empezar otra en el mismo grupo
    expect(await pedir(sBeto, E.iniciar, { grupo_id: grupo.id })).toMatchObject({ ok: false, codigo: 'conflicto', datos: { llamada_id: llamada.id } });

    await pedirOk(sBeto, E.aceptar, { llamada_id: llamada.id });
    const unidoAna = esperar<{ usuario: { id: number } }>(sAna, E.unido);
    const unidoBeto = esperar<{ usuario: { id: number } }>(sBeto, E.unido);
    const entrada = await pedirOk<EntradaLlamada>(sCarla, E.aceptar, { llamada_id: llamada.id });
    expect(entrada.presentes.map((u) => u.id).sort()).toEqual([ana.id, beto.id].sort());
    expect((await unidoAna)?.usuario.id).toBe(carla.id);
    expect((await unidoBeto)?.usuario.id).toBe(carla.id);

    // Carla le manda la oferta a Beto: le llega solo a Beto
    const aBeto = esperar(sBeto, E.senal);
    const aAna = esperar(sAna, E.senal, 300);
    await pedirOk(sCarla, E.senal, { llamada_id: llamada.id, para: beto.id, tipo: 'oferta', sdp: 'oferta carla' });
    expect(await aBeto).toMatchObject({ de: carla.id, sdp: 'oferta carla' });
    expect(await aAna).toBeNull();

    // Un externo no puede entrar ni ver la llamada del grupo
    expect(await pedir(sExterno, E.aceptar, { llamada_id: llamada.id })).toMatchObject({ ok: false, codigo: 'prohibido' });
    const activa = await api().get(`/api/llamadas/grupos/${grupo.id}/activa`).set(bearer(ana));
    expect(activa.body.data).toMatchObject({ id: llamada.id, estado: 'en_curso', sonando: [dani.id] });
    expect(activa.body.data.presentes).toHaveLength(3);
    expect((await api().get(`/api/llamadas/grupos/${grupo.id}/activa`).set(bearer(externo))).status).toBe(403);

    // Dani no contestó: deja de sonarle y le queda perdida, pero la llamada sigue
    const canceladaDani = esperar(sDani, E.cancelada, 2000);
    expect(await canceladaDani).toEqual({ llamada_id: llamada.id, motivo: 'sin_respuesta' });
    expect(await Notificacion.findOne({ where: { usuario_id: dani.id, tipo: 'llamada_perdida' } })).toMatchObject({ entidad_tipo: 'grupo', entidad_id: grupo.id });
    expect(await Llamada.findByPk(llamada.id)).toMatchObject({ estado: 'en_curso', max_participantes: 3 });

    // Dani puede entrar tarde (es miembro)
    const tarde = await pedirOk<EntradaLlamada>(sDani, E.aceptar, { llamada_id: llamada.id });
    expect(tarde.presentes).toHaveLength(3);

    // Van saliendo: la llamada termina cuando queda una sola persona
    const salioAna = esperar(sBeto, E.salio);
    await pedirOk(sAna, E.colgar, { llamada_id: llamada.id });
    expect(await salioAna).toEqual({ llamada_id: llamada.id, usuario_id: ana.id });
    await pedirOk(sBeto, E.colgar, { llamada_id: llamada.id });
    const terminada = esperar(sCarla, E.terminada);
    await pedirOk(sDani, E.colgar, { llamada_id: llamada.id });
    expect(await terminada).toMatchObject({ estado: 'terminada' });
    expect(await Llamada.findByPk(llamada.id)).toMatchObject({ estado: 'terminada', max_participantes: 4 });

    const historialDani = await api().get('/api/llamadas').set(bearer(dani));
    expect(historialDani.body.data[0]).toMatchObject({ grupo: { id: grupo.id }, otro: null, mi_estado: 'salio' });
  });

  it('respeta el máximo de personas de la malla', async () => {
    senalizacionLlamadas.ajustar({ maximoParticipantes: 2 });
    const [ana, beto, carla] = await Promise.all([crearUsuario('ana'), crearUsuario('beto'), crearUsuario('carla')]);
    const grupo = await grupoCon(ana, [beto, carla]);
    const [sAna, sBeto, sCarla] = await Promise.all([cliente(ana), cliente(beto), cliente(carla)]);
    const { llamada } = await pedirOk<{ llamada: LlamadaEnVivo }>(sAna, E.iniciar, { grupo_id: grupo.id });
    await pedirOk(sBeto, E.aceptar, { llamada_id: llamada.id });
    expect(await pedir(sCarla, E.aceptar, { llamada_id: llamada.id })).toMatchObject({ ok: false, codigo: 'llena' });
  });

  it('no le suena a quien bloqueó a quien llama', async () => {
    const [ana, beto, carla] = await Promise.all([crearUsuario('ana'), crearUsuario('beto'), crearUsuario('carla')]);
    const grupo = await grupoCon(ana, [beto, carla]);
    await Bloqueo.create({ bloqueador_id: carla.id, bloqueado_id: ana.id });
    const [sAna, sCarla] = await Promise.all([cliente(ana), cliente(carla)]);
    const nada = esperar(sCarla, E.entrante, 300);
    const { llamada } = await pedirOk<{ llamada: LlamadaEnVivo }>(sAna, E.iniciar, { grupo_id: grupo.id });
    expect(llamada.sonando).toEqual([beto.id]);
    expect(await nada).toBeNull();
    expect(await pedir(sCarla, E.aceptar, { llamada_id: llamada.id })).toMatchObject({ ok: false, codigo: 'prohibido' });
  });
});

describe('REST', () => {
  it('GET /ice da STUN y, con variables, TURN', async () => {
    const ana = await crearUsuario('ana');
    const res = await api().get('/api/llamadas/ice').set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.data.ice_servers[0].urls).toContain('stun:stun.l.google.com:19302');
    expect((await api().get('/api/llamadas/ice')).status).toBe(401);

    expect(configuracionIce({ TURN_URL: 'turn:turn.ejemplo.com:3478, turns:turn.ejemplo.com:5349', TURN_USUARIO: 'u', TURN_CLAVE: 'c' })).toEqual({
      turn: true,
      ice_servers: [
        { urls: expect.arrayContaining(['stun:stun.l.google.com:19302']) },
        { urls: ['turn:turn.ejemplo.com:3478', 'turns:turn.ejemplo.com:5349'], username: 'u', credential: 'c' },
      ],
    });
    expect(configuracionIce({ TURN_URL: 'http://no-es-turn' }).turn).toBe(false);
  });

  it('cerrarHuerfanas deja cerradas las que quedaron abiertas al reiniciar', async () => {
    const [ana, beto] = await Promise.all([crearUsuario('ana'), crearUsuario('beto')]);
    await Llamada.create({ iniciador_id: ana.id, destinatario_id: beto.id, estado: 'sonando' });
    await Llamada.create({ iniciador_id: ana.id, destinatario_id: beto.id, estado: 'en_curso', inicio: new Date() });
    expect(await llamadaService.cerrarHuerfanas()).toBe(2);
    expect(await Llamada.count({ where: { estado: ['sonando', 'en_curso'] } })).toBe(0);
  });
});
