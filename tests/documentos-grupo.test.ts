import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  Bloqueo,
  DocumentoColaborativo,
  DocumentoPermiso,
  DocumentoVersion,
  Grupo,
  GrupoMiembro,
  Notificacion,
} from '../src/infrastructure/database/models';
import { realtime, salas } from '../src/infrastructure/realtime/RealtimeGateway';
import { documentoColaborativoRepository } from '../src/modules/documentos-grupo/documento-colaborativo.repository';
import { documentoColaborativoRoutes } from '../src/modules/documentos-grupo/documento-colaborativo.routes';
import { EVENTO_DOCUMENTOS_GRUPO, nombreArchivo } from '../src/modules/documentos-grupo/documento-colaborativo.service';
import { CAMPO_CONTENIDO, docDesde, documentoHtml, reemplazarContenido, resumenDe, textoPlano } from '../src/modules/documentos-grupo/documento-yjs';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/documentos-colaborativos': documentoColaborativoRoutes }));
beforeEach(reiniciarBD);
afterEach(() => vi.restoreAllMocks());

const URL = '/api/documentos-colaborativos';

interface Escenario {
  grupoId: number;
  ana: UsuarioPrueba; // creadora del grupo (admin)
  beto: UsuarioPrueba; // miembro activo
  caro: UsuarioPrueba; // solicitud pendiente
  dani: UsuarioPrueba; // no es miembro
}

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

const crear = (de: UsuarioPrueba, cuerpo: object) => api().post(URL).set(bearer(de)).send(cuerpo);
const ver = (de: UsuarioPrueba, id: number) => api().get(`${URL}/${id}`).set(bearer(de));

/** Contenido de TipTap como lo guarda y-prosemirror: elementos con atributos y textos con marcas. */
function docDePrueba(): Y.Doc {
  const doc = new Y.Doc();
  const titulo = new Y.XmlElement('heading');
  titulo.setAttribute('level', '2');
  titulo.insert(0, [new Y.XmlText('Plan <2026>')]);

  const parrafo = new Y.XmlElement('paragraph');
  const texto = new Y.XmlText();
  texto.insert(0, 'Hola ');
  texto.insert(5, 'mundo', { bold: {} });
  texto.insert(10, ' y enlace', { link: { href: 'https://trino.app' } });
  parrafo.insert(0, [texto]);

  const lista = new Y.XmlElement('bulletList');
  const item = new Y.XmlElement('listItem');
  const enItem = new Y.XmlElement('paragraph');
  enItem.insert(0, [new Y.XmlText('uno')]);
  item.insert(0, [enItem]);
  lista.insert(0, [item]);

  const tareas = new Y.XmlElement('taskList');
  const tarea = new Y.XmlElement('taskItem');
  tarea.setAttribute('checked', true as unknown as string);
  const enTarea = new Y.XmlElement('paragraph');
  enTarea.insert(0, [new Y.XmlText('listo')]);
  tarea.insert(0, [enTarea]);
  tareas.insert(0, [tarea]);

  const peligro = new Y.XmlElement('paragraph');
  peligro.insert(0, [new Y.XmlText('<script>alert(1)</script>')]);

  doc.getXmlFragment(CAMPO_CONTENIDO).insert(0, [titulo, parrafo, lista, tareas, peligro]);
  return doc;
}

function docConTexto(texto: string): Y.Doc {
  const doc = new Y.Doc();
  const parrafo = new Y.XmlElement('paragraph');
  parrafo.insert(0, [new Y.XmlText(texto)]);
  doc.getXmlFragment(CAMPO_CONTENIDO).insert(0, [parrafo]);
  return doc;
}

async function guardarContenido(documentoId: number, doc: Y.Doc, editorId: number): Promise<void> {
  const texto = textoPlano(doc);
  await documentoColaborativoRepository.guardarEstado(documentoId, {
    estado: Y.encodeStateAsUpdate(doc),
    texto,
    resumen: resumenDe(texto),
    editorId,
    fecha: new Date(),
  });
}

