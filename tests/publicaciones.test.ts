import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  Documento,
  Grupo,
  GrupoMiembro,
  Like,
  Notificacion,
  Publicacion,
  PublicacionNoInteresa,
  PublicacionOculta,
  Seguidor,
  Usuario,
} from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { fileStorage } from '../src/infrastructure/storage/CloudinaryStorage';
import { documentoRoutes } from '../src/modules/documentos/documento.routes';
import { likeRoutes } from '../src/modules/likes/like.routes';
import { publicacionRoutes } from '../src/modules/publicaciones/publicacion.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/publicaciones': publicacionRoutes, '/likes': likeRoutes, '/documentos': documentoRoutes }));
let eliminarArchivo: MockInstance<typeof fileStorage.eliminar>;

beforeEach(async () => {
  await reiniciarBD();
  // Nunca se llama a Cloudinary en pruebas: solo se verifica qué se pidió borrar
  eliminarArchivo = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

/** Crea una publicación por la API (JSON, sin archivos). */
async function publicar(u: UsuarioPrueba, datos: Record<string, unknown> = {}) {
  const res = await api()
    .post('/api/publicaciones')
    .set(bearer(u))
    .send({ contenido: 'Hola mundo', ...datos });
  if (res.status !== 201) throw new Error(`No se pudo publicar: ${JSON.stringify(res.body)}`);
  return res.body.data as { id: number; [k: string]: unknown };
}

const idsDe = (body: { data: { id: number }[] }) => body.data.map((p) => p.id);

describe('publicaciones: crear y validar', () => {
  it('crea con JSON, asigna color de categoría y suma total_posts', async () => {
    const ana = await crearUsuario('ana');
    const emitir = vi.spyOn(realtime, 'aTodos');

    const res = await api()
      .post('/api/publicaciones')
      .set(bearer(ana))
      .send({ contenido: 'Mi primer post', categoria: 'Tecnología', visibilidad: 'seguidores' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      contenido: 'Mi primer post',
      categoria: 'Tecnología',
      color_categoria: 'bg-teal-500',
      visibilidad: 'seguidores',
      grupo_id: null,
      documentos: [],
      usuario_dio_like: false,
      autor: { id: ana.id, nombre_usuario: 'ana' },
    });
    expect(res.body.data.autor.contrasena).toBeUndefined();
    expect((await Usuario.findByPk(ana.id))!.total_posts).toBe(1);
    expect(emitir).toHaveBeenCalledWith('new_post', expect.objectContaining({ id: res.body.data.id }));
  });

  it('usa General / publico por defecto', async () => {
    const ana = await crearUsuario('ana');
    const pub = await publicar(ana);
    expect(pub).toMatchObject({ categoria: 'General', color_categoria: 'bg-orange-500', visibilidad: 'publico' });
  });

  it('valida contenido, categoría, visibilidad y grupo_id con 400', async () => {
    const ana = await crearUsuario('ana');
    const res = await api()
      .post('/api/publicaciones')
      .set(bearer(ana))
      .send({ contenido: '   ', categoria: 'Cocina', visibilidad: 'amigos', grupo_id: 'x' });

    expect(res.status).toBe(400);
    const campos = res.body.errores.map((e: { campo: string }) => e.campo);
    expect(campos).toEqual(expect.arrayContaining(['contenido', 'categoria', 'visibilidad', 'grupo_id']));

    const largo = await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'a'.repeat(5001) });
    expect(largo.status).toBe(400);

    const sinToken = await api().post('/api/publicaciones').send({ contenido: 'hola' });
    expect(sinToken.status).toBe(401);

    const idMalo = await api().get('/api/publicaciones/abc');
    expect(idMalo.status).toBe(400);
  });

  it('en un grupo exige ser miembro activo y no aparece en el feed', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const grupo = await Grupo.create({ nombre: 'Club', creador_id: beto.id });

    const ajeno = await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'hola grupo', grupo_id: grupo.id });
    expect(ajeno.status).toBe(403);

    await GrupoMiembro.create({ grupo_id: grupo.id, usuario_id: ana.id, estado: 'pendiente' });
    const pendiente = await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'hola grupo', grupo_id: grupo.id });
    expect(pendiente.status).toBe(403);

    await GrupoMiembro.update({ estado: 'activo' }, { where: { grupo_id: grupo.id, usuario_id: ana.id } });
    const sala = vi.spyOn(realtime, 'aSala');
    const enGrupo = await publicar(ana, { grupo_id: String(grupo.id) });
    expect(enGrupo.grupo_id).toBe(grupo.id);
    expect(sala).toHaveBeenCalledWith(`group_${grupo.id}`, 'new_post', expect.objectContaining({ id: enGrupo.id }));

    const feed = await api().get('/api/publicaciones').set(bearer(beto));
    expect(idsDe(feed.body)).not.toContain(enGrupo.id);
  });

  it('catálogos de categorías y visibilidades', async () => {
    const cat = await api().get('/api/publicaciones/categorias');
    expect(cat.body.data).toHaveLength(14);
    expect(cat.body.data[0]).toEqual({ value: 'General', label: 'General', color: 'bg-orange-500' });

    const vis = await api().get('/api/publicaciones/visibilidades');
    expect(vis.body.data.map((v: { value: string }) => v.value)).toEqual(['publico', 'seguidores', 'privado']);
  });
});

