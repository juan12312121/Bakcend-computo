import type { UsuarioAutenticado } from '../http/BaseController';

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
    }
  }
}

export {};
