import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { Evento, EventoAsistente, Grupo, GrupoMiembro, Notificacion, Seguidor } from '../src/infrastructure/database/models';
import { fileStorage } from '../src/infrastructure/storage/CloudinaryStorage';
import { escaparIcs, fechaIcs, generarIcs, plegarLinea } from '../src/modules/eventos/evento.ics';
import { eventoRoutes } from '../src/modules/eventos/evento.routes';
import { enviarRecordatoriosEventos, programarRecordatoriosEventos } from '../src/modules/eventos/evento.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/eventos': eventoRoutes }));
let eliminarArchivo: MockInstance<typeof fileStorage.eliminar>;

beforeEach(async () => {
  await reiniciarBD();
  // Nunca se llama a Cloudinary en pruebas: solo se verifica qué se pidió borrar
  eliminarArchivo = vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

const HORA = 60 * 60 * 1000;
const enHoras = (h: number) => new Date(Date.now() + h * HORA).toISOString();
const campos = (body: { errores?: { campo: string }[] }) => (body.errores ?? []).map((e) => e.campo);

interface EventoRespuesta {
  id: number;
  [k: string]: unknown;
}

/** Crea un evento presencial dentro de 48 h (se puede sobrescribir cualquier campo). */
async function crearEvento(u: UsuarioPrueba, extra: Record<string, unknown> = {}): Promise<EventoRespuesta> {
  const res = await api()
    .post('/api/eventos')
    .set(bearer(u))
    .send({ titulo: 'Fiesta de fin de mes', lugar: 'Casa de Ana', inicio: enHoras(48), ...extra });
  if (res.status !== 201) throw new Error(`No se pudo crear el evento: ${JSON.stringify(res.body)}`);
  return res.body.data as EventoRespuesta;
}

const ver = (u: UsuarioPrueba | null, id: number) => {
  const peticion = api().get(`/api/eventos/${id}`);
  return u ? peticion.set(bearer(u)) : peticion;
};
const marcar = (u: UsuarioPrueba, id: number, estado: string) => api().post(`/api/eventos/${id}/asistencia`).set(bearer(u)).send({ estado });
const idsDe = (body: { data: { id: number }[] }) => body.data.map((e) => e.id);

async function crearGrupo(creador: UsuarioPrueba, miembros: { u: UsuarioPrueba; rol?: 'miembro' | 'admin' | 'moderador'; estado?: 'activo' | 'pendiente' }[] = []) {
  const grupo = await Grupo.create({ nombre: 'Club', creador_id: creador.id });
  await GrupoMiembro.create({ grupo_id: grupo.id, usuario_id: creador.id, rol: 'admin', estado: 'activo' });
  for (const m of miembros) {
    await GrupoMiembro.create({ grupo_id: grupo.id, usuario_id: m.u.id, rol: m.rol ?? 'miembro', estado: m.estado ?? 'activo' });
  }
  return grupo;
}

const notificaciones = (u: UsuarioPrueba, tipo: string) => Notificacion.findAll({ where: { usuario_id: u.id, tipo } });

describe('eventos: crear', () => {
  it('crea con JSON, valores por defecto y el creador queda con "voy"', async () => {
    const ana = await crearUsuario('ana');
    const evento = await crearEvento(ana, { titulo: '  Fiesta  ', descripcion: 'Traer botana' });

    expect(evento).toMatchObject({
      titulo: 'Fiesta',
      creador_id: ana.id,
      grupo_id: null,
      modalidad: 'presencial',
      categoria: 'social',
      visibilidad: 'publico',
      lugar: 'Casa de Ana',
      cupo: null,
      total_asistentes: 1,
      total_interesados: 0,
      cancelado: false,
      mi_estado: 'voy',
      puedo_editar: true,
      lleno: false,
      terminado: false,
      grupo: null,
      total_invitados: 0,
    });
    expect(evento.portada_s3).toBeUndefined();
    expect((evento.creador as { id: number }).id).toBe(ana.id);
    expect((evento.asistentes_preview as { id: number }[]).map((u) => u.id)).toEqual([ana.id]);
  });

  it('acepta multipart (todo como texto) y convierte números y fechas', async () => {
    const ana = await crearUsuario('ana');
    const res = await api()
      .post('/api/eventos')
      .set(bearer(ana))
      .field('titulo', 'Clase de yoga')
      .field('modalidad', 'en_linea')
      .field('enlace', 'https://meet.example.com/abc')
      .field('categoria', 'deporte')
      .field('inicio', enHoras(5))
      .field('fin', enHoras(6))
      .field('cupo', '15')
      .field('lugar', '');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ modalidad: 'en_linea', cupo: 15, lugar: null, categoria: 'deporte' });
  });

  it('valida fechas, lugar, enlace y visibilidad con 400 por campo', async () => {
    const ana = await crearUsuario('ana');
    const enviar = (body: Record<string, unknown>) => api().post('/api/eventos').set(bearer(ana)).send({ titulo: 'X', ...body });

    const finAntes = await enviar({ lugar: 'Aquí', inicio: enHoras(5), fin: enHoras(4) });
    expect(finAntes.status).toBe(400);
    expect(campos(finAntes.body)).toEqual(['fin']);

    expect(campos((await enviar({ inicio: enHoras(5) })).body)).toEqual(['lugar']);
    expect(campos((await enviar({ modalidad: 'en_linea', inicio: enHoras(5) })).body)).toEqual(['enlace']);
    expect(campos((await enviar({ modalidad: 'hibrido', inicio: enHoras(5) })).body).sort()).toEqual(['enlace', 'lugar']);
    expect(campos((await enviar({ modalidad: 'en_linea', enlace: 'no-es-url', inicio: enHoras(5) })).body)).toContain('enlace');
    expect(campos((await enviar({ modalidad: 'en_linea', enlace: 'ftp://x.com/a', inicio: enHoras(5) })).body)).toContain('enlace');
    expect(campos((await enviar({ lugar: 'Aquí', inicio: enHoras(-1) })).body)).toEqual(['inicio']);
    expect(campos((await enviar({ lugar: 'Aquí', inicio: 'mañana' })).body)).toContain('inicio');
    expect(campos((await enviar({ lugar: 'Aquí', inicio: enHoras(5), visibilidad: 'grupo' })).body)).toEqual(['visibilidad']);
    expect(campos((await enviar({ lugar: 'Aquí', inicio: enHoras(5), cupo: 0 })).body)).toEqual(['cupo']);
    expect(campos((await enviar({ lugar: 'Aquí', inicio: enHoras(5), categoria: 'fiesta' })).body)).toEqual(['categoria']);
    expect(campos((await api().post('/api/eventos').set(bearer(ana)).send({ lugar: 'Aquí', inicio: enHoras(5) })).body)).toEqual(['titulo']);

    const sinSesion = await api().post('/api/eventos').send({ titulo: 'X', lugar: 'Aquí', inicio: enHoras(5) });
    expect(sinSesion.status).toBe(401);
  });

  it('en un grupo: solo miembros activos y visibilidad "grupo" por defecto', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const grupo = await crearGrupo(ana, [{ u: beto }, { u: caro, estado: 'pendiente' }]);

    const deBeto = await crearEvento(beto, { grupo_id: grupo.id });
    expect(deBeto).toMatchObject({ grupo_id: grupo.id, visibilidad: 'grupo', grupo: { id: grupo.id, nombre: 'Club' } });

    const publico = await crearEvento(beto, { grupo_id: grupo.id, visibilidad: 'publico' });
    expect(publico.visibilidad).toBe('publico');

    const pendiente = await api().post('/api/eventos').set(bearer(caro)).send({ titulo: 'X', lugar: 'A', inicio: enHoras(5), grupo_id: grupo.id });
    expect(pendiente.status).toBe(403);

    const noExiste = await api().post('/api/eventos').set(bearer(caro)).send({ titulo: 'X', lugar: 'A', inicio: enHoras(5), grupo_id: 999 });
    expect(noExiste.status).toBe(404);
  });
});

