import type { AccionPalabra, CoincidenciaPalabra, ContextoTexto } from '../../infrastructure/database/models';

/** Regla ya cargada en memoria (una palabra prohibida activa). */
export interface ReglaPalabra {
  id: number;
  palabra: string;
  coincidencia: CoincidenciaPalabra;
  accion: AccionPalabra;
  aplica_a: readonly ContextoTexto[];
}

export interface CoincidenciaTexto {
  id: number;
  palabra: string;
  accion: AccionPalabra;
  coincidencia: CoincidenciaPalabra;
  /** El fragmento tal como estaba escrito. */
  fragmento: string;
}

export interface ResultadoRevision {
  /** false si alguna coincidencia bloquea el envío. */
  permitido: boolean;
  /** Texto con las coincidencias cambiadas por asteriscos. */
  texto: string;
  coincidencias: CoincidenciaTexto[];
}

interface TextoNormalizado {
  normal: string;
  /** Para cada carácter de `normal`, dónde empieza en el texto original. */
  origen: number[];
  /** Dónde termina (exclusivo) en el original. */
  fin: number[];
}

const MARCAS = /[̀-ͯ]/g;
const LETRA_O_NUMERO = /[\p{L}\p{N}]/u;
const ESPACIO = /\s/u;

/** Minúsculas, sin acentos y con los espacios seguidos reducidos a uno. */
export function normalizar(texto: string): string {
  return normalizarConMapa(texto).normal;
}

/** Igual que normalizar() pero recuerda de qué parte del original salió cada carácter (para censurar). */
function normalizarConMapa(texto: string): TextoNormalizado {
  const resultado: TextoNormalizado = { normal: '', origen: [], fin: [] };
  let indice = 0;
  for (const caracter of texto) {
    const largo = caracter.length;
    if (ESPACIO.test(caracter)) {
      if (!resultado.normal.endsWith(' ')) agregar(resultado, ' ', indice, indice + largo);
      else resultado.fin[resultado.fin.length - 1] = indice + largo;
    } else {
      const limpio = caracter.normalize('NFD').replace(MARCAS, '').toLowerCase();
      for (const c of limpio) agregar(resultado, c, indice, indice + largo);
    }
    indice += largo;
  }
  return resultado;
}

function agregar(destino: TextoNormalizado, caracter: string, inicio: number, fin: number): void {
  for (let i = 0; i < caracter.length; i++) {
    destino.normal += caracter[i];
    destino.origen.push(inicio);
    destino.fin.push(fin);
  }
}

/**
 * Filtro de palabras prohibidas (puro, sin base de datos): se arma con las reglas activas y revisa textos.
 * - 'exacta' respeta los límites de palabra ("mal" no coincide dentro de "maleta"); 'contiene' coincide en cualquier parte.
 * - Compara sin mayúsculas ni acentos y con espacios normalizados.
 * - En el contexto 'nombre' cualquier coincidencia bloquea (un nombre con *** no sirve).
 */
export class FiltroPalabras {
  private readonly reglas: (ReglaPalabra & { normal: string })[];

  constructor(reglas: readonly ReglaPalabra[]) {
    this.reglas = reglas
      .map((r) => ({ ...r, normal: normalizar(r.palabra.trim()) }))
      .filter((r) => r.normal.length > 0);
  }

  get total(): number {
    return this.reglas.length;
  }

  revisar(texto: string, contexto: ContextoTexto): ResultadoRevision {
    if (!texto || !this.reglas.length) return { permitido: true, texto: texto ?? '', coincidencias: [] };

    const { normal, origen, fin } = normalizarConMapa(texto);
    const rangos: [number, number][] = [];
    const coincidencias: CoincidenciaTexto[] = [];

    for (const regla of this.reglas) {
      if (!regla.aplica_a.includes(contexto)) continue;
      let desde = 0;
      let encontrada = false;
      while (desde <= normal.length - regla.normal.length) {
        const posicion = normal.indexOf(regla.normal, desde);
        if (posicion < 0) break;
        const ultimo = posicion + regla.normal.length - 1;
        if (regla.coincidencia === 'contiene' || this.esPalabraCompleta(normal, posicion, ultimo)) {
          const rango: [number, number] = [origen[posicion], fin[ultimo]];
          rangos.push(rango);
          if (!encontrada) {
            coincidencias.push({
              id: regla.id,
              palabra: regla.palabra,
              accion: regla.accion,
              coincidencia: regla.coincidencia,
              fragmento: texto.slice(rango[0], rango[1]),
            });
            encontrada = true;
          }
        }
        desde = posicion + 1;
      }
    }

    const bloquea = coincidencias.some((c) => c.accion === 'bloquear') || (contexto === 'nombre' && coincidencias.length > 0);
    return { permitido: !bloquea, texto: this.censurar(texto, rangos), coincidencias };
  }

  private esPalabraCompleta(normal: string, inicio: number, ultimo: number): boolean {
    const antes = inicio > 0 ? normal[inicio - 1] : '';
    const despues = ultimo + 1 < normal.length ? normal[ultimo + 1] : '';
    return !LETRA_O_NUMERO.test(antes) && !LETRA_O_NUMERO.test(despues);
  }

  /** Cambia por * cada carácter visible dentro de los rangos (los espacios se respetan). */
  private censurar(texto: string, rangos: [number, number][]): string {
    if (!rangos.length) return texto;
    const marcado = new Array<boolean>(texto.length).fill(false);
    for (const [inicio, fin] of rangos) for (let i = inicio; i < fin; i++) marcado[i] = true;

    let resultado = '';
    let i = 0;
    for (const caracter of texto) {
      resultado += marcado[i] && !ESPACIO.test(caracter) ? '*' : caracter;
      i += caracter.length;
    }
    return resultado;
  }
}
