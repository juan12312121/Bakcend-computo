import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  Anuncio,
  AnuncioFoto,
  AnuncioGuardado,
  AnuncioInteresado,
  AnuncioReporte,
  Bloqueo,
  CalificacionVendedor,
  Chat,
  Grupo,
  GrupoMiembro,
  MensajeChat,
  Notificacion,
  Usuario,
} from '../src/infrastructure/database/models';
import { fileStorage, motorCloudinary } from '../src/infrastructure/storage/CloudinaryStorage';
import { marketplaceRoutes } from '../src/modules/marketplace/marketplace.routes';
import { erroresDeCoherencia, marketplaceService } from '../src/modules/marketplace/marketplace.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/marketplace': marketplaceRoutes }));

let eliminarArchivo: MockInstance<typeof fileStorage.eliminar>;
let subidas = 0;

beforeEach(async () => {
  await reiniciarBD();
  // Nunca se llama a Cloudinary: multer "sube" a una URL falsa y solo se verifica qué se pidió borrar
  eliminarArchivo = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
  vi.spyOn(motorCloudinary, '_handleFile').mockImplementation(async (_req, file, cb) => {
    const nombre = `${++subidas}-${file.originalname}`;
    file.stream.on('end', () =>
      cb(null, { path: `https://res.cloudinary.com/demo/image/upload/v1/trino/publicaciones/${nombre}`, filename: `trino/publicaciones/${nombre}`, size: 5 }),
    );
    file.stream.resume();
  });
  // Si multer aborta (p. ej. más de 10 fotos) "borra" lo ya subido sin salir a internet
  vi.spyOn(motorCloudinary, '_removeFile').mockImplementation((_req, _file, cb) => cb(null as unknown as Error));
});
afterEach(() => vi.restoreAllMocks());

const HORA = 60 * 60 * 1000;
const campos = (body: { errores?: { campo: string }[] }) => (body.errores ?? []).map((e) => e.campo);

interface AnuncioRespuesta {
  id: number;
  fotos: { id: number; url: string; orden: number }[];
  [k: string]: unknown;
}

const PRODUCTO = { titulo: 'Bicicleta de montaña', precio: '2500', condicion: 'usado', categoria: 'deportes', ubicacion: 'Culiacán centro' };

/** Publica un producto con fotos (multipart). */
async function publicar(u: UsuarioPrueba, extra: Record<string, string> = {}, fotos = ['a.png']): Promise<AnuncioRespuesta> {
  let peticion = api().post('/api/marketplace').set(bearer(u));
  for (const [campo, valor] of Object.entries({ ...PRODUCTO, ...extra })) peticion = peticion.field(campo, valor);
  for (const nombre of fotos) peticion = peticion.attach('imagen', Buffer.from('img'), { filename: nombre, contentType: 'image/png' });
  const res = await peticion;
  if (res.status !== 201) throw new Error(`No se pudo publicar: ${JSON.stringify(res.body)}`);
  return res.body.data as AnuncioRespuesta;
}

/** Servicio sin fotos (JSON). */
async function publicarServicio(u: UsuarioPrueba, extra: Record<string, unknown> = {}): Promise<AnuncioRespuesta> {
  const res = await api()
    .post('/api/marketplace')
    .set(bearer(u))
    .send({ titulo: 'Clases de guitarra', tipo: 'servicio', modo_precio: 'a_convenir', ubicacion: 'En línea', ...extra });
  if (res.status !== 201) throw new Error(`No se pudo publicar: ${JSON.stringify(res.body)}`);
  return res.body.data as AnuncioRespuesta;
}

const buscar = (u: UsuarioPrueba | null, query = '') => {
  const peticion = api().get(`/api/marketplace${query}`);
  return u ? peticion.set(bearer(u)) : peticion;
};
const ver = (u: UsuarioPrueba | null, id: number) => {
  const peticion = api().get(`/api/marketplace/${id}`);
  return u ? peticion.set(bearer(u)) : peticion;
};
const titulos = (body: { data: { titulo: string }[] }) => body.data.map((a) => a.titulo);
const estado = (u: UsuarioPrueba, id: number, body: Record<string, unknown>) =>
  api().patch(`/api/marketplace/${id}/estado`).set(bearer(u)).send(body);
const interes = (u: UsuarioPrueba, id: number, mensaje?: string) =>
  api().post(`/api/marketplace/${id}/interes`).set(bearer(u)).send(mensaje ? { mensaje } : {});
