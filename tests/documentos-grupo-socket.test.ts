import { vi } from 'vitest';

// Guardado y versiones rápidos para no esperar 5 s ni 10 min (antes de importar el módulo)
vi.hoisted(() => {
  process.env.DOCUMENTOS_GUARDADO_MS = '120';
  process.env.DOCUMENTOS_MINUTOS_VERSION = '0.002';
});

import http from 'http';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type { AddressInfo } from 'net';
import { io as conectar, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { crearApp } from '../src/app';
import { DocumentoColaborativo, DocumentoVersion, Grupo, GrupoMiembro } from '../src/infrastructure/database/models';
import { SocketGateway, type PermisosDeSalas } from '../src/infrastructure/realtime/RealtimeGateway';
import { tokenService } from '../src/infrastructure/security/TokenService';
import { sesionesDocumentos } from '../src/modules/documentos-grupo/documento-almacen';
import { documentoColaborativoRoutes } from '../src/modules/documentos-grupo/documento-colaborativo.routes';
import { manejadorDocumentos, type RespuestaEntrar } from '../src/modules/documentos-grupo/documento-colaborativo.socket';
import { EVENTOS_DOCUMENTO } from '../src/modules/documentos-grupo/documento-sesiones';
import { CAMPO_CONTENIDO, docDesde, textoPlano } from '../src/modules/documentos-grupo/documento-yjs';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

const sinSalas: PermisosDeSalas = {
  puedeEntrarAChat: async () => false,
  puedeEntrarAGrupo: async () => false,
  puedeEntrarATablero: async () => false,
};

let server: http.Server;
let url: string;
const abiertos: Socket[] = [];
const URL = '/api/documentos-colaborativos';

beforeAll(async () => {
  usarModulos({ '/documentos-colaborativos': documentoColaborativoRoutes });
  server = http.createServer(crearApp());
  const gateway = new SocketGateway(tokenService).usar(manejadorDocumentos);
  gateway.adjuntar(server, sinSalas);
  await new Promise<void>((ok) => server.listen(0, ok));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(reiniciarBD);
afterEach(async () => {
  abiertos.splice(0).forEach((s) => s.disconnect());
  await sesionesDocumentos.cerrarTodas();
});

/** Lo que hace el proveedor Yjs del frontend, sobre un socket de Node. */
class ClienteYjs {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly cerrados: string[] = [];
  readonly guardados: number[] = [];
  readonly titulos: string[] = [];

  constructor(
    readonly socket: Socket,
    readonly documentoId: number,
  ) {
    socket.on(EVENTOS_DOCUMENTO.sync, ({ documento_id, mensaje }: { documento_id: number; mensaje: Uint8Array }) => {
      if (documento_id !== documentoId) return;
      const encoder = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoding.createDecoder(new Uint8Array(mensaje)), encoder, this.doc, 'servidor');
      if (encoding.length(encoder) > 0) socket.emit(EVENTOS_DOCUMENTO.sync, { documento_id: documentoId, mensaje: encoding.toUint8Array(encoder) });
    });
    socket.on(EVENTOS_DOCUMENTO.awareness, ({ documento_id, actualizacion }: { documento_id: number; actualizacion: Uint8Array }) => {
      if (documento_id === documentoId) awarenessProtocol.applyAwarenessUpdate(this.awareness, new Uint8Array(actualizacion), 'servidor');
    });
    socket.on(EVENTOS_DOCUMENTO.cerrado, ({ motivo }: { motivo: string }) => this.cerrados.push(motivo));
    socket.on(EVENTOS_DOCUMENTO.guardado, ({ ultimo_editor_id }: { ultimo_editor_id: number }) => this.guardados.push(ultimo_editor_id));
    socket.on(EVENTOS_DOCUMENTO.titulo, ({ titulo }: { titulo: string }) => this.titulos.push(titulo));

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'servidor') return;
      const encoder = encoding.createEncoder();
      syncProtocol.writeUpdate(encoder, update);
      socket.emit(EVENTOS_DOCUMENTO.sync, { documento_id: documentoId, mensaje: encoding.toUint8Array(encoder) });
    });
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === 'servidor') return;
      const actualizacion = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]);
      socket.emit(EVENTOS_DOCUMENTO.awareness, { documento_id: documentoId, actualizacion });
    });
  }

  async entrar(): Promise<RespuestaEntrar> {
    const respuesta = (await this.socket.timeout(3000).emitWithAck(EVENTOS_DOCUMENTO.entrar, { documento_id: this.documentoId })) as RespuestaEntrar;
    if (respuesta.ok) {
      const encoder = encoding.createEncoder();
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this.socket.emit(EVENTOS_DOCUMENTO.sync, { documento_id: this.documentoId, mensaje: encoding.toUint8Array(encoder) });
    }
    return respuesta;
  }

  escribir(texto: string): void {
    const parrafo = new Y.XmlElement('paragraph');
    parrafo.insert(0, [new Y.XmlText(texto)]);
    const fragmento = this.doc.getXmlFragment(CAMPO_CONTENIDO);
    fragmento.insert(fragmento.length, [parrafo]);
  }

  texto(): string {
    return textoPlano(this.doc);
  }

  destruir(): void {
    this.awareness.destroy();
    this.doc.destroy();
  }
}

