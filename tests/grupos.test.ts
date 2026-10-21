import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GrupoMiembro, Notificacion, Publicacion } from '../src/infrastructure/database/models';
import { grupoRoutes } from '../src/modules/grupos/grupo.routes';
import { CloudinaryFileStorage } from '../src/infrastructure/storage/CloudinaryStorage';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/grupos': grupoRoutes }));
beforeEach(reiniciarBD);

async function crearGrupo(u: UsuarioPrueba, datos: Record<string, unknown> = {}) {
  const res = await api()
    .post('/api/grupos')
    .set(bearer(u))
    .send({ nombre: 'Club de lectura', descripcion: 'Libros', ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: number };
}

describe('grupos: creación y detalle', () => {
  it('crea el grupo y deja al creador como admin activo', async () => {
    const ana = await crearUsuario('ana');
    const res = await api().post('/api/grupos').set(bearer(ana)).send({ nombre: 'Robótica', privacidad: 'privado', req_aprobacion: 'true' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      nombre: 'Robótica',
      privacidad: 'privado',
      req_aprobacion: true,
      creador_id: ana.id,
      total_miembros: 1,
      es_miembro: true,
      mi_rol: 'admin',
      creador: { id: ana.id, nombre_usuario: 'ana' },
    });
    const miembro = await GrupoMiembro.findOne({ where: { grupo_id: res.body.data.id, usuario_id: ana.id } });
    expect(miembro).toMatchObject({ rol: 'admin', estado: 'activo' });
  });

  it('cada grupo tiene un tipo (escuela, trabajo, ocio...) y se puede filtrar por él', async () => {
    const ana = await crearUsuario('ana');
    const sinTipo = await api().post('/api/grupos').set(bearer(ana)).send({ nombre: 'Vecinos' });
    expect(sinTipo.body.data.tipo).toBe('comunidad');
    await api().post('/api/grupos').set(bearer(ana)).send({ nombre: 'Equipo de ventas', tipo: 'trabajo' });
    await api().post('/api/grupos').set(bearer(ana)).send({ nombre: 'Proyecto final', tipo: 'escuela' });

    const trabajo = await api().get('/api/grupos?tipo=trabajo');
    expect(trabajo.body.data.map((g: { nombre: string }) => g.nombre)).toEqual(['Equipo de ventas']);

    const busqueda = await api().get('/api/grupos?q=ventas');
    expect(busqueda.body.data.map((g: { nombre: string }) => g.nombre)).toEqual(['Equipo de ventas']);

    const malo = await api().post('/api/grupos').set(bearer(ana)).send({ nombre: 'X', tipo: 'fiesta' });
    expect(malo.status).toBe(400);

    const editado = await api().put(`/api/grupos/${sinTipo.body.data.id}`).set(bearer(ana)).send({ tipo: 'ocio' });
    expect(editado.body.data.tipo).toBe('ocio');
  });

  it('valida el cuerpo (400)', async () => {
    const ana = await crearUsuario('ana');
    const res = await api().post('/api/grupos').set(bearer(ana)).send({ nombre: '  ', privacidad: 'secreto' });
    expect(res.status).toBe(400);
    const campos = res.body.errores.map((e: { campo: string }) => e.campo);
    expect(campos).toEqual(expect.arrayContaining(['nombre', 'privacidad']));
  });

  it('exige sesión para crear y valida el id', async () => {
    expect((await api().post('/api/grupos').send({ nombre: 'X' })).status).toBe(401);
    expect((await api().get('/api/grupos/abc')).status).toBe(400);
    expect((await api().get('/api/grupos/999')).status).toBe(404);
  });

  it('lista paginada con auth opcional y detalle con mi relación', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const g = await crearGrupo(ana);
    await crearGrupo(ana, { nombre: 'Otro' });

    const anonimo = await api().get('/api/grupos?limit=1');
    expect(anonimo.status).toBe(200);
    expect(anonimo.body.meta).toMatchObject({ total: 2, limit: 1, offset: 0, hayMas: true });
    expect(anonimo.body.data[0]).toMatchObject({ es_miembro: false, mi_estado: null });

    const detalle = await api().get(`/api/grupos/${g.id}`).set(bearer(beto));
    expect(detalle.body.data).toMatchObject({ id: g.id, total_miembros: 1, es_miembro: false, mi_rol: null });
  });
});