const notificaciones = (u: UsuarioPrueba, tipo: string) => Notificacion.findAll({ where: { usuario_id: u.id, tipo } });

async function crearGrupo(creador: UsuarioPrueba, privacidad: 'publico' | 'privado', miembros: UsuarioPrueba[] = []) {
  const grupo = await Grupo.create({ nombre: 'Vecinos', creador_id: creador.id, privacidad });
  await GrupoMiembro.create({ grupo_id: grupo.id, usuario_id: creador.id, rol: 'admin', estado: 'activo' });
  for (const m of miembros) await GrupoMiembro.create({ grupo_id: grupo.id, usuario_id: m.id, rol: 'miembro', estado: 'activo' });
  return grupo;
}

describe('marketplace: publicar', () => {
  it('publica un producto con fotos en orden, vendedor y valores por defecto', async () => {
    const ana = await crearUsuario('ana');
    const anuncio = await publicar(ana, { entrega_envio: 'true', moneda: 'USD' }, ['uno.png', 'dos.png', 'tres.png']);

    expect(anuncio).toMatchObject({
      titulo: 'Bicicleta de montaña',
      tipo: 'producto',
      condicion: 'usado',
      categoria: 'deportes',
      modo_precio: 'fijo',
      precio: 2500,
      moneda: 'USD',
      estado: 'activo',
      entrega_en_persona: true,
      entrega_envio: true,
      total_vistas: 0,
      total_fotos: 3,
      es_mio: true,
      guardado: false,
      vendedor: { id: ana.id, nombre_usuario: 'ana' },
      vendedor_calificacion: { promedio: null, total: 0 },
      puede_renovar: false,
    });
    expect(anuncio.fotos.map((f) => f.orden)).toEqual([0, 1, 2]);
    expect(anuncio.fotos[0].url).toContain('uno.png');
    expect(anuncio.foto_principal).toBe(anuncio.fotos[0].url);
    expect(anuncio).not.toHaveProperty('fotos.0.archivo_id');
    expect(await AnuncioFoto.count()).toBe(3);
  });

  it('servicio sin fotos (JSON): sin condición, categoría "servicios" y precio a convenir null; gratis guarda 0', async () => {
    const ana = await crearUsuario('ana');
    const servicio = await publicarServicio(ana, { condicion: 'nuevo' });
    expect(servicio).toMatchObject({ tipo: 'servicio', categoria: 'servicios', condicion: null, precio: null, modo_precio: 'a_convenir', total_fotos: 0 });

    const regalo = await publicar(ana, { modo_precio: 'gratis', precio: '' });
    expect(regalo).toMatchObject({ modo_precio: 'gratis', precio: 0 });
  });

  it('valida: sin sesión 401, campos requeridos, condición, precio, entrega, foto y máximo de fotos', async () => {
    const ana = await crearUsuario('ana');
    expect((await api().post('/api/marketplace').send({ titulo: 'x' })).status).toBe(401);

    const vacio = await api().post('/api/marketplace').set(bearer(ana)).send({});
    expect(vacio.status).toBe(400);
    expect(campos(vacio.body)).toEqual(expect.arrayContaining(['titulo', 'ubicacion']));

    const malo = await api()
      .post('/api/marketplace')
      .set(bearer(ana))
      .send({ titulo: 'Tele', ubicacion: 'Centro', categoria: 'naves', moneda: 'XXX', precio: -3 });
    expect(campos(malo.body)).toEqual(expect.arrayContaining(['categoria', 'moneda', 'precio']));

    const incoherente = await api()
      .post('/api/marketplace')
      .set(bearer(ana))
      .send({ titulo: 'Tele', ubicacion: 'Centro', entrega_en_persona: false });
    expect(incoherente.status).toBe(400);
    expect(campos(incoherente.body)).toEqual(expect.arrayContaining(['condicion', 'precio', 'entrega_en_persona', 'fotos']));
    expect((await api().post('/api/marketplace').set(bearer(ana)).send({ ...PRODUCTO, precio: 10.555 })).status).toBe(400);

    let demasiadas = api().post('/api/marketplace').set(bearer(ana));
    for (const [c, v] of Object.entries(PRODUCTO)) demasiadas = demasiadas.field(c, v);
    for (let i = 0; i < 11; i++) demasiadas = demasiadas.attach('imagen', Buffer.from('x'), { filename: `f${i}.png`, contentType: 'image/png' });
    expect((await demasiadas).status).toBe(400);
    expect(await Anuncio.count()).toBe(0);
  });

  it('en un grupo solo publican sus miembros activos', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const grupo = await crearGrupo(ana, 'privado');
    expect((await api().post('/api/marketplace').set(bearer(beto)).send({ titulo: 'x', tipo: 'servicio', modo_precio: 'gratis', ubicacion: 'y', grupo_id: grupo.id })).status).toBe(403);
    const enGrupo = await publicarServicio(ana, { grupo_id: grupo.id });
    expect(enGrupo).toMatchObject({ grupo_id: grupo.id, grupo: { id: grupo.id, nombre: 'Vecinos', privacidad: 'privado' } });
  });

  it('reglas entre campos (función pura)', () => {
    const base = { tipo: 'producto' as const, condicion: 'nuevo' as const, modo_precio: 'fijo' as const, precio: 10, entrega_en_persona: true, entrega_envio: false, totalFotos: 1 };
    expect(erroresDeCoherencia(base)).toEqual([]);
    expect(erroresDeCoherencia({ ...base, totalFotos: 11 }).map((e) => e.campo)).toEqual(['fotos']);
    expect(erroresDeCoherencia({ ...base, tipo: 'servicio', condicion: null, totalFotos: 0, entrega_en_persona: false })).toEqual([]);
    expect(erroresDeCoherencia({ ...base, modo_precio: 'gratis', precio: 0 })).toEqual([]);
  });
});