describe('publicaciones: feed y visibilidad', () => {
  it('feed paginado: públicas de otros + todas las mías, sin privadas ajenas', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const publica = await publicar(beto);
    const privada = await publicar(beto, { visibilidad: 'privado' });
    const deSeguidores = await publicar(beto, { visibilidad: 'seguidores' });
    const miPrivada = await publicar(ana, { visibilidad: 'privado' });

    const res = await api().get('/api/publicaciones?limit=10').set(bearer(ana));
    expect(res.status).toBe(200);
    expect(idsDe(res.body)).toEqual([miPrivada.id, publica.id]);
    expect(res.body.meta).toEqual({ total: 2, limit: 10, offset: 0, hayMas: false });
    expect(idsDe(res.body)).not.toContain(privada.id);
    expect(idsDe(res.body)).not.toContain(deSeguidores.id);

    const pagina = await api().get('/api/publicaciones?limit=1&offset=1').set(bearer(ana));
    expect(idsDe(pagina.body)).toEqual([publica.id]);

    const anonimo = await api().get('/api/publicaciones');
    expect(idsDe(anonimo.body)).toEqual([publica.id]);
    expect(anonimo.body.data[0].usuario_dio_like).toBe(false);
  });

  it('"seguidores" solo lo ve quien sigue al autor; "privado" solo el autor', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const paraSeguidores = await publicar(beto, { visibilidad: 'seguidores' });
    const privada = await publicar(beto, { visibilidad: 'privado' });

    expect((await api().get(`/api/publicaciones/${paraSeguidores.id}`).set(bearer(ana))).status).toBe(404);
    expect((await api().get(`/api/publicaciones/${paraSeguidores.id}`)).status).toBe(404);

    await Seguidor.create({ seguidor_id: ana.id, siguiendo_id: beto.id });
    const detalle = await api().get(`/api/publicaciones/${paraSeguidores.id}`).set(bearer(ana));
    expect(detalle.status).toBe(200);
    expect(detalle.body.data).toMatchObject({ id: paraSeguidores.id, documentos: [], usuario_dio_like: false });

    const feed = await api().get('/api/publicaciones').set(bearer(ana));
    expect(idsDe(feed.body)).toContain(paraSeguidores.id);

    expect((await api().get(`/api/publicaciones/${privada.id}`).set(bearer(ana))).status).toBe(404);
    expect((await api().get(`/api/publicaciones/${privada.id}`).set(bearer(beto))).status).toBe(200);

    const perfil = await api().get(`/api/publicaciones/usuario/${beto.id}`).set(bearer(ana));
    expect(idsDe(perfil.body)).toEqual([paraSeguidores.id]);

    const mias = await api().get('/api/publicaciones/mis-publicaciones').set(bearer(beto));
    expect(idsDe(mias.body)).toEqual([privada.id, paraSeguidores.id]);
  });

  it('el feed excluye ocultas y "no me interesa"', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const p1 = await publicar(beto, { contenido: 'uno' });
    const p2 = await publicar(beto, { contenido: 'dos' });
    const p3 = await publicar(beto, { contenido: 'tres' });

    await PublicacionOculta.create({ usuario_id: ana.id, publicacion_id: p1.id });
    await PublicacionNoInteresa.create({ usuario_id: ana.id, publicacion_id: p2.id, categoria: 'General' });

    const deAna = await api().get('/api/publicaciones').set(bearer(ana));
    expect(idsDe(deAna.body)).toEqual([p3.id]);

    const deBeto = await api().get('/api/publicaciones').set(bearer(beto));
    expect(idsDe(deBeto.body)).toEqual([p3.id, p2.id, p1.id]);
  });

  it('busca por contenido o autor respetando visibilidad y valida q', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const visible = await publicar(beto, { contenido: 'Taller de robótica' });
    await publicar(beto, { contenido: 'Robótica secreta', visibilidad: 'privado' });

    const porContenido = await api().get('/api/publicaciones/buscar?q=rob').set(bearer(ana));
    expect(idsDe(porContenido.body)).toEqual([visible.id]);

    const porAutor = await api().get('/api/publicaciones/buscar?q=beto').set(bearer(ana));
    expect(idsDe(porAutor.body)).toEqual([visible.id]);

    const sinQ = await api().get('/api/publicaciones/buscar').set(bearer(ana));
    expect(sinQ.status).toBe(400);
  });
});