describe('eventos: visibilidad', () => {
  it('aplica publico / seguidores / grupo / privado en el detalle', async () => {
    const ana = await crearUsuario('ana');
    const seguidora = await crearUsuario('seguidora');
    const pendiente = await crearUsuario('pendiente');
    const miembro = await crearUsuario('miembro');
    const invitado = await crearUsuario('invitado');
    const extrano = await crearUsuario('extrano');
    await Seguidor.create({ seguidor_id: seguidora.id, siguiendo_id: ana.id });
    await Seguidor.create({ seguidor_id: pendiente.id, siguiendo_id: ana.id, estado: 'pendiente' });
    const grupo = await crearGrupo(ana, [{ u: miembro }]);

    const publico = await crearEvento(ana);
    const seguidores = await crearEvento(ana, { visibilidad: 'seguidores' });
    const deGrupo = await crearEvento(ana, { grupo_id: grupo.id });
    const privado = await crearEvento(ana, { visibilidad: 'privado' });
    await api().post(`/api/eventos/${privado.id}/invitar`).set(bearer(ana)).send({ usuario_ids: [invitado.id] });

    const puede = async (u: UsuarioPrueba | null, id: number) => (await ver(u, id)).status;

    expect(await puede(null, publico.id)).toBe(200);
    expect(await puede(extrano, publico.id)).toBe(200);

    expect(await puede(seguidora, seguidores.id)).toBe(200);
    expect(await puede(pendiente, seguidores.id)).toBe(403);
    expect(await puede(extrano, seguidores.id)).toBe(403);
    expect(await puede(null, seguidores.id)).toBe(401);

    expect(await puede(miembro, deGrupo.id)).toBe(200);
    expect(await puede(seguidora, deGrupo.id)).toBe(403);

    expect(await puede(invitado, privado.id)).toBe(200);
    expect(await puede(seguidora, privado.id)).toBe(403);
    expect(await puede(miembro, privado.id)).toBe(403);
    expect((await ver(extrano, privado.id)).body.mensaje).toMatch(/privado/);

    // El creador ve todo
    for (const e of [publico, seguidores, deGrupo, privado]) expect(await puede(ana, e.id)).toBe(200);

    expect((await ver(extrano, 999)).status).toBe(404);
  });

  it('el listado solo trae lo que cada quien puede ver', async () => {
    const ana = await crearUsuario('ana');
    const seguidora = await crearUsuario('seguidora');
    const miembro = await crearUsuario('miembro');
    const invitado = await crearUsuario('invitado');
    const extrano = await crearUsuario('extrano');
    await Seguidor.create({ seguidor_id: seguidora.id, siguiendo_id: ana.id });
    const grupo = await crearGrupo(ana, [{ u: miembro }]);

    const publico = await crearEvento(ana, { inicio: enHoras(10) });
    const seguidores = await crearEvento(ana, { visibilidad: 'seguidores', inicio: enHoras(20) });
    const deGrupo = await crearEvento(ana, { grupo_id: grupo.id, inicio: enHoras(30) });
    const privado = await crearEvento(ana, { visibilidad: 'privado', inicio: enHoras(40) });
    await api().post(`/api/eventos/${privado.id}/invitar`).set(bearer(ana)).send({ usuario_ids: [invitado.id] });

    const lista = async (u: UsuarioPrueba | null) => {
      const peticion = api().get('/api/eventos');
      return idsDe((await (u ? peticion.set(bearer(u)) : peticion)).body);
    };

    expect(await lista(null)).toEqual([publico.id]);
    expect(await lista(extrano)).toEqual([publico.id]);
    expect(await lista(seguidora)).toEqual([publico.id, seguidores.id]);
    expect(await lista(miembro)).toEqual([publico.id, deGrupo.id]);
    expect(await lista(invitado)).toEqual([publico.id, privado.id]);
    expect(await lista(ana)).toEqual([publico.id, seguidores.id, deGrupo.id, privado.id]);
  });
});