describe('marketplace: búsqueda y filtros', () => {
  async function catalogo() {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const bici = await publicar(ana, { titulo: 'Bicicleta roja', precio: '3000', ubicacion: 'Culiacán norte' });
    const libro = await publicar(ana, { titulo: 'Libro de cálculo', precio: '150', categoria: 'libros_escuela', condicion: 'como_nuevo', ubicacion: 'Mazatlán' });
    const sofa = await publicar(beto, { titulo: 'Sofá', modo_precio: 'gratis', categoria: 'hogar', entrega_envio: 'true', entrega_en_persona: 'false' });
    const clases = await publicarServicio(beto, { titulo: 'Clases de piano', descripcion: 'Bicicleta no incluida' });
    return { ana, beto, bici, libro, sofa, clases };
  }

  it('sin sesión ve los activos, recientes primero, con paginación', async () => {
    await catalogo();
    const res = await buscar(null, '?limit=3');
    expect(res.status).toBe(200);
    expect(titulos(res.body)).toEqual(['Clases de piano', 'Sofá', 'Libro de cálculo']);
    expect(res.body.meta).toMatchObject({ total: 4, limit: 3, offset: 0, hayMas: true });
    expect(res.body.data[0]).toMatchObject({ guardado: false, es_mio: false, foto_principal: null });
    expect(res.body.data[1].foto_principal).toContain('res.cloudinary.com');
    expect(res.body.data[0]).not.toHaveProperty('comprador_id');
  });

  it('filtra por texto (título y descripción), categoría, tipo, condición, precio, ubicación, gratis y envío', async () => {
    const { ana } = await catalogo();
    expect(titulos((await buscar(ana, '?q=bicicleta')).body).sort()).toEqual(['Bicicleta roja', 'Clases de piano']);
    expect(titulos((await buscar(ana, '?categoria=libros_escuela')).body)).toEqual(['Libro de cálculo']);
    expect(titulos((await buscar(ana, '?tipo=servicio')).body)).toEqual(['Clases de piano']);
    expect(titulos((await buscar(ana, '?condicion=como_nuevo')).body)).toEqual(['Libro de cálculo']);
    expect(titulos((await buscar(ana, '?precio_min=100&precio_max=2000')).body)).toEqual(['Libro de cálculo']);
    expect(titulos((await buscar(ana, '?precio_max=200')).body)).toEqual(['Sofá', 'Libro de cálculo']);
    expect(titulos((await buscar(ana, '?ubicacion=culiac')).body)).toEqual(['Sofá', 'Bicicleta roja']);
    expect(titulos((await buscar(ana, '?gratis=true')).body)).toEqual(['Sofá']);
    expect(titulos((await buscar(ana, '?envio=true')).body)).toEqual(['Sofá']);
    expect((await buscar(ana, '?precio_min=50&precio_max=10')).status).toBe(400);
    expect((await buscar(ana, '?orden=raro')).status).toBe(400);
  });

  it('ordena por precio (los "a convenir" al final) y por más vistos', async () => {
    const { ana, beto, libro } = await catalogo();
    expect(titulos((await buscar(ana, '?orden=precio_asc')).body)).toEqual(['Sofá', 'Libro de cálculo', 'Bicicleta roja', 'Clases de piano']);
    expect(titulos((await buscar(ana, '?orden=precio_desc')).body)).toEqual(['Bicicleta roja', 'Libro de cálculo', 'Sofá', 'Clases de piano']);
    await ver(beto, libro.id);
    expect(titulos((await buscar(ana, '?orden=vistas')).body)[0]).toBe('Libro de cálculo');
  });

  it('no muestra pausados ni vendidos; "mis anuncios" sí, con filtro de estado', async () => {
    const { ana, beto, bici, libro } = await catalogo();
    expect((await estado(ana, bici.id, { estado: 'pausado' })).status).toBe(200);
    expect((await estado(ana, libro.id, { estado: 'vendido' })).status).toBe(200);
    expect(titulos((await buscar(beto)).body)).toEqual(['Clases de piano', 'Sofá']);

    const mios = await api().get('/api/marketplace/mios').set(bearer(ana));
    expect(titulos(mios.body).sort()).toEqual(['Bicicleta roja', 'Libro de cálculo']);
    const vendidos = await api().get('/api/marketplace/mios?estado=vendido').set(bearer(ana));
    expect(titulos(vendidos.body)).toEqual(['Libro de cálculo']);
    expect((await api().get('/api/marketplace/mios')).status).toBe(401);
  });

  it('los bloqueos ocultan los anuncios en ambos sentidos', async () => {
    const { ana, beto } = await catalogo();
    await Bloqueo.create({ bloqueador_id: beto.id, bloqueado_id: ana.id });
    expect(titulos((await buscar(ana)).body).sort()).toEqual(['Bicicleta roja', 'Libro de cálculo']);
    expect(titulos((await buscar(beto)).body).sort()).toEqual(['Clases de piano', 'Sofá']);
  });

  it('anuncios de grupo: en la búsqueda general solo para miembros; por grupo, privado solo miembros', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    const privado = await crearGrupo(ana, 'privado', [beto]);
    const publico = await crearGrupo(ana, 'publico');
    await publicarServicio(ana, { titulo: 'Del grupo privado', grupo_id: privado.id });
    await publicarServicio(ana, { titulo: 'Del grupo público', grupo_id: publico.id });
    await publicarServicio(ana, { titulo: 'Abierto' });

    expect(titulos((await buscar(beto)).body)).toEqual(['Abierto', 'Del grupo privado']);
    expect(titulos((await buscar(caro)).body)).toEqual(['Abierto']);
    expect(titulos((await buscar(caro, `?grupo_id=${publico.id}`)).body)).toEqual(['Del grupo público']);
    expect((await buscar(caro, `?grupo_id=${privado.id}`)).status).toBe(403);
    expect(titulos((await buscar(beto, `?grupo_id=${privado.id}`)).body)).toEqual(['Del grupo privado']);
    expect((await buscar(beto, '?grupo_id=999')).status).toBe(404);
  });
});