describe('publicaciones: editar y borrar', () => {
  it('solo el autor edita (403 ajeno) y la categoría actualiza el color', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const pub = await publicar(ana);

    const ajeno = await api().put(`/api/publicaciones/${pub.id}`).set(bearer(beto)).send({ contenido: 'hackeado' });
    expect(ajeno.status).toBe(403);

    const emitir = vi.spyOn(realtime, 'aTodos');
    const res = await api().put(`/api/publicaciones/${pub.id}`).set(bearer(ana)).send({ contenido: 'Editado', categoria: 'Deportes' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ contenido: 'Editado', categoria: 'Deportes', color_categoria: 'bg-blue-500' });
    expect(emitir).toHaveBeenCalledWith('update_post', expect.objectContaining({ id: pub.id }));

    const vacio = await api().put(`/api/publicaciones/${pub.id}`).set(bearer(ana)).send({});
    expect(vacio.status).toBe(400);

    const invalida = await api().put(`/api/publicaciones/${pub.id}`).set(bearer(ana)).send({ visibilidad: 'todos' });
    expect(invalida.status).toBe(400);
  });

  it('solo el autor borra; borrar resta total_posts, quita adjuntos y avisa', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const pub = await publicar(ana);
    await Documento.create({
      usuario_id: ana.id,
      publicacion_id: pub.id,
      documento_s3: 'trino/documentos/x',
      nombre_archivo: 'apuntes.pdf',
      tamano_archivo: 100,
      tipo_archivo: 'application/pdf',
    });

    expect((await api().delete(`/api/publicaciones/${pub.id}`).set(bearer(beto))).status).toBe(403);

    const emitir = vi.spyOn(realtime, 'aTodos');
    const res = await api().delete(`/api/publicaciones/${pub.id}`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, mensaje: 'Publicación eliminada correctamente' });
    expect(emitir).toHaveBeenCalledWith('delete_post', { id: pub.id });

    expect(await Publicacion.count()).toBe(0);
    expect(await Documento.count()).toBe(0);
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/documentos/x');
    expect((await Usuario.findByPk(ana.id))!.total_posts).toBe(0);
    expect((await api().get(`/api/publicaciones/${pub.id}`).set(bearer(ana))).status).toBe(404);
  });
});