describe('eventos: listados y calendario', () => {
  it('filtra por categoría, texto, grupo y "mis eventos"; separa próximos y pasados', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const grupo = await crearGrupo(ana, [{ u: beto }]);

    const fiesta = await crearEvento(ana, { titulo: 'Fiesta de disfraces', inicio: enHoras(10) });
    const torneo = await crearEvento(ana, { titulo: 'Torneo de fútbol', categoria: 'deporte', inicio: enHoras(5) });
    const junta = await crearEvento(beto, { titulo: 'Junta semanal', categoria: 'trabajo', grupo_id: grupo.id, inicio: enHoras(20) });
    const vieja = await crearEvento(ana, { titulo: 'Fiesta pasada', inicio: enHoras(1) });
    await Evento.update({ inicio: new Date(Date.now() - 5 * HORA), fin: new Date(Date.now() - 4 * HORA) }, { where: { id: vieja.id } });

    const listar = async (query: Record<string, string | number>, u: UsuarioPrueba = ana) =>
      idsDe((await api().get('/api/eventos').query(query).set(bearer(u))).body);

    expect(await listar({})).toEqual([torneo.id, fiesta.id, junta.id]);
    expect(await listar({ categoria: 'deporte' })).toEqual([torneo.id]);
    expect(await listar({ texto: 'fiesta' })).toEqual([fiesta.id]);
    expect(await listar({ grupo_id: grupo.id })).toEqual([junta.id]);
    expect(await listar({ cuando: 'pasados' })).toEqual([vieja.id]);
    expect(await listar({ cuando: 'todos', texto: 'fiesta' })).toEqual([vieja.id, fiesta.id]);
    expect(await listar({ mios: 'creados' })).toEqual([torneo.id, fiesta.id]);

    await marcar(beto, fiesta.id, 'interesado');
    expect(await listar({ mios: 'interesado' }, beto)).toEqual([fiesta.id]);
    expect(await listar({ mios: 'voy' }, beto)).toEqual([junta.id]);

    const pagina = await api().get('/api/eventos').query({ limit: 2 }).set(bearer(ana));
    expect(pagina.body.meta).toMatchObject({ total: 3, limit: 2, offset: 0, hayMas: true });
    expect(pagina.body.data[0]).toMatchObject({ mi_estado: 'voy', puedo_editar: true });

    expect((await api().get('/api/eventos').query({ mios: 'voy' })).status).toBe(401);
    expect((await api().get('/api/eventos').query({ mios: 'otros' }).set(bearer(ana))).status).toBe(400);
  });

  it('calendario: lo visible que se cruza con el rango, máximo 62 días', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const dentro = await crearEvento(ana, { inicio: enHoras(24) });
    await crearEvento(ana, { inicio: enHoras(24 * 40) });
    const privado = await crearEvento(ana, { inicio: enHoras(30), visibilidad: 'privado' });

    const desde = new Date().toISOString();
    const hasta = enHoras(24 * 10);
    const res = await api().get('/api/eventos/calendario').query({ desde, hasta }).set(bearer(beto));
    expect(res.status).toBe(200);
    expect(idsDe(res.body)).toEqual([dentro.id]);
    expect(res.body.meta).toBeUndefined();

    const deAna = await api().get('/api/eventos/calendario').query({ desde, hasta }).set(bearer(ana));
    expect(idsDe(deAna.body)).toEqual([dentro.id, privado.id]);

    const largo = await api().get('/api/eventos/calendario').query({ desde, hasta: enHoras(24 * 63) });
    expect(largo.status).toBe(400);
    expect(campos(largo.body)).toEqual(['hasta']);
    expect((await api().get('/api/eventos/calendario').query({ desde: hasta, hasta: desde })).status).toBe(400);
    expect((await api().get('/api/eventos/calendario')).status).toBe(400);
  });
});

