import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AccionModeracion,
  Chat,
  Comentario,
  Evento,
  Grupo,
  GrupoMiembro,
  LogSeguridad,
  MensajeChat,
  MensajeGrupo,
  NotaModeracion,
  Notificacion,
  Publicacion,
  Reporte,
  ReporteContenido,
  Suspension,
  Usuario,
} from '../src/infrastructure/database/models';
import { adminRoutes } from '../src/modules/admin/admin.routes';
import { moderacionRoutes } from '../src/modules/moderacion/moderacion.routes';
import { moderacionService } from '../src/modules/moderacion/moderacion.service';
import { suspensionService } from '../src/modules/moderacion/suspension.service';
import { reporteRoutes } from '../src/modules/reportes/reporte.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/moderacion': moderacionRoutes, '/reportes': reporteRoutes, '/admin': adminRoutes }));
beforeEach(reiniciarBD);

async function crearAdmin(nombre = 'root'): Promise<UsuarioPrueba> {
  const u = await crearUsuario(nombre);
  await Usuario.update({ rol: 'admin' }, { where: { id: u.id } });
  const res = await api().post('/api/auth/login').send({ email: nombre, contrasena: 'secreto123' });
  return { ...u, token: res.body.data.token };
}

const reportar = (u: UsuarioPrueba, tipo: string, id: number, motivo = 'Lenguaje ofensivo', descripcion?: string) =>
  api().post('/api/moderacion/reportes').set(bearer(u)).send({ tipo, id, motivo, descripcion });

const resolver = (admin: UsuarioPrueba, tipo: string, id: number, body: object) =>
  api().post(`/api/moderacion/contenidos/${tipo}/${id}/resolver`).set(bearer(admin)).send(body);

/** Ana publica y Beto comenta; Caro y Dani son testigos. */
async function escenario() {
  const [ana, beto, caro, dani] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro'), await crearUsuario('dani')];
  const pub = await Publicacion.create({ usuario_id: ana.id, contenido: 'Hola mundo' });
  const comentario = await Comentario.create({ publicacion_id: pub.id, usuario_id: beto.id, texto: 'Comentario feo' });
  await Publicacion.update({ total_comentarios: 1 }, { where: { id: pub.id } });
  return { ana, beto, caro, dani, pub, comentario };
}