describe('likes', () => {
  it('toggle da y quita like, ajusta el contador, notifica y emite like_update', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const pub = await publicar(ana);
    const emitir = vi.spyOn(realtime, 'aTodos');

    const dar = await api().post('/api/likes/toggle').set(bearer(beto)).send({ publicacion_id: pub.id });
    expect(dar.status).toBe(201);
    expect(dar.body.data).toEqual({ publicacion_id: pub.id, liked: true, usuario_dio_like: true, total_likes: 1 });
    expect((await Publicacion.findByPk(pub.id))!.total_likes).toBe(1);
    expect(emitir).toHaveBeenCalledWith('like_update', expect.objectContaining({ publicacion_id: pub.id, total: 1 }));

    const notificaciones = await Notificacion.findAll({ where: { usuario_id: ana.id } });
    expect(notificaciones).toHaveLength(1);
    expect(notificaciones[0]).toMatchObject({ de_usuario_id: beto.id, tipo: 'like', publicacion_id: pub.id });

    const detalle = await api().get(`/api/publicaciones/${pub.id}`).set(bearer(beto));
    expect(detalle.body.data).toMatchObject({ usuario_dio_like: true, total_likes: 1 });
    const feed = await api().get('/api/publicaciones').set(bearer(beto));
    expect(feed.body.data[0].usuario_dio_like).toBe(true);

    const verificar = await api().get(`/api/likes/verificar/${pub.id}`).set(bearer(beto));
    expect(verificar.body.data).toMatchObject({ liked: true, total_likes: 1 });

    const quien = await api().get(`/api/likes/publicacion/${pub.id}`);
    expect(quien.body.data[0].usuario).toMatchObject({ id: beto.id, nombre_usuario: 'beto' });
    expect(quien.body.meta.total).toBe(1);

    const mis = await api().get('/api/likes/usuario/mis-likes').set(bearer(beto));
    expect(mis.body.data[0].publicacion).toMatchObject({ id: pub.id, contenido: 'Hola mundo' });

    const quitar = await api().post('/api/likes/toggle').set(bearer(beto)).send({ publicacion_id: pub.id });
    expect(quitar.status).toBe(200);
    expect(quitar.body.data).toMatchObject({ liked: false, total_likes: 0 });
    expect((await Publicacion.findByPk(pub.id))!.total_likes).toBe(0);
    expect(await Notificacion.count({ where: { usuario_id: ana.id } })).toBe(0);

    const total = await api().get(`/api/likes/total/${pub.id}`);
    expect(total.body.data).toMatchObject({ total: 0, total_likes: 0 });
  });

  it('agregar dos veces es 409; eliminar sin like es 404; like propio no notifica', async () => {
    const ana = await crearUsuario('ana');
    const pub = await publicar(ana);

    expect((await api().post('/api/likes/agregar').set(bearer(ana)).send({ publicacion_id: pub.id })).status).toBe(201);
    expect((await api().post('/api/likes/agregar').set(bearer(ana)).send({ publicacion_id: pub.id })).status).toBe(409);
    expect(await Like.count()).toBe(1);
    expect(await Notificacion.count()).toBe(0);

    expect((await api().delete('/api/likes/eliminar').set(bearer(ana)).send({ publicacion_id: pub.id })).status).toBe(200);
    expect((await api().delete('/api/likes/eliminar').set(bearer(ana)).send({ publicacion_id: pub.id })).status).toBe(404);
  });

  it('no se puede dar like a lo que no se puede ver y valida el body', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const privada = await publicar(ana, { visibilidad: 'privado' });

    const res = await api().post('/api/likes/toggle').set(bearer(beto)).send({ publicacion_id: privada.id });
    expect(res.status).toBe(404);
    expect(await Like.count()).toBe(0);

    const sinId = await api().post('/api/likes/toggle').set(bearer(beto)).send({});
    expect(sinId.status).toBe(400);
    expect(sinId.body.errores[0].campo).toBe('publicacion_id');

    expect((await api().get(`/api/likes/publicacion/${privada.id}`)).status).toBe(404);
  });
});

