import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { sequelize, Usuario, VerificacionEmail } from '../src/infrastructure/database/models';
import { mailService, type MailService, type MensajeCorreo } from '../src/infrastructure/mail';
import { hashToken } from '../src/modules/auth/contrasena.service';
import { verificacionRepository } from '../src/modules/auth/verificacion.repository';
import {
  CORREO_YA_VERIFICADO,
  ESPERA_REENVIO,
  TOKEN_VERIFICACION_INVALIDO,
  VerificacionService,
} from '../src/modules/auth/verificacion.service';
import { usuarioRepository } from '../src/modules/usuarios/usuario.repository';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos } from './helpers';

let envios: MockInstance<MailService['enviar']>;

/** Correos de "verifica tu correo" capturados. */
const correos = (): MensajeCorreo[] => envios.mock.calls.map(([m]) => m).filter((m) => /verifica/i.test(m.asunto));

function tokenDelUltimoCorreo(): string {
  const coincidencia = correos().at(-1)?.texto.match(/verificar-correo\?token=([^\s&]+)/);
  if (!coincidencia) throw new Error('No se envió ningún enlace de verificación');
  return decodeURIComponent(coincidencia[1]);
}

const verificar = (token: string) => api().get('/api/auth/verificar-correo').query({ token });

/** Hace que los enlaces del usuario parezcan pedidos hace 2 minutos (para el límite de reenvíos). */
const envejecer = (usuarioId: number) =>
  sequelize.getQueryInterface().bulkUpdate('verificaciones_email', { fecha_creacion: new Date(Date.now() - 2 * 60_000) }, { usuario_id: usuarioId });

beforeAll(() => usarModulos({}));

