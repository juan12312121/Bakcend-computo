import type { Boleto, EstadoBoleto, Evento } from '../../infrastructure/database/models';

export interface ArchivoCsv {
  nombre: string;
  contenido: string;
}

const ESTADO_TEXTO: Record<EstadoBoleto, string> = {
  valido: 'Válido',
  usado: 'Usado',
  cancelado: 'Cancelado',
  reembolsado: 'Reembolsado',
};

/**
 * Una celda CSV: entre comillas si hace falta y con apóstrofo delante de = + - @ (evita que Excel
 * ejecute fórmulas escritas en un nombre de usuario).
 */
export function celdaCsv(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  let texto = String(valor);
  if (typeof valor === 'string' && /^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[",\n\r;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Marca de orden de bytes UTF-8: Excel la necesita para mostrar bien los acentos. */
const BOM = String.fromCharCode(0xfeff);

const fechaIso = (fecha: Date | null | undefined) => (fecha ? new Date(fecha).toISOString() : '');

/** "fiesta-de-fin-de-mes" (para el nombre del archivo). */
export function slug(texto: string): string {
  return (
    texto
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'evento'
  );
}

/** Asistentes del evento con BOM UTF-8 (Excel lo abre con acentos). Fechas en ISO UTC. */
export function generarCsv(evento: Pick<Evento, 'id' | 'titulo' | 'moneda'>, boletos: Boleto[]): ArchivoCsv {
  const encabezado = ['Boleto', 'Tipo', `Precio (${evento.moneda})`, 'Estado', 'Nombre', 'Usuario', 'Emitido', 'Escaneado en', 'Escaneado por'];
  const filas = boletos.map((b) => [
    b.id,
    b.tipo?.nombre ?? '',
    ((b.tipo?.precio_centavos ?? 0) / 100).toFixed(2),
    ESTADO_TEXTO[b.estado as EstadoBoleto],
    b.dueno?.nombre_completo ?? '',
    b.dueno?.nombre_usuario ?? '',
    fechaIso(b.fecha_creacion),
    fechaIso(b.usado_en),
    b.escaneador?.nombre_completo ?? '',
  ]);
  const lineas = [encabezado, ...filas].map((fila) => fila.map((v) => celdaCsv(v)).join(','));
  return { nombre: `asistentes-${slug(evento.titulo)}-${evento.id}.csv`, contenido: `${BOM}${lineas.join('\r\n')}\r\n` };
}
