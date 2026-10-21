import { BaseService } from '../../core/domain/BaseService';
import { NotFoundError } from '../../core/errors';
import type { Usuario } from '../../infrastructure/database/models';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { publicacionRepository, type PublicacionRepository } from '../publicaciones/publicacion.repository';
import { mencionRepository, type MencionRepository } from './mencion.repository';

/** Dónde ocurrió la mención. */
export interface ContextoMencion {
  publicacion_id: number;
  comentario_id?: number;
}

export interface UsuarioMencionable {
  id: number;
  nombre_usuario: string;
  nombre_completo: string;
  foto_perfil_url: string | null;
}

/** Máximo de sugerencias del autocompletado y de personas notificadas por texto. */
export const MAX_SUGERENCIAS = 8;
const MAX_MENCIONES_POR_TEXTO = 20;

/**
 * `@nombre_usuario`: mismas reglas que el registro (letras, números y _; 3-50).
 * No cuenta si va pegado a otra palabra (así un correo como ana@x.com no es mención).
 */
const PATRON_MENCION = /(?<![\p{L}\p{N}_@.])@([A-Za-z0-9_]{3,50})(?![A-Za-z0-9_])/gu;

/** Nombres mencionados en un texto, sin repetir (en el orden en que aparecen). */
export function extraerMenciones(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const nombres = new Map<string, string>();
  for (const [, nombre] of texto.matchAll(PATRON_MENCION)) {
    const clave = nombre.toLowerCase();
    if (!nombres.has(clave)) nombres.set(clave, nombre);
  }
  return [...nombres.values()];
}

export class MencionService extends BaseService<Usuario, MencionRepository> {
  constructor(
    repository: MencionRepository,
    private readonly notificaciones: NotificacionService,
    private readonly publicaciones: PublicacionRepository,
  ) {
    super(repository);
  }

  /**
   * Notifica (tipo 'mencion') a cada usuario activo mencionado con @ en el texto, sin repetir ni al autor
   * y solo si puede ver la publicación. Devuelve los ids notificados.
   */
  notificar(texto: string, autorId: number, contexto: ContextoMencion): Promise<number[]>;
  notificar(texto: string, autorId: number, contexto: ContextoMencion, excluirNombres: string[]): Promise<number[]>;
  async notificar(texto: string, autorId: number, contexto: ContextoMencion, excluirNombres: string[] = []): Promise<number[]> {
    const excluidos = new Set(excluirNombres.map((n) => n.toLowerCase()));
    const nombres = extraerMenciones(texto)
      .filter((n) => !excluidos.has(n.toLowerCase()))
      .slice(0, MAX_MENCIONES_POR_TEXTO);
    if (!nombres.length) return [];

    const publicacion = await this.publicaciones.findById(contexto.publicacion_id, { include: [] });
    if (!publicacion) return [];

    const usuarios = (await this.repository.activosPorNombre(nombres)).filter((u) => u.id !== autorId);
    const mensaje = contexto.comentario_id ? 'te mencionó en un comentario' : 'te mencionó en una publicación';
    const notificados: number[] = [];
    for (const usuario of usuarios) {
      if (notificados.includes(usuario.id)) continue;
      if (!(await this.publicaciones.puedeVer(publicacion, usuario.id))) continue;
      await this.notificaciones.notificar({
        usuario_id: usuario.id,
        de_usuario_id: autorId,
        tipo: 'mencion',
        mensaje,
        publicacion_id: contexto.publicacion_id,
        entidad_tipo: contexto.comentario_id ? 'comentario' : 'publicacion',
        entidad_id: contexto.comentario_id ?? contexto.publicacion_id,
      });
      notificados.push(usuario.id);
    }
    return notificados;
  }

  /** Al editar un texto: notifica solo a quienes no estaban mencionados en la versión anterior. */
  notificarNuevas(textoNuevo: string, textoAnterior: string, autorId: number, contexto: ContextoMencion): Promise<number[]> {
    return this.notificar(textoNuevo, autorId, contexto, extraerMenciones(textoAnterior));
  }

  /** Resuelve `/u/:nombre` → { id, nombre_usuario } (404 si no existe o no está activo). */
  async usuarioPorNombre(nombre: string): Promise<{ id: number; nombre_usuario: string }> {
    const usuario = await this.repository.porNombre(nombre.replace(/^@/, ''));
    if (!usuario) throw new NotFoundError('Usuario');
    return { id: usuario.id, nombre_usuario: usuario.nombre_usuario };
  }

  /** Autocompletado de @: primero a quienes sigo, luego el resto; máximo 8 y solo datos públicos. */
  async sugerencias(q: string, usuarioId: number): Promise<UsuarioMencionable[]> {
    const termino = q.replace(/^@/, '').trim();
    const seguidos = await this.repository.idsSeguidos(usuarioId);
    const primero = await this.repository.candidatos(termino, MAX_SUGERENCIAS, { soloIds: seguidos.filter((id) => id !== usuarioId) });
    const faltan = MAX_SUGERENCIAS - primero.length;
    const resto = faltan > 0
      ? await this.repository.candidatos(termino, faltan, { excluir: [usuarioId, ...primero.map((u) => u.id)] })
      : [];
    return [...primero, ...resto].map((u) => ({
      id: u.id,
      nombre_usuario: u.nombre_usuario,
      nombre_completo: u.nombre_completo,
      foto_perfil_url: u.foto_perfil_url ?? null,
    }));
  }
}

export const mencionService = new MencionService(mencionRepository, notificacionService, publicacionRepository);