beforeEach(async () => {
  await reiniciarBD();
  envios = vi.spyOn(mailService, 'enviar').mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('registro', () => {
  it('manda el correo de verificación con enlace al frontend y guarda solo el hash (24 h)', async () => {
    const u = await crearUsuario('ana');

    expect(correos()).toHaveLength(1);
    const correo = correos()[0];
    expect(correo.para).toBe('ana@test.com');
    expect(correo.texto).toContain('/verificar-correo?token=');
    expect(correo.html).toContain('Verificar mi correo');

    const token = tokenDelUltimoCorreo();
    const registros = await VerificacionEmail.findAll({ where: { usuario_id: u.id } });
    expect(registros).toHaveLength(1);
    expect(registros[0].token_hash).toBe(hashToken(token));
    expect(registros[0].token_hash).not.toBe(token);
    const horas = (registros[0].expira_en.getTime() - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(23.9);
    expect(horas).toBeLessThanOrEqual(24);
  });

  it('el usuario de la sesión trae email_verificado y cuenta_privada (registro, login y verificar)', async () => {
    const registro = await api()
      .post('/api/auth/registro')
      .send({ nombre_usuario: 'beto', email: 'beto@test.com', nombre_completo: 'Beto Pérez', contrasena: 'secreto123' });
    expect(registro.body.data.usuario).toMatchObject({ email_verificado: false, cuenta_privada: false });

    const login = await api().post('/api/auth/login').send({ email: 'beto', contrasena: 'secreto123' });
    expect(login.status).toBe(200); // no verificar el correo no bloquea el login
    expect(login.body.data.usuario).toMatchObject({ email_verificado: false, cuenta_privada: false });

    const sesion = await api().get('/api/auth/verificar').set({ Authorization: `Bearer ${login.body.data.token}` });
    expect(sesion.body.data).toMatchObject({ email_verificado: false, cuenta_privada: false });
  });
});

describe('GET /auth/verificar-correo', () => {
  it('marca el correo como verificado; el mismo enlace después da 400', async () => {
    const u = await crearUsuario('carla');
    const token = tokenDelUltimoCorreo();

    const res = await verificar(token);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ usuario_id: u.id, email_verificado: true });
    expect((await Usuario.findByPk(u.id))?.email_verificado).toBe(true);
    expect((await VerificacionEmail.findOne({ where: { usuario_id: u.id } }))?.usado_en).toBeInstanceOf(Date);

    const sesion = await api().get('/api/auth/verificar').set(bearer(u));
    expect(sesion.body.data.email_verificado).toBe(true);

    const otraVez = await verificar(token);
    expect(otraVez.status).toBe(400);
    expect(otraVez.body.mensaje).toBe(TOKEN_VERIFICACION_INVALIDO);
  });

  it('enlace vencido, inventado o ausente → 400', async () => {
    const u = await crearUsuario('dani');
    const token = tokenDelUltimoCorreo();
    await VerificacionEmail.update({ expira_en: new Date(Date.now() - 1000) }, { where: { usuario_id: u.id } });

    const vencido = await verificar(token);
    expect(vencido.status).toBe(400);
    expect(vencido.body.mensaje).toBe(TOKEN_VERIFICACION_INVALIDO);
    expect((await Usuario.findByPk(u.id))?.email_verificado).toBe(false);

    expect((await verificar('inventado123')).status).toBe(400);

    const sinToken = await api().get('/api/auth/verificar-correo');
    expect(sinToken.status).toBe(400);
    expect(sinToken.body.errores[0].campo).toBe('token');
  });
});

describe('POST /auth/reenviar-verificacion', () => {
  it('exige sesión', async () => {
    expect((await api().post('/api/auth/reenviar-verificacion')).status).toBe(401);
  });

  it('máximo uno por minuto (429); después manda otro enlace e invalida el anterior', async () => {
    const u = await crearUsuario('eva');
    const primero = tokenDelUltimoCorreo();

    const pronto = await api().post('/api/auth/reenviar-verificacion').set(bearer(u));
    expect(pronto.status).toBe(429);
    expect(pronto.body.mensaje).toBe(ESPERA_REENVIO);
    expect(correos()).toHaveLength(1);

    await envejecer(u.id);
    const res = await api().post('/api/auth/reenviar-verificacion').set(bearer(u));
    expect(res.status).toBe(200);
    expect(res.body.mensaje).toBe('Te enviamos un nuevo enlace para verificar tu correo.');
    expect(correos()).toHaveLength(2);
    const segundo = tokenDelUltimoCorreo();
    expect(segundo).not.toBe(primero);

    expect((await verificar(primero)).status).toBe(400);
    expect((await verificar(segundo)).status).toBe(200);
  });

  it('si ya está verificado → 400', async () => {
    const u = await crearUsuario('fer');
    await verificar(tokenDelUltimoCorreo());
    await envejecer(u.id);

    const res = await api().post('/api/auth/reenviar-verificacion').set(bearer(u));
    expect(res.status).toBe(400);
    expect(res.body.mensaje).toBe(CORREO_YA_VERIFICADO);
  });
});

describe('VerificacionService con correo inyectado', () => {
  it('usa el MailService y las opciones que recibe por constructor', async () => {
    const enviados: MensajeCorreo[] = [];
    const correoFalso: MailService = { enviar: async (m) => void enviados.push(m) };
    const servicio = new VerificacionService(verificacionRepository, usuarioRepository, correoFalso, {
      frontendUrl: 'https://trino.test/',
      horasVigencia: 1,
    });
    const u = await crearUsuario('gaby');
    const usuario = await Usuario.findByPk(u.id);

    await servicio.enviar(usuario!);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toMatch(/https:\/\/trino\.test\/verificar-correo\?token=[A-Za-z0-9_-]{43}/);
    expect(enviados[0].texto).toContain('1 hora ');
    // El del registro quedó invalidado por el nuevo
    expect(await VerificacionEmail.count({ where: { usuario_id: u.id } })).toBe(2);
    expect((await verificar(tokenDelUltimoCorreo())).status).toBe(400);
  });
});
