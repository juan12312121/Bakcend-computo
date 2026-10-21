import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Comentario, ComentarioLike, Notificacion, Publicacion, Seguidor, type Visibilidad } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { comentarioRoutes } from '../src/modules/comentarios/comentario.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos } from './helpers';

beforeAll(() => usarModulos({ '/comentarios': comentarioRoutes }));
beforeEach(reiniciarBD);
afterEach(() => vi.restoreAllMocks());

const publicar = (usuario_id: number, visibilidad: Visibilidad = 'publico') =>
  Publicacion.create({ usuario_id, contenido: 'Publicación de prueba', visibilidad });

const comentar = (u: { token: string }, publicacion_id: number, texto = 'Buen post', padre_id?: number) =>
  api().post('/api/comentarios').set({ Authorization: `Bearer ${u.token}` }).send({ publicacion_id, texto, padre_id });

describe('comentarios: crear', () => {
  it('crea con autor, suma al contador y notifica al autor de la publicación', async () => {
    const autor = await crearUsuario();
    const lector = await crearUsuario();
    const pub = await publicar(autor.id);

    const res = await comentar(lector, pub.id, '  Hola!  ');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ publicacion_id: pub.id, usuario_id: lector.id, texto: 'Hola!' });
    expect(res.body.data.autor).toMatchObject({ id: lector.id, nombre_usuario: lector.nombre_usuario });
    expect(res.body.data.autor.contrasena).toBeUndefined();

    await pub.reload();
    expect(pub.total_comentarios).toBe(1);
    const avisos = await Notificacion.findAll({ where: { usuario_id: autor.id } });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ de_usuario_id: lector.id, tipo: 'comment', publicacion_id: pub.id });
  });

  it('no se notifica a sí mismo al comentar su propia publicación', async () => {
    const autor = await crearUsuario();
    const pub = await publicar(autor.id);
    expect((await comentar(autor, pub.id)).status).toBe(201);
    expect(await Notificacion.count()).toBe(0);
  });

  it('una publicación privada ajena responde 404 al comentar y al listar', async () => {
    const autor = await crearUsuario();
    const otro = await crearUsuario();
    const pub = await publicar(autor.id, 'privado');

    expect((await comentar(otro, pub.id)).status).toBe(404);
    expect((await api().get(`/api/comentarios/publicacion/${pub.id}`).set(bearer(otro))).status).toBe(404);
    expect((await api().get(`/api/comentarios/publicacion/${pub.id}`)).status).toBe(404);
    expect((await comentar(autor, pub.id)).status).toBe(201);
  });

  it('solo seguidores comentan publicaciones "seguidores"', async () => {
    const autor = await crearUsuario();
    const seguidor = await crearUsuario();
    const pub = await publicar(autor.id, 'seguidores');

    expect((await comentar(seguidor, pub.id)).status).toBe(404);
    await Seguidor.create({ seguidor_id: seguidor.id, siguiendo_id: autor.id });
    expect((await comentar(seguidor, pub.id)).status).toBe(201);
  });

  it('exige sesión para comentar', async () => {
    const res = await api().post('/api/comentarios').send({ publicacion_id: 1, texto: 'x' });
    expect(res.status).toBe(401);
  });

  it('valida el cuerpo (400)', async () => {
    const u = await crearUsuario();
    const pub = await publicar(u.id);

    const sinNada = await api().post('/api/comentarios').set(bearer(u)).send({});
    expect(sinNada.status).toBe(400);
    expect(sinNada.body.errores.map((e: { campo: string }) => e.campo)).toEqual(expect.arrayContaining(['publicacion_id', 'texto']));

    expect((await comentar(u, pub.id, '   ')).status).toBe(400);
    expect((await comentar(u, pub.id, 'a'.repeat(1001))).status).toBe(400);
    expect((await api().post('/api/comentarios').set(bearer(u)).send({ publicacion_id: 'abc', texto: 'x' })).status).toBe(400);
    expect((await api().get('/api/comentarios/publicacion/abc')).status).toBe(400);
  });
});

