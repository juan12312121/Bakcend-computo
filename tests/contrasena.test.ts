import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { LogSeguridad, RestablecimientoContrasena, Usuario } from '../src/infrastructure/database/models';
import { mailService, type MailService, type MensajeCorreo } from '../src/infrastructure/mail';
import { passwordHasher } from '../src/infrastructure/security/PasswordHasher';
import { tokenService } from '../src/infrastructure/security/TokenService';
import { MENSAJE_OLVIDE } from '../src/modules/auth/auth.controller';
import { ContrasenaService, hashToken, TOKEN_INVALIDO } from '../src/modules/auth/contrasena.service';
import { restablecimientoRepository } from '../src/modules/auth/restablecimiento.repository';
import { logSeguridadRepository } from '../src/modules/seguridad/log-seguridad.repository';
import { usuarioRepository } from '../src/modules/usuarios/usuario.repository';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos } from './helpers';

/** Correos capturados en lugar de enviarse. */
let envios: MockInstance<MailService['enviar']>;

/** Solo los de restablecer contraseña (al registrarse también sale el de "verifica tu correo"). */
const correos = (): MensajeCorreo[] => envios.mock.calls.map(([m]) => m).filter((m) => /contraseña/i.test(m.asunto));

/** Saca el token del enlace del último correo enviado. */
function tokenDelUltimoCorreo(): string {
  const ultimo = correos().at(-1);
  const coincidencia = ultimo?.texto.match(/restablecer-contrasena\?token=([^\s&]+)/);
  if (!coincidencia) throw new Error('No se envió ningún enlace');
  return decodeURIComponent(coincidencia[1]);
}

const olvide = (email: string) => api().post('/api/auth/olvide-contrasena').send({ email });
const validar = (token: string) => api().get('/api/auth/restablecer-contrasena/validar').query({ token });
const restablecer = (token: string, contrasena: string) => api().post('/api/auth/restablecer-contrasena').send({ token, contrasena });
const login = (email: string, contrasena: string) => api().post('/api/auth/login').send({ email, contrasena });

beforeAll(() => usarModulos({}));