describe('documentos colaborativos: contenido Yjs', () => {
  it('saca texto plano y HTML (con marcas, listas, tareas y escapando lo peligroso)', () => {
    const doc = docDePrueba();
    expect(textoPlano(doc)).toBe('Plan <2026>\nHola mundo y enlace\n• uno\n[x] listo\n<script>alert(1)</script>');

    const html = documentoHtml(doc, 'Mi <doc>');
    expect(html).toContain('<title>Mi &lt;doc&gt;</title>');
    expect(html).toContain('<h2>Plan &lt;2026&gt;</h2>');
    expect(html).toContain('<p>Hola <strong>mundo</strong><a href="https://trino.app"> y enlace</a></p>');
    expect(html).toContain('<ul><li><p>uno</p></li></ul>');
    expect(html).toContain('<li><input type="checkbox" disabled checked> <p>listo</p></li>');
    expect(html).not.toContain('<script>');
  });

  it('reemplazar el contenido copia el de otra versión en una sola actualización', () => {
    const destino = docConTexto('nuevo');
    const actualizaciones: Uint8Array[] = [];
    destino.on('update', (u: Uint8Array) => actualizaciones.push(u));
    reemplazarContenido(destino, docConTexto('viejo'), 'prueba');
    expect(textoPlano(destino)).toBe('viejo');
    expect(actualizaciones).toHaveLength(1);
    expect(textoPlano(docDesde(Y.encodeStateAsUpdate(destino)))).toBe('viejo');
  });

  it('el resumen y el nombre de archivo se limpian', () => {
    expect(resumenDe('  a\n\n b ')).toBe('a b');
    expect(resumenDe('x'.repeat(400))).toHaveLength(280);
    expect(nombreArchivo('Plan 2026: borrador/final')).toBe('Plan 2026 borrador final');
    expect(nombreArchivo('???')).toBe('documento');
  });
});

describe('documentos del grupo: permisos', () => {
  it('solo miembros activos crean, listan y abren; grupo inexistente 404; sin sesión 401', async () => {
    const { grupoId, beto, caro, dani } = await escenario();
    expect((await crear(dani, { grupo_id: grupoId })).status).toBe(403);
    expect((await crear(caro, { grupo_id: grupoId })).status).toBe(403);
    expect((await crear(beto, { grupo_id: 999 })).status).toBe(404);
    expect((await api().post(URL).send({ titulo: 'x' })).status).toBe(401);

    const creado = await crear(beto, { grupo_id: grupoId, titulo: '  Acta de la reunión ' });
    expect(creado.status).toBe(201);
    expect(creado.body.data).toMatchObject({
      titulo: 'Acta de la reunión',
      grupo_id: grupoId,
      propietario_id: beto.id,
      en_papelera: false,
      propietario: { id: beto.id, nombre_usuario: 'beto' },
      grupo: { id: grupoId, nombre: 'Club' },
      mi_acceso: { rol: 'propietario', ver: true, editar: true, administrar: true, compartir: false },
      editando_ahora: [],
    });
    expect(creado.body.data).not.toHaveProperty('estado_yjs');
    expect(creado.body.data).not.toHaveProperty('texto_plano');

    const id = creado.body.data.id;
    expect((await ver(dani, id)).status).toBe(403);
    expect((await ver(caro, id)).status).toBe(403);
    expect((await api().get(`${URL}/grupo/${grupoId}`).set(bearer(dani))).status).toBe(403);
    expect((await ver(beto, 999)).status).toBe(404);
  });

  it('sin título usa uno por defecto y avisa a la sala del grupo', async () => {
    const { grupoId, ana } = await escenario();
    const aviso = vi.spyOn(realtime, 'aSala');
    const res = await crear(ana, { grupo_id: grupoId });
    expect(res.body.data.titulo).toBe('Documento sin título');
    expect(aviso).toHaveBeenCalledWith(salas.grupo(grupoId), EVENTO_DOCUMENTOS_GRUPO, {
      grupo_id: grupoId,
      documento_id: res.body.data.id,
      accion: 'creado',
      por_usuario_id: ana.id,
    });
  });

  it('cualquier miembro edita; solo el creador o un admin/moderador manda a la papelera y borra', async () => {
    const { grupoId, ana, beto } = await escenario();
    const id = (await crear(ana, { grupo_id: grupoId, titulo: 'Reglas' })).body.data.id;

    const delMiembro = await ver(beto, id);
    expect(delMiembro.body.data.mi_acceso).toEqual({ rol: 'miembro', ver: true, editar: true, administrar: false, compartir: false });

    const renombrado = await api().patch(`${URL}/${id}`).set(bearer(beto)).send({ titulo: 'Reglas 2026' });
    expect(renombrado.status).toBe(200);
    expect(renombrado.body.data.titulo).toBe('Reglas 2026');
    expect((await api().patch(`${URL}/${id}`).set(bearer(beto)).send({ titulo: '  ' })).status).toBe(400);

    expect((await api().post(`${URL}/${id}/papelera`).set(bearer(beto))).status).toBe(403);
    expect((await api().delete(`${URL}/${id}`).set(bearer(beto))).status).toBe(403);

    // El documento de beto lo administra beto y también la admin
    const deBeto = (await crear(beto, { grupo_id: grupoId })).body.data.id;
    expect((await ver(ana, deBeto)).body.data.mi_acceso).toMatchObject({ rol: 'moderador', administrar: true });
    expect((await api().post(`${URL}/${deBeto}/papelera`).set(bearer(ana))).status).toBe(200);
  });
});

