import { Op, type Attributes, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { DocumentoColaborativo, DocumentoPermiso, DocumentoVersion, Grupo, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** Columnas pesadas que no viajan en listas ni detalles. */
const PESADAS = ['estado_yjs', 'texto_plano'] as const;

export const ATRIBUTOS_GRUPO_DOCUMENTO = ['id', 'nombre', 'imagen_url', 'tipo'] as const;

/** Lo que se guarda tras editar (lo llama el guardado diferido). */
export interface EstadoGuardado {
  estado: Uint8Array;
  texto: string;
  resumen: string;
  editorId: number | null;
  fecha: Date;
}

export class DocumentoColaborativoRepository extends BaseRepository<DocumentoColaborativo> {
  protected readonly entidad = 'Documento';

  constructor() {
    super(DocumentoColaborativo);
  }

  /** Sin el estado de Yjs ni el texto completo; con dueño, último editor y grupo. */
  protected override opcionesPorDefecto() {
    return {
      attributes: { exclude: [...PESADAS] },
      include: [
        { model: Usuario, as: 'propietario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
        { model: Usuario, as: 'ultimo_editor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
        { model: Grupo, as: 'grupo', attributes: [...ATRIBUTOS_GRUPO_DOCUMENTO] },
      ],
    };
  }

  /** El registro completo (con estado de Yjs y texto) para editar, exportar o versionar. */
  conContenido(id: number): Promise<DocumentoColaborativo | null> {
    return DocumentoColaborativo.findByPk(id);
  }

  /** Página de documentos con filtro de texto (título o contenido), los editados más recientemente primero. */
  buscar(where: WhereOptions<Attributes<DocumentoColaborativo>>, paginacion: Paginacion): Promise<Page<DocumentoColaborativo>>;
  buscar(where: WhereOptions<Attributes<DocumentoColaborativo>>, paginacion: Paginacion, texto: string | undefined): Promise<Page<DocumentoColaborativo>>;
  buscar(where: WhereOptions<Attributes<DocumentoColaborativo>>, paginacion: Paginacion, texto?: string): Promise<Page<DocumentoColaborativo>> {
    const patron = texto ? `%${texto}%` : null;
    const filtro = patron ? { [Op.and]: [where, { [Op.or]: [{ titulo: { [Op.like]: patron } }, { texto_plano: { [Op.like]: patron } }] }] } : where;
    return this.paginate(filtro, paginacion, { order: [['fecha_actualizacion', 'DESC'], ['id', 'DESC']] });
  }

  /** Personales compartidos conmigo (fuera de la papelera). */
  async compartidosCon(usuarioId: number, paginacion: Paginacion, texto?: string): Promise<Page<DocumentoColaborativo>> {
    const permisos = await DocumentoPermiso.findAll({ where: { usuario_id: usuarioId }, attributes: ['documento_id'] });
    const ids = permisos.map((p) => p.documento_id);
    return this.buscar({ grupo_id: null, en_papelera: false, id: { [Op.in]: ids.length ? ids : [0] } }, paginacion, texto);
  }

  guardarEstado(id: number, { estado, texto, resumen, editorId, fecha }: EstadoGuardado): Promise<[number]> {
    return DocumentoColaborativo.update(
      {
        estado_yjs: Buffer.from(estado),
        texto_plano: texto,
        resumen,
        ...(editorId !== null ? { ultimo_editor_id: editorId, fecha_edicion: fecha } : {}),
      },
      { where: { id } },
    );
  }
}

export class DocumentoPermisoRepository extends BaseRepository<DocumentoPermiso> {
  protected readonly entidad = 'Permiso';

  constructor() {
    super(DocumentoPermiso);
  }

  protected override opcionesPorDefecto() {
    return { include: [{ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }] };
  }

  de(documentoId: number, usuarioId: number): Promise<DocumentoPermiso | null> {
    return DocumentoPermiso.findOne({ where: { documento_id: documentoId, usuario_id: usuarioId } });
  }

  delDocumento(documentoId: number): Promise<DocumentoPermiso[]> {
    return this.findAll({ documento_id: documentoId }, { order: [['fecha_creacion', 'ASC'], ['id', 'ASC']] });
  }
}

export class DocumentoVersionRepository extends BaseRepository<DocumentoVersion> {
  protected readonly entidad = 'Versión';

  constructor() {
    super(DocumentoVersion);
  }

  /** Sin el estado de Yjs; con su autor. */
  protected override opcionesPorDefecto() {
    return {
      attributes: { exclude: ['estado_yjs'] },
      include: [{ model: Usuario, as: 'autor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
    };
  }

  delDocumento(documentoId: number, paginacion: Paginacion): Promise<Page<DocumentoVersion>> {
    return this.paginate({ documento_id: documentoId }, paginacion, {
      attributes: { exclude: ['estado_yjs', 'texto_plano'] },
      order: [['fecha_creacion', 'DESC'], ['id', 'DESC']],
    });
  }

  /** Con el estado de Yjs (para restaurarla). */
  conEstado(documentoId: number, versionId: number): Promise<DocumentoVersion | null> {
    return DocumentoVersion.findOne({
      where: { id: versionId, documento_id: documentoId },
      include: [{ model: Usuario, as: 'autor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
    });
  }

  /** Deja solo las `maximo` automáticas más recientes de un documento. */
  async podarAutomaticas(documentoId: number, maximo: number): Promise<number> {
    const sobrantes = await DocumentoVersion.findAll({
      where: { documento_id: documentoId, tipo: 'automatica' },
      attributes: ['id'],
      order: [['fecha_creacion', 'DESC'], ['id', 'DESC']],
      offset: maximo,
      limit: 10_000,
    });
    if (!sobrantes.length) return 0;
    return DocumentoVersion.destroy({ where: { id: sobrantes.map((v) => v.id) } });
  }
}

export const documentoColaborativoRepository = new DocumentoColaborativoRepository();
export const documentoPermisoRepository = new DocumentoPermisoRepository();
export const documentoVersionRepository = new DocumentoVersionRepository();
