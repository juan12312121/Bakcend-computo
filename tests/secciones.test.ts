import { CloudinaryFileStorage } from '../src/infrastructure/storage/CloudinaryStorage';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Publicacion, PublicacionSeccion, Seccion, type Visibilidad } from '../src/infrastructure/database/models';
import type { FileStorage } from '../src/infrastructure/storage/FileStorage';
import { publicacionRepository } from '../src/modules/publicaciones/publicacion.repository';
import { seccionRepository } from '../src/modules/secciones/seccion.repository';
import { seccionRoutes } from '../src/modules/secciones/seccion.routes';
import { SeccionService } from '../src/modules/secciones/seccion.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/secciones': seccionRoutes }));
beforeEach(reiniciarBD);

const publicar = (usuario_id: number, visibilidad: Visibilidad = 'publico') =>
  Publicacion.create({ usuario_id, contenido: 'Publicación de prueba', visibilidad });

const crearSeccion = (u: UsuarioPrueba, datos: Record<string, unknown> = { nombre: 'Apuntes' }) =>
  api().post('/api/secciones').set(bearer(u)).send(datos);

const agregar = (u: UsuarioPrueba, seccion_id: number, publicacion_id: number) =>
  api().post('/api/secciones/posts/agregar').set(bearer(u)).send({ seccion_id, publicacion_id });

describe('secciones: CRUD', () => {
  it('crea con valores por defecto y rechaza nombres repetidos', async () => {
    const u = await crearUsuario();
    const res = await crearSeccion(u, { nombre: ' Apuntes ', icono: '' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      usuario_id: u.id,
      nombre: 'Apuntes',
      icono: 'fa-folder',
      color: 'from-gray-400 to-gray-600',
      imagen_portada: null,
    });

    expect((await crearSeccion(u, { nombre: 'Apuntes' })).status).toBe(409);
    // Otro usuario sí puede usar el mismo nombre.
    expect((await crearSeccion(await crearUsuario(), { nombre: 'Apuntes' })).status).toBe(201);
  });

  it('lista mis secciones (/ y /mis-secciones) y las de otro usuario sin sesión', async () => {
    const u = await crearUsuario();
    await crearSeccion(u, { nombre: 'A' });
    await crearSeccion(u, { nombre: 'B' });

    for (const ruta of ['/api/secciones', '/api/secciones/mis-secciones']) {
      const res = await api().get(ruta).set(bearer(u));
      expect(res.status, ruta).toBe(200);
      expect(res.body.data.map((s: { nombre: string }) => s.nombre)).toEqual(['B', 'A']);
    }
    const publica = await api().get(`/api/secciones/usuario/${u.id}`);
    expect(publica.status).toBe(200);
    expect(publica.body.data).toHaveLength(2);
  });

  it('actualiza y elimina solo el dueño', async () => {
    const dueno = await crearUsuario();
    const otro = await crearUsuario();
    const { body } = await crearSeccion(dueno);
    const id = body.data.id;
    await crearSeccion(dueno, { nombre: 'Otra' });

    expect((await api().put(`/api/secciones/${id}`).set(bearer(otro)).send({ nombre: 'Mía' })).status).toBe(403);
    expect((await api().delete(`/api/secciones/${id}`).set(bearer(otro))).status).toBe(403);
    expect((await api().get(`/api/secciones/${id}`).set(bearer(otro))).status).toBe(403);

    expect((await api().put(`/api/secciones/${id}`).set(bearer(dueno)).send({})).status).toBe(400);
    expect((await api().put(`/api/secciones/${id}`).set(bearer(dueno)).send({ nombre: 'Otra' })).status).toBe(409);

    const ok = await api().put(`/api/secciones/${id}`).set(bearer(dueno)).send({ nombre: 'Renombrada', color: 'azul' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ nombre: 'Renombrada', color: 'azul', icono: 'fa-folder' });

    const borrar = await api().delete(`/api/secciones/${id}`).set(bearer(dueno));
    expect(borrar.status).toBe(200);
    expect(await Seccion.count({ where: { id } })).toBe(0);
    expect((await api().get(`/api/secciones/${id}`).set(bearer(dueno))).status).toBe(404);
  });

  it('valida cuerpo y parámetros (400)', async () => {
    const u = await crearUsuario();
    expect((await crearSeccion(u, {})).status).toBe(400);
    expect((await crearSeccion(u, { nombre: 'x'.repeat(101) })).status).toBe(400);
    expect((await api().get('/api/secciones/abc').set(bearer(u))).status).toBe(400);
    expect((await api().get('/api/secciones/usuario/abc')).status).toBe(400);
    const sinIds = await api().post('/api/secciones/posts/agregar').set(bearer(u)).send({});
    expect(sinIds.status).toBe(400);
    expect(sinIds.body.errores.map((e: { campo: string }) => e.campo)).toEqual(['seccion_id', 'publicacion_id']);
  });

  it('exige sesión en las rutas propias', async () => {
    expect((await api().get('/api/secciones')).status).toBe(401);
    expect((await api().post('/api/secciones').send({ nombre: 'x' })).status).toBe(401);
  });
});

