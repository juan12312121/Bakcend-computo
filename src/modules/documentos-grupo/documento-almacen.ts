import {
  documentoColaborativoRepository,
  documentoVersionRepository,
  type DocumentoColaborativoRepository,
  type DocumentoVersionRepository,
  type EstadoGuardado,
} from './documento-colaborativo.repository';
import { SesionesDocumentos, type AlmacenDocumentos } from './documento-sesiones';

/** Número positivo de una variable de entorno, o el valor por defecto. */
function numeroEnv(nombre: string, porDefecto: number): number {
  const valor = Number(process.env[nombre]);
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto;
}

/** Ajustes opcionales del `.env` (todos tienen un valor por defecto seguro). */
export const CONFIG_DOCUMENTOS = {
  guardarCadaMs: numeroEnv('DOCUMENTOS_GUARDADO_MS', 5_000),
  minutosVersion: numeroEnv('DOCUMENTOS_MINUTOS_VERSION', 10),
  maxVersionesAutomaticas: numeroEnv('DOCUMENTOS_MAX_VERSIONES_AUTO', 50),
};

/** Guarda el contenido de los documentos en la base (estado de Yjs + texto plano) y sus versiones automáticas. */
export class AlmacenSequelize implements AlmacenDocumentos {
  constructor(
    private readonly documentos: DocumentoColaborativoRepository,
    private readonly versiones: DocumentoVersionRepository,
    private readonly maxAutomaticas: number,
  ) {}

  async cargar(documentoId: number): Promise<Uint8Array | null> {
    const documento = await this.documentos.conContenido(documentoId);
    return documento?.estado_yjs ? new Uint8Array(documento.estado_yjs) : null;
  }

  async guardar(documentoId: number, datos: EstadoGuardado): Promise<void> {
    await this.documentos.guardarEstado(documentoId, datos);
  }

  async versionAutomatica(documentoId: number, estado: Uint8Array, texto: string, autorId: number | null): Promise<void> {
    await this.versiones.create({
      documento_id: documentoId,
      autor_id: autorId,
      tipo: 'automatica',
      estado_yjs: Buffer.from(estado),
      texto_plano: texto,
    });
    await this.versiones.podarAutomaticas(documentoId, this.maxAutomaticas);
  }
}

export const sesionesDocumentos = new SesionesDocumentos(
  new AlmacenSequelize(documentoColaborativoRepository, documentoVersionRepository, CONFIG_DOCUMENTOS.maxVersionesAutomaticas),
  CONFIG_DOCUMENTOS,
);