describe('eventos: asistencia', () => {
  it('mantiene los contadores al cambiar de estado', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const evento = await crearEvento(ana);

    const voy = await marcar(beto, evento.id, 'voy');
    expect(voy.status).toBe(200);
    expect(voy.body.data).toMatchObject({ mi_estado: 'voy', total_asistentes: 2, total_interesados: 0 });

    const interesado = await marcar(beto, evento.id, 'interesado');
    expect(interesado.body.data).toMatchObject({ total_asistentes: 1, total_interesados: 1 });

    const noVoy = await marcar(beto, evento.id, 'no_voy');
    expect(noVoy.body.data).toMatchObject({ total_asistentes: 1, total_interesados: 0 });

    // Repetir el mismo estado no cambia nada
    await marcar(beto, evento.id, 'no_voy');
    const detalle = await ver(beto, evento.id);
    expect(detalle.body.data).toMatchObject({ mi_estado: 'no_voy', total_asistentes: 1, total_interesados: 0 });

    expect((await marcar(beto, evento.id, 'invitado')).status).toBe(400);
  });

  it('cupo lleno → 409; si alguien se baja, se libera el lugar', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const evento = await crearEvento(ana, { cupo: 2 });

    expect((await marcar(beto, evento.id, 'voy')).body.data.lleno).toBe(true);
    const lleno = await marcar(caro, evento.id, 'voy');
    expect(lleno.status).toBe(409);
    expect(lleno.body.mensaje).toBe('El evento ya está lleno');
    // "Me interesa" no ocupa lugar
    expect((await marcar(caro, evento.id, 'interesado')).status).toBe(200);

    await marcar(beto, evento.id, 'no_voy');
    expect((await marcar(caro, evento.id, 'voy')).body.data).toMatchObject({ total_asistentes: 2, total_interesados: 0, lleno: true });
  });

  it('evento cancelado o terminado → 400; sin acceso → 403', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const cancelado = await crearEvento(ana);
    await api().post(`/api/eventos/${cancelado.id}/cancelar`).set(bearer(ana));
    expect((await marcar(beto, cancelado.id, 'voy')).body.mensaje).toBe('El evento fue cancelado');

    const terminado = await crearEvento(ana);
    await Evento.update({ inicio: new Date(Date.now() - 5 * HORA), fin: new Date(Date.now() - HORA) }, { where: { id: terminado.id } });
    const res = await marcar(beto, terminado.id, 'voy');
    expect(res.status).toBe(400);
    expect(res.body.mensaje).toBe('El evento ya terminó');

    const privado = await crearEvento(ana, { visibilidad: 'privado' });
    expect((await marcar(beto, privado.id, 'voy')).status).toBe(403);
  });

  it('lista asistentes por estado, paginada', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const evento = await crearEvento(ana);
    await marcar(beto, evento.id, 'voy');
    await marcar(caro, evento.id, 'interesado');

    const voy = await api().get(`/api/eventos/${evento.id}/asistentes`).query({ limit: 1 });
    expect(voy.status).toBe(200);
    expect(voy.body.meta).toMatchObject({ total: 2, hayMas: true });
    expect(voy.body.data[0]).toMatchObject({ estado: 'voy', usuario: { id: ana.id } });

    const interesados = await api().get(`/api/eventos/${evento.id}/asistentes`).query({ estado: 'interesado' });
    expect(interesados.body.data.map((a: { usuario: { id: number } }) => a.usuario.id)).toEqual([caro.id]);
  });
});