describe('moderación: reportar cualquier contenido', () => {
  it('reporta un comentario con copia del contenido; duplicado 409; el propio 400', async () => {
    const { beto, caro, comentario, pub } = await escenario();

    const res = await reportar(caro, 'comentario', comentario.id, 'Acoso o bullying', 'Me insultó');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      total_reportes: 1,
      reporte: { tipo: 'comentario', contenido_id: comentario.id, autor_id: beto.id, estado: 'pendiente', descripcion: 'Me insultó' },
    });
    expect(res.body.data.reporte.copia).toEqual({ texto: 'Comentario feo', contexto: { publicacion_id: pub.id, padre_id: null } });

    expect((await reportar(caro, 'comentario', comentario.id)).status).toBe(409);
    expect((await reportar(beto, 'comentario', comentario.id)).status).toBe(400);
    expect((await reportar(caro, 'comentario', 999)).status).toBe(404);
  });

  it('valida tipo y motivo; sin sesión 401', async () => {
    const { caro, comentario } = await escenario();
    const tipo = await reportar(caro, 'foto', comentario.id);
    expect(tipo.status).toBe(400);
    expect(tipo.body.errores[0].campo).toBe('tipo');
    const motivo = await reportar(caro, 'comentario', comentario.id, 'Me cae mal');
    expect(motivo.body.errores[0].campo).toBe('motivo');
    expect((await api().post('/api/moderacion/reportes').send({ tipo: 'comentario', id: 1, motivo: 'Otro' })).status).toBe(401);
  });

  it('un mensaje privado solo lo reporta quien participa en el chat', async () => {
    const { ana, beto, caro } = await escenario();
    const chat = await Chat.create({ usuario1_id: ana.id, usuario2_id: beto.id, estado: 'accepted' });
    const mensaje = await MensajeChat.create({ chat_id: chat.id, emisor_id: beto.id, texto: 'Mensaje grosero' });

    expect((await reportar(caro, 'mensaje_chat', mensaje.id)).status).toBe(403);
    expect((await reportar(beto, 'mensaje_chat', mensaje.id)).status).toBe(400);
    const res = await reportar(ana, 'mensaje_chat', mensaje.id);
    expect(res.status).toBe(201);
    expect(res.body.data.reporte.copia).toMatchObject({ texto: 'Mensaje grosero', contexto: { chat_id: chat.id } });
  });

  it('un mensaje de grupo solo lo reportan los miembros activos', async () => {
    const { ana, beto, caro } = await escenario();
    const grupo = await Grupo.create({ nombre: 'Club', creador_id: ana.id });
    await GrupoMiembro.bulkCreate([
      { grupo_id: grupo.id, usuario_id: ana.id, rol: 'admin', estado: 'activo' },
      { grupo_id: grupo.id, usuario_id: beto.id, estado: 'activo' },
    ]);
    const mensaje = await MensajeGrupo.create({ grupo_id: grupo.id, emisor_id: beto.id, texto: 'spam spam' });

    expect((await reportar(caro, 'mensaje_grupo', mensaje.id)).status).toBe(403);
    expect((await reportar(ana, 'mensaje_grupo', mensaje.id, 'Spam o publicidad')).status).toBe(201);
  });

  it('usuarios, grupos y eventos; no puedes reportarte a ti mismo', async () => {
    const { ana, beto, caro } = await escenario();
    const grupo = await Grupo.create({ nombre: 'Estafas SA', descripcion: 'Ganá dinero fácil', creador_id: beto.id });
    const evento = await Evento.create({ creador_id: beto.id, titulo: 'Fiesta', inicio: new Date(Date.now() + 86_400_000) });

    expect((await reportar(caro, 'usuario', caro.id)).status).toBe(400);
    const u = await reportar(caro, 'usuario', beto.id, 'Suplantación de identidad');
    expect(u.status).toBe(201);
    expect(u.body.data.reporte).toMatchObject({ autor_id: beto.id, copia: { titulo: 'Usuario beto (@beto)' } });

    const g = await reportar(ana, 'grupo', grupo.id, 'Spam o publicidad');
    expect(g.body.data.reporte).toMatchObject({ autor_id: beto.id, copia: { titulo: 'Estafas SA', texto: 'Ganá dinero fácil' } });
    const e = await reportar(ana, 'evento', evento.id, 'Información falsa');
    expect(e.body.data.reporte).toMatchObject({ autor_id: beto.id, copia: { titulo: 'Fiesta' } });
    expect((await reportar(ana, 'publicacion_canal', 1)).status).toBe(400);
  });

  it('las publicaciones conservan el reporte de siempre y también entran a la bandeja', async () => {
    const { ana, caro, dani, pub } = await escenario();
    const nuevo = await reportar(caro, 'publicacion', pub.id, 'Spam o publicidad');
    expect(nuevo.status).toBe(201);
    expect(nuevo.body.data).toMatchObject({ total_reportes: 1, publicacion_oculta: false, reporte: { tipo: 'publicacion', autor_id: ana.id } });

    const viejo = await api().post('/api/reportes/crear').set(bearer(dani)).send({ publicacion_id: pub.id, motivo: 'Otro' });
    expect(viejo.status).toBe(201);
    expect(viejo.body.data.reporte_moderacion).toMatchObject({ tipo: 'publicacion', copia: { texto: 'Hola mundo' } });
    expect(await Reporte.count()).toBe(2);
    expect(await ReporteContenido.count({ where: { tipo: 'publicacion' } })).toBe(2);
    expect((await reportar(caro, 'publicacion', pub.id)).status).toBe(409);
  });

  it('opciones: motivos y tipos que se pueden reportar', async () => {
    const { caro } = await escenario();
    const res = await api().get('/api/moderacion/opciones').set(bearer(caro));
    expect(res.body.data.motivos).toContain('Acoso o bullying');
    expect(res.body.data.tipos).toEqual(['publicacion', 'comentario', 'mensaje_chat', 'mensaje_grupo', 'usuario', 'grupo', 'evento']);
  });
});

