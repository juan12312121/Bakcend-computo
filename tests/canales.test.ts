import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canal, CanalMiembro, CanalPublicacion, CanalReaccion, Dispositivo, Notificacion, Usuario } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { fileStorage, motorCloudinary } from '../src/infrastructure/storage/CloudinaryStorage';
import { canalRoutes } from '../src/modules/canales/canal.routes';
import { dispositivoService } from '../src/modules/dispositivos/dispositivo.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/canales': canalRoutes }));
beforeEach(reiniciarBD);
afterEach(() => vi.restoreAllMocks());

/** Multer "sube" a una URL falsa de Cloudinary sin salir a internet. */
function simularSubidas(): void {
  vi.spyOn(motorCloudinary, '_handleFile').mockImplementation(async (_req, file, cb) => {
    file.stream.on('end', () =>
      cb(null, { path: `https://res.cloudinary.com/demo/raw/upload/v1/trino/canales/${file.originalname}`, filename: `trino/canales/${file.originalname}`, size: 5 }),
    );
    file.stream.resume();
  });
}

const crearCanal = (de: UsuarioPrueba, datos: Record<string, unknown> = {}) =>
  api().post('/api/canales').set(bearer(de)).send({ nombre: 'Noticias', descripcion: 'Lo último', ...datos });
const publicar = (de: UsuarioPrueba, canalId: number, texto: string) =>
  api().post(`/api/canales/${canalId}/publicaciones`).set(bearer(de)).send({ texto });
const suscribir = (de: UsuarioPrueba, canalId: number) => api().post(`/api/canales/${canalId}/suscripcion`).set(bearer(de));

describe('canales: crear, ver y editar', () => {
  it('quien crea queda como propietario; el enlace solo lo ven los administradores', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const res = await crearCanal(ana, { privacidad: 'publico' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      nombre: 'Noticias',
      descripcion: 'Lo último',
      privacidad: 'publico',
      total_suscriptores: 1,
      total_publicaciones: 0,
      mi_rol: 'propietario',
      silenciado: false,
      creador: { id: ana.id, nombre_usuario: 'ana' },
    });
    expect(res.body.data.codigo_invitacion).toMatch(/^[A-Za-z0-9_-]{12}$/);

    const deBeto = await api().get(`/api/canales/${res.body.data.id}`).set(bearer(beto));
    expect(deBeto.body.data).toMatchObject({ mi_rol: null, codigo_invitacion: null });
    const anonimo = await api().get(`/api/canales/${res.body.data.id}`);
    expect(anonimo.status).toBe(200);
  });

  it('valida al crear (400) y pide sesión (401)', async () => {
    const ana = await crearUsuario('ana');
    expect((await crearCanal(ana, { nombre: '  ' })).status).toBe(400);
    expect((await crearCanal(ana, { privacidad: 'secreto' })).status).toBe(400);
    expect((await api().post('/api/canales').send({ nombre: 'X' })).status).toBe(401);
    expect((await api().get('/api/canales/999')).status).toBe(404);
  });

  it('foto por multipart; al cambiarla o quitarla se borra la anterior; solo administradores editan', async () => {
    simularSubidas();
    const eliminar = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const creado = await api()
      .post('/api/canales')
      .set(bearer(ana))
      .field('nombre', 'Fotos')
      .field('privacidad', 'privado')
      .attach('imagen', Buffer.from('png'), { filename: 'logo.png', contentType: 'image/png' });
    expect(creado.status).toBe(201);
    expect(creado.body.data).toMatchObject({ privacidad: 'privado', foto_url: expect.stringContaining('logo.png') });
    const id = creado.body.data.id;

    const cambiada = await api()
      .put(`/api/canales/${id}`)
      .set(bearer(ana))
      .field('descripcion', 'Nueva')
      .attach('imagen', Buffer.from('png'), { filename: 'otro.png', contentType: 'image/png' });
    expect(cambiada.body.data).toMatchObject({ descripcion: 'Nueva', foto_url: expect.stringContaining('otro.png') });
    expect(eliminar).toHaveBeenCalledWith(expect.stringContaining('logo.png'));

    const sinFoto = await api().put(`/api/canales/${id}`).set(bearer(ana)).send({ quitar_foto: true, nombre: 'Fotos 2' });
    expect(sinFoto.body.data).toMatchObject({ foto_url: null, nombre: 'Fotos 2' });
    expect(eliminar).toHaveBeenCalledWith(expect.stringContaining('otro.png'));

    expect((await api().put(`/api/canales/${id}`).set(bearer(beto)).send({ nombre: 'Mío' })).status).toBe(403);
  });
});