describe('eventos: invitaciones', () => {
  it('invita, notifica y omite repetidos, inexistentes y a uno mismo', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const evento = await crearEvento(ana);
    await marcar(caro, evento.id, 'interesado');

    const res = await api()
      .post(`/api/eventos/${evento.id}/invitar`)
      .set(bearer(ana))
      .send({ usuario_ids: [beto.id, beto.id, caro.id, ana.id, 999] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ invitados: [beto.id], omitidos: [caro.id, ana.id, 999] });

    const fila = await EventoAsistente.findOne({ where: { evento_id: evento.id, usuario_id: beto.id } });
    expect(fila).toMatchObject({ estado: 'invitado', invitado_por: ana.id });
    const [aviso] = await notificaciones(beto, 'evento_invitacion');
    expect(aviso).toMatchObject({ de_usuario_id: ana.id, entidad_tipo: 'evento', entidad_id: evento.id });
    expect(aviso.mensaje).toContain('Fiesta de fin de mes');

    expect((await ver(beto, evento.id)).body.data).toMatchObject({ mi_estado: 'invitado', total_invitados: 1 });
    expect(idsDe((await api().get('/api/eventos').query({ mios: 'invitado' }).set(bearer(beto))).body)).toEqual([evento.id]);

    // Aceptar la invitación con "voy"
    expect((await marcar(beto, evento.id, 'voy')).body.data.total_asistentes).toBe(2);

    const soloYo = await api().post(`/api/eventos/${evento.id}/invitar`).set(bearer(ana)).send({ usuario_ids: [ana.id] });
    expect(soloYo.status).toBe(400);
    expect((await api().post(`/api/eventos/${evento.id}/invitar`).set(bearer(ana)).send({ usuario_ids: [] })).status).toBe(400);
  });

  it('cualquiera que ve un evento abierto puede invitar; a uno privado solo quien lo organiza', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const publico = await crearEvento(ana);
    const privado = await crearEvento(ana, { visibilidad: 'privado' });
    await api().post(`/api/eventos/${privado.id}/invitar`).set(bearer(ana)).send({ usuario_ids: [beto.id] });

    expect((await api().post(`/api/eventos/${publico.id}/invitar`).set(bearer(beto)).send({ usuario_ids: [caro.id] })).status).toBe(200);
    const enPrivado = await api().post(`/api/eventos/${privado.id}/invitar`).set(bearer(beto)).send({ usuario_ids: [caro.id] });
    expect(enPrivado.status).toBe(403);
    expect((await api().post(`/api/eventos/${privado.id}/invitar`).set(bearer(caro)).send({ usuario_ids: [beto.id] })).status).toBe(403);
  });
});