describe('moderación: bandeja del admin', () => {
  it('solo admins (403)', async () => {
    const { caro } = await escenario();
    for (const peticion of [
      api().get('/api/moderacion/bandeja').set(bearer(caro)),
      api().get('/api/moderacion/historial').set(bearer(caro)),
      api().get('/api/moderacion/estadisticas').set(bearer(caro)),
      api().get('/api/moderacion/palabras').set(bearer(caro)),
      api().post('/api/moderacion/contenidos/comentario/1/resolver').set(bearer(caro)).send({ acciones: ['descartar'] }),
    ]) {
      expect((await peticion).status).toBe(403);
    }
  });

  it('agrupa por contenido con número de reportes y motivos, y filtra por tipo, estado y motivo', async () => {
    const admin = await crearAdmin();
    const { ana, beto, caro, dani, comentario } = await escenario();
    await reportar(caro, 'comentario', comentario.id, 'Acoso o bullying', 'Insulto');
    await reportar(dani, 'comentario', comentario.id, 'Acoso o bullying');
    await reportar(ana, 'comentario', comentario.id, 'Lenguaje ofensivo');
    await reportar(caro, 'usuario', beto.id, 'Spam o publicidad');

    const res = await api().get('/api/moderacion/bandeja').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ total: 2, hayMas: false });
    const [primero, segundo] = res.body.data;
    expect(primero).toMatchObject({
      tipo: 'comentario',
      contenido_id: comentario.id,
      estado: 'pendiente',
      total_reportes: 3,
      motivos: [
        { motivo: 'Acoso o bullying', total: 2 },
        { motivo: 'Lenguaje ofensivo', total: 1 },
      ],
      copia: { texto: 'Comentario feo' },
      autor: { id: beto.id, suspendido: false, suspension_hasta: null },
      existe: true,
      acciones: ['descartar', 'borrar', 'advertir', 'suspender'],
    });
    expect(primero.reportantes).toHaveLength(3);
    expect(primero.descripciones).toEqual([expect.objectContaining({ descripcion: 'Insulto', usuario: expect.objectContaining({ id: caro.id }) })]);
    expect(segundo).toMatchObject({ tipo: 'usuario', contenido_id: beto.id, total_reportes: 1, acciones: ['descartar', 'advertir', 'suspender'] });

    const soloUsuarios = await api().get('/api/moderacion/bandeja?tipo=usuario').set(bearer(admin));
    expect(soloUsuarios.body.meta.total).toBe(1);
    const porMotivo = await api().get('/api/moderacion/bandeja').query({ motivo: 'Lenguaje ofensivo' }).set(bearer(admin));
    expect(porMotivo.body.data).toHaveLength(1);
    expect(porMotivo.body.data[0].contenido_id).toBe(comentario.id);
    const resueltos = await api().get('/api/moderacion/bandeja?estado=resuelto').set(bearer(admin));
    expect(resueltos.body.meta.total).toBe(0);
    const pagina = await api().get('/api/moderacion/bandeja?limit=1').set(bearer(admin));
    expect(pagina.body.meta).toMatchObject({ total: 2, hayMas: true });
    expect((await api().get('/api/moderacion/bandeja?estado=raro').set(bearer(admin))).status).toBe(400);
  });

  it('borrar un comentario: lo elimina, cierra los reportes, avisa a quienes reportaron y deja historial y nota', async () => {
    const admin = await crearAdmin();
    const { beto, caro, dani, comentario, pub } = await escenario();
    await reportar(caro, 'comentario', comentario.id);
    await reportar(dani, 'comentario', comentario.id);

    const res = await resolver(admin, 'comentario', comentario.id, { acciones: ['borrar', 'advertir'], mensaje: 'Cuida tu lenguaje', nota: 'Reincidente' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ estado: 'resuelto', reportes_cerrados: 2, reportantes_avisados: 2, suspension: null });

    expect(await Comentario.findByPk(comentario.id)).toBeNull();
    expect((await Publicacion.findByPk(pub.id))?.total_comentarios).toBe(0);
    expect(await ReporteContenido.count({ where: { estado: 'resuelto', resuelto_por: admin.id } })).toBe(2);

    const avisos = await Notificacion.findAll({ where: { tipo: 'reporte_resuelto' }, order: [['id', 'ASC']] });
    const advertencia = avisos.find((n) => n.usuario_id === beto.id);
    expect(advertencia?.mensaje).toBe('Advertencia de moderación: Cuida tu lenguaje');
    expect(avisos.filter((n) => [caro.id, dani.id].includes(n.usuario_id)).map((n) => n.mensaje)).toEqual([
      expect.stringContaining('tomamos medidas'),
      expect.stringContaining('tomamos medidas'),
    ]);
    expect(await LogSeguridad.count({ where: { evento: 'ADMIN_DELETE_CONTENT' } })).toBe(1);

    // El detalle conserva la copia aunque el comentario ya no exista.
    const detalle = await api().get(`/api/moderacion/contenidos/comentario/${comentario.id}`).set(bearer(admin));
    expect(detalle.status).toBe(200);
    expect(detalle.body.data).toMatchObject({ estado: 'resuelto', existe: false, copia: { texto: 'Comentario feo' }, acciones: ['descartar', 'advertir', 'suspender'] });
    expect(detalle.body.data.reportes).toHaveLength(2);
    expect(detalle.body.data.notas).toEqual([expect.objectContaining({ texto: 'Reincidente', admin: expect.objectContaining({ id: admin.id }) })]);
    expect(detalle.body.data.historial.map((a: { accion: string }) => a.accion).sort()).toEqual(['advertir', 'borrar']);

    // Ya no hay pendientes: 409; el historial filtra por acción.
    expect((await resolver(admin, 'comentario', comentario.id, { acciones: ['descartar'] })).status).toBe(409);
    const historial = await api().get('/api/moderacion/historial?accion=advertir').set(bearer(admin));
    expect(historial.body.meta.total).toBe(1);
    expect(historial.body.data[0]).toMatchObject({ accion: 'advertir', detalle: 'Cuida tu lenguaje', admin: { id: admin.id }, autor: { id: beto.id } });
  });

  it('descartar avisa que no hubo falta; ocultar una publicación la deja oculta', async () => {
    const admin = await crearAdmin();
    const { caro, dani, pub, comentario } = await escenario();
    await reportar(caro, 'comentario', comentario.id);
    await reportar(dani, 'publicacion', pub.id);

    const d = await resolver(admin, 'comentario', comentario.id, { acciones: ['descartar'], avisar_reportantes: true });
    expect(d.body.data.estado).toBe('descartado');
    expect((await Notificacion.findOne({ where: { usuario_id: caro.id, tipo: 'reporte_resuelto' } }))?.mensaje).toContain('no encontramos una falta');
    expect(await Comentario.findByPk(comentario.id)).not.toBeNull();

    const o = await resolver(admin, 'publicacion', pub.id, { acciones: ['ocultar'], avisar_reportantes: false });
    expect(o.body.data).toMatchObject({ estado: 'resuelto', reportantes_avisados: 0 });
    expect((await Publicacion.findByPk(pub.id))?.oculto).toBe(true);

    const descartados = await api().get('/api/moderacion/bandeja?estado=descartado').set(bearer(admin));
    expect(descartados.body.data[0]).toMatchObject({ tipo: 'comentario', estado: 'descartado' });
  });

  it('reglas de acciones: combinaciones inválidas, ocultar no aplica a comentarios, advertir pide mensaje', async () => {
    const admin = await crearAdmin();
    const { caro, comentario } = await escenario();
    await reportar(caro, 'comentario', comentario.id);

    expect((await resolver(admin, 'comentario', comentario.id, { acciones: ['descartar', 'borrar'] })).status).toBe(400);
    expect((await resolver(admin, 'comentario', comentario.id, { acciones: ['ocultar', 'borrar'] })).status).toBe(400);
    const sinMensaje = await resolver(admin, 'comentario', comentario.id, { acciones: ['advertir'] });
    expect(sinMensaje.body.errores[0].campo).toBe('mensaje');
    expect((await resolver(admin, 'comentario', comentario.id, { acciones: ['ocultar'] })).status).toBe(400);
    expect((await resolver(admin, 'comentario', comentario.id, { acciones: [] })).status).toBe(400);
    expect((await resolver(admin, 'comentario', 999, { acciones: ['descartar'] })).status).toBe(409);
    expect(await ReporteContenido.count({ where: { estado: 'pendiente' } })).toBe(1);
  });

  it('suspender temporalmente al autor desde la bandeja (y la tarea programada la levanta al vencer)', async () => {
    const admin = await crearAdmin();
    const { beto, caro } = await escenario();
    await reportar(caro, 'usuario', beto.id, 'Acoso o bullying');

    const res = await resolver(admin, 'usuario', beto.id, { acciones: ['suspender'], dias: 3 });
    expect(res.status).toBe(200);
    const hasta = new Date(res.body.data.suspension.hasta).getTime();
    expect(hasta).toBeGreaterThan(Date.now() + 2.9 * 86_400_000);
    expect((await Usuario.findByPk(beto.id))?.suspendido).toBe(true);
    expect((await api().post('/api/auth/login').send({ email: 'beto', contrasena: 'secreto123' })).status).toBe(403);

    // Antes de vencer no cambia nada; después la levanta.
    expect(await suspensionService.levantarVencidas(new Date())).toBe(0);
    expect(await suspensionService.levantarVencidas(new Date(hasta + 1000))).toBe(1);
    expect((await Usuario.findByPk(beto.id))?.suspendido).toBe(false);
    expect(await Suspension.count({ where: { activa: true } })).toBe(0);
    expect(await LogSeguridad.count({ where: { evento: 'SUSPENSION_VENCIDA', usuario_id: beto.id } })).toBe(1);
  });

  it('notas internas: requieren reportes del contenido', async () => {
    const admin = await crearAdmin();
    const { caro, comentario } = await escenario();
    expect((await api().post(`/api/moderacion/contenidos/comentario/${comentario.id}/notas`).set(bearer(admin)).send({ texto: 'x' })).status).toBe(404);
    await reportar(caro, 'comentario', comentario.id);
    const nota = await api().post(`/api/moderacion/contenidos/comentario/${comentario.id}/notas`).set(bearer(admin)).send({ texto: 'Revisar mañana' });
    expect(nota.status).toBe(201);
    expect(nota.body.data).toMatchObject({ texto: 'Revisar mañana', admin: { id: admin.id } });
    expect(await NotaModeracion.count()).toBe(1);
    expect((await api().get('/api/moderacion/contenidos/comentario/999').set(bearer(admin))).status).toBe(404);
  });
});

