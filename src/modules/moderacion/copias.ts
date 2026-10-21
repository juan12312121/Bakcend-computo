import type { CopiaContenido } from '../../infrastructure/database/models';

/** Copia de una publicación al reportarla (la usan ReporteService y el proveedor de publicaciones). */
export function copiaPublicacion(p: {
  contenido: string;
  imagen_url: string | null;
  video_url?: string | null;
  grupo_id?: number | null;
}): CopiaContenido {
  return {
    texto: p.contenido ?? '',
    imagen_url: p.imagen_url ?? null,
    archivo_url: p.video_url ?? null,
    tipo_archivo: p.video_url ? 'video' : null,
    contexto: { grupo_id: p.grupo_id ?? null },
  };
}