beforeEach(async () => {
  await reiniciarBD();
  envios = vi.spyOn(mailService, 'enviar').mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('olvidé mi contraseña', () => {
  it('responde lo mismo si el email no existe y no manda correo', async () => {
    await crearUsuario('ana');
    const existe = await olvide('ana@test.com');
    const noExiste = await olvide('nadie@test.com');

    expect(existe.status).toBe(200);
    expect(noExiste.status).toBe(200);
    expect(noExiste.body).toEqual(existe.body);
    expect(noExiste.body).toEqual({ success: true, mensaje: MENSAJE_OLVIDE });
    expect(correos()).toHaveLength(1);
    expect(correos()[0].para).toBe('ana@test.com');
  });

  it('no manda correo a cuentas desactivadas', async () => {
    const u = await crearUsuario('beto');
    await Usuario.update({ activo: false }, { where: { id: u.id } });
    const res = await olvide('beto@test.com');
    expect(res.status).toBe(200);
    expect(correos()).toHaveLength(0);
  });

  it('guarda solo el hash del token, con vencimiento de 1 hora', async () => {
    const u = await crearUsuario('carla');
    await olvide('CARLA@test.com');
    const token = tokenDelUltimoCorreo();

    const registros = await RestablecimientoContrasena.findAll({ where: { usuario_id: u.id } });
    expect(registros).toHaveLength(1);
    expect(registros[0].token_hash).not.toBe(token);
    expect(registros[0].token_hash).toBe(hashToken(token));
    expect(registros[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    const minutos = (registros[0].expira_en.getTime() - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(58);
    expect(minutos).toBeLessThanOrEqual(60);

    // El correo trae enlace al frontend, en HTML y texto.
    const correo = correos()[0];
    expect(correo.texto).toContain('/restablecer-contrasena?token=');
    expect(correo.html).toContain('#f97316');
    expect(correo.asunto).toMatch(/contraseña/i);
  });

  it('limita a 3 solicitudes por hora sin cambiar la respuesta', async () => {
    const u = await crearUsuario('dani');
    for (let i = 0; i < 4; i++) {
      const res = await olvide('dani@test.com');
      expect(res.status).toBe(200);
      expect(res.body.mensaje).toBe(MENSAJE_OLVIDE);
    }
    expect(correos()).toHaveLength(3);
    expect(await RestablecimientoContrasena.count({ where: { usuario_id: u.id } })).toBe(3);
    expect(await LogSeguridad.count({ where: { usuario_id: u.id, evento: 'restablecimiento_limite' } })).toBe(1);
  });

  it('un enlace nuevo invalida el anterior', async () => {
    await crearUsuario('eva');
    await olvide('eva@test.com');
    const primero = tokenDelUltimoCorreo();
    await olvide('eva@test.com');
    const segundo = tokenDelUltimoCorreo();

    expect((await validar(primero)).body.data).toEqual({ valido: false });
    expect((await validar(segundo)).body.data).toEqual({ valido: true });
  });

  it('valida el email', async () => {
    const sinEmail = await api().post('/api/auth/olvide-contrasena').send({});
    expect(sinEmail.status).toBe(400);
    expect(sinEmail.body.errores[0].campo).toBe('email');

    const malo = await olvide('no-es-email');
    expect(malo.status).toBe(400);
    expect(correos()).toHaveLength(0);
  });
});

describe('restablecer contraseña', () => {
  it('flujo completo: olvidé → validar → restablecer → login con la nueva', async () => {
    const u = await crearUsuario('fer');
    await olvide('fer@test.com');
    const token = tokenDelUltimoCorreo();

    const valido = await validar(token);
    expect(valido.status).toBe(200);
    expect(valido.body.data).toEqual({ valido: true });

    const res = await restablecer(token, 'nuevaClave1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect((await login('fer', 'nuevaClave1')).status).toBe(200);
    expect((await login('fer', 'secreto123')).status).toBe(401);

    const registro = await RestablecimientoContrasena.findOne({ where: { usuario_id: u.id } });
    expect(registro?.usado_en).toBeInstanceOf(Date);
    expect(await LogSeguridad.count({ where: { usuario_id: u.id, evento: 'contrasena_restablecida' } })).toBe(1);
  });

  it('quita el bloqueo por intentos fallidos', async () => {
    await crearUsuario('gaby');
    for (let i = 0; i < 5; i++) await login('gaby', 'mala');
    expect((await login('gaby', 'secreto123')).status).toBe(429);

    await olvide('gaby@test.com');
    expect((await restablecer(tokenDelUltimoCorreo(), 'otraClave9')).status).toBe(200);
    expect((await login('gaby', 'otraClave9')).status).toBe(200);
  });

  it('un token ya usado da 400', async () => {
    await crearUsuario('hugo');
    await olvide('hugo@test.com');
    const token = tokenDelUltimoCorreo();
    expect((await restablecer(token, 'nuevaClave1')).status).toBe(200);

    const otraVez = await restablecer(token, 'otraClave2');
    expect(otraVez.status).toBe(400);
    expect(otraVez.body.mensaje).toBe(TOKEN_INVALIDO);
    expect((await validar(token)).body.data).toEqual({ valido: false });
    expect((await login('hugo', 'nuevaClave1')).status).toBe(200);
  });

  it('un token vencido da 400', async () => {
    const u = await crearUsuario('ines');
    await olvide('ines@test.com');
    const token = tokenDelUltimoCorreo();
    await RestablecimientoContrasena.update({ expira_en: new Date(Date.now() - 1000) }, { where: { usuario_id: u.id } });

    expect((await validar(token)).body.data).toEqual({ valido: false });
    const res = await restablecer(token, 'nuevaClave1');
    expect(res.status).toBe(400);
    expect(res.body.mensaje).toBe(TOKEN_INVALIDO);
    expect((await login('ines', 'secreto123')).status).toBe(200);
  });

  it('un token inventado da 400', async () => {
    await crearUsuario('juan');
    expect((await validar('inventado123')).body.data).toEqual({ valido: false });
    const res = await restablecer('inventado123', 'nuevaClave1');
    expect(res.status).toBe(400);
    expect(res.body.mensaje).toBe(TOKEN_INVALIDO);
  });

  it('valida token y contraseña con las reglas del registro', async () => {
    const sinNada = await api().post('/api/auth/restablecer-contrasena').send({});
    expect(sinNada.status).toBe(400);
    expect(sinNada.body.errores.map((e: { campo: string }) => e.campo)).toEqual(expect.arrayContaining(['token', 'contrasena']));

    await crearUsuario('karla');
    await olvide('karla@test.com');
    const corta = await restablecer(tokenDelUltimoCorreo(), '123');
    expect(corta.status).toBe(400);
    expect(corta.body.errores[0]).toEqual({ campo: 'contrasena', mensaje: 'La contraseña debe tener al menos 6 caracteres' });

    const sinToken = await api().get('/api/auth/restablecer-contrasena/validar');
    expect(sinToken.status).toBe(400);
    expect(sinToken.body.errores[0].campo).toBe('token');
  });
});

describe('cambiar contraseña con sesión', () => {
  const cambiar = (headers: Record<string, string>, body: object) => api().put('/api/auth/contrasena').set(headers).send(body);

  it('exige sesión', async () => {
    expect((await api().put('/api/auth/contrasena').send({ actual: 'secreto123', nueva: 'nuevaClave1' })).status).toBe(401);
  });

  it('400 en el campo "actual" si no coincide (un 401 cerraría la sesión en el frontend)', async () => {
    const u = await crearUsuario('luis');
    const res = await cambiar(bearer(u), { actual: 'equivocada', nueva: 'nuevaClave1' });
    expect(res.status).toBe(400);
    expect(res.body.mensaje).toBe('La contraseña actual es incorrecta');
    expect(res.body.errores).toEqual([{ campo: 'actual', mensaje: 'La contraseña actual es incorrecta' }]);
    expect((await login('luis', 'secreto123')).status).toBe(200);
  });

  it('400 si la nueva es igual a la actual', async () => {
    const u = await crearUsuario('mara');
    const res = await cambiar(bearer(u), { actual: 'secreto123', nueva: 'secreto123' });
    expect(res.status).toBe(400);
    expect(res.body.mensaje).toBe('La nueva contraseña debe ser distinta de la actual');
  });

  it('400 por validación', async () => {
    const u = await crearUsuario('nico');
    const res = await cambiar(bearer(u), { nueva: '123' });
    expect(res.status).toBe(400);
    expect(res.body.errores.map((e: { campo: string }) => e.campo)).toEqual(expect.arrayContaining(['actual', 'nueva']));
  });

  it('cambia la contraseña e invalida enlaces pendientes', async () => {
    const u = await crearUsuario('olga');
    await olvide('olga@test.com');
    const pendiente = tokenDelUltimoCorreo();

    const res = await cambiar(bearer(u), { actual: 'secreto123', nueva: 'nuevaClave1' });
    expect(res.status).toBe(200);
    expect(res.body.mensaje).toBe('Contraseña actualizada. Se cerraron tus otras sesiones.');

    // El token viejo deja de valer; el nuevo que devuelve el cambio sí sirve
    expect((await api().get('/api/auth/verificar').set(bearer(u))).status).toBe(401);
    expect((await api().get('/api/auth/verificar').set({ Authorization: `Bearer ${res.body.data.token}` })).status).toBe(200);

    expect((await login('olga', 'nuevaClave1')).status).toBe(200);
    expect((await login('olga', 'secreto123')).status).toBe(401);
    expect((await validar(pendiente)).body.data).toEqual({ valido: false });
    expect(await LogSeguridad.count({ where: { usuario_id: u.id, evento: 'contrasena_cambiada' } })).toBe(1);
  });
});

describe('ContrasenaService con correo inyectado', () => {
  it('usa el MailService y las opciones que recibe por constructor', async () => {
    const enviados: MensajeCorreo[] = [];
    const correoFalso: MailService = { enviar: async (m) => void enviados.push(m) };
    const servicio = new ContrasenaService(
      restablecimientoRepository,
      usuarioRepository,
      passwordHasher,
      correoFalso,
      logSeguridadRepository,
      tokenService,
      { frontendUrl: 'https://trino.test/', maxSolicitudesPorHora: 1 },
    );
    await crearUsuario('pepe');

    await servicio.solicitar({ email: 'pepe@test.com' });
    await servicio.solicitar({ email: 'pepe@test.com' });

    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toMatch(/https:\/\/trino\.test\/restablecer-contrasena\?token=[A-Za-z0-9_-]{43}/);
    expect(correos()).toHaveLength(0);
  });
});

describe('restablecer cierra las sesiones abiertas', () => {
  it('un token emitido antes del restablecimiento ya no sirve', async () => {
    const u = await crearUsuario('rita');
    await olvide('rita@test.com');
    const token = tokenDelUltimoCorreo();
    expect((await api().post('/api/auth/restablecer-contrasena').send({ token, contrasena: 'otraClave9' })).status).toBe(200);

    const res = await api().get('/api/auth/verificar').set(bearer(u));
    expect(res.status).toBe(401);
    expect(res.body.mensaje).toBe('Tu sesión ya no es válida, vuelve a iniciar sesión');
  });
});