describe('moderación: suspensiones directas y desde /admin', () => {
  it('suspende con días, lista activas y levanta; queda en historial y bitácora', async () => {
    const admin = await crearAdmin();
    const beto = await crearUsuario('beto');

    const s = await api().post(`/api/moderacion/usuarios/${beto.id}/suspender`).set(bearer(admin)).send({ dias: 7, motivo: 'Spam' });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ mensaje: 'Usuario suspendido temporalmente', data: { id: beto.id, suspendido: true } });

    const activas = await api().get('/api/moderacion/suspensiones').set(bearer(admin));
    expect(activas.body.data).toEqual([expect.objectContaining({ usuario_id: beto.id, motivo: 'Spam', usuario: expect.objectContaining({ id: beto.id }) })]);

    const l = await api().delete(`/api/moderacion/usuarios/${beto.id}/suspension`).set(bearer(admin));
    expect(l.body.data).toEqual({ id: beto.id, suspendido: false, hasta: null });
    expect((await api().delete(`/api/moderacion/usuarios/${beto.id}/suspension`).set(bearer(admin))).status).toBe(400);
    expect((await api().post(`/api/moderacion/usuarios/${admin.id}/suspender`).set(bearer(admin)).send({})).status).toBe(400);

    const acciones = await AccionModeracion.findAll({ order: [['id', 'ASC']] });
    expect(acciones.map((a) => a.accion)).toEqual(['suspender', 'levantar_suspension']);
    expect((await api().get('/api/moderacion/suspensiones?activas=false').set(bearer(admin))).body.meta.total).toBe(1);
  });

  it('PATCH /admin/usuarios/:id/suspender acepta días y sigue alternando', async () => {
    const admin = await crearAdmin();
    const beto = await crearUsuario('beto');
    const s = await api().patch(`/api/admin/usuarios/${beto.id}/suspender`).set(bearer(admin)).send({ motivo: 'Spam', dias: 2 });
    expect(s.body.data).toMatchObject({ id: beto.id, suspendido: true });
    expect(s.body.data.hasta).not.toBeNull();
    expect((await Suspension.findOne({ where: { usuario_id: beto.id, activa: true } }))?.admin_id).toBe(admin.id);

    const r = await api().patch(`/api/admin/usuarios/${beto.id}/suspender`).set(bearer(admin));
    expect(r.body.data).toMatchObject({ suspendido: false, hasta: null });
    expect(await Suspension.count({ where: { activa: true } })).toBe(0);
  });

  it('borrar una publicación desde /admin resuelve sus reportes pendientes de la bandeja', async () => {
    const admin = await crearAdmin();
    const { caro, pub } = await escenario();
    await reportar(caro, 'publicacion', pub.id);
    expect((await api().delete(`/api/admin/publicaciones/${pub.id}`).set(bearer(admin)).send({ motivo: 'x' })).status).toBe(200);
    expect(await ReporteContenido.count({ where: { estado: 'pendiente' } })).toBe(0);
  });
});