describe('grupos: membresía', () => {
  it('unirse a un grupo público queda activo; a uno privado, pendiente', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const publico = await crearGrupo(ana);
    const privado = await crearGrupo(ana, { nombre: 'Privado', privacidad: 'privado' });

    const r1 = await api().post(`/api/grupos/${publico.id}/unirse`).set(bearer(beto));
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ mensaje: 'Te has unido al grupo', data: { estado: 'activo' } });

    const r2 = await api().post(`/api/grupos/${privado.id}/unirse`).set(bearer(beto));
    expect(r2.body).toMatchObject({ mensaje: 'Solicitud enviada', data: { estado: 'pendiente' } });

    const repetido = await api().post(`/api/grupos/${publico.id}/unirse`).set(bearer(beto));
    expect(repetido.status).toBe(409);

    const mis = await api().get('/api/grupos/mis-grupos').set(bearer(beto));
    expect(mis.body.data.map((g: { id: number }) => g.id)).toEqual([publico.id]);
    expect(mis.body.data[0]).toMatchObject({ total_miembros: 2, mi_rol: 'miembro' });
  });

  it('grupo público con aprobación también queda pendiente', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const g = await crearGrupo(ana, { req_aprobacion: true });
    const res = await api().post(`/api/grupos/${g.id}/unirse`).set(bearer(beto));
    expect(res.body.data.estado).toBe('pendiente');
  });

  it('el creador no puede salir (400); un miembro sí', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const g = await crearGrupo(ana);
    await api().post(`/api/grupos/${g.id}/unirse`).set(bearer(beto));

    const creador = await api().post(`/api/grupos/${g.id}/salir`).set(bearer(ana));
    expect(creador.status).toBe(400);

    const miembro = await api().post(`/api/grupos/${g.id}/salir`).set(bearer(beto));
    expect(miembro.status).toBe(200);
    expect(await GrupoMiembro.count({ where: { grupo_id: g.id } })).toBe(1);

    const otraVez = await api().post(`/api/grupos/${g.id}/salir`).set(bearer(beto));
    expect(otraVez.status).toBe(404);
  });

  it('solo los admins del grupo pueden editarlo', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const g = await crearGrupo(ana);
    await api().post(`/api/grupos/${g.id}/unirse`).set(bearer(beto));

    const ajeno = await api().put(`/api/grupos/${g.id}`).set(bearer(beto)).send({ nombre: 'Hackeado' });
    expect(ajeno.status).toBe(403);

    const vacio = await api().put(`/api/grupos/${g.id}`).set(bearer(ana)).send({});
    expect(vacio.status).toBe(400);

    const ok = await api().put(`/api/grupos/${g.id}`).set(bearer(ana)).send({ nombre: 'Lectores', privacidad: 'privado' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ nombre: 'Lectores', privacidad: 'privado', mi_rol: 'admin' });
  });
});

describe('grupos: invitaciones', () => {
  it('invitar crea la invitación, notifica y el invitado la acepta', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const g = await crearGrupo(ana, { privacidad: 'privado' });

    const inv = await api().post(`/api/grupos/${g.id}/invitar`).set(bearer(ana)).send({ usuario_id: beto.id });
    expect(inv.status).toBe(201);
    expect(inv.body.data).toMatchObject({ grupo_id: g.id, invitado_id: beto.id, estado: 'pendiente', grupo: { id: g.id } });
    expect(await Notificacion.count({ where: { usuario_id: beto.id, tipo: 'invitacion_grupo' } })).toBe(1);

    const duplicada = await api().post(`/api/grupos/${g.id}/invitar`).set(bearer(ana)).send({ usuario_id: beto.id });
    expect(duplicada.status).toBe(409);

    const pendientes = await api().get('/api/grupos/invitaciones').set(bearer(beto));
    expect(pendientes.body.data).toHaveLength(1);
    expect(pendientes.body.data[0].remitente).toMatchObject({ id: ana.id });

    const invitacionId = inv.body.data.id;
    const ajeno = await api().post(`/api/grupos/invitaciones/${invitacionId}/responder`).set(bearer(ana)).send({ accion: 'aceptar' });
    expect(ajeno.status).toBe(403);

    const invalida = await api().post(`/api/grupos/invitaciones/${invitacionId}/responder`).set(bearer(beto)).send({ accion: 'quizas' });
    expect(invalida.status).toBe(400);

    const acepta = await api().post(`/api/grupos/invitaciones/${invitacionId}/responder`).set(bearer(beto)).send({ accion: 'aceptar' });
    expect(acepta.status).toBe(200);
    expect(acepta.body.data).toEqual({ grupo_id: g.id, estado: 'aceptada' });

    const detalle = await api().get(`/api/grupos/${g.id}`).set(bearer(beto));
    expect(detalle.body.data).toMatchObject({ es_miembro: true, mi_rol: 'miembro', total_miembros: 2 });

    const yaRespondida = await api().post(`/api/grupos/invitaciones/${invitacionId}/responder`).set(bearer(beto)).send({ accion: 'rechazar' });
    expect(yaRespondida.status).toBe(404);
  });

  it('rechazar no lo hace miembro; un no-admin no puede invitar', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const g = await crearGrupo(ana);
    await api().post(`/api/grupos/${g.id}/unirse`).set(bearer(beto));

    const noAdmin = await api().post(`/api/grupos/${g.id}/invitar`).set(bearer(beto)).send({ usuario_id: caro.id });
    expect(noAdmin.status).toBe(403);

    const yaMiembro = await api().post(`/api/grupos/${g.id}/invitar`).set(bearer(ana)).send({ usuario_id: beto.id });
    expect(yaMiembro.status).toBe(409);

    const sinId = await api().post(`/api/grupos/${g.id}/invitar`).set(bearer(ana)).send({});
    expect(sinId.status).toBe(400);

    const inv = await api().post(`/api/grupos/${g.id}/invitar`).set(bearer(ana)).send({ usuario_id: caro.id });
    const rechaza = await api().post(`/api/grupos/invitaciones/${inv.body.data.id}/responder`).set(bearer(caro)).send({ accion: 'rechazar' });
    expect(rechaza.body.data.estado).toBe('rechazada');
    expect(await GrupoMiembro.count({ where: { grupo_id: g.id, usuario_id: caro.id } })).toBe(0);
  });
});

