import { BaseRepository } from '../../core/domain/BaseRepository';
import { Dispositivo, type Canal, type CanalPublicacion } from '../../infrastructure/database/models';
import type { MensajePush } from '../../infrastructure/push';
import { resumenAdjunto } from '../chat/adjuntos';
import { dispositivoService } from '../dispositivos/dispositivo.service';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';

/** Hasta esta cantidad de suscriptores se guarda una notificación por persona; arriba, solo push. */
export const LIMITE_NOTIFICACIONES_GUARDADAS = 200;
/** Tokens por envío a Firebase (su máximo en un multicast es 500). */
export const TOKENS_POR_LOTE = 500;
/** Notificaciones que se guardan a la vez (para no abrir cientos de consultas juntas). */
const NOTIFICACIONES_EN_PARALELO = 50;
/** Largo máximo del texto de la push. */
const CUERPO_MAX = 140;

/** Lo que usa la difusión para mandar push sin guardar notificación (DispositivoService ya lo cumple). */
export interface EnviadorPush {
  enviar(tokens: readonly string[], mensaje: MensajePush): Promise<void>;
}

/** Tokens de muchos usuarios en una sola consulta. */
export class TokensDifusionRepository extends BaseRepository<Dispositivo> {
  protected readonly entidad = 'Dispositivo';

  constructor() {
    super(Dispositivo);
  }

  async tokensDe(usuarioIds: readonly number[]): Promise<string[]> {
    if (!usuarioIds.length) return [];
    const filas = await this.findAll({ usuario_id: [...usuarioIds] }, { attributes: ['token'] });
    return filas.map((d) => d.token);
  }
}

export interface ResultadoDifusion {
  /** notificaciones: se guardó una por persona (SSE + push) · push: solo push por lotes · nadie: no había a quién. */
  modo: 'notificaciones' | 'push' | 'nadie';
  destinatarios: number;
}

export interface OpcionesDifusion {
  limiteNotificaciones?: number;
  tokensPorLote?: number;
}

const partir = <T>(lista: readonly T[], tamano: number): T[][] => {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
};

/**
 * Avisa a los suscriptores de una publicación nueva. Pensado para canales con miles de suscriptores:
 * - Pocos (≤ 200): una notificación guardada por persona (`canal_publicacion`, entidad `canal`), que ya manda SSE y push.
 * - Muchos: no se guarda nada; los tokens se leen por lotes de usuarios y la push sale en lotes de 500 tokens sin esperar a Firebase.
 */
export class DifusorCanal {
  private readonly limite: number;
  private readonly tokensPorLote: number;

  constructor(
    private readonly notificaciones: NotificacionService,
    private readonly tokens: TokensDifusionRepository,
    private readonly enviador: EnviadorPush,
    opciones: OpcionesDifusion = {},
  ) {
    this.limite = opciones.limiteNotificaciones ?? LIMITE_NOTIFICACIONES_GUARDADAS;
    this.tokensPorLote = opciones.tokensPorLote ?? TOKENS_POR_LOTE;
  }

  async difundir(canal: Canal, publicacion: CanalPublicacion, destinatarios: readonly number[]): Promise<ResultadoDifusion> {
    if (!destinatarios.length) return { modo: 'nadie', destinatarios: 0 };

    if (destinatarios.length <= this.limite) {
      for (const lote of partir(destinatarios, NOTIFICACIONES_EN_PARALELO)) {
        await Promise.all(
          lote.map((usuario_id) =>
            this.notificaciones.notificar({
              usuario_id,
              de_usuario_id: publicacion.autor_id,
              tipo: 'canal_publicacion',
              mensaje: `publicó en «${canal.nombre}»`,
              entidad_tipo: 'canal',
              entidad_id: canal.id,
            }),
          ),
        );
      }
      return { modo: 'notificaciones', destinatarios: destinatarios.length };
    }

    const mensaje = this.mensajePush(canal, publicacion);
    for (const usuarios of partir(destinatarios, this.tokensPorLote)) {
      const tokens = await this.tokens.tokensDe(usuarios);
      // El envío no se espera: DispositivoService.enviar nunca falla y borra solo los tokens inválidos
      for (const lote of partir(tokens, this.tokensPorLote)) void this.enviador.enviar(lote, mensaje);
    }
    return { modo: 'push', destinatarios: destinatarios.length };
  }

  /** Mismo formato de `datos` que las push de notificaciones, para que la app abra `/canales/:id`. */
  mensajePush(canal: Canal, publicacion: CanalPublicacion): MensajePush {
    const texto = publicacion.texto.trim();
    const cuerpo = texto ? (texto.length > CUERPO_MAX ? `${texto.slice(0, CUERPO_MAX - 1)}…` : texto) : resumenAdjunto(publicacion.tipo_archivo);
    return {
      titulo: canal.nombre,
      cuerpo,
      datos: {
        tipo: 'canal_publicacion',
        de_usuario_id: String(publicacion.autor_id),
        entidad_tipo: 'canal',
        entidad_id: String(canal.id),
      },
    };
  }
}

export const difusorCanal = new DifusorCanal(notificacionService, new TokensDifusionRepository(), dispositivoService);