describe('marketplace: detalle y vistas', () => {
  it('cuenta una vista por persona (el vendedor no cuenta; sin sesión, cada vez) y registra "vistos recientemente"', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const anuncio = await publicar(ana);
    const otro = await publicar(ana, { titulo: 'Casco' });

    await ver(ana, anuncio.id);
    await ver(beto, anuncio.id);
    await ver(beto, anuncio.id);
    const anonimo = await ver(null, anuncio.id);
    expect(anonimo.status).toBe(200);
    expect(anonimo.body.data).toMatchObject({ total_vistas: 2, guardado: false, es_mio: false, me_interesa: false, puede_renovar: false });

    await ver(beto, otro.id);
    const vistos = await api().get('/api/marketplace/vistos').set(bearer(beto));
    expect(vistos.body.data.map((a: { id: number }) => a.id).sort()).toEqual([anuncio.id, otro.id].sort());
    expect((await api().get('/api/marketplace/vistos').set(bearer(ana))).body.data).toEqual([]);
  });

  it('404 si no existe, si está pausado (salvo para el dueño) o si hay bloqueo; 403 en grupo privado ajeno', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    const anuncio = await publicar(ana);
    expect((await ver(beto, 999)).status).toBe(404);

    await estado(ana, anuncio.id, { estado: 'pausado' });
    expect((await ver(beto, anuncio.id)).status).toBe(404);
    expect((await ver(ana, anuncio.id)).body.data.estado).toBe('pausado');
    await estado(ana, anuncio.id, { estado: 'activo' });

    await Bloqueo.create({ bloqueador_id: ana.id, bloqueado_id: beto.id });
    expect((await ver(beto, anuncio.id)).status).toBe(404);

    const grupo = await crearGrupo(ana, 'privado');
    const delGrupo = await publicarServicio(ana, { grupo_id: grupo.id });
    expect((await ver(caro, delGrupo.id)).status).toBe(403);
    expect((await ver(null, delGrupo.id)).status).toBe(403);
  });
});