describe('canales: descubrir y suscribirse', () => {
  it('descubrir solo muestra públicos, busca y ordena por populares', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    const futbol = (await crearCanal(ana, { nombre: 'Fútbol hoy', descripcion: 'Goles' })).body.data;
    const cocina = (await crearCanal(beto, { nombre: 'Cocina fácil', descripcion: 'Recetas de goles... no' })).body.data;
    await crearCanal(caro, { nombre: 'Secreto', privacidad: 'privado' });
    await suscribir(caro, cocina.id);

    const todos = await api().get('/api/canales').set(bearer(caro));
    expect(todos.status).toBe(200);
    expect(todos.body.data.map((c: { id: number }) => c.id)).toEqual([cocina.id, futbol.id]);
    expect(todos.body.data[0]).toMatchObject({ mi_rol: 'suscriptor', total_suscriptores: 2 });

    const busqueda = await api().get('/api/canales?q=fútbol');
    expect(busqueda.body.data.map((c: { nombre: string }) => c.nombre)).toEqual(['Fútbol hoy']);
    expect((await api().get('/api/canales?orden=raro')).status).toBe(400);
  });

  it('suscribirse a un público (201), repetir 409; un privado solo con su enlace', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const publico = (await crearCanal(ana)).body.data;
    const privado = (await crearCanal(ana, { nombre: 'VIP', privacidad: 'privado' })).body.data;

    const res = await suscribir(beto, publico.id);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ mi_rol: 'suscriptor', total_suscriptores: 2 });
    expect((await suscribir(beto, publico.id)).status).toBe(409);

    expect((await suscribir(beto, privado.id)).status).toBe(403);
    expect((await api().get(`/api/canales/${privado.id}`).set(bearer(beto))).status).toBe(403);
    expect((await api().get(`/api/canales/${privado.id}/publicaciones`).set(bearer(beto))).status).toBe(403);

    const vistaPrevia = await api().get(`/api/canales/invitacion/${privado.codigo_invitacion}`);
    expect(vistaPrevia.body.data).toMatchObject({ id: privado.id, nombre: 'VIP', mi_rol: null });
    const unido = await api().post(`/api/canales/invitacion/${privado.codigo_invitacion}`).set(bearer(beto));
    expect(unido.status).toBe(201);
    expect(unido.body.data).toMatchObject({ id: privado.id, mi_rol: 'suscriptor' });
    expect((await api().post(`/api/canales/invitacion/${privado.codigo_invitacion}`).set(bearer(beto))).status).toBe(200);
    expect((await api().get(`/api/canales/${privado.id}`).set(bearer(beto))).status).toBe(200);

    expect((await api().get('/api/canales/invitacion/no-existe-123')).status).toBe(404);
    expect((await api().get('/api/canales/invitacion/a$b')).status).toBe(400);
  });

  it('regenerar el enlace invalida el anterior (solo administradores)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const canal = (await crearCanal(ana, { privacidad: 'privado' })).body.data;
    expect((await api().post(`/api/canales/${canal.id}/enlace`).set(bearer(beto))).status).toBe(403);
    const nuevo = await api().post(`/api/canales/${canal.id}/enlace`).set(bearer(ana));
    expect(nuevo.body.data.codigo_invitacion).not.toBe(canal.codigo_invitacion);
    expect((await api().get(`/api/canales/invitacion/${canal.codigo_invitacion}`)).status).toBe(404);
  });

  it('salir y silenciar; el propietario no puede salir', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const canal = (await crearCanal(ana)).body.data;
    await suscribir(beto, canal.id);

    const silencio = await api().put(`/api/canales/${canal.id}/silencio`).set(bearer(beto)).send({ silenciado: true });
    expect(silencio.body.data).toMatchObject({ silenciado: true });
    expect((await api().put(`/api/canales/${canal.id}/silencio`).set(bearer(beto)).send({ silenciado: 'quizá' })).status).toBe(400);

    expect((await api().delete(`/api/canales/${canal.id}/suscripcion`).set(bearer(ana))).status).toBe(400);
    expect((await api().delete(`/api/canales/${canal.id}/suscripcion`).set(bearer(beto))).status).toBe(200);
    expect((await api().delete(`/api/canales/${canal.id}/suscripcion`).set(bearer(beto))).status).toBe(404);
    expect((await Canal.findByPk(canal.id))?.total_suscriptores).toBe(1);
    expect((await api().put(`/api/canales/${canal.id}/silencio`).set(bearer(beto)).send({ silenciado: true })).status).toBe(403);
  });
});