describe('documentos: listas, búsqueda y papelera', () => {
  it('lista los del grupo por fecha de cambio, busca en título y contenido, y separa la papelera', async () => {
    const { grupoId, ana, beto } = await escenario();
    const acta = (await crear(ana, { grupo_id: grupoId, titulo: 'Acta' })).body.data.id;
    const menu = (await crear(beto, { grupo_id: grupoId, titulo: 'Menú de la fiesta' })).body.data.id;
    await new Promise((r) => setTimeout(r, 15));
    await guardarContenido(acta, docConTexto('Acuerdos sobre la fiesta de fin de año'), ana.id);
    await crear(ana, { titulo: 'Personal' });

    const todos = await api().get(`${URL}/grupo/${grupoId}`).set(bearer(beto));
    expect(todos.status).toBe(200);
    expect(todos.body.data.map((d: { id: number }) => d.id)).toEqual([acta, menu]);
    expect(todos.body.data[0]).toMatchObject({ resumen: 'Acuerdos sobre la fiesta de fin de año', ultimo_editor: { id: ana.id } });
    expect(todos.body.meta).toMatchObject({ total: 2, hayMas: false });

    const fiesta = await api().get(`${URL}/grupo/${grupoId}?q=fiesta`).set(bearer(beto));
    expect(fiesta.body.data).toHaveLength(2);
    const acuerdos = await api().get(`${URL}/grupo/${grupoId}?q=acuerdos`).set(bearer(beto));
    expect(acuerdos.body.data.map((d: { id: number }) => d.id)).toEqual([acta]);

    expect((await api().post(`${URL}/${acta}/papelera`).set(bearer(ana))).body.data).toMatchObject({ en_papelera: true });
    expect((await api().get(`${URL}/grupo/${grupoId}`).set(bearer(beto))).body.data.map((d: { id: number }) => d.id)).toEqual([menu]);
    expect((await api().get(`${URL}/grupo/${grupoId}?papelera=true`).set(bearer(beto))).body.data.map((d: { id: number }) => d.id)).toEqual([acta]);

    // En la papelera no se edita
    expect((await api().patch(`${URL}/${acta}`).set(bearer(ana)).send({ titulo: 'x' })).status).toBe(409);
    expect((await api().post(`${URL}/${acta}/versiones`).set(bearer(ana)).send({})).status).toBe(409);

    const restaurado = await api().post(`${URL}/${acta}/restaurar`).set(bearer(ana));
    expect(restaurado.body.data).toMatchObject({ en_papelera: false, fecha_papelera: null });
    expect((await api().get(`${URL}/grupo/${grupoId}?papelera=1`).set(bearer(beto))).body.data).toHaveLength(0);
  });

  it('mis documentos personales no incluyen los de grupos; borrar quita versiones y permisos', async () => {
    const { grupoId, ana, beto } = await escenario();
    const propio = (await crear(ana, { titulo: 'Diario' })).body.data.id;
    await crear(ana, { grupo_id: grupoId, titulo: 'Del club' });
    const mios = await api().get(`${URL}/mios`).set(bearer(ana));
    expect(mios.body.data.map((d: { titulo: string }) => d.titulo)).toEqual(['Diario']);

    await api().put(`${URL}/${propio}/permisos`).set(bearer(ana)).send({ usuario_id: beto.id });
    await api().post(`${URL}/${propio}/versiones`).set(bearer(ana)).send({ nombre: 'v1' });
    expect((await api().delete(`${URL}/${propio}`).set(bearer(ana))).status).toBe(200);
    expect(await DocumentoColaborativo.count()).toBe(1);
    expect(await DocumentoPermiso.count()).toBe(0);
    expect(await DocumentoVersion.count()).toBe(0);
    expect((await ver(ana, propio)).status).toBe(404);
  });
});