describe('moderación: estadísticas e importación', () => {
  it('pendientes por tipo, resueltos por día, motivos y usuarios más reportados', async () => {
    const admin = await crearAdmin();
    const { ana, beto, caro, dani, comentario, pub } = await escenario();
    await reportar(caro, 'comentario', comentario.id, 'Acoso o bullying');
    await reportar(dani, 'comentario', comentario.id, 'Acoso o bullying');
    await reportar(caro, 'usuario', beto.id, 'Spam o publicidad');
    await reportar(beto, 'publicacion', pub.id, 'Otro');
    await resolver(admin, 'comentario', comentario.id, { acciones: ['descartar'] });

    const res = await api().get('/api/moderacion/estadisticas?dias=7').set(bearer(admin));
    expect(res.status).toBe(200);
    const datos = res.body.data;
    expect(datos.pendientes).toMatchObject({ reportes: 2, contenidos: 2, por_tipo: { usuario: 1, publicacion: 1, comentario: 0 } });
    expect(datos.resueltos_por_dia).toHaveLength(7);
    expect(datos.resueltos_por_dia[6]).toEqual({ fecha: new Date().toISOString().slice(0, 10), resueltos: 0, descartados: 1 });
    expect(datos.total_descartados).toBe(1);
    expect(datos.motivos[0]).toEqual({ motivo: 'Acoso o bullying', total: 2 });
    expect(datos.usuarios_mas_reportados[0]).toMatchObject({ usuario: { id: beto.id }, reportes: 3, pendientes: 1, contenidos_reportados: 2 });
    expect(datos.usuarios_mas_reportados[1]).toMatchObject({ usuario: { id: ana.id }, reportes: 1 });

    const top = await api().get('/api/moderacion/usuarios-reportados?limit=1').set(bearer(admin));
    expect(top.body.data).toHaveLength(1);
    expect((await api().get('/api/moderacion/estadisticas?dias=0').set(bearer(admin))).status).toBe(400);
  });

  it('importa a la bandeja los reportes de publicaciones anteriores (idempotente)', async () => {
    const admin = await crearAdmin();
    const { ana, caro, dani, pub } = await escenario();
    await Reporte.bulkCreate([
      { publicacion_id: pub.id, usuario_id: caro.id, motivo: 'Otro' },
      { publicacion_id: pub.id, usuario_id: dani.id, motivo: 'Spam o publicidad', descripcion: 'Publicidad' },
    ]);

    const res = await api().post('/api/moderacion/importar-reportes-publicaciones').set(bearer(admin));
    expect(res.body.data).toEqual({ cantidad: 2 });
    expect((await api().post('/api/moderacion/importar-reportes-publicaciones').set(bearer(admin))).body.data).toEqual({ cantidad: 0 });
    const bandeja = await api().get('/api/moderacion/bandeja').set(bearer(admin));
    expect(bandeja.body.data[0]).toMatchObject({ tipo: 'publicacion', contenido_id: pub.id, total_reportes: 2, autor: { id: ana.id } });
  });

  it('otro módulo puede registrar su tipo de contenido (p. ej. publicaciones de canal)', async () => {
    const { ana, caro } = await escenario();
    moderacionService.registrarProveedor({
      tipo: 'publicacion_canal',
      acciones: ['borrar'],
      paraReportar: async () => ({ autor_id: ana.id, copia: { texto: 'Oferta increíble' } }),
      existe: async () => true,
      borrar: async () => undefined,
    });
    const res = await reportar(caro, 'publicacion_canal', 5, 'Spam o publicidad');
    expect(res.status).toBe(201);
    expect(res.body.data.reporte).toMatchObject({ autor_id: ana.id, copia: { texto: 'Oferta increíble' } });
  });
});
