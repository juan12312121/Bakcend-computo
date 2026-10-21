import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchivoGrupo, CarpetaGrupo, Grupo, GrupoMiembro, Notificacion } from '../src/infrastructure/database/models';
import { realtime, salas } from '../src/infrastructure/realtime/RealtimeGateway';
import { fileStorage, motorCloudinary } from '../src/infrastructure/storage/CloudinaryStorage';
import { EVENTO_ARCHIVOS_GRUPO } from '../src/modules/archivos-grupo/archivo-grupo.acceso';
import { creariaCiclo, descendientes, nombreLegible, nombreOcupado, rutaDe, tipoDeArchivo } from '../src/modules/archivos-grupo/archivo-grupo.arbol';
import { AgrupadorAvisos, mensajeAviso, type AvisoArchivos, type RelojAvisos } from '../src/modules/archivos-grupo/archivo-grupo.avisos';
import { archivoGrupoRoutes } from '../src/modules/archivos-grupo/archivo-grupo.routes';
import { avisosArchivos } from '../src/modules/archivos-grupo/archivo-grupo.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

const URL = '/api/archivos-grupo';

beforeAll(() => usarModulos({ '/archivos-grupo': archivoGrupoRoutes }));
beforeEach(async () => {
  await reiniciarBD();
  avisosArchivos.reiniciar();
  simularSubidas();
  vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

/** Multer "sube" a una URL falsa de Cloudinary (sin salir a internet) contando los bytes reales. */
function simularSubidas(): void {
  vi.spyOn(motorCloudinary, '_handleFile').mockImplementation(async (_req, file, cb) => {
    let bytes = 0;
    file.stream.on('data', (trozo: Buffer) => (bytes += trozo.length));
    file.stream.on('end', () =>
      cb(null, { path: `https://res.cloudinary.com/demo/raw/upload/v1/trino/chat/${file.originalname}`, filename: `trino/chat/${file.originalname}`, size: bytes }),
    );
  });
}

interface Escenario {
  grupoId: number;
  ana: UsuarioPrueba; // admin
  beto: UsuarioPrueba; // miembro
  caro: UsuarioPrueba; // miembro
  dani: UsuarioPrueba; // de fuera
}

async function escenario(): Promise<Escenario> {
  const [ana, beto, caro, dani] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro'), await crearUsuario('dani')];
  const grupo = await Grupo.create({ nombre: 'Club', creador_id: ana.id });
  await GrupoMiembro.bulkCreate([
    { grupo_id: grupo.id, usuario_id: ana.id, rol: 'admin', estado: 'activo' },
    { grupo_id: grupo.id, usuario_id: beto.id, rol: 'miembro', estado: 'activo' },
    { grupo_id: grupo.id, usuario_id: caro.id, rol: 'miembro', estado: 'activo' },
  ]);
  return { grupoId: grupo.id, ana, beto, caro, dani };
}

const crearCarpeta = (de: UsuarioPrueba, grupoId: number, nombre: string, padre_id?: number) =>
  api().post(`${URL}/grupo/${grupoId}/carpetas`).set(bearer(de)).send({ nombre, padre_id });

function subir(de: UsuarioPrueba, grupoId: number, nombre: string, opciones: { tipo?: string; carpeta?: number; contenido?: string } = {}) {
  const peticion = api()
    .post(`${URL}/grupo/${grupoId}/archivos`)
    .set(bearer(de))
    .attach('archivo', Buffer.from(opciones.contenido ?? 'contenido'), { filename: nombre, contentType: opciones.tipo ?? 'application/pdf' });
  return opciones.carpeta ? peticion.field('carpeta_id', String(opciones.carpeta)) : peticion;
}

const contenido = (de: UsuarioPrueba, grupoId: number, carpeta?: number) =>
  api().get(`${URL}/grupo/${grupoId}${carpeta ? `?carpeta_id=${carpeta}` : ''}`).set(bearer(de));

describe('archivos del grupo: árbol (funciones puras)', () => {
  const carpetas = [
    { id: 1, padre_id: null, nombre: 'Clases' },
    { id: 2, padre_id: 1, nombre: 'Mate' },
    { id: 3, padre_id: 2, nombre: 'Tareas' },
    { id: 4, padre_id: null, nombre: 'Fotos' },
  ];

  it('migas de pan, descendientes, ciclos y nombres repetidos', () => {
    expect(rutaDe(3, carpetas)).toEqual([
      { id: 1, nombre: 'Clases' },
      { id: 2, nombre: 'Mate' },
      { id: 3, nombre: 'Tareas' },
    ]);
    expect(rutaDe(null, carpetas)).toEqual([]);
    expect(descendientes(1, carpetas).sort()).toEqual([1, 2, 3]);
    expect(creariaCiclo(1, 3, carpetas)).toBe(true);
    expect(creariaCiclo(1, 1, carpetas)).toBe(true);
    expect(creariaCiclo(3, 4, carpetas)).toBe(false);
    expect(creariaCiclo(3, null, carpetas)).toBe(false);
    expect(nombreOcupado(' mate ', 1, carpetas)).toBe(true);
    expect(nombreOcupado('Mate', 1, carpetas, 2)).toBe(false);
    expect(nombreOcupado('Mate', null, carpetas)).toBe(false);
  });

  it('tipo por MIME y nombre original legible', () => {
    expect(tipoDeArchivo('image/png')).toBe('imagen');
    expect(tipoDeArchivo('application/pdf')).toBe('documento');
    expect(tipoDeArchivo('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('documento');
    expect(tipoDeArchivo('audio/webm')).toBe('audio');
    expect(tipoDeArchivo('video/mp4')).toBe('video');
    expect(tipoDeArchivo('application/zip')).toBe('otro');
    expect(nombreLegible(Buffer.from('reunión.pdf', 'utf8').toString('latin1'))).toBe('reunión.pdf');
    expect(nombreLegible('plain.txt')).toBe('plain.txt');
  });
});

describe('archivos del grupo: avisos agrupados', () => {
  it('el primero sale al instante y los siguientes de los 10 min se juntan en uno', async () => {
    let ahora = 0;
    const tareas: { cuando: number; tarea: () => void }[] = [];
    const reloj: RelojAvisos = { ahora: () => ahora, programar: (tarea, ms) => tareas.push({ cuando: ahora + ms, tarea }) };
    const enviados: AvisoArchivos[] = [];
    const agrupador = new AgrupadorAvisos(async (a) => void enviados.push(a), 600_000, reloj);
    const base = { destinatarioId: 1, grupoId: 9, grupoNombre: 'Club', nombreArchivo: 'a.pdf' };

    await agrupador.registrar({ ...base, deUsuarioId: 2, archivoId: 1 });
    expect(enviados).toHaveLength(1);
    ahora = 60_000;
    await agrupador.registrar({ ...base, deUsuarioId: 2, archivoId: 2 });
    await agrupador.registrar({ ...base, deUsuarioId: 3, archivoId: 3 });
    // Otro destinatario no se ve afectado
    await agrupador.registrar({ ...base, destinatarioId: 5, deUsuarioId: 2, archivoId: 3 });
    expect(enviados).toHaveLength(2);
    expect(tareas).toHaveLength(1);
    expect(tareas[0].cuando).toBe(600_000);

    ahora = 600_000;
    tareas[0].tarea();
    await Promise.resolve();
    expect(enviados[2]).toMatchObject({ destinatarioId: 1, archivoId: 3, cantidad: 2, autores: 2 });
    expect(mensajeAviso(enviados[2])).toBe('y otras personas subieron 2 archivos a «Club»');
    expect(mensajeAviso({ ...enviados[2], autores: 1 })).toBe('subió 2 archivos a «Club»');
    expect(mensajeAviso(enviados[0])).toBe('subió «a.pdf» a los archivos de «Club»');
  });
});

describe('archivos del grupo: permisos', () => {
  it('solo miembros activos ven y suben; grupo inexistente 404; sin sesión 401', async () => {
    const { grupoId, beto, dani } = await escenario();
    expect((await contenido(dani, grupoId)).status).toBe(403);
    expect((await subir(dani, grupoId, 'x.pdf')).status).toBe(403);
    expect((await crearCarpeta(dani, grupoId, 'Mía')).status).toBe(403);
    expect((await api().get(`${URL}/grupo/${grupoId}/uso`).set(bearer(dani))).status).toBe(403);
    expect((await contenido(beto, 999)).status).toBe(404);
    expect((await api().get(`${URL}/grupo/${grupoId}`)).status).toBe(401);

    const vacio = await contenido(beto, grupoId);
    expect(vacio.status).toBe(200);
    expect(vacio.body.data).toEqual({ grupo: { id: grupoId, nombre: 'Club' }, carpeta: null, ruta: [], carpetas: [], archivos: [], puede_moderar: false });
  });
});

describe('archivos del grupo: carpetas', () => {
  it('crea carpetas anidadas, muestra migas y conteos, y no repite nombres en el mismo lugar', async () => {
    const { grupoId, ana, beto } = await escenario();
    const clases = (await crearCarpeta(beto, grupoId, 'Clases')).body.data;
    expect(clases).toMatchObject({ grupo_id: grupoId, padre_id: null, nombre: 'Clases', creador_id: beto.id });
    const mate = (await crearCarpeta(beto, grupoId, 'Mate', clases.id)).body.data;
    await crearCarpeta(beto, grupoId, 'Tareas', mate.id);
    await subir(beto, grupoId, 'temario.pdf', { carpeta: clases.id });

    expect((await crearCarpeta(ana, grupoId, 'clases')).status).toBe(409);
    expect((await crearCarpeta(ana, grupoId, 'Mate')).status).toBe(201);
    expect((await crearCarpeta(ana, grupoId, 'X', 999)).status).toBe(404);
    expect((await crearCarpeta(ana, grupoId, 'a/b')).status).toBe(400);

    const raiz = await contenido(ana, grupoId);
    expect(raiz.body.data.carpetas.map((c: { nombre: string; total_elementos: number }) => [c.nombre, c.total_elementos])).toEqual([
      ['Clases', 2],
      ['Mate', 0],
    ]);
    expect(raiz.body.data.puede_moderar).toBe(true);

    const dentro = await contenido(ana, grupoId, mate.id);
    expect(dentro.body.data.carpeta).toMatchObject({ id: mate.id, nombre: 'Mate' });
    expect(dentro.body.data.ruta).toEqual([
      { id: clases.id, nombre: 'Clases' },
      { id: mate.id, nombre: 'Mate' },
    ]);
    expect(dentro.body.data.carpetas.map((c: { nombre: string }) => c.nombre)).toEqual(['Tareas']);
    expect((await contenido(ana, grupoId, 999)).status).toBe(404);

    const arbol = await api().get(`${URL}/grupo/${grupoId}/carpetas`).set(bearer(ana));
    expect(arbol.body.data).toHaveLength(4);
  });

  it('renombra y mueve (creador o admin); no se mete dentro de sí misma', async () => {
    const { grupoId, ana, beto, caro } = await escenario();
    const clases = (await crearCarpeta(beto, grupoId, 'Clases')).body.data;
    const mate = (await crearCarpeta(beto, grupoId, 'Mate', clases.id)).body.data;
    const avisos = vi.spyOn(realtime, 'aSala');

    expect((await api().patch(`${URL}/carpetas/${clases.id}`).set(bearer(caro)).send({ nombre: 'Mías' })).status).toBe(403);
    expect((await api().patch(`${URL}/carpetas/${clases.id}`).set(bearer(beto)).send({ padre_id: mate.id })).status).toBe(400);
    expect((await api().patch(`${URL}/carpetas/${clases.id}`).set(bearer(beto)).send({})).status).toBe(400);

    const movida = await api().patch(`${URL}/carpetas/${mate.id}`).set(bearer(ana)).send({ padre_id: null, nombre: 'Matemáticas' });
    expect(movida.status).toBe(200);
    expect(movida.body.data).toMatchObject({ padre_id: null, nombre: 'Matemáticas' });
    expect(avisos).toHaveBeenCalledWith(salas.grupo(grupoId), EVENTO_ARCHIVOS_GRUPO, expect.objectContaining({ accion: 'carpeta_actualizada', carpeta_id: clases.id }));
    expect((await api().patch(`${URL}/carpetas/${clases.id}`).set(bearer(beto)).send({ nombre: 'matemáticas' })).status).toBe(409);
  });

  it('borra con todo su contenido (y de Cloudinary); si hay cosas de otros solo un admin', async () => {
    const { grupoId, ana, beto, caro } = await escenario();
    const clases = (await crearCarpeta(beto, grupoId, 'Clases')).body.data;
    const mate = (await crearCarpeta(beto, grupoId, 'Mate', clases.id)).body.data;
    await subir(beto, grupoId, 'mio.pdf', { carpeta: clases.id });
    await subir(caro, grupoId, 'de-caro.pdf', { carpeta: mate.id });
    await subir(caro, grupoId, 'raiz.pdf');

    expect((await api().delete(`${URL}/carpetas/${clases.id}`).set(bearer(caro))).status).toBe(403);
    const delCreador = await api().delete(`${URL}/carpetas/${clases.id}`).set(bearer(beto));
    expect(delCreador.status).toBe(403);
    expect(delCreador.body.mensaje).toContain('admin/moderador');

    const borrado = await api().delete(`${URL}/carpetas/${clases.id}`).set(bearer(ana));
    expect(borrado.status).toBe(200);
    expect(borrado.body.data).toEqual({ carpetas: 2, archivos: 2 });
    expect(await CarpetaGrupo.count()).toBe(0);
    expect((await ArchivoGrupo.findAll()).map((a) => a.nombre)).toEqual(['raiz.pdf']);
    expect(fileStorage.eliminar).toHaveBeenCalledTimes(2);
    expect(fileStorage.eliminar).toHaveBeenCalledWith('https://res.cloudinary.com/demo/raw/upload/v1/trino/chat/de-caro.pdf');

    // Si todo es suyo, el creador sí puede
    const propia = (await crearCarpeta(beto, grupoId, 'Propia')).body.data;
    await subir(beto, grupoId, 'p.pdf', { carpeta: propia.id });
    expect((await api().delete(`${URL}/carpetas/${propia.id}`).set(bearer(beto))).status).toBe(200);
  });
});

describe('archivos del grupo: archivos', () => {
  it('sube con nombre, tamaño, tipo y autor; abre el archivo con su ruta', async () => {
    const { grupoId, beto, caro } = await escenario();
    const clases = (await crearCarpeta(beto, grupoId, 'Clases')).body.data;

    const subido = await subir(beto, grupoId, 'foto.png', { tipo: 'image/png', carpeta: clases.id, contenido: '12345678' });
    expect(subido.status).toBe(201);
    expect(subido.body.data).toMatchObject({
      grupo_id: grupoId,
      carpeta_id: clases.id,
      usuario_id: beto.id,
      nombre: 'foto.png',
      mimetype: 'image/png',
      tipo: 'imagen',
      tamano: 8,
      autor: { id: beto.id, nombre_usuario: 'beto' },
    });

    const abierto = await api().get(`${URL}/${subido.body.data.id}`).set(bearer(caro));
    expect(abierto.body.data).toMatchObject({
      ruta: [{ id: clases.id, nombre: 'Clases' }],
      puede_modificar: false,
      grupo: { id: grupoId, nombre: 'Club' },
      carpeta: { id: clases.id, nombre: 'Clases' },
    });
    expect((await api().get(`${URL}/999`).set(bearer(caro))).status).toBe(404);

    // Nombre propio y validaciones
    const conNombre = await api()
      .post(`${URL}/grupo/${grupoId}/archivos`)
      .set(bearer(caro))
      .field('nombre', 'Notas de voz')
      .attach('archivo', Buffer.from('ogg'), { filename: 'nota.ogg', contentType: 'audio/ogg' });
    expect(conNombre.body.data).toMatchObject({ nombre: 'Notas de voz', tipo: 'audio', carpeta_id: null });
    expect((await api().post(`${URL}/grupo/${grupoId}/archivos`).set(bearer(caro))).status).toBe(400);
    expect((await subir(caro, grupoId, 'peli.mp4', { tipo: 'video/mp4' })).status).toBe(400);
    expect((await subir(caro, grupoId, 'x.pdf', { carpeta: 999 })).status).toBe(404);
  });

  it('renombra y mueve (autor o admin/moderador) y borra también de Cloudinary', async () => {
    const { grupoId, ana, beto, caro } = await escenario();
    const destino = (await crearCarpeta(ana, grupoId, 'Destino')).body.data;
    const id = (await subir(beto, grupoId, 'tarea.pdf')).body.data.id;

    expect((await api().patch(`${URL}/${id}`).set(bearer(caro)).send({ nombre: 'mía.pdf' })).status).toBe(403);
    expect((await api().delete(`${URL}/${id}`).set(bearer(caro))).status).toBe(403);

    const movido = await api().patch(`${URL}/${id}`).set(bearer(beto)).send({ nombre: 'tarea-final.pdf', carpeta_id: destino.id });
    expect(movido.body.data).toMatchObject({ nombre: 'tarea-final.pdf', carpeta_id: destino.id, puede_modificar: true });
    expect((await api().patch(`${URL}/${id}`).set(bearer(beto)).send({ carpeta_id: 999 })).status).toBe(404);
    const aRaiz = await api().patch(`${URL}/${id}`).set(bearer(ana)).send({ carpeta_id: null });
    expect(aRaiz.body.data).toMatchObject({ carpeta_id: null, ruta: [] });

    expect((await api().delete(`${URL}/${id}`).set(bearer(ana))).status).toBe(200);
    expect(fileStorage.eliminar).toHaveBeenCalledWith('https://res.cloudinary.com/demo/raw/upload/v1/trino/chat/tarea.pdf');
    expect(await ArchivoGrupo.count()).toBe(0);
  });

  it('busca por nombre y tipo en todo el grupo y suma el espacio usado', async () => {
    const { grupoId, beto, caro } = await escenario();
    const carpeta = (await crearCarpeta(beto, grupoId, 'Fotos')).body.data;
    await subir(beto, grupoId, 'Examen final.pdf', { contenido: '1234' });
    await subir(caro, grupoId, 'examen-foto.jpg', { tipo: 'image/jpeg', carpeta: carpeta.id, contenido: '123456' });
    await subir(caro, grupoId, 'otro.png', { tipo: 'image/png', contenido: '12' });

    const examen = await api().get(`${URL}/grupo/${grupoId}/buscar?q=examen`).set(bearer(beto));
    expect(examen.body.data.map((a: { nombre: string }) => a.nombre)).toEqual(['examen-foto.jpg', 'Examen final.pdf']);
    const imagenes = await api().get(`${URL}/grupo/${grupoId}/buscar?tipo=imagen&limit=1`).set(bearer(beto));
    expect(imagenes.body.meta).toMatchObject({ total: 2, hayMas: true });

    const uso = await api().get(`${URL}/grupo/${grupoId}/uso`).set(bearer(beto));
    expect(uso.body.data).toMatchObject({
      total_bytes: 12,
      total_archivos: 3,
      por_tipo: { imagen: { bytes: 8, archivos: 2 }, documento: { bytes: 4, archivos: 1 }, audio: { bytes: 0, archivos: 0 } },
    });
    expect(uso.body.data.limite_bytes).toBeGreaterThan(0);
  });

  it('avisa "archivo_subido" a los demás miembros, como mucho una vez cada 10 minutos', async () => {
    const { grupoId, ana, beto, caro } = await escenario();
    const avisos = vi.spyOn(realtime, 'aSala');
    const primero = (await subir(beto, grupoId, 'uno.pdf')).body.data.id;
    await subir(beto, grupoId, 'dos.pdf');

    const notificaciones = await Notificacion.findAll({ where: { tipo: 'archivo_subido' }, order: [['usuario_id', 'ASC']] });
    expect(notificaciones.map((n) => n.usuario_id)).toEqual([ana.id, caro.id]);
    expect(notificaciones[0].toJSON()).toMatchObject({ de_usuario_id: beto.id, entidad_tipo: 'archivo', entidad_id: primero });
    expect(notificaciones[0].mensaje).toBe('subió «uno.pdf» a los archivos de «Club»');
    expect(avisos).toHaveBeenCalledWith(salas.grupo(grupoId), EVENTO_ARCHIVOS_GRUPO, expect.objectContaining({ accion: 'archivo_subido', carpeta_id: null }));
  });
});