describe('comentarios: listar', () => {
  it('lista paginada por publicación, con autor y meta', async () => {
    const autor = await crearUsuario();
    const lector = await crearUsuario();
    const pub = await publicar(autor.id);
    for (const texto of ['uno', 'dos', 'tres']) await comentar(lector, pub.id, texto);

    const res = await api().get(`/api/comentarios/publicacion/${pub.id}?limit=2`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].texto).toBe('tres');
    expect(res.body.data[0].autor.id).toBe(lector.id);
    expect(res.body.meta).toEqual({ total: 3, limit: 2, offset: 0, hayMas: true });
  });

  it('los comentarios de un usuario omiten los de publicaciones que no puedo ver', async () => {
    const autor = await crearUsuario();
    const comentarista = await crearUsuario();
    const visitante = await crearUsuario();
    const publica = await publicar(autor.id);
    const privada = await publicar(autor.id, 'privado');
    await comentar(comentarista, publica.id, 'en pública');
    await comentar(autor, privada.id, 'en privada');
    await comentar(autor, publica.id, 'del autor');

    const delAutor = await api().get(`/api/comentarios/usuario/${autor.id}`).set(bearer(visitante));
    expect(delAutor.body.data.map((c: { texto: string }) => c.texto)).toEqual(['del autor']);
    expect(delAutor.body.meta.total).toBe(1);

    const comoAutor = await api().get(`/api/comentarios/usuario/${autor.id}`).set(bearer(autor));
    expect(comoAutor.body.meta.total).toBe(2);
  });

  it('un comentario suelto de una publicación privada es 404 para otros', async () => {
    const autor = await crearUsuario();
    const pub = await publicar(autor.id, 'privado');
    const { body } = await comentar(autor, pub.id);

    expect((await api().get(`/api/comentarios/${body.data.id}`)).status).toBe(404);
    const propio = await api().get(`/api/comentarios/${body.data.id}`).set(bearer(autor));
    expect(propio.status).toBe(200);
    expect(propio.body.data.autor.id).toBe(autor.id);
  });
});

describe('comentarios: editar y borrar', () => {
  it('solo el autor del comentario puede editarlo', async () => {
    const autor = await crearUsuario();
    const lector = await crearUsuario();
    const pub = await publicar(autor.id);
    const { body } = await comentar(lector, pub.id, 'original');

    const ajeno = await api().put(`/api/comentarios/${body.data.id}`).set(bearer(autor)).send({ texto: 'hackeado' });
    expect(ajeno.status).toBe(403);

    const propio = await api().put(`/api/comentarios/${body.data.id}`).set(bearer(lector)).send({ texto: 'editado' });
    expect(propio.status).toBe(200);
    expect(propio.body.data).toMatchObject({ texto: 'editado', autor: { id: lector.id } });

    expect((await api().put(`/api/comentarios/${body.data.id}`).set(bearer(lector)).send({ texto: '' })).status).toBe(400);
    expect((await api().put('/api/comentarios/999').set(bearer(lector)).send({ texto: 'x' })).status).toBe(404);
  });

  it('el autor de la publicación puede borrar comentarios ajenos; baja el contador y se retira el aviso', async () => {
    const autor = await crearUsuario();
    const lector = await crearUsuario();
    const pub = await publicar(autor.id);
    const { body } = await comentar(lector, pub.id);
    expect(await Notificacion.count()).toBe(1);

    const res = await api().delete(`/api/comentarios/${body.data.id}`).set(bearer(autor));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, mensaje: 'Comentario eliminado' });

    await pub.reload();
    expect(pub.total_comentarios).toBe(0);
    expect(await Notificacion.count()).toBe(0);
    expect((await api().get(`/api/comentarios/${body.data.id}`)).status).toBe(404);
  });

  it('el autor del comentario lo borra; un tercero recibe 403', async () => {
    const autor = await crearUsuario();
    const lector = await crearUsuario();
    const tercero = await crearUsuario();
    const pub = await publicar(autor.id);
    const primero = await comentar(lector, pub.id, 'uno');
    await comentar(lector, pub.id, 'dos');

    expect((await api().delete(`/api/comentarios/${primero.body.data.id}`).set(bearer(tercero))).status).toBe(403);
    expect((await api().delete(`/api/comentarios/${primero.body.data.id}`).set(bearer(lector))).status).toBe(200);

    await pub.reload();
    expect(pub.total_comentarios).toBe(1);
    // Aún le queda un comentario: el aviso se conserva.
    expect(await Notificacion.count({ where: { usuario_id: autor.id } })).toBeGreaterThan(0);
  });
});