describe('marketplace: editar', () => {
  it('solo el vendedor; cambia campos y recalcula el precio según el modo', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const anuncio = await publicar(ana);
    expect((await api().put(`/api/marketplace/${anuncio.id}`).set(bearer(beto)).send({ titulo: 'Mía' })).status).toBe(403);
    expect((await api().put(`/api/marketplace/${anuncio.id}`).set(bearer(ana)).send({})).status).toBe(400);

    const editado = await api().put(`/api/marketplace/${anuncio.id}`).set(bearer(ana)).send({ titulo: 'Bici rodada 29', modo_precio: 'a_convenir', descripcion: 'Poco uso' });
    expect(editado.status).toBe(200);
    expect(editado.body.data).toMatchObject({ titulo: 'Bici rodada 29', modo_precio: 'a_convenir', precio: null, descripcion: 'Poco uso' });

    const sinPrecio = await api().put(`/api/marketplace/${anuncio.id}`).set(bearer(ana)).send({ modo_precio: 'fijo' });
    expect(sinPrecio.status).toBe(400);
    expect(campos(sinPrecio.body)).toContain('precio');

    const servicio = await api().put(`/api/marketplace/${anuncio.id}`).set(bearer(ana)).send({ tipo: 'servicio' });
    expect(servicio.body.data).toMatchObject({ tipo: 'servicio', condicion: null });
  });

  it('reordena, quita (borra de Cloudinary) y agrega fotos con la lista final', async () => {
    const ana = await crearUsuario('ana');
    const anuncio = await publicar(ana, {}, ['uno.png', 'dos.png', 'tres.png']);
    const [uno, dos, tres] = anuncio.fotos;

    const res = await api()
      .put(`/api/marketplace/${anuncio.id}`)
      .set(bearer(ana))
      .field('fotos', `${tres.id},nueva:0,${uno.id}`)
      .attach('imagen', Buffer.from('x'), { filename: 'cuatro.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    const fotos = res.body.data.fotos as { id: number; url: string; orden: number }[];
    expect(fotos.map((f) => f.id)).toEqual([tres.id, expect.any(Number), uno.id]);
    expect(fotos[1].url).toContain('cuatro.png');
    expect(fotos.map((f) => f.orden)).toEqual([0, 1, 2]);
    expect(res.body.data.foto_principal).toBe(tres.url);
    expect(eliminarArchivo).toHaveBeenCalledWith(expect.stringContaining('dos.png'));
    expect(await AnuncioFoto.findByPk(dos.id)).toBeNull();

    // JSON: arreglo de ids
    const json = await api().put(`/api/marketplace/${anuncio.id}`).set(bearer(ana)).send({ fotos: [String(uno.id), String(tres.id)] });
    expect(json.body.data.fotos.map((f: { id: number }) => f.id)).toEqual([uno.id, tres.id]);

    const ajena = await api().put(`/api/marketplace/${anuncio.id}`).set(bearer(ana)).send({ fotos: ['999'] });
    expect(ajena.status).toBe(400);
    const sinFotos = await api().put(`/api/marketplace/${anuncio.id}`).set(bearer(ana)).send({ fotos: [] });
    expect(sinFotos.status).toBe(400);
    expect(campos(sinFotos.body)).toContain('fotos');
  });
});

describe('marketplace: estado, renovar y eliminar', () => {
  it('marcar vendido avisa a quienes lo guardaron; el comprador debe ser un interesado; volver a activo lo limpia', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    const anuncio = await publicar(ana);
    await api().post(`/api/marketplace/${anuncio.id}/guardar`).set(bearer(caro));
    await interes(beto, anuncio.id);

    expect((await estado(beto, anuncio.id, { estado: 'vendido' })).status).toBe(403);
    expect((await estado(ana, anuncio.id, { estado: 'reservado', comprador_id: beto.id })).status).toBe(400);
    const noInteresado = await estado(ana, anuncio.id, { estado: 'vendido', comprador_id: caro.id });
    expect(noInteresado.status).toBe(400);
    expect(campos(noInteresado.body)).toEqual(['comprador_id']);

    const reservado = await estado(ana, anuncio.id, { estado: 'reservado' });
    expect(reservado.body).toMatchObject({ mensaje: 'Anuncio marcado como reservado', data: { estado: 'reservado' } });
    expect((await estado(ana, anuncio.id, { estado: 'reservado' })).status).toBe(400);

    const vendido = await estado(ana, anuncio.id, { estado: 'vendido', comprador_id: beto.id });
    expect(vendido.body.data).toMatchObject({ estado: 'vendido', comprador_id: beto.id, puede_renovar: false, renovable_desde: null });
    expect(vendido.body.data.vendido_en).toBeTruthy();
    const avisos = await notificaciones(caro, 'anuncio_vendido');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ de_usuario_id: ana.id, entidad_tipo: 'anuncio', entidad_id: anuncio.id });
    expect(await notificaciones(beto, 'anuncio_vendido')).toHaveLength(0);

    // El comprador lo ve; otros no ven quién compró
    expect((await ver(beto, anuncio.id)).body.data).toMatchObject({ comprador_id: beto.id, puedo_calificar: true });
    expect((await ver(caro, anuncio.id)).body.data).toMatchObject({ comprador_id: null, puedo_calificar: false });

    const otraVez = await estado(ana, anuncio.id, { estado: 'activo' });
    expect(otraVez.body.data).toMatchObject({ estado: 'activo', comprador_id: null, vendido_en: null });
  });

  it('renovar: una vez cada 24 h, sube a recientes, reactiva pausados y no aplica a vendidos', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const viejo = await publicar(ana, { titulo: 'Viejo' });
    await publicar(ana, { titulo: 'Nuevo' });
    expect((await api().post(`/api/marketplace/${viejo.id}/renovar`).set(bearer(ana))).status).toBe(400);

    await Anuncio.update({ renovado_en: new Date(Date.now() - 25 * HORA), estado: 'pausado' }, { where: { id: viejo.id } });
    expect((await ver(ana, viejo.id)).body.data.puede_renovar).toBe(true);
    expect((await api().post(`/api/marketplace/${viejo.id}/renovar`).set(bearer(beto))).status).toBe(403);
    const renovado = await api().post(`/api/marketplace/${viejo.id}/renovar`).set(bearer(ana));
    expect(renovado.status).toBe(200);
    expect(renovado.body.data).toMatchObject({ estado: 'activo', puede_renovar: false });
    expect(titulos((await buscar(beto)).body)).toEqual(['Viejo', 'Nuevo']);

    await Anuncio.update({ renovado_en: new Date(Date.now() - 25 * HORA), estado: 'vendido' }, { where: { id: viejo.id } });
    expect((await api().post(`/api/marketplace/${viejo.id}/renovar`).set(bearer(ana))).status).toBe(400);
  });

  it('eliminar: solo el vendedor o un admin; borra fotos de Cloudinary y lo relacionado, conserva las calificaciones', async () => {
    const [ana, beto, admin] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('admin')];
    await Usuario.update({ rol: 'admin' }, { where: { id: admin.id } });
    const anuncio = await publicar(ana, {}, ['uno.png', 'dos.png']);
    await interes(beto, anuncio.id);
    await api().post(`/api/marketplace/${anuncio.id}/guardar`).set(bearer(beto));
    await api().post(`/api/marketplace/${anuncio.id}/reportar`).set(bearer(beto)).send({ motivo: 'estafa' });
    await estado(ana, anuncio.id, { estado: 'vendido', comprador_id: beto.id });
    await api().post(`/api/marketplace/${anuncio.id}/calificacion`).set(bearer(beto)).send({ puntuacion: 5 });

    expect((await api().delete(`/api/marketplace/${anuncio.id}`).set(bearer(beto))).status).toBe(403);
    const res = await api().delete(`/api/marketplace/${anuncio.id}`).set(bearer(ana));
    expect(res.body).toMatchObject({ success: true, mensaje: 'Anuncio eliminado' });
    expect(eliminarArchivo).toHaveBeenCalledTimes(2);
    expect(await AnuncioFoto.count()).toBe(0);
    expect(await AnuncioGuardado.count()).toBe(0);
    expect(await AnuncioInteresado.count()).toBe(0);
    expect(await AnuncioReporte.count()).toBe(0);
    expect(await CalificacionVendedor.findOne()).toMatchObject({ anuncio_id: null, titulo_anuncio: 'Bicicleta de montaña' });
    expect((await ver(ana, anuncio.id)).status).toBe(404);

    const otro = await publicar(ana);
    expect((await api().delete(`/api/marketplace/${otro.id}`).set(bearer(admin))).status).toBe(200);
  });
});

