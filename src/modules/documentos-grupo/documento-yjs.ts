import * as Y from 'yjs';

/**
 * Nombre del XmlFragment donde TipTap (extensión Collaboration, `field`) guarda el contenido.
 * Debe coincidir con el frontend (`CAMPO_CONTENIDO` en data/documentos-grupo).
 */
export const CAMPO_CONTENIDO = 'contenido';

/** Caracteres del texto que se guardan como resumen para las listas. */
const LARGO_RESUMEN = 280;

type NodoXml = Y.XmlElement | Y.XmlText;

interface TrozoDelta {
  insert?: unknown;
  attributes?: Record<string, unknown>;
}

/** Documento Yjs a partir del estado guardado (vacío si no hay). */
export function docDesde(estado: Uint8Array | null | undefined): Y.Doc {
  const doc = new Y.Doc();
  if (estado?.length) Y.applyUpdate(doc, estado);
  return doc;
}

export function fragmentoDe(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment(CAMPO_CONTENIDO);
}

// ---------- Texto plano ----------

/** Copia en texto plano (para buscar, la vista previa y exportar .txt). */
export function textoPlano(doc: Y.Doc): string {
  return hijos(fragmentoDe(doc))
    .flatMap((nodo) => lineas(nodo))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Primeros caracteres del texto en una sola línea. */
export function resumenDe(texto: string): string {
  const plano = texto.replace(/\s+/g, ' ').trim();
  return plano.length > LARGO_RESUMEN ? `${plano.slice(0, LARGO_RESUMEN - 1)}…` : plano;
}

function hijos(padre: Y.XmlFragment | Y.XmlElement): NodoXml[] {
  return padre.toArray().filter((n): n is NodoXml => n instanceof Y.XmlElement || n instanceof Y.XmlText);
}

function lineas(nodo: NodoXml): string[] {
  if (nodo instanceof Y.XmlText) return [textoDe(nodo)];
  switch (nodo.nodeName) {
    case 'paragraph':
    case 'heading':
    case 'codeBlock':
      return [textoEnLinea(nodo)];
    case 'horizontalRule':
      return ['---'];
    case 'bulletList':
      return hijos(nodo).flatMap((item) => lineasDeItem(item, '• '));
    case 'orderedList': {
      const inicio = Number(nodo.getAttribute('start') ?? 1) || 1;
      return hijos(nodo).flatMap((item, i) => lineasDeItem(item, `${inicio + i}. `));
    }
    case 'taskList':
      return hijos(nodo).flatMap((item) => lineasDeItem(item, marcado(item) ? '[x] ' : '[ ] '));
    case 'blockquote':
      return hijos(nodo)
        .flatMap((hijo) => lineas(hijo))
        .map((l) => `> ${l}`);
    default:
      return hijos(nodo).flatMap((hijo) => lineas(hijo));
  }
}

function lineasDeItem(item: NodoXml, prefijo: string): string[] {
  const [primera = '', ...resto] = lineas(item);
  return [`${prefijo}${primera}`, ...resto.map((l) => `  ${l}`)];
}

function marcado(nodo: NodoXml): boolean {
  if (!(nodo instanceof Y.XmlElement)) return false;
  const valor = nodo.getAttribute('checked') as unknown;
  return valor === true || valor === 'true';
}

function textoEnLinea(elemento: Y.XmlElement): string {
  return hijos(elemento)
    .map((hijo) => {
      if (hijo instanceof Y.XmlText) return textoDe(hijo);
      if (hijo.nodeName === 'hardBreak') return '\n';
      return textoEnLinea(hijo);
    })
    .join('');
}

function textoDe(texto: Y.XmlText): string {
  return (texto.toDelta() as TrozoDelta[]).map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('');
}

// ---------- HTML ----------

/** Página HTML completa lista para descargar. */
export function documentoHtml(doc: Y.Doc, titulo: string): string {
  const cuerpo = hijos(fragmentoDe(doc)).map((nodo) => html(nodo)).join('\n');
  return [
    '<!doctype html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapar(titulo)}</title>`,
    '<style>body{font-family:system-ui,sans-serif;max-width:780px;margin:2rem auto;padding:0 1rem;line-height:1.6}' +
      'pre{background:#f3f4f6;padding:.75rem;border-radius:.5rem;overflow:auto}blockquote{border-left:4px solid #d1d5db;margin:0;padding-left:1rem;color:#4b5563}' +
      'ul[data-type=taskList]{list-style:none;padding-left:0}</style>',
    '</head>',
    '<body>',
    cuerpo,
    '</body>',
    '</html>',
  ].join('\n');
}

/** Solo el contenido (sin <html>), por ejemplo para mostrar una versión. */
export function contenidoHtml(doc: Y.Doc): string {
  return hijos(fragmentoDe(doc))
    .map((nodo) => html(nodo))
    .join('');
}

const ETIQUETAS: Record<string, string> = {
  paragraph: 'p',
  blockquote: 'blockquote',
  bulletList: 'ul',
  listItem: 'li',
};

function html(nodo: NodoXml): string {
  if (nodo instanceof Y.XmlText) return htmlDeTexto(nodo);
  const contenido = () => hijos(nodo).map((hijo) => html(hijo)).join('');
  switch (nodo.nodeName) {
    case 'heading': {
      const nivel = Math.min(6, Math.max(1, Number(nodo.getAttribute('level') ?? 1) || 1));
      return `<h${nivel}>${contenido()}</h${nivel}>`;
    }
    case 'orderedList': {
      const inicio = Number(nodo.getAttribute('start') ?? 1) || 1;
      return `<ol${inicio !== 1 ? ` start="${inicio}"` : ''}>${contenido()}</ol>`;
    }
    case 'taskList':
      return `<ul data-type="taskList">${contenido()}</ul>`;
    case 'taskItem':
      return `<li><input type="checkbox" disabled${marcado(nodo) ? ' checked' : ''}> ${contenido()}</li>`;
    case 'codeBlock': {
      const lenguaje = nodo.getAttribute('language') as unknown;
      const clase = typeof lenguaje === 'string' && /^[\w-]+$/.test(lenguaje) ? ` class="language-${lenguaje}"` : '';
      return `<pre><code${clase}>${contenido()}</code></pre>`;
    }
    case 'horizontalRule':
      return '<hr>';
    case 'hardBreak':
      return '<br>';
    default: {
      const etiqueta = ETIQUETAS[nodo.nodeName];
      return etiqueta ? `<${etiqueta}>${contenido()}</${etiqueta}>` : contenido();
    }
  }
}

/** Marcas de TipTap → etiquetas HTML (las demás se ignoran). */
const MARCAS: [string, string][] = [
  ['code', 'code'],
  ['bold', 'strong'],
  ['italic', 'em'],
  ['underline', 'u'],
  ['strike', 's'],
  ['highlight', 'mark'],
];

function htmlDeTexto(texto: Y.XmlText): string {
  return (texto.toDelta() as TrozoDelta[])
    .map(({ insert, attributes = {} }) => {
      if (typeof insert !== 'string') return '';
      // y-prosemirror puede guardar "marca--hash" cuando una marca se repite
      const marcas = new Map(Object.entries(attributes).map(([clave, valor]) => [clave.split('--')[0], valor]));
      let salida = escapar(insert);
      for (const [marca, etiqueta] of MARCAS) if (marcas.has(marca)) salida = `<${etiqueta}>${salida}</${etiqueta}>`;
      const href = (marcas.get('link') as { href?: unknown } | undefined)?.href;
      if (typeof href === 'string' && /^(https?:|mailto:)/i.test(href)) salida = `<a href="${escapar(href)}">${salida}</a>`;
      return salida;
    })
    .join('');
}

function escapar(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- Restaurar ----------

/**
 * Reemplaza el contenido de `destino` por el de `origen` en una sola transacción.
 * Así la restauración viaja como una actualización normal de Yjs a todos los que están editando.
 */
export function reemplazarContenido(destino: Y.Doc, origen: Y.Doc, origin: unknown): void {
  const actual = fragmentoDe(destino);
  const copia = hijos(fragmentoDe(origen)).map((nodo) => nodo.clone());
  destino.transact(() => {
    if (actual.length) actual.delete(0, actual.length);
    if (copia.length) actual.insert(0, copia);
  }, origin);
}