describe('secciones: publicaciones', () => {
  it('agrega y quita publicaciones manteniendo total_posts', async () => {
    const u = await crearUsuario();
    const { body } = await crearSeccion(u);
    const seccionId = body.data.id;
    const p1 = await publicar(u.id);
    const p2 = await publicar(u.id);

    const a1 = await agregar(u, seccionId, p1.id);
    expect(a1.status).toBe(200);
    expect(a1.body.data.total_posts).toBe(1);
    expect((await agregar(u, seccionId, p2.id)).body.data.total_posts).toBe(2);
    expect((await agregar(u, seccionId, p1.id)).status).toBe(409);

    const deP1 = await api().get(`/api/secciones/posts/${p1.id}`).set(bearer(u));
    expect(deP1.body.data.map((s: { id: number }) => s.id)).toEqual([seccionId]);

    const quitar = await api().post('/api/secciones/posts/quitar').set(bearer(u)).send({ seccion_id: seccionId, publicacion_id: p1.id });
    expect(quitar.status).toBe(200);
    expect(quitar.body.data.total_posts).toBe(1);

    const otraVez = await api().post('/api/secciones/posts/quitar').set(bearer(u)).send({ seccion_id: seccionId, publicacion_id: p1.id });
    expect(otraVez.status).toBe(404);
    expect((await Seccion.findByPk(seccionId))?.total_posts).toBe(1);
  });

  it('no permite agregar publicaciones ajenas ni tocar secciones ajenas', async () => {
    const dueno = await crearUsuario();
    const otro = await crearUsuario();
    const { body } = await crearSeccion(dueno);
    const ajena = await publicar(otro.id);
    const propia = await publicar(dueno.id);

    expect((await agregar(dueno, body.data.id, ajena.id)).status).toBe(403);
    expect((await agregar(otro, body.data.id, ajena.id)).status).toBe(403);
    expect((await agregar(dueno, body.data.id, 999)).status).toBe(404);
    expect((await api().get(`/api/secciones/posts/${propia.id}`).set(bearer(otro))).status).toBe(403);
    expect(await PublicacionSeccion.count()).toBe(0);
  });

  it('la vista pública solo muestra publicaciones visibles; el dueño ve todas', async () => {
    const dueno = await crearUsuario();
    const visitante = await crearUsuario();
    const { body } = await crearSeccion(dueno);
    const seccionId = body.data.id;
    const publica = await publicar(dueno.id);
    const privada = await publicar(dueno.id, 'privado');
    await agregar(dueno, seccionId, publica.id);
    await agregar(dueno, seccionId, privada.id);

    const vista = await api().get(`/api/secciones/usuario/${dueno.id}/seccion/${seccionId}`).set(bearer(visitante));
    expect(vista.status).toBe(200);
    expect(vista.body.data.seccion.id).toBe(seccionId);
    expect(vista.body.data.publicaciones.map((p: { id: number }) => p.id)).toEqual([publica.id]);
    expect(vista.body.data.publicaciones[0].autor.id).toBe(dueno.id);

    const anonima = await api().get(`/api/secciones/usuario/${dueno.id}/seccion/${seccionId}`);
    expect(anonima.body.data.publicaciones).toHaveLength(1);

    const propia = await api().get(`/api/secciones/${seccionId}`).set(bearer(dueno));
    expect(propia.body.data.publicaciones).toHaveLength(2);

    // La sección debe pertenecer al usuario de la URL.
    expect((await api().get(`/api/secciones/usuario/${visitante.id}/seccion/${seccionId}`)).status).toBe(404);
  });

  it('al eliminar la sección se borran sus relaciones', async () => {
    const u = await crearUsuario();
    const { body } = await crearSeccion(u);
    const pub = await publicar(u.id);
    await agregar(u, body.data.id, pub.id);

    await api().delete(`/api/secciones/${body.data.id}`).set(bearer(u));
    expect(await PublicacionSeccion.count()).toBe(0);
    expect(await Publicacion.count()).toBe(1);
  });
});

describe('secciones: portada (sin subir a Cloudinary)', () => {
  const urlCloudinary = (nombre: string) => `https://res.cloudinary.com/demo/image/upload/v1700000000/trino/secciones/${nombre}.jpg`;
  const archivo = (nombre: string) => ({
    url: urlCloudinary(nombre),
    id: `trino/secciones/${nombre}`,
    nombreOriginal: `${nombre}.jpg`,
    mimetype: 'image/jpeg',
    tamano: 10,
  });

  it('deduce el public_id de la URL guardada', () => {
    expect(CloudinaryFileStorage.idDesdeUrl(urlCloudinary('vieja'))).toBe('trino/secciones/vieja');
    expect(CloudinaryFileStorage.idDesdeUrl(null)).toBeNull();
  });

  // El servicio entrega la URL guardada; FileStorage saca el public_id (ver CloudinaryFileStorage.idDesdeUrl).
  it('al reemplazar o borrar la portada elimina la anterior; si falla, libera la nueva', async () => {
    const storage: FileStorage = { eliminar: vi.fn(async () => true) };
    const service = new SeccionService(seccionRepository, publicacionRepository, storage);
    const u = await crearUsuario();

    const seccion = await service.crear(u.id, { nombre: 'Con portada' }, archivo('vieja'));
    expect(seccion.imagen_portada).toBe(urlCloudinary('vieja'));

    const actualizada = await service.actualizar(seccion.id, u.id, {}, archivo('nueva'));
    expect(actualizada.imagen_portada).toBe(urlCloudinary('nueva'));
    expect(storage.eliminar).toHaveBeenLastCalledWith(urlCloudinary('vieja'));

    await expect(service.crear(u.id, { nombre: 'Con portada' }, archivo('repetida'))).rejects.toMatchObject({ statusCode: 409 });
    expect(storage.eliminar).toHaveBeenLastCalledWith('trino/secciones/repetida');

    await service.eliminar(seccion.id, u.id);
    expect(storage.eliminar).toHaveBeenLastCalledWith(urlCloudinary('nueva'));
  });
});