describe('marketplace: guardados', () => {
  it('alterna guardado, mantiene el contador y lista "Guardados" (no el propio)', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const anuncio = await publicar(ana);
    expect((await api().post(`/api/marketplace/${anuncio.id}/guardar`).set(bearer(ana))).status).toBe(400);

    const guardado = await api().post(`/api/marketplace/${anuncio.id}/guardar`).set(bearer(beto));
    expect(guardado.body).toMatchObject({ mensaje: 'Anuncio guardado', data: { anuncio_id: anuncio.id, guardado: true, total_guardados: 1 } });
    expect((await ver(beto, anuncio.id)).body.data.guardado).toBe(true);
    expect((await buscar(beto)).body.data[0].guardado).toBe(true);

    const lista = await api().get('/api/marketplace/guardados').set(bearer(beto));
    expect(lista.body.data.map((a: { id: number }) => a.id)).toEqual([anuncio.id]);
    expect(lista.body.data[0]).toMatchObject({ guardado: true, foto_principal: expect.stringContaining('cloudinary') });

    const quitado = await api().post(`/api/marketplace/${anuncio.id}/guardar`).set(bearer(beto));
    expect(quitado.body.data).toMatchObject({ guardado: false, total_guardados: 0 });
    expect((await api().get('/api/marketplace/guardados').set(bearer(beto))).body.data).toEqual([]);
  });
});

