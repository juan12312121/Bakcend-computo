import { Op, type Attributes, type CreationAttributes, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Publicacion, PublicacionNoInteresa, PublicacionOculta, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

type ModeloPreferencia = PublicacionOculta | PublicacionNoInteresa;

/**
 * Preferencias de un usuario sobre publicaciones ajenas ("ocultar", "no me interesa").
 * Las dos tablas comparten la forma (usuario_id, publicacion_id) y todo el comportamiento;
 * cada hija solo dice qué datos extra guarda al marcar (patrón plantilla).
 */
export abstract class PreferenciaPublicacionRepository<M extends ModeloPreferencia> extends BaseRepository<M> {
  /** Marca la publicación para el usuario; si ya estaba marcada devuelve el registro existente. */
  async marcar(usuarioId: number, publicacion: Publicacion): Promise<M> {
    const existente = await this.findOne(this.clave(usuarioId, publicacion.id));
    return existente ?? this.create(this.datosNuevos(usuarioId, publicacion));
  }

  desmarcar(usuarioId: number, publicacionId: number): Promise<number> {
    return this.delete(this.clave(usuarioId, publicacionId));
  }

  limpiar(usuarioId: number): Promise<number> {
    return this.delete({ usuario_id: usuarioId } as WhereOptions<Attributes<M>>);
  }

  /** Página de marcas del usuario con la publicación (y su autor), filtrada por lo que aún puede ver. */
  paginarDelUsuario(usuarioId: number, paginacion: Paginacion, visibles: WhereOptions<Publicacion>): Promise<Page<M>> {
    return this.paginate({ usuario_id: usuarioId } as WhereOptions<Attributes<M>>, paginacion, {
      include: [
        {
          model: Publicacion,
          as: 'publicacion',
          where: visibles,
          required: true,
          include: [{ model: Usuario, as: 'autor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
        },
      ],
      order: [['fecha_creacion', 'DESC']],
    });
  }

  /** Datos con los que se crea la marca; las hijas agregan sus columnas propias. */
  protected datosNuevos(usuarioId: number, publicacion: Publicacion): CreationAttributes<M> {
    return { usuario_id: usuarioId, publicacion_id: publicacion.id } as CreationAttributes<M>;
  }

  private clave(usuarioId: number, publicacionId: number): WhereOptions<Attributes<M>> {
    return { usuario_id: usuarioId, publicacion_id: publicacionId } as WhereOptions<Attributes<M>>;
  }
}

export class PublicacionOcultaRepository extends PreferenciaPublicacionRepository<PublicacionOculta> {
  protected readonly entidad = 'Publicación oculta';

  constructor() {
    super(PublicacionOculta);
  }
}

export class PublicacionNoInteresaRepository extends PreferenciaPublicacionRepository<PublicacionNoInteresa> {
  protected readonly entidad = 'Publicación marcada como no interesa';

  constructor() {
    super(PublicacionNoInteresa);
  }

  /** Guarda la categoría para que el feed pueda bajar el peso de temas que no interesan. */
  protected override datosNuevos(usuarioId: number, publicacion: Publicacion): CreationAttributes<PublicacionNoInteresa> {
    return { ...super.datosNuevos(usuarioId, publicacion), categoria: publicacion.categoria };
  }
}

/** Publicaciones del propio usuario que él oculta o vuelve a mostrar en bloque. */
export class PublicacionPropiaRepository extends BaseRepository<Publicacion> {
  protected readonly entidad = 'Publicación';

  constructor() {
    super(Publicacion);
  }

  /** Cambia `oculto` en todas las publicaciones del usuario, salvo las de `excepto`. Devuelve cuántas cambió. */
  async cambiarOculto(usuarioId: number, oculto: boolean, excepto: number[] = []): Promise<number> {
    const [cambiadas] = await Publicacion.update(
      { oculto },
      { where: { usuario_id: usuarioId, oculto: !oculto, ...(excepto.length ? { id: { [Op.notIn]: excepto } } : {}) } },
    );
    return cambiadas;
  }

  paginarOcultas(usuarioId: number, paginacion: Paginacion): Promise<Page<Publicacion>> {
    return this.paginate({ usuario_id: usuarioId, oculto: true }, paginacion, { order: [['fecha_actualizacion', 'DESC']] });
  }
}

export const publicacionOcultaRepository = new PublicacionOcultaRepository();
export const publicacionNoInteresaRepository = new PublicacionNoInteresaRepository();
export const publicacionPropiaRepository = new PublicacionPropiaRepository();
