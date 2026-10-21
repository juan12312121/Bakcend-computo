import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Bloqueo, Notificacion, Seguidor, Usuario } from '../src/infrastructure/database/models';
import { bloqueoRoutes } from '../src/modules/bloqueos/bloqueo.routes';
import { privacidadService } from '../src/modules/privacidad/privacidad.service';
import { seguidorRoutes } from '../src/modules/seguidores/seguidor.routes';
import { usuarioRoutes } from '../src/modules/usuarios/usuario.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/bloqueos': bloqueoRoutes, '/seguidores': seguidorRoutes, '/usuarios': usuarioRoutes }));
beforeEach(reiniciarBD);

const bloquear = (quien: UsuarioPrueba, a: UsuarioPrueba | number) =>
  api().post('/api/bloqueos').set(bearer(quien)).send({ usuario_id: typeof a === 'number' ? a : a.id });
const seguir = (quien: UsuarioPrueba, a: UsuarioPrueba) => api().post('/api/seguidores/seguir').set(bearer(quien)).send({ seguido_id: a.id });

const totales = async (id: number) => {
  const u = await Usuario.findByPk(id);
  return { seguidores: u!.total_seguidores, siguiendo: u!.total_siguiendo };
};

describe('bloquear', () => {
  it('bloquea, borra los seguimientos en ambos sentidos con sus contadores y retira las notificaciones', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await seguir(ana, beto);
    await seguir(beto, ana);
    expect(await totales(ana.id)).toEqual({ seguidores: 1, siguiendo: 1 });

    const res = await bloquear(ana, beto);
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ usuario_id: beto.id, bloqueado: true });

    expect(await Seguidor.count()).toBe(0);
    expect(await totales(ana.id)).toEqual({ seguidores: 0, siguiendo: 0 });
    expect(await totales(beto.id)).toEqual({ seguidores: 0, siguiendo: 0 });
    expect(await Notificacion.count({ where: { tipo: 'follow' } })).toBe(0);
    expect(await Bloqueo.count({ where: { bloqueador_id: ana.id, bloqueado_id: beto.id } })).toBe(1);
  });

  it('también borra solicitudes pendientes sin tocar contadores', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await Usuario.update({ cuenta_privada: true }, { where: { id: ana.id } });
    await seguir(beto, ana);
    expect(await Seguidor.count({ where: { estado: 'pendiente' } })).toBe(1);

    await bloquear(ana, beto);
    expect(await Seguidor.count()).toBe(0);
    expect(await totales(ana.id)).toEqual({ seguidores: 0, siguiendo: 0 });
    expect(await Notificacion.count({ where: { tipo: 'solicitud_seguimiento' } })).toBe(0);
  });

  it('a uno mismo → 400; dos veces → 409; usuario inexistente → 404; sin sesión → 401; body inválido → 400', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');

    const yo = await bloquear(ana, ana);
    expect(yo.status).toBe(400);
    expect(yo.body.mensaje).toBe('No puedes bloquearte a ti mismo');

    expect((await bloquear(ana, beto)).status).toBe(201);
    const dup = await bloquear(ana, beto);
    expect(dup.status).toBe(409);
    expect(dup.body.mensaje).toBe('Ya bloqueaste a este usuario');

    expect((await bloquear(ana, 9999)).status).toBe(404);
    expect((await api().post('/api/bloqueos').send({ usuario_id: beto.id })).status).toBe(401);

    const malo = await api().post('/api/bloqueos').set(bearer(ana)).send({});
    expect(malo.status).toBe(400);
    expect(malo.body.errores[0].campo).toBe('usuario_id');
  });

  it('el bloqueado también puede bloquear (son dos registros independientes)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    expect((await bloquear(ana, beto)).status).toBe(201);
    expect((await bloquear(beto, ana)).status).toBe(201);
    expect(await Bloqueo.count()).toBe(2);
  });
});

describe('desbloquear y listar', () => {
  it('lista mis bloqueados paginados con datos públicos (más recientes primero)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const carla = await crearUsuario('carla');
    await bloquear(ana, beto);
    await bloquear(ana, carla);
    await bloquear(beto, ana); // no es mío: no aparece

    const res = await api().get('/api/bloqueos?limit=1').set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 2, limit: 1, offset: 0, hayMas: true });
    expect(res.body.data[0]).toMatchObject({ id: carla.id, nombre_usuario: 'carla' });
    expect(res.body.data[0].bloqueado_desde).toBeDefined();
    expect(res.body.data[0].email).toBeUndefined();

    const todos = await api().get('/api/bloqueos').set(bearer(ana));
    expect(todos.body.data.map((u: { id: number }) => u.id)).toEqual([carla.id, beto.id]);

    // Una cuenta eliminada deja de aparecer
    await Usuario.update({ activo: false }, { where: { id: carla.id } });
    const sinCarla = await api().get('/api/bloqueos').set(bearer(ana));
    expect(sinCarla.body.meta.total).toBe(1);
  });

  it('desbloquea (404 si no estaba bloqueado) y no restaura los seguimientos', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await seguir(ana, beto);
    await bloquear(ana, beto);

    const res = await api().delete(`/api/bloqueos/${beto.id}`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ usuario_id: beto.id, bloqueado: false });
    expect(await Bloqueo.count()).toBe(0);
    expect(await Seguidor.count()).toBe(0);

    expect((await api().delete(`/api/bloqueos/${beto.id}`).set(bearer(ana))).status).toBe(404);
    expect((await api().delete('/api/bloqueos/abc').set(bearer(ana))).status).toBe(400);
  });
});