describe('documentos personales: compartir', () => {
  it('el dueño comparte para ver o editar, avisa una vez y puede quitar el acceso', async () => {
    const { ana, beto, dani } = await escenario();
    const id = (await crear(ana, { titulo: 'Tesis' })).body.data.id;
    expect((await ver(beto, id)).status).toBe(403);

    const compartido = await api().put(`${URL}/${id}/permisos`).set(bearer(ana)).send({ usuario_id: beto.id });
    expect(compartido.status).toBe(200);
    expect(compartido.body.data).toMatchObject({ documento_id: id, usuario_id: beto.id, permiso: 'ver', usuario: { nombre_usuario: 'beto' } });
    const aviso = await Notificacion.findOne({ where: { usuario_id: beto.id, tipo: 'documento_compartido' } });
    expect(aviso?.toJSON()).toMatchObject({ de_usuario_id: ana.id, entidad_tipo: 'documento', entidad_id: id });
    expect(aviso?.mensaje).toContain('«Tesis»');

    // Lector: ve, no edita
    expect((await ver(beto, id)).body.data.mi_acceso).toEqual({ rol: 'lector', ver: true, editar: false, administrar: false, compartir: false });
    expect((await api().patch(`${URL}/${id}`).set(bearer(beto)).send({ titulo: 'Mía' })).status).toBe(403);
    expect((await api().get(`${URL}/${id}/permisos`).set(bearer(beto))).status).toBe(403);
    expect((await api().get(`${URL}/compartidos`).set(bearer(beto))).body.data.map((d: { id: number }) => d.id)).toEqual([id]);

    // Pasar a editor no repite el aviso
    await api().put(`${URL}/${id}/permisos`).set(bearer(ana)).send({ usuario_id: beto.id, permiso: 'editar' });
    expect(await Notificacion.count({ where: { usuario_id: beto.id, tipo: 'documento_compartido' } })).toBe(1);
    expect((await ver(beto, id)).body.data.mi_acceso).toMatchObject({ rol: 'editor', editar: true });
    expect((await api().patch(`${URL}/${id}`).set(bearer(beto)).send({ titulo: 'Tesis final' })).status).toBe(200);
    expect((await api().put(`${URL}/${id}/permisos`).set(bearer(beto)).send({ usuario_id: dani.id })).status).toBe(403);

    const lista = await api().get(`${URL}/${id}/permisos`).set(bearer(ana));
    expect(lista.body.data).toHaveLength(1);

    expect((await api().delete(`${URL}/${id}/permisos/${beto.id}`).set(bearer(ana))).status).toBe(200);
    expect((await ver(beto, id)).status).toBe(403);
    expect(await Notificacion.count({ where: { usuario_id: beto.id, tipo: 'documento_compartido' } })).toBe(0);
    expect((await api().delete(`${URL}/${id}/permisos/${beto.id}`).set(bearer(ana))).status).toBe(404);
  });

  it('quien recibió el documento puede dejarlo; no se comparte con uno mismo, con bloqueados ni documentos de grupo', async () => {
    const { grupoId, ana, beto, dani } = await escenario();
    const id = (await crear(ana, { titulo: 'Notas' })).body.data.id;
    await api().put(`${URL}/${id}/permisos`).set(bearer(ana)).send({ usuario_id: beto.id, permiso: 'editar' });
    expect((await api().delete(`${URL}/${id}/permisos/${beto.id}`).set(bearer(beto))).status).toBe(200);
    expect((await ver(beto, id)).status).toBe(403);

    expect((await api().put(`${URL}/${id}/permisos`).set(bearer(ana)).send({ usuario_id: ana.id })).status).toBe(400);
    expect((await api().put(`${URL}/${id}/permisos`).set(bearer(ana)).send({ usuario_id: 999 })).status).toBe(404);
    expect((await api().put(`${URL}/${id}/permisos`).set(bearer(ana)).send({ usuario_id: beto.id, permiso: 'admin' })).status).toBe(400);
    await Bloqueo.create({ bloqueador_id: dani.id, bloqueado_id: ana.id });
    expect((await api().put(`${URL}/${id}/permisos`).set(bearer(ana)).send({ usuario_id: dani.id })).status).toBe(403);

    const delGrupo = (await crear(ana, { grupo_id: grupoId })).body.data.id;
    expect((await api().put(`${URL}/${delGrupo}/permisos`).set(bearer(ana)).send({ usuario_id: dani.id })).status).toBe(400);
  });
});