describe('eventos: editar, cancelar y eliminar', () => {
  it('solo el creador o admin/moderador del grupo editan', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const moderador = await crearUsuario('moderador');
    const miembro = await crearUsuario('miembro');
    const grupo = await crearGrupo(ana, [{ u: beto }, { u: moderador, rol: 'moderador' }, { u: miembro }]);
    const evento = await crearEvento(beto, { grupo_id: grupo.id });

    const editar = (u: UsuarioPrueba, body: Record<string, unknown>) => api().put(`/api/eventos/${evento.id}`).set(bearer(u)).send(body);

    expect((await editar(miembro, { titulo: 'Hackeado' })).status).toBe(403);
    expect((await editar(moderador, { titulo: 'Por el moderador' })).body.data).toMatchObject({ titulo: 'Por el moderador', puedo_editar: true });
    expect((await editar(ana, { titulo: 'Por la admin' })).status).toBe(200);
    expect((await editar(beto, { descripcion: 'Nueva' })).body.data.descripcion).toBe('Nueva');
    expect((await editar(beto, { descripcion: null })).body.data.descripcion).toBeNull();
    expect((await editar(beto, {})).status).toBe(400);

    const lista = await api().get('/api/eventos').set(bearer(miembro));
    expect(lista.body.data[0].puedo_editar).toBe(false);
    expect((await api().get('/api/eventos').set(bearer(moderador))).body.data[0].puedo_editar).toBe(true);
  });

  it('valida la coherencia contra lo guardado y el cupo contra los confirmados', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const evento = await crearEvento(ana, { fin: enHoras(50) });
    await marcar(beto, evento.id, 'voy');
    await marcar(caro, evento.id, 'voy');
    const editar = (body: Record<string, unknown>) => api().put(`/api/eventos/${evento.id}`).set(bearer(ana)).send(body);

    expect(campos((await editar({ inicio: enHoras(60) })).body)).toEqual(['fin']);
    expect(campos((await editar({ lugar: null })).body)).toEqual(['lugar']);
    expect(campos((await editar({ modalidad: 'en_linea' })).body)).toEqual(['enlace']);
    expect(campos((await editar({ inicio: enHoras(-3) })).body)).toContain('inicio');
    expect(campos((await editar({ visibilidad: 'grupo' })).body)).toEqual(['visibilidad']);
    expect(campos((await editar({ cupo: 2 })).body)).toEqual(['cupo']);
    expect((await editar({ cupo: 3 })).body.data).toMatchObject({ cupo: 3, lleno: true });
    expect((await editar({ cupo: null })).body.data.cupo).toBeNull();
    expect((await editar({ modalidad: 'en_linea', enlace: 'https://meet.example.com/x', lugar: null })).status).toBe(200);
  });

  it('si cambian fecha, lugar o enlace avisa a quienes van o les interesa', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const dani = await crearUsuario('dani');
    const evento = await crearEvento(ana);
    await marcar(beto, evento.id, 'voy');
    await marcar(caro, evento.id, 'interesado');
    await marcar(dani, evento.id, 'no_voy');
    await Evento.update({ recordatorio_enviado: true }, { where: { id: evento.id } });

    await api().put(`/api/eventos/${evento.id}`).set(bearer(ana)).send({ titulo: 'Solo el título' });
    expect(await Notificacion.count({ where: { tipo: 'evento_actualizado' } })).toBe(0);

    const res = await api().put(`/api/eventos/${evento.id}`).set(bearer(ana)).send({ inicio: enHoras(72), lugar: 'Parque' });
    expect(res.status).toBe(200);
    expect(res.body.data.recordatorio_enviado).toBe(false);

    const [aviso] = await notificaciones(beto, 'evento_actualizado');
    expect(aviso).toMatchObject({ de_usuario_id: ana.id, entidad_tipo: 'evento', entidad_id: evento.id });
    expect(aviso.mensaje).toBe('cambió la fecha y el lugar del evento «Solo el título»');
    expect(await notificaciones(caro, 'evento_actualizado')).toHaveLength(1);
    expect(await notificaciones(dani, 'evento_actualizado')).toHaveLength(0);
    // Quien edita no se notifica a sí mismo
    expect(await notificaciones(ana, 'evento_actualizado')).toHaveLength(0);
  });

  it('cancelar avisa (también a invitados) y bloquea más cambios', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const evento = await crearEvento(ana);
    await marcar(beto, evento.id, 'voy');
    await api().post(`/api/eventos/${evento.id}/invitar`).set(bearer(ana)).send({ usuario_ids: [caro.id] });

    expect((await api().post(`/api/eventos/${evento.id}/cancelar`).set(bearer(beto))).status).toBe(403);
    const res = await api().post(`/api/eventos/${evento.id}/cancelar`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.data.cancelado).toBe(true);
    expect(await notificaciones(beto, 'evento_cancelado')).toHaveLength(1);
    expect(await notificaciones(caro, 'evento_cancelado')).toHaveLength(1);

    expect((await api().post(`/api/eventos/${evento.id}/cancelar`).set(bearer(ana))).status).toBe(400);
    expect((await api().put(`/api/eventos/${evento.id}`).set(bearer(ana)).send({ titulo: 'Otra' })).status).toBe(400);
  });

  it('eliminar borra asistentes, evento y la portada', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const evento = await crearEvento(ana);
    await marcar(beto, evento.id, 'voy');
    await Evento.update({ portada_url: 'https://res.cloudinary.com/demo/image/upload/v1/trino/x.jpg', portada_s3: 'trino/x' }, { where: { id: evento.id } });

    expect((await api().delete(`/api/eventos/${evento.id}`).set(bearer(beto))).status).toBe(403);
    const res = await api().delete(`/api/eventos/${evento.id}`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.mensaje).toBe('Evento eliminado');
    expect(await Evento.count()).toBe(0);
    expect(await EventoAsistente.count()).toBe(0);
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/x');
  });

  it('quitar_portada borra la anterior de Cloudinary', async () => {
    const ana = await crearUsuario('ana');
    const evento = await crearEvento(ana);
    await Evento.update({ portada_url: 'https://res.cloudinary.com/demo/x.jpg', portada_s3: 'trino/x' }, { where: { id: evento.id } });

    const res = await api().put(`/api/eventos/${evento.id}`).set(bearer(ana)).field('quitar_portada', 'true');
    expect(res.status).toBe(200);
    expect(res.body.data.portada_url).toBeNull();
    expect(eliminarArchivo).toHaveBeenCalledWith('trino/x');
  });
});