describe('grupos: publicaciones', () => {
  it('las de un grupo privado son solo para miembros activos (403)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const g = await crearGrupo(ana, { privacidad: 'privado' });
    await Publicacion.create({ usuario_id: ana.id, grupo_id: g.id, contenido: 'Hola grupo' });
    await Publicacion.create({ usuario_id: ana.id, contenido: 'Fuera del grupo' });

    expect((await api().get(`/api/grupos/${g.id}/publicaciones`)).status).toBe(403);
    expect((await api().get(`/api/grupos/${g.id}/publicaciones`).set(bearer(beto))).status).toBe(403);

    // Con solicitud pendiente sigue sin acceso.
    await api().post(`/api/grupos/${g.id}/unirse`).set(bearer(beto));
    expect((await api().get(`/api/grupos/${g.id}/publicaciones`).set(bearer(beto))).status).toBe(403);

    const res = await api().get(`/api/grupos/${g.id}/publicaciones`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ contenido: 'Hola grupo', usuario_dio_like: false, autor: { id: ana.id } });
  });

  it('las de un grupo público las ve cualquiera', async () => {
    const ana = await crearUsuario('ana');
    const g = await crearGrupo(ana);
    await Publicacion.create({ usuario_id: ana.id, grupo_id: g.id, contenido: 'Abierta' });
    const res = await api().get(`/api/grupos/${g.id}/publicaciones?limit=5`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('CloudinaryFileStorage.idDesdeUrl', () => {
  it('saca el public_id de una URL de Cloudinary', () => {
    expect(CloudinaryFileStorage.idDesdeUrl('https://res.cloudinary.com/demo/image/upload/v1712/trino/perfiles/foto_perfil-1-2.jpg')).toBe(
      'trino/perfiles/foto_perfil-1-2',
    );
    expect(CloudinaryFileStorage.idDesdeUrl('https://otro.com/a.jpg')).toBeNull();
    expect(CloudinaryFileStorage.idDesdeUrl(null)).toBeNull();
  });

  it('sabe si la URL es de una imagen, un video o un archivo (para borrarlo del lugar correcto)', () => {
    expect(CloudinaryFileStorage.tipoDesdeUrl('https://res.cloudinary.com/demo/video/upload/v1/trino/videos/v.mp4')).toBe('video');
    expect(CloudinaryFileStorage.tipoDesdeUrl('https://res.cloudinary.com/demo/raw/upload/v1/trino/documentos/a.docx')).toBe('raw');
    expect(CloudinaryFileStorage.tipoDesdeUrl('https://res.cloudinary.com/demo/image/upload/v1/trino/perfiles/f.jpg')).toBe('image');
    expect(CloudinaryFileStorage.tipoDesdeUrl('trino/videos/v')).toBeNull();
  });
});