describe('canales: administradores', () => {
  it('el propietario nombra y quita administradores entre los miembros; los admins publican', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    const canal = (await crearCanal(ana)).body.data;
    await suscribir(beto, canal.id);
    const agregar = (de: UsuarioPrueba, usuarioId: number) =>
      api().post(`/api/canales/${canal.id}/administradores`).set(bearer(de)).send({ usuario_id: usuarioId });

    expect((await publicar(beto, canal.id, 'hola')).status).toBe(403);
    expect((await agregar(ana, caro.id)).status).toBe(400); // no es miembro
    expect((await agregar(beto, beto.id)).status).toBe(403);
    expect((await agregar(ana, 999)).status).toBe(404);

    const lista = await agregar(ana, beto.id);
    expect(lista.status).toBe(200);
    expect(lista.body.data.map((a: { usuario_id: number; rol: string }) => [a.usuario_id, a.rol])).toEqual([
      [ana.id, 'propietario'],
      [beto.id, 'admin'],
    ]);
    expect((await agregar(ana, beto.id)).status).toBe(409);
    expect((await publicar(beto, canal.id, 'ya puedo')).status).toBe(201);
    // Un admin ve el enlace y la lista de miembros, pero no gestiona administradores
    expect((await api().get(`/api/canales/${canal.id}`).set(bearer(beto))).body.data.codigo_invitacion).toBe(canal.codigo_invitacion);
    expect((await api().get(`/api/canales/${canal.id}/suscriptores`).set(bearer(beto))).body.meta.total).toBe(2);
    expect((await api().get(`/api/canales/${canal.id}/suscriptores`).set(bearer(caro))).status).toBe(403);

    const quitado = await api().delete(`/api/canales/${canal.id}/administradores/${beto.id}`).set(bearer(ana));
    expect(quitado.body.data).toHaveLength(1);
    expect((await api().delete(`/api/canales/${canal.id}/administradores/${beto.id}`).set(bearer(ana))).status).toBe(404);
    expect((await publicar(beto, canal.id, 'ya no')).status).toBe(403);
    expect((await api().get(`/api/canales/${canal.id}/administradores`)).body.data).toHaveLength(1);
  });
});