describe('efectos del bloqueo', () => {
  it('no se puede seguir con bloqueo de por medio (en ningún sentido) → 403', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await bloquear(ana, beto);

    const yoBloquee = await seguir(ana, beto);
    expect(yoBloquee.status).toBe(403);
    const meBloquearon = await seguir(beto, ana);
    expect(meBloquearon.status).toBe(403);
    expect((await api().post('/api/seguidores/toggle').set(bearer(beto)).send({ seguido_id: ana.id })).status).toBe(403);
    expect(await Seguidor.count()).toBe(0);
  });

  it('perfil: quien me bloqueó → 404; a quien bloqueé → 200 con bloqueado_por_mi', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await bloquear(ana, beto);

    const comoBeto = await api().get(`/api/usuarios/${ana.id}`).set(bearer(beto));
    expect(comoBeto.status).toBe(404);

    const comoAna = await api().get(`/api/usuarios/${beto.id}`).set(bearer(ana));
    expect(comoAna.status).toBe(200);
    expect(comoAna.body.data.relacion).toEqual({ lo_sigo: false, solicitud_pendiente: false, me_sigue: false, bloqueado_por_mi: true });
  });

  it('la búsqueda y los usuarios en línea excluyen bloqueados en ambos sentidos', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('anabeto');
    const carla = await crearUsuario('anacarla');
    await bloquear(beto, ana);

    const busca = await api().get('/api/usuarios/buscar?q=ana').set(bearer(ana));
    expect(busca.body.data.map((u: { id: number }) => u.id).sort()).toEqual([ana.id, carla.id].sort());
    const buscaBeto = await api().get('/api/usuarios/buscar?q=ana').set(bearer(beto));
    expect(buscaBeto.body.data.map((u: { id: number }) => u.id).sort()).toEqual([beto.id, carla.id].sort());

    for (const u of [ana, beto, carla]) await api().post('/api/usuarios/me/heartbeat').set(bearer(u));
    const activos = await api().get('/api/usuarios/activos').set(bearer(ana));
    expect(activos.body.data.map((u: { id: number }) => u.id)).not.toContain(beto.id);
  });

  it('listas de seguidores: con bloqueo → 404; los bloqueados del observador no aparecen', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const carla = await crearUsuario('carla');
    await seguir(beto, carla);
    await seguir(ana, carla);
    await bloquear(ana, beto);

    const lista = await api().get(`/api/seguidores/seguidores/${carla.id}`).set(bearer(ana));
    expect(lista.status).toBe(200);
    expect(lista.body.data.map((u: { id: number }) => u.id)).toEqual([ana.id]);

    expect((await api().get(`/api/seguidores/seguidores/${ana.id}`).set(bearer(beto))).status).toBe(404);
  });
});

describe('privacidadService', () => {
  it('idsOcultosPara y hayBloqueo cubren ambos sentidos', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const carla = await crearUsuario('carla');
    const dani = await crearUsuario('dani');
    await bloquear(ana, beto);
    await bloquear(carla, ana);
    await bloquear(beto, ana);

    expect((await privacidadService.idsOcultosPara(ana.id)).sort()).toEqual([beto.id, carla.id].sort());
    expect(await privacidadService.idsOcultosPara(dani.id)).toEqual([]);
    expect(await privacidadService.hayBloqueo(ana.id, carla.id)).toBe(true);
    expect(await privacidadService.hayBloqueo(carla.id, ana.id)).toBe(true);
    expect(await privacidadService.hayBloqueo(ana.id, dani.id)).toBe(false);
    expect(await privacidadService.hayBloqueo(ana.id, ana.id)).toBe(false);
  });

  it('puedeVerPublicacionesDe: yo, pública sin bloqueo, privada solo si la sigo aceptado', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const carla = await crearUsuario('carla');

    expect(await privacidadService.puedeVerPublicacionesDe(ana.id, ana.id)).toBe(true);
    expect(await privacidadService.puedeVerPublicacionesDe(ana.id, beto.id)).toBe(true);
    expect(await privacidadService.puedeVerPublicacionesDe(ana.id)).toBe(true);

    await bloquear(ana, beto);
    expect(await privacidadService.puedeVerPublicacionesDe(ana.id, beto.id)).toBe(false);
    expect(await privacidadService.puedeVerPublicacionesDe(beto.id, ana.id)).toBe(false);

    await Usuario.update({ cuenta_privada: true }, { where: { id: ana.id } });
    expect(await privacidadService.puedeVerPublicacionesDe(ana.id)).toBe(false);
    expect(await privacidadService.puedeVerPublicacionesDe(ana.id, carla.id)).toBe(false);
    expect(await privacidadService.puedeVerPublicacionesDe(ana.id, ana.id)).toBe(true);

    await Seguidor.create({ seguidor_id: carla.id, siguiendo_id: ana.id, estado: 'pendiente' });
    expect(await privacidadService.puedeVerPublicacionesDe(ana.id, carla.id)).toBe(false);
    await Seguidor.update({ estado: 'aceptado' }, { where: { seguidor_id: carla.id } });
    expect(await privacidadService.puedeVerPublicacionesDe(ana.id, carla.id)).toBe(true);

    // Cuenta eliminada: nadie la ve
    await Usuario.update({ activo: false }, { where: { id: carla.id } });
    expect(await privacidadService.puedeVerPublicacionesDe(carla.id, ana.id)).toBe(false);
  });
});