describe('marketplace: me interesa', () => {
  it('abre el chat con el vendedor, manda el mensaje con el enlace y notifica solo la primera vez', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const anuncio = await publicar(ana);

    const primera = await interes(beto, anuncio.id);
    expect(primera.status).toBe(200);
    expect(primera.body.data).toMatchObject({ anuncio_id: anuncio.id, chat_id: expect.any(Number), primera_vez: true });
    const chat = await Chat.findByPk(primera.body.data.chat_id);
    expect([chat?.usuario1_id, chat?.usuario2_id].sort()).toEqual([ana.id, beto.id].sort());
    const mensaje = await MensajeChat.findByPk(primera.body.data.mensaje_id);
    expect(mensaje?.texto).toContain('¿Sigue disponible «Bicicleta de montaña»?');
    expect(mensaje?.texto).toContain(`/marketplace/${anuncio.id}`);
    const avisos = await notificaciones(ana, 'anuncio_interes');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ de_usuario_id: beto.id, entidad_tipo: 'anuncio', entidad_id: anuncio.id });

    const segunda = await interes(beto, anuncio.id, '¿Aceptas 2000?');
    expect(segunda.body.data).toMatchObject({ chat_id: primera.body.data.chat_id, primera_vez: false });
    expect((await MensajeChat.findByPk(segunda.body.data.mensaje_id))?.texto).toMatch(/^¿Aceptas 2000\?/);
    expect(await notificaciones(ana, 'anuncio_interes')).toHaveLength(1);

    const detalle = (await ver(beto, anuncio.id)).body.data;
    expect(detalle).toMatchObject({ me_interesa: true, chat_id: primera.body.data.chat_id, total_interesados: 1 });

    const lista = await api().get(`/api/marketplace/${anuncio.id}/interesados`).set(bearer(ana));
    expect(lista.body.data).toEqual([expect.objectContaining({ usuario: expect.objectContaining({ id: beto.id }), chat_id: primera.body.data.chat_id })]);
    expect((await api().get(`/api/marketplace/${anuncio.id}/interesados`).set(bearer(beto))).status).toBe(403);
  });

  it('no en el propio, ni vendido o pausado, ni con bloqueo; sin sesión 401', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    const anuncio = await publicar(ana);
    expect((await api().post(`/api/marketplace/${anuncio.id}/interes`)).status).toBe(401);
    expect((await interes(ana, anuncio.id)).status).toBe(400);

    await Bloqueo.create({ bloqueador_id: caro.id, bloqueado_id: ana.id });
    expect((await interes(caro, anuncio.id)).status).toBe(404);

    await estado(ana, anuncio.id, { estado: 'vendido' });
    const vendido = await interes(beto, anuncio.id);
    expect(vendido.status).toBe(400);
    expect(vendido.body.mensaje).toBe('Este anuncio ya se vendió');
    expect(await MensajeChat.count()).toBe(0);
  });
});

