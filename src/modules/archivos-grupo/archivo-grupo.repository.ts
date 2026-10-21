import { Op, col, fn, type Attributes, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { ArchivoGrupo, CarpetaGrupo, Grupo, Usuario, type TipoArchivoGrupo } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

export class CarpetaGrupoRepository extends BaseRepository<CarpetaGrupo> {
  protected readonly entidad = 'Carpeta';

  constructor() {
    super(CarpetaGrupo);
  }

  /** Todas las carpetas del grupo (planas, por nombre): para el árbol, las migas y validar movimientos. */
  delGrupo(grupoId: number): Promise<CarpetaGrupo[]> {
    return this.findAll({ grupo_id: grupoId }, { order: [['nombre', 'ASC'], ['id', 'ASC']] });
  }
}

/** Uso de espacio por tipo de archivo. */
export interface UsoPorTipo {
  tipo: TipoArchivoGrupo;
  bytes: number;
  archivos: number;
}

export interface FiltroArchivos {
  q?: string;
  tipo?: TipoArchivoGrupo;
}

export class ArchivoGrupoRepository extends BaseRepository<ArchivoGrupo> {
  protected readonly entidad = 'Archivo';

  constructor() {
    super(ArchivoGrupo);
  }

  /** Cada archivo viaja con quien lo subió. */
  protected override opcionesPorDefecto() {
    return { include: [{ model: Usuario, as: 'autor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }] };
  }

  /** Con autor, carpeta y grupo (para abrir un archivo por su id). */
  completo(id: number): Promise<ArchivoGrupo | null> {
    return this.findById(id, {
      include: [
        { model: Usuario, as: 'autor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
        { model: CarpetaGrupo, as: 'carpeta', attributes: ['id', 'nombre', 'padre_id'] },
        { model: Grupo, as: 'grupo', attributes: ['id', 'nombre', 'imagen_url'] },
      ],
    });
  }

  /** Archivos de una carpeta (null = raíz), por nombre. */
  enCarpeta(grupoId: number, carpetaId: number | null): Promise<ArchivoGrupo[]> {
    return this.findAll({ grupo_id: grupoId, carpeta_id: carpetaId }, { order: [['nombre', 'ASC'], ['id', 'ASC']] });
  }

  /** Busca por nombre en todo el grupo (los más nuevos primero). */
  buscar(grupoId: number, { q, tipo }: FiltroArchivos, paginacion: Paginacion): Promise<Page<ArchivoGrupo>> {
    const where: WhereOptions<Attributes<ArchivoGrupo>> = {
      grupo_id: grupoId,
      ...(tipo ? { tipo } : {}),
      ...(q ? { nombre: { [Op.like]: `%${q}%` } } : {}),
    };
    return this.paginate(where, paginacion, { order: [['fecha_creacion', 'DESC'], ['id', 'DESC']] });
  }

  /** Cuántos archivos hay directamente en cada carpeta (clave null = raíz). */
  async conteoPorCarpeta(grupoId: number): Promise<Map<number | null, number>> {
    const filas = (await ArchivoGrupo.findAll({
      attributes: ['carpeta_id', [fn('COUNT', col('id')), 'total']],
      where: { grupo_id: grupoId },
      group: ['carpeta_id'],
      raw: true,
    })) as unknown as { carpeta_id: number | null; total: number }[];
    return new Map(filas.map((f) => [f.carpeta_id === null ? null : Number(f.carpeta_id), Number(f.total)]));
  }

  async usoPorTipo(grupoId: number): Promise<UsoPorTipo[]> {
    const filas = (await ArchivoGrupo.findAll({
      attributes: ['tipo', [fn('SUM', col('tamano')), 'bytes'], [fn('COUNT', col('id')), 'archivos']],
      where: { grupo_id: grupoId },
      group: ['tipo'],
      raw: true,
    })) as unknown as { tipo: TipoArchivoGrupo; bytes: number | string | null; archivos: number | string }[];
    return filas.map((f) => ({ tipo: f.tipo, bytes: Number(f.bytes ?? 0), archivos: Number(f.archivos) }));
  }

  async bytesDelGrupo(grupoId: number): Promise<number> {
    return Number((await ArchivoGrupo.sum('tamano', { where: { grupo_id: grupoId } })) ?? 0);
  }
}

export const carpetaGrupoRepository = new CarpetaGrupoRepository();
export const archivoGrupoRepository = new ArchivoGrupoRepository();