describe('canales: publicaciones', () => {
  it('feed con cursor (más nuevas primero), en tiempo real a la sala y validaciones', async () => {
    const ana = await crearUsuario('ana');
    const canal = (await crearCanal(ana)).body.data;
    const sala = vi.spyOn(realtime, 'aSala');

    const ids: number[] = [];
    for (const texto of ['uno', 'dos', 'tres']) {
      const res = await publicar(ana, canal.id, texto);
      expect(res.status).toBe(201);
      ids.push(res.body.data.id);
    }
    expect(sala).toHaveBeenCalledWith(
      `canal_${canal.id}`,
      'canal_publicacion',
      expect.objectContaining({ id: ids[2], texto: 'tres', autor: expect.objectContaining({ id: ana.id }), reacciones: [], total_vistas: 0 }),
    );

    const primera = await api().get(`/api/canales/${canal.id}/publicaciones?limit=2`);
    expect(primera.body.data.map((p: { texto: string }) => p.texto)).toEqual(['tres', 'dos']);
    expect(primera.body.meta).toMatchObject({ total: 3, hayMas: true });
    const anteriores = await api().get(`/api/canales/${canal.id}/publicaciones?limit=2&antes_de=${ids[1]}`);
    expect(anteriores.body.data.map((p: { texto: string }) => p.texto)).toEqual(['uno']);

    const actualizado = await Canal.findByPk(canal.id);
    expect(actualizado?.total_publicaciones).toBe(3);
    expect(actualizado?.ultima_publicacion_en).toBeInstanceOf(Date);

    expect((await publicar(ana, canal.id, '   ')).status).toBe(400);
    expect((await publicar(ana, canal.id, 'x'.repeat(4001))).status).toBe(400);
  });

  it('adjuntos: imagen o documento (con su nombre); audio no', async () => {
    simularSubidas();
    const eliminar = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
    const ana = await crearUsuario('ana');
    const canal = (await crearCanal(ana)).body.data;
    const adjuntar = (nombre: string, tipo: string) =>
      api().post(`/api/canales/${canal.id}/publicaciones`).set(bearer(ana)).attach('archivo', Buffer.from('x'), { filename: nombre, contentType: tipo });

    const pdf = await adjuntar('temario.pdf', 'application/pdf');
    expect(pdf.status).toBe(201);
    expect(pdf.body.data).toMatchObject({ tipo_archivo: 'document', nombre_archivo: 'temario.pdf', texto: '' });
    expect((await adjuntar('foto.png', 'image/png')).body.data).toMatchObject({ tipo_archivo: 'image', nombre_archivo: null });

    const audio = await adjuntar('voz.webm', 'audio/webm');
    expect(audio.status).toBe(400);
    expect(eliminar).toHaveBeenCalledWith('trino/canales/voz.webm');
    expect(await CanalPublicacion.count()).toBe(2);
  });

  it('cuenta una vista por persona con sesión y "mis canales" lleva los no leídos', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const canal = (await crearCanal(ana)).body.data;
    await suscribir(beto, canal.id);
    await publicar(ana, canal.id, 'uno');
    await publicar(ana, canal.id, 'dos');

    const mios = await api().get('/api/canales/mios').set(bearer(beto));
    expect(mios.status).toBe(200);
    expect(mios.body.data[0]).toMatchObject({ id: canal.id, no_leidos: 2, mi_rol: 'suscriptor', ultima_publicacion: { texto: 'dos' } });
    expect((await api().get('/api/canales/mios').set(bearer(ana))).body.data[0].no_leidos).toBe(0);

    const vistas = await api().get(`/api/canales/${canal.id}/publicaciones`).set(bearer(beto));
    expect(vistas.body.data.map((p: { total_vistas: number }) => p.total_vistas)).toEqual([1, 1]);
    await api().get(`/api/canales/${canal.id}/publicaciones`).set(bearer(beto));
    await api().get(`/api/canales/${canal.id}/publicaciones`); // sin sesión no cuenta
    const deCaro = await api().get(`/api/canales/${canal.id}/publicaciones`).set(bearer(caro));
    expect(deCaro.body.data.map((p: { total_vistas: number }) => p.total_vistas)).toEqual([2, 2]);

    // Leer la página más reciente la marca leída
    expect((await api().get('/api/canales/mios').set(bearer(beto))).body.data[0].no_leidos).toBe(0);
    await publicar(ana, canal.id, 'tres');
    expect((await api().get('/api/canales/mios').set(bearer(beto))).body.data[0].no_leidos).toBe(1);
    const lectura = await api().put(`/api/canales/${canal.id}/leer`).set(bearer(beto));
    expect(lectura.status).toBe(200);
    expect((await api().get('/api/canales/mios').set(bearer(beto))).body.data[0].no_leidos).toBe(0);
    expect((await api().put(`/api/canales/${canal.id}/leer`).set(bearer(caro))).status).toBe(404);
  });

  it('solo administradores eliminan; borra el archivo y avisa a la sala', async () => {
    simularSubidas();
    const eliminar = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const canal = (await crearCanal(ana)).body.data;
    await suscribir(beto, canal.id);
    const foto = (
      await api().post(`/api/canales/${canal.id}/publicaciones`).set(bearer(ana)).attach('archivo', Buffer.from('x'), { filename: 'a.png', contentType: 'image/png' })
    ).body.data;

    const ruta = `/api/canales/${canal.id}/publicaciones/${foto.id}`;
    expect((await api().delete(ruta).set(bearer(beto))).status).toBe(403);
    const sala = vi.spyOn(realtime, 'aSala');
    const res = await api().delete(ruta).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(sala).toHaveBeenCalledWith(`canal_${canal.id}`, 'canal_publicacion_eliminada', { canal_id: canal.id, publicacion_id: foto.id });
    expect(eliminar).toHaveBeenCalledWith(expect.stringContaining('a.png'));
    expect((await api().delete(ruta).set(bearer(ana))).status).toBe(404);
    expect((await Canal.findByPk(canal.id))?.total_publicaciones).toBe(0);
  });
});