describe('marketplace: reportes y calificaciones', () => {
  it('reporta una vez (no el propio) y el admin los lista y revisa', async () => {
    const [ana, beto, admin] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('admin')];
    await Usuario.update({ rol: 'admin' }, { where: { id: admin.id } });
    const anuncio = await publicar(ana);

    expect((await api().post(`/api/marketplace/${anuncio.id}/reportar`).set(bearer(ana)).send({ motivo: 'estafa' })).status).toBe(400);
    expect((await api().post(`/api/marketplace/${anuncio.id}/reportar`).set(bearer(beto)).send({ motivo: 'nada' })).status).toBe(400);
    const res = await api().post(`/api/marketplace/${anuncio.id}/reportar`).set(bearer(beto)).send({ motivo: 'enganoso', detalle: 'Fotos de internet' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ motivo: 'enganoso', estado: 'pendiente' });
    expect((await api().post(`/api/marketplace/${anuncio.id}/reportar`).set(bearer(beto)).send({ motivo: 'estafa' })).status).toBe(409);

    expect((await api().get('/api/marketplace/reportes').set(bearer(beto))).status).toBe(403);
    const lista = await api().get('/api/marketplace/reportes?estado=pendiente').set(bearer(admin));
    expect(lista.body.data).toEqual([
      expect.objectContaining({ motivo: 'enganoso', anuncio: expect.objectContaining({ id: anuncio.id, vendedor: expect.objectContaining({ id: ana.id }) }), usuario: expect.objectContaining({ id: beto.id }) }),
    ]);
    const revisado = await api().patch(`/api/marketplace/reportes/${res.body.data.id}`).set(bearer(admin)).send({ estado: 'descartado' });
    expect(revisado.body.data).toMatchObject({ estado: 'descartado', revisado_por: admin.id });

    const servicio = await marketplaceService.listarReportes({ estado: 'pendiente' }, { limit: 10, offset: 0 });
    expect(servicio.total).toBe(0);
  });

  it('solo el comprador califica, una vez; la ficha del vendedor muestra el promedio', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    const uno = await publicar(ana);
    const dos = await publicar(ana, { titulo: 'Casco' });
    const calificar = (u: UsuarioPrueba, id: number, puntuacion: number) =>
      api().post(`/api/marketplace/${id}/calificacion`).set(bearer(u)).send({ puntuacion, comentario: 'Todo bien' });

    await interes(beto, uno.id);
    await interes(caro, dos.id);
    expect((await calificar(beto, uno.id, 5)).status).toBe(403);
    await estado(ana, uno.id, { estado: 'vendido', comprador_id: beto.id });
    await estado(ana, dos.id, { estado: 'vendido', comprador_id: caro.id });

    expect((await calificar(caro, uno.id, 5)).status).toBe(403);
    expect((await calificar(beto, uno.id, 6)).status).toBe(400);
    const ok = await calificar(beto, uno.id, 5);
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ puntuacion: 5, vendedor_id: ana.id, comprador: { id: beto.id } });
    expect((await calificar(beto, uno.id, 4)).status).toBe(409);
    await calificar(caro, dos.id, 4);

    expect((await ver(beto, uno.id)).body.data).toMatchObject({ puedo_calificar: false, mi_calificacion: 5, vendedor_calificacion: { promedio: 4.5, total: 2 } });
    const ficha = await api().get(`/api/marketplace/vendedores/${ana.id}`);
    expect(ficha.body.data).toMatchObject({ vendedor: { id: ana.id }, calificacion: { promedio: 4.5, total: 2 }, anuncios_activos: 0, vendidos: 2 });
    expect(ficha.body.data.vendedor).not.toHaveProperty('activo');
    const lista = await api().get(`/api/marketplace/vendedores/${ana.id}/calificaciones`);
    expect(lista.body.meta.total).toBe(2);
    expect((await api().get('/api/marketplace/vendedores/999')).status).toBe(404);
  });
});