describe('eventos: recordatorios', () => {
  it('avisa una sola vez a voy + interesados de los eventos que empiezan en la próxima hora', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const dani = await crearUsuario('dani');
    const pronto = await crearEvento(ana, { inicio: enHoras(0.5) });
    const lejos = await crearEvento(ana, { inicio: enHoras(3) });
    const cancelado = await crearEvento(ana, { inicio: enHoras(0.5) });
    for (const e of [pronto, lejos, cancelado]) await marcar(beto, e.id, 'voy');
    await marcar(caro, pronto.id, 'interesado');
    await marcar(dani, pronto.id, 'no_voy');
    await api().post(`/api/eventos/${cancelado.id}/cancelar`).set(bearer(ana));

    expect(await enviarRecordatoriosEventos()).toBe(1);
    const avisosBeto = await notificaciones(beto, 'evento_recordatorio');
    expect(avisosBeto).toHaveLength(1);
    expect(avisosBeto[0]).toMatchObject({ entidad_tipo: 'evento', entidad_id: pronto.id, de_usuario_id: ana.id });
    expect(await notificaciones(caro, 'evento_recordatorio')).toHaveLength(1);
    expect(await notificaciones(dani, 'evento_recordatorio')).toHaveLength(0);
    expect((await Evento.findByPk(pronto.id))?.recordatorio_enviado).toBe(true);

    // Segunda pasada: nada nuevo
    expect(await enviarRecordatoriosEventos()).toBe(0);
    expect(await notificaciones(beto, 'evento_recordatorio')).toHaveLength(1);

    // Más tarde le toca al otro
    expect(await enviarRecordatoriosEventos(new Date(Date.now() + 2.5 * HORA))).toBe(1);
  });

  it('programa el temporizador sin mantener vivo el proceso', () => {
    const temporizador = programarRecordatoriosEventos(60_000);
    expect(temporizador.hasRef()).toBe(false);
    clearInterval(temporizador);
  });
});

