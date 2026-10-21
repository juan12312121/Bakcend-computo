import { Router } from 'express';
import request from 'supertest';
import { crearApp } from '../src/app';
import { sequelize } from '../src/infrastructure/database/models';
import { authRoutes } from '../src/modules/auth/auth.routes';

let app = crearApp();
export const api = () => request(app);

/**
 * Prueba un módulo aislado: monta /auth (para crear usuarios) + los routers indicados.
 * Uso: usarModulos({ '/publicaciones': publicacionRoutes })
 */
export function usarModulos(montajes: Record<string, Router>): void {
  const rutas = Router();
  rutas.use('/auth', authRoutes);
  for (const [ruta, router] of Object.entries(montajes)) rutas.use(ruta, router);
  app = crearApp(rutas);
}

export async function reiniciarBD(): Promise<void> {
  await sequelize.sync({ force: true });
}

export interface UsuarioPrueba {
  id: number;
  token: string;
  nombre_usuario: string;
}

let contador = 0;

/** Registra un usuario nuevo y devuelve su id y token. */
export async function crearUsuario(nombre = `user${++contador}`): Promise<UsuarioPrueba> {
  const res = await api()
    .post('/api/auth/registro')
    .send({ nombre_usuario: nombre, email: `${nombre}@test.com`, nombre_completo: `Usuario ${nombre}`, contrasena: 'secreto123' });
  if (res.status !== 201) throw new Error(`No se pudo registrar ${nombre}: ${JSON.stringify(res.body)}`);
  return { id: res.body.data.usuario.id, token: res.body.data.token, nombre_usuario: nombre };
}

export const bearer = (u: UsuarioPrueba) => ({ Authorization: `Bearer ${u.token}` });