describe('canales: reacciones a publicaciones', () => {
  it('una por persona; poner, cambiar y quitar; en vivo a la sala; sin sesión 401', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const canal = (await crearCanal(ana)).body.data;
    const pub = (await publicar(ana, canal.id, 'Hola')).body.data;
    const ruta = `/api/canales/${canal.id}/publicaciones/${pub.id}/reaccion`;
    const sala = vi.spyOn(realtime, 'aSala');

    const puesta = await api().put(ruta).set(bearer(beto)).send({ emoji: '🔥' });
    expect(puesta.body.data).toEqual({ canal_id: canal.id, publicacion_id: pub.id, reacciones: [{ emoji: '🔥', total: 1, mia: true }] });
    expect(sala).toHaveBeenCalledWith(`canal_${canal.id}`, 'canal_reaccion', {
      canal_id: canal.id,
      publicacion_id: pub.id,
      usuario_id: beto.id,
      emoji: '🔥',
      reacciones: [{ emoji: '🔥', total: 1 }],
    });
    await api().put(ruta).set(bearer(beto)).send({ emoji: '❤️' });
    await api().put(ruta).set(bearer(ana)).send({ emoji: '❤️' });
    expect(await CanalReaccion.count()).toBe(2);

    const feed = await api().get(`/api/canales/${canal.id}/publicaciones`).set(bearer(ana));
    expect(feed.body.data[0].reacciones).toEqual([{ emoji: '❤️', total: 2, mia: true }]);
    const anonimo = await api().get(`/api/canales/${canal.id}/publicaciones`);
    expect(anonimo.body.data[0].reacciones).toEqual([{ emoji: '❤️', total: 2, mia: false }]);

    expect((await api().delete(ruta).set(bearer(beto))).body.data.reacciones).toEqual([{ emoji: '❤️', total: 1, mia: false }]);
    expect((await api().put(ruta).send({ emoji: '❤️' })).status).toBe(401);
    expect((await api().put(ruta).set(bearer(beto)).send({ emoji: '🍕' })).status).toBe(400);
    expect((await api().put(`/api/canales/${canal.id}/publicaciones/999/reaccion`).set(bearer(beto)).send({ emoji: '👍' })).status).toBe(404);
  });

  it('en un canal privado solo reaccionan sus miembros', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const canal = (await crearCanal(ana, { privacidad: 'privado' })).body.data;
    const pub = (await publicar(ana, canal.id, 'Secreto')).body.data;
    expect((await api().put(`/api/canales/${canal.id}/publicaciones/${pub.id}/reaccion`).set(bearer(beto)).send({ emoji: '👍' })).status).toBe(403);
  });
});