describe('documentos', () => {
  async function documentoDe(u: UsuarioPrueba, publicacionId: number | null = null) {
    return Documento.create({
      usuario_id: u.id,
      publicacion_id: publicacionId,
      documento_url: 'https://res.cloudinary.com/demo/raw/upload/doc.pdf',
      documento_s3: 'trino/documentos/doc',
      nombre_archivo: 'doc.pdf',
      tamano_archivo: 2048,
      tipo_archivo: 'application/pdf',
      icono: 'fa-file-pdf',
      color: 'text-red-500',
    });
  }

  it('solo el dueño vincula, desvincula, edita y borra (403 ajeno)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const doc = await documentoDe(ana);
    const pubAna = await publicar(ana);
    const pubBeto = await publicar(beto);

    expect((await api().patch(`/api/documentos/${doc.id}/vincular`).set(bearer(beto)).send({ publicacion_id: pubBeto.id })).status).toBe(403);
    expect((await api().patch(`/api/documentos/${doc.id}/desvincular`).set(bearer(beto))).status).toBe(403);
    expect((await api().put(`/api/documentos/${doc.id}`).set(bearer(beto)).send({ descripcion: 'x' })).status).toBe(403);
    expect((await api().delete(`/api/documentos/${doc.id}`).set(bearer(beto))).status).toBe(403);

    // Vincular a una publicación ajena tampoco
    const ajena = await api().patch(`/api/documentos/${doc.id}/vincular`).set(bearer(ana)).send({ publicacion_id: pubBeto.id });
    expect(ajena.status).toBe(403);

    const vinculado = await api().patch(`/api/documentos/${doc.id}/vincular`).set(bearer(ana)).send({ publicacion_id: pubAna.id });
    expect(vinculado.status).toBe(200);
    expect(vinculado.body.data).toMatchObject({ publicacion_id: pubAna.id, usuario: { id: ana.id } });

    const detalle = await api().get(`/api/publicaciones/${pubAna.id}`);
    expect(detalle.body.data.documentos).toHaveLength(1);
    expect(detalle.body.data.documentos[0]).toMatchObject({ id: doc.id, icono: 'fa-file-pdf' });

    const adjuntos = await api().get(`/api/documentos/publicacion/${pubAna.id}`).set(bearer(beto));
    expect(adjuntos.body.data).toHaveLength(1);

    const editado = await api().put(`/api/documentos/${doc.id}`).set(bearer(ana)).send({ nombre_archivo_custom: 'Apuntes.pdf', descripcion: 'Parcial 1' });
    expect(editado.body.data).toMatchObject({ nombre_archivo: 'Apuntes.pdf', descripcion: 'Parcial 1' });

    const desvinculado = await api().patch(`/api/documentos/${doc.id}/desvincular`).set(bearer(ana));
    expect(desvinculado.body.data.publicacion_id).toBeNull();

    expect((await api().delete(`/api/documentos/${doc.id}`).set(bearer(ana))).status).toBe(200);
    expect(await Documento.count()).toBe(0);
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/documentos/doc');
  });

  it('los adjuntos de publicaciones no visibles no se muestran a otros', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const privada = await publicar(ana, { visibilidad: 'privado' });
    const oculto = await documentoDe(ana, privada.id);
    const suelto = await documentoDe(ana);

    expect((await api().get(`/api/documentos/${oculto.id}`).set(bearer(beto))).status).toBe(404);
    expect((await api().get(`/api/documentos/${oculto.id}`).set(bearer(ana))).status).toBe(200);
    expect((await api().get(`/api/documentos/${suelto.id}`)).status).toBe(200);
    expect((await api().get(`/api/documentos/publicacion/${privada.id}`).set(bearer(beto))).status).toBe(404);

    const deAna = await api().get(`/api/documentos/usuario/${ana.id}`).set(bearer(beto));
    expect(idsDe(deAna.body)).toEqual([suelto.id]);

    const mios = await api().get('/api/documentos/mis-documentos').set(bearer(ana));
    expect(idsDe(mios.body).sort()).toEqual([oculto.id, suelto.id].sort());
  });

  it('valida: subir sin archivo, ícono inválido, vincular sin id y listado completo solo admin', async () => {
    const ana = await crearUsuario('ana');
    const doc = await documentoDe(ana);

    const sinArchivo = await api().post('/api/documentos').set(bearer(ana)).send({});
    expect(sinArchivo.status).toBe(400);
    expect(sinArchivo.body.mensaje).toBe('No se seleccionó archivo');

    expect((await api().put(`/api/documentos/${doc.id}`).set(bearer(ana)).send({ icono: 'fa-rocket' })).status).toBe(400);
    expect((await api().patch(`/api/documentos/${doc.id}/vincular`).set(bearer(ana)).send({})).status).toBe(400);
    expect((await api().get('/api/documentos').set(bearer(ana))).status).toBe(403);
  });
});

describe('publicaciones: filtro por categoría', () => {
  it('el feed filtra por ?categoria= y valida el valor', async () => {
    const ana = await crearUsuario('ana');
    const tec = await publicar(ana, { categoria: 'Tecnología' });
    await publicar(ana, { categoria: 'Deportes' });

    const res = await api().get('/api/publicaciones?categoria=Tecnología');
    expect(res.status).toBe(200);
    expect(idsDe(res.body)).toEqual([tec.id]);
    expect(res.body.meta.total).toBe(1);

    expect((await api().get('/api/publicaciones?categoria=Cocina')).status).toBe(400);
  });

  it('totales por categoría cuentan solo lo que el usuario puede ver', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await publicar(ana, { categoria: 'Tecnología' });
    await publicar(ana, { categoria: 'Tecnología', visibilidad: 'privado' });
    await publicar(ana, { categoria: 'Deportes' });

    const deBeto = await api().get('/api/publicaciones/categorias/totales').set(bearer(beto));
    const total = (body: { data: { value: string; total: number }[] }, c: string) => body.data.find((x) => x.value === c)?.total;
    expect(total(deBeto.body, 'Tecnología')).toBe(1);
    expect(total(deBeto.body, 'Deportes')).toBe(1);
    expect(total(deBeto.body, 'Ciencias')).toBe(0);

    const deAna = await api().get('/api/publicaciones/categorias/totales').set(bearer(ana));
    expect(total(deAna.body, 'Tecnología')).toBe(2);
  });
});