function cliente(usuario?: UsuarioPrueba): Promise<Socket> {
  const socket = conectar(url, { auth: usuario ? { token: usuario.token } : {}, transports: ['websocket'], forceNew: true });
  abiertos.push(socket);
  return new Promise((ok, mal) => {
    socket.on('connect', () => ok(socket));
    socket.on('connect_error', mal);
  });
}

async function editor(usuario: UsuarioPrueba, documentoId: number): Promise<ClienteYjs> {
  return new ClienteYjs(await cliente(usuario), documentoId);
}

/** Espera hasta que la condición se cumpla (o falla a los `ms`). */
async function esperarQue(condicion: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const limite = Date.now() + ms;
  while (!(await condicion())) {
    if (Date.now() > limite) throw new Error('No se cumplió a tiempo');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Escenario {
  ana: UsuarioPrueba;
  beto: UsuarioPrueba;
  dani: UsuarioPrueba;
  documentoId: number;
}

/** Documento del grupo "Club" (ana admin, beto miembro); dani es de fuera. */
async function escenario(): Promise<Escenario> {
  const [ana, beto, dani] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('dani')];
  const grupo = await Grupo.create({ nombre: 'Club', creador_id: ana.id });
  await GrupoMiembro.bulkCreate([
    { grupo_id: grupo.id, usuario_id: ana.id, rol: 'admin', estado: 'activo' },
    { grupo_id: grupo.id, usuario_id: beto.id, rol: 'miembro', estado: 'activo' },
  ]);
  const doc = await DocumentoColaborativo.create({ titulo: 'Acta', grupo_id: grupo.id, propietario_id: ana.id });
  return { ana, beto, dani, documentoId: doc.id };
}

describe('documentos en vivo: entrar', () => {
  it('valida sesión, permiso, existencia y papelera', async () => {
    const { ana, dani, documentoId } = await escenario();
    expect(await new ClienteYjs(await cliente(), documentoId).entrar()).toMatchObject({ ok: false, estado: 401 });
    expect(await (await editor(dani, documentoId)).entrar()).toMatchObject({ ok: false, estado: 403 });
    expect(await (await editor(ana, 999)).entrar()).toMatchObject({ ok: false, estado: 404 });
    expect(await (await editor(ana, 0)).entrar()).toMatchObject({ ok: false, estado: 400 });

    await DocumentoColaborativo.update({ en_papelera: true }, { where: { id: documentoId } });
    expect(await (await editor(ana, documentoId)).entrar()).toMatchObject({ ok: false, estado: 409 });
  });
});

describe('documentos en vivo: sincronización Yjs', () => {
  it('dos clientes editan a la vez y ven los cambios del otro; quien llega después recibe todo', async () => {
    const { ana, beto, documentoId } = await escenario();
    const deAna = await editor(ana, documentoId);
    const deBeto = await editor(beto, documentoId);
    expect(await deAna.entrar()).toEqual({ ok: true, documento_id: documentoId, puede_editar: true });
    expect(await deBeto.entrar()).toMatchObject({ ok: true, puede_editar: true });

    deAna.escribir('Hola desde Ana');
    await esperarQue(() => deBeto.texto() === 'Hola desde Ana');
    deBeto.escribir('Respuesta de Beto');
    await esperarQue(() => deAna.texto() === 'Hola desde Ana\nRespuesta de Beto');

    const tarde = await editor(ana, documentoId);
    await tarde.entrar();
    await esperarQue(() => tarde.texto() === 'Hola desde Ana\nRespuesta de Beto');
  });

  it('awareness: cada uno ve quién está y desaparece al salir', async () => {
    const { ana, beto, documentoId } = await escenario();
    const deAna = await editor(ana, documentoId);
    const deBeto = await editor(beto, documentoId);
    await deAna.entrar();
    await deBeto.entrar();

    deAna.awareness.setLocalStateField('usuario', { id: ana.id, nombre: 'Ana' });
    await esperarQue(() => deBeto.awareness.getStates().has(deAna.doc.clientID));
    expect(deBeto.awareness.getStates().get(deAna.doc.clientID)).toMatchObject({ usuario: { nombre: 'Ana' } });

    // Quien entra después recibe los estados que ya había
    const tercero = await editor(beto, documentoId);
    await tercero.entrar();
    await esperarQue(() => tercero.awareness.getStates().has(deAna.doc.clientID));

    deAna.socket.emit(EVENTOS_DOCUMENTO.salir, { documento_id: documentoId });
    await esperarQue(() => !deBeto.awareness.getStates().has(deAna.doc.clientID));
  });

  it('quien solo puede leer recibe los cambios pero los suyos se ignoran', async () => {
    const { ana, beto, documentoId } = await escenario();
    const personal = await DocumentoColaborativo.create({ titulo: 'Diario', propietario_id: ana.id });
    await api().put(`${URL}/${personal.id}/permisos`).set(bearer(ana)).send({ usuario_id: beto.id, permiso: 'ver' });
    expect(documentoId).toBeGreaterThan(0);

    const deAna = await editor(ana, personal.id);
    const lector = await editor(beto, personal.id);
    await deAna.entrar();
    expect(await lector.entrar()).toMatchObject({ ok: true, puede_editar: false });

    deAna.escribir('Solo Ana escribe');
    await esperarQue(() => lector.texto() === 'Solo Ana escribe');
    lector.escribir('intento de Beto');
    await pausa(250);
    expect(deAna.texto()).toBe('Solo Ana escribe');

    // Al darle permiso de editar se le avisa (el editor del navegador se vuelve editable) y sus cambios ya cuentan
    const avisado = new Promise((ok) => lector.socket.once(EVENTOS_DOCUMENTO.acceso, ok));
    await api().put(`${URL}/${personal.id}/permisos`).set(bearer(ana)).send({ usuario_id: beto.id, permiso: 'editar' });
    expect(await avisado).toEqual({ documento_id: personal.id, puede_editar: true });
    const editorBeto = await editor(beto, personal.id);
    expect(await editorBeto.entrar()).toMatchObject({ ok: true, puede_editar: true });
    await esperarQue(() => editorBeto.texto() === 'Solo Ana escribe');
    editorBeto.escribir('ahora sí');
    await esperarQue(() => deAna.texto() === 'Solo Ana escribe\nahora sí');

    // Al quitarle el acceso se le saca del documento
    await api().delete(`${URL}/${personal.id}/permisos/${beto.id}`).set(bearer(ana));
    await esperarQue(() => lector.cerrados.includes('sin_acceso'));
  });
});

describe('documentos en vivo: persistencia y versiones', () => {
  it('guarda en diferido el estado y el texto con su último editor, y deja versión automática al salir', async () => {
    const { ana, beto, documentoId } = await escenario();
    const deAna = await editor(ana, documentoId);
    const deBeto = await editor(beto, documentoId);
    await deAna.entrar();
    await deBeto.entrar();

    deBeto.escribir('Acuerdo 1');
    await esperarQue(async () => (await DocumentoColaborativo.findByPk(documentoId))?.texto_plano === 'Acuerdo 1');
    await esperarQue(() => deAna.guardados.includes(beto.id));
    const guardado = await DocumentoColaborativo.findByPk(documentoId);
    expect(guardado?.toJSON()).toMatchObject({ ultimo_editor_id: beto.id, resumen: 'Acuerdo 1' });
    expect(textoPlano(docDesde(guardado?.estado_yjs))).toBe('Acuerdo 1');

    // Mientras está abierto, REST ya ve quién edita
    const detalle = await api().get(`${URL}/${documentoId}`).set(bearer(ana));
    expect(detalle.body.data.editando_ahora.sort()).toEqual([ana.id, beto.id].sort());

    deAna.escribir('Acuerdo 2');
    await pausa(50);
    deAna.socket.disconnect();
    deBeto.socket.disconnect();
    await esperarQue(async () => (await DocumentoColaborativo.findByPk(documentoId))?.texto_plano === 'Acuerdo 1\nAcuerdo 2');
    await esperarQue(async () => (await DocumentoVersion.count({ where: { documento_id: documentoId, tipo: 'automatica' } })) > 0);

    // Al volver a abrirlo se carga lo guardado
    const otraVez = await editor(beto, documentoId);
    await otraVez.entrar();
    await esperarQue(() => otraVez.texto() === 'Acuerdo 1\nAcuerdo 2');
  });

  it('restaurar una versión llega en vivo a quien edita, y la versión manual incluye lo no guardado', async () => {
    const { ana, beto, documentoId } = await escenario();
    const deBeto = await editor(beto, documentoId);
    await deBeto.entrar();
    deBeto.escribir('Versión buena');

    // Aún no se guardó, pero la versión manual toma el estado en vivo
    const version = await api().post(`${URL}/${documentoId}/versiones`).set(bearer(ana)).send({ nombre: 'Buena' });
    expect(version.body.data).toMatchObject({ texto_plano: 'Versión buena' });

    deBeto.escribir('se arruinó');
    await esperarQue(async () => (await DocumentoColaborativo.findByPk(documentoId))?.texto_plano.includes('se arruinó') ?? false);

    const restaurada = await api().post(`${URL}/${documentoId}/versiones/${version.body.data.id}/restaurar`).set(bearer(ana));
    expect(restaurada.status).toBe(200);
    await esperarQue(() => deBeto.texto() === 'Versión buena');
    expect((await DocumentoColaborativo.findByPk(documentoId))?.texto_plano).toBe('Versión buena');
  });

  it('renombrar avisa en vivo; mandar a la papelera saca a todos guardando lo pendiente', async () => {
    const { ana, beto, documentoId } = await escenario();
    const deBeto = await editor(beto, documentoId);
    await deBeto.entrar();
    await api().patch(`${URL}/${documentoId}`).set(bearer(ana)).send({ titulo: 'Acta final' });
    await esperarQue(() => deBeto.titulos.includes('Acta final'));

    deBeto.escribir('último cambio');
    await pausa(30);
    expect((await api().post(`${URL}/${documentoId}/papelera`).set(bearer(ana))).status).toBe(200);
    await esperarQue(() => deBeto.cerrados.includes('papelera'));
    expect((await DocumentoColaborativo.findByPk(documentoId))?.texto_plano).toBe('último cambio');

    // Sus mensajes ya no llegan a ninguna parte
    deBeto.escribir('después');
    await pausa(150);
    expect((await DocumentoColaborativo.findByPk(documentoId))?.texto_plano).toBe('último cambio');
  });
});