describe('documentos: versiones y exportar', () => {
  it('guarda versiones manuales, las muestra y restaura dejando copia de lo anterior', async () => {
    const { grupoId, ana, beto, dani } = await escenario();
    const id = (await crear(ana, { grupo_id: grupoId, titulo: 'Plan' })).body.data.id;
    await guardarContenido(id, docConTexto('primer borrador'), ana.id);

    const v1 = await api().post(`${URL}/${id}/versiones`).set(bearer(beto)).send({ nombre: 'Borrador' });
    expect(v1.status).toBe(201);
    expect(v1.body.data).toMatchObject({ documento_id: id, tipo: 'manual', nombre: 'Borrador', autor: { id: beto.id }, texto_plano: 'primer borrador' });
    expect(v1.body.data).not.toHaveProperty('estado_yjs');

    await guardarContenido(id, docConTexto('segunda versión'), beto.id);
    const detalleV1 = await api().get(`${URL}/${id}/versiones/${v1.body.data.id}`).set(bearer(beto));
    expect(detalleV1.body.data).toMatchObject({ html: '<p>primer borrador</p>', texto_plano: 'primer borrador' });
    expect((await api().get(`${URL}/${id}/versiones/${v1.body.data.id}`).set(bearer(dani))).status).toBe(403);
    expect((await api().get(`${URL}/${id}/versiones/999`).set(bearer(beto))).status).toBe(404);

    const restaurado = await api().post(`${URL}/${id}/versiones/${v1.body.data.id}/restaurar`).set(bearer(beto));
    expect(restaurado.status).toBe(200);
    expect(restaurado.body.data).toMatchObject({ resumen: 'primer borrador', ultimo_editor: { id: beto.id } });
    const guardado = await DocumentoColaborativo.findByPk(id);
    expect(textoPlano(docDesde(guardado?.estado_yjs))).toBe('primer borrador');

    const versiones = await api().get(`${URL}/${id}/versiones`).set(bearer(ana));
    expect(versiones.body.data.map((v: { nombre: string; tipo: string }) => [v.tipo, v.nombre])).toEqual([
      ['automatica', 'Antes de restaurar'],
      ['manual', 'Borrador'],
    ]);
    expect(versiones.body.data[0]).not.toHaveProperty('texto_plano');
    expect(versiones.body.meta.total).toBe(2);
  });

  it('exporta a texto y a HTML con un nombre de archivo limpio; un lector también puede', async () => {
    const { ana, beto } = await escenario();
    const id = (await crear(ana, { titulo: 'Plan: 2026' })).body.data.id;
    await guardarContenido(id, docDePrueba(), ana.id);
    await api().put(`${URL}/${id}/permisos`).set(bearer(ana)).send({ usuario_id: beto.id });

    const texto = await api().get(`${URL}/${id}/exportar?formato=texto`).set(bearer(beto));
    expect(texto.body.data).toMatchObject({ nombre_archivo: 'Plan 2026.txt', tipo_mime: 'text/plain;charset=utf-8' });
    expect(texto.body.data.contenido).toContain('[x] listo');

    const html = await api().get(`${URL}/${id}/exportar`).set(bearer(beto));
    expect(html.body.data.nombre_archivo).toBe('Plan 2026.html');
    expect(html.body.data.contenido).toContain('<strong>mundo</strong>');
    expect((await api().get(`${URL}/${id}/exportar?formato=pdf`).set(bearer(beto))).status).toBe(400);
  });
});