describe('comentarios: respuestas', () => {
  it('responde a un comentario, cuelga las respuestas de respuestas del primer nivel y ajusta contadores', async () => {
    const autor = await crearUsuario();
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const pub = await publicar(autor.id);
    const raiz = (await comentar(ana, pub.id, 'raíz')).body.data;

    const r1 = await comentar(beto, pub.id, 'respuesta', raiz.id);
    expect(r1.status).toBe(201);
    expect(r1.body.data).toMatchObject({ padre_id: raiz.id, total_likes: 0, total_respuestas: 0, yo_di_like: false });
    // Responder a una respuesta: se cuelga de la raíz (un solo nivel)
    const r2 = await comentar(ana, pub.id, 'otra', r1.body.data.id);
    expect(r2.body.data.padre_id).toBe(raiz.id);

    expect((await Comentario.findByPk(raiz.id))!.total_respuestas).toBe(2);
    expect((await Publicacion.findByPk(pub.id))!.total_comentarios).toBe(3);

    // El listado de la publicación solo trae el primer nivel, con su total de respuestas
    const lista = await api().get(`/api/comentarios/publicacion/${pub.id}`);
    expect(lista.body.meta.total).toBe(1);
    expect(lista.body.data[0]).toMatchObject({ id: raiz.id, total_respuestas: 2, yo_di_like: false });

    // Respuestas paginadas, más viejas primero
    const respuestas = await api().get(`/api/comentarios/${raiz.id}/respuestas?limit=1`);
    expect(respuestas.status).toBe(200);
    expect(respuestas.body.data.map((c: { texto: string }) => c.texto)).toEqual(['respuesta']);
    expect(respuestas.body.meta).toEqual({ total: 2, limit: 1, offset: 0, hayMas: true });
    expect(respuestas.body.data[0].autor.id).toBe(beto.id);
  });

  it('notifica respuesta_comentario al autor del comentario y comment al de la publicación', async () => {
    const autor = await crearUsuario();
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const pub = await publicar(autor.id);
    const raiz = (await comentar(ana, pub.id, 'raíz')).body.data;
    const r = (await comentar(beto, pub.id, 'te respondo', raiz.id)).body.data;

    const aAna = await Notificacion.findAll({ where: { usuario_id: ana.id } });
    expect(aAna).toHaveLength(1);
    expect(aAna[0]).toMatchObject({
      tipo: 'respuesta_comentario',
      de_usuario_id: beto.id,
      publicacion_id: pub.id,
      entidad_tipo: 'comentario',
      entidad_id: r.id,
      mensaje: 'respondió a tu comentario',
    });
    expect(await Notificacion.count({ where: { usuario_id: autor.id, de_usuario_id: beto.id, tipo: 'comment' } })).toBe(1);

    // Si respondo a un comentario del autor de la publicación, solo recibe el aviso de respuesta
    const delAutor = (await comentar(autor, pub.id, 'gracias')).body.data;
    await comentar(beto, pub.id, 'de nada', delAutor.id);
    expect(await Notificacion.count({ where: { usuario_id: autor.id, de_usuario_id: beto.id } })).toBe(2);
  });

  it('valida el padre: debe existir (404) y ser de la misma publicación (400)', async () => {
    const autor = await crearUsuario();
    const pub = await publicar(autor.id);
    const otra = await publicar(autor.id);
    const ajeno = (await comentar(autor, otra.id, 'en otra')).body.data;

    expect((await comentar(autor, pub.id, 'x', 999)).status).toBe(404);
    expect((await comentar(autor, pub.id, 'x', ajeno.id)).status).toBe(400);
    expect((await api().get('/api/comentarios/999/respuestas')).status).toBe(404);
  });

  it('las respuestas de una publicación privada son 404 para otros', async () => {
    const autor = await crearUsuario();
    const otro = await crearUsuario();
    const pub = await publicar(autor.id, 'privado');
    const raiz = (await comentar(autor, pub.id, 'raíz')).body.data;
    expect((await api().get(`/api/comentarios/${raiz.id}/respuestas`).set(bearer(otro))).status).toBe(404);
    expect((await comentar(otro, pub.id, 'x', raiz.id)).status).toBe(404);
  });

  it('borrar un comentario borra sus respuestas, sus likes, ajusta contadores y retira avisos', async () => {
    const autor = await crearUsuario();
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const pub = await publicar(autor.id);
    const raiz = (await comentar(ana, pub.id, 'raíz')).body.data;
    const r1 = (await comentar(beto, pub.id, 'r1', raiz.id)).body.data;
    await comentar(beto, pub.id, 'r2', raiz.id);
    await api().post(`/api/comentarios/${r1.id}/like`).set(bearer(ana));
    expect((await Publicacion.findByPk(pub.id))!.total_comentarios).toBe(3);

    // Borrar una respuesta descuenta al padre y a la publicación
    expect((await api().delete(`/api/comentarios/${r1.id}`).set(bearer(beto))).status).toBe(200);
    expect((await Comentario.findByPk(raiz.id))!.total_respuestas).toBe(1);
    expect((await Publicacion.findByPk(pub.id))!.total_comentarios).toBe(2);
    expect(await ComentarioLike.count()).toBe(0);
    expect(await Notificacion.count({ where: { usuario_id: ana.id, tipo: 'respuesta_comentario' } })).toBe(1);

    // Borrar la raíz se lleva la respuesta que queda
    expect((await api().delete(`/api/comentarios/${raiz.id}`).set(bearer(autor))).status).toBe(200);
    expect(await Comentario.count()).toBe(0);
    expect((await Publicacion.findByPk(pub.id))!.total_comentarios).toBe(0);
    expect(await Notificacion.count({ where: { tipo: ['comment', 'respuesta_comentario'] } })).toBe(0);
  });
});