describe('eventos: calendario externo (.ics)', () => {
  it('devuelve un VEVENT válido en UTC', async () => {
    const ana = await crearUsuario('ana');
    const inicio = new Date('2030-03-15T18:30:00.000Z');
    const evento = await crearEvento(ana, {
      titulo: 'Junta; anual, 2030',
      inicio: inicio.toISOString(),
      fin: '2030-03-15T20:00:00.000Z',
      modalidad: 'hibrido',
      lugar: 'Sala 3',
      enlace: 'https://meet.example.com/junta',
    });

    const res = await api().get(`/api/eventos/${evento.id}/ics`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/calendar/);
    expect(res.headers['content-disposition']).toContain(`evento-${evento.id}.ics`);
    const texto = res.text;
    expect(texto.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(texto).toContain('BEGIN:VEVENT\r\n');
    expect(texto).toContain(`UID:evento-${evento.id}@trinoflow`);
    expect(texto).toContain('DTSTART:20300315T183000Z');
    expect(texto).toContain('DTEND:20300315T200000Z');
    expect(texto).toContain('SUMMARY:Junta\\; anual\\, 2030');
    expect(texto).toContain('LOCATION:Sala 3');
    expect(texto).toContain('STATUS:CONFIRMED');
    expect(texto.endsWith('END:VCALENDAR\r\n')).toBe(true);

    const privado = await crearEvento(ana, { visibilidad: 'privado' });
    expect((await api().get(`/api/eventos/${privado.id}/ics`)).status).toBe(401);
    expect((await api().get(`/api/eventos/${privado.id}/ics`).set(bearer(ana))).status).toBe(200);
  });

  it('sin fin dura 2 h; cancelado sale CANCELLED; líneas largas se pliegan', () => {
    const ics = generarIcs(
      {
        id: 1,
        titulo: 'á'.repeat(80),
        descripcion: 'Línea 1\nLínea 2',
        lugar: null,
        enlace: null,
        inicio: new Date('2030-01-01T10:00:00Z'),
        fin: null,
        cancelado: true,
        url: 'http://localhost:4200/eventos/1',
      },
      new Date('2029-12-01T00:00:00Z'),
    );
    expect(ics).toContain('DTEND:20300101T120000Z');
    expect(ics).toContain('DTSTAMP:20291201T000000Z');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('Línea 1\\nLínea 2');
    for (const linea of ics.split('\r\n')) expect(Buffer.byteLength(linea, 'utf8')).toBeLessThanOrEqual(75);

    expect(fechaIcs(new Date('2030-01-02T03:04:05.678Z'))).toBe('20300102T030405Z');
    expect(escaparIcs('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
    const plegada = plegarLinea(`DESCRIPTION:${'x'.repeat(100)}`);
    expect(plegada.split('\r\n')).toHaveLength(2);
    expect(plegada.split('\r\n')[1].startsWith(' ')).toBe(true);
  });
});