describe('canales: avisos a suscriptores', () => {
  it('pocos suscriptores: una notificación canal_publicacion por persona no silenciada (no al autor)', async () => {
    const [ana, beto, caro, dani] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro'), await crearUsuario('dani')];
    const canal = (await crearCanal(ana)).body.data;
    for (const u of [beto, caro, dani]) await suscribir(u, canal.id);
    await api().put(`/api/canales/${canal.id}/silencio`).set(bearer(dani)).send({ silenciado: true });

    await publicar(ana, canal.id, 'Hay noticias');
    const notificaciones = await Notificacion.findAll({ where: { tipo: 'canal_publicacion' } });
    expect(notificaciones.map((n) => n.usuario_id).sort()).toEqual([beto.id, caro.id].sort());
    expect(notificaciones[0]).toMatchObject({ de_usuario_id: ana.id, entidad_tipo: 'canal', entidad_id: canal.id, mensaje: 'publicó en «Noticias»' });
  });

  it('más de 200: no guarda notificaciones y manda push por lotes de tokens', async () => {
    const ana = await crearUsuario('ana');
    const canal = (await crearCanal(ana)).body.data;
    // 205 suscriptores creados directo en la base (registrar uno por uno sería lento)
    const usuarios = await Usuario.bulkCreate(
      Array.from({ length: 205 }, (_, i) => ({
        nombre_usuario: `fan${i}`,
        email: `fan${i}@test.com`,
        nombre_completo: `Fan ${i}`,
        contrasena: 'x',
      })),
    );
    await CanalMiembro.bulkCreate(usuarios.map((u) => ({ canal_id: canal.id, usuario_id: u.id })));
    await Dispositivo.bulkCreate(usuarios.slice(0, 3).map((u, i) => ({ usuario_id: u.id, token: `token-${i}`, plataforma: 'android' })));
    const enviar = vi.spyOn(dispositivoService, 'enviar').mockResolvedValue();

    expect((await publicar(ana, canal.id, 'Para miles')).status).toBe(201);
    expect(await Notificacion.count({ where: { tipo: 'canal_publicacion' } })).toBe(0);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledWith(['token-0', 'token-1', 'token-2'], {
      titulo: 'Noticias',
      cuerpo: 'Para miles',
      datos: { tipo: 'canal_publicacion', de_usuario_id: String(ana.id), entidad_tipo: 'canal', entidad_id: String(canal.id) },
    });
  });
});

describe('canales: eliminar', () => {
  it('solo el propietario; borra publicaciones y archivos', async () => {
    simularSubidas();
    const eliminar = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const canal = (await crearCanal(ana)).body.data;
    await suscribir(beto, canal.id);
    await api().post(`/api/canales/${canal.id}/administradores`).set(bearer(ana)).send({ usuario_id: beto.id });
    await api().post(`/api/canales/${canal.id}/publicaciones`).set(bearer(ana)).attach('archivo', Buffer.from('x'), { filename: 'b.pdf', contentType: 'application/pdf' });

    expect((await api().delete(`/api/canales/${canal.id}`).set(bearer(beto))).status).toBe(403);
    expect((await api().delete(`/api/canales/${canal.id}`).set(bearer(ana))).status).toBe(200);
    expect(eliminar).toHaveBeenCalledWith(expect.stringContaining('b.pdf'));
    expect(await Canal.count()).toBe(0);
    expect(await CanalPublicacion.count()).toBe(0);
    expect(await CanalMiembro.count()).toBe(0);
  });
});