describe('comentarios: likes', () => {
  it('toggle de like en un comentario con contador, yo_di_like y aviso al autor', async () => {
    const autor = await crearUsuario();
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const pub = await publicar(autor.id);
    const c = (await comentar(ana, pub.id, 'me gustan los likes')).body.data;
    const emitir = vi.spyOn(realtime, 'aTodos');

    const dar = await api().post(`/api/comentarios/${c.id}/like`).set(bearer(beto));
    expect(dar.status).toBe(200);
    expect(dar.body.data).toEqual({ comentario_id: c.id, publicacion_id: pub.id, yo_di_like: true, total_likes: 1 });
    expect(emitir).toHaveBeenCalledWith('comentario_like_update', { comentario_id: c.id, publicacion_id: pub.id, total_likes: 1 });

    const aviso = await Notificacion.findOne({ where: { usuario_id: ana.id, tipo: 'like_comentario' } });
    expect(aviso).toMatchObject({ de_usuario_id: beto.id, publicacion_id: pub.id, entidad_tipo: 'comentario', entidad_id: c.id });

    const lista = await api().get(`/api/comentarios/publicacion/${pub.id}`).set(bearer(beto));
    expect(lista.body.data[0]).toMatchObject({ total_likes: 1, yo_di_like: true });
    expect((await api().get(`/api/comentarios/publicacion/${pub.id}`)).body.data[0].yo_di_like).toBe(false);
    expect((await api().get(`/api/comentarios/${c.id}`).set(bearer(beto))).body.data.yo_di_like).toBe(true);

    const quitar = await api().post(`/api/comentarios/${c.id}/like`).set(bearer(beto));
    expect(quitar.body.data).toMatchObject({ yo_di_like: false, total_likes: 0 });
    expect(await Notificacion.count({ where: { tipo: 'like_comentario' } })).toBe(0);
  });

  it('exige sesión, comentario existente y publicación visible', async () => {
    const autor = await crearUsuario();
    const otro = await crearUsuario();
    const pub = await publicar(autor.id, 'privado');
    const c = (await comentar(autor, pub.id)).body.data;

    expect((await api().post(`/api/comentarios/${c.id}/like`)).status).toBe(401);
    expect((await api().post('/api/comentarios/999/like').set(bearer(otro))).status).toBe(404);
    expect((await api().post(`/api/comentarios/${c.id}/like`).set(bearer(otro))).status).toBe(404);
    expect(await ComentarioLike.count()).toBe(0);
  });
});

describe('comentarios: menciones', () => {
  it('avisa a los @mencionados que pueden ver la publicación', async () => {
    const autor = await crearUsuario();
    const carla = await crearUsuario('carla_m');
    const pub = await publicar(autor.id);

    const res = await comentar(autor, pub.id, 'Mira esto @carla_m');
    expect(res.status).toBe(201);
    const aviso = await Notificacion.findOne({ where: { usuario_id: carla.id, tipo: 'mencion' } });
    expect(aviso).toMatchObject({ de_usuario_id: autor.id, publicacion_id: pub.id, entidad_tipo: 'comentario', entidad_id: res.body.data.id });
  });
});
