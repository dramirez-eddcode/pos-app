/**
 * Constructor de bytes ESC/POS. Puro TS, sin dependencias nativas.
 *
 * Estándar: ESC/POS de EPSON (compatible con TM-T20III y la mayoría de térmicas).
 * Texto se codifica a PC858 (Latin-1 multilingual + euro), que cubre acentos
 * y la ñ para españoles. Se selecciona con `selectCodepage(19)`.
 */

import iconv from 'iconv-lite'

// ── Bajos-niveles ───────────────────────────────────────────────────────────
const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

export const COLS_DEFAULT = 42 // Font A en EPSON TM-T20III a 80mm (aprox)

function bytes(...b: number[]): Uint8Array {
  return new Uint8Array(b)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.byteLength, 0)
  const out = new Uint8Array(len)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.byteLength
  }
  return out
}

// ── Builder ─────────────────────────────────────────────────────────────────
export class Escpos {
  private parts: Uint8Array[] = []

  init(): this {
    // ESC @ — reset impresora
    this.parts.push(bytes(ESC, 0x40))
    // ESC t 19 — codepage PC858 (Latin-1 multilingual + euro)
    this.parts.push(bytes(ESC, 0x74, 19))
    return this
  }

  align(mode: 'left' | 'center' | 'right'): this {
    const n = mode === 'left' ? 0 : mode === 'center' ? 1 : 2
    this.parts.push(bytes(ESC, 0x61, n))
    return this
  }

  bold(on: boolean): this {
    this.parts.push(bytes(ESC, 0x45, on ? 1 : 0))
    return this
  }

  // GS ! n — ancho y alto de caracteres (nibble alto = ancho, bajo = alto)
  size(width: 1 | 2 = 1, height: 1 | 2 = 1): this {
    const n = ((width - 1) << 4) | (height - 1)
    this.parts.push(bytes(GS, 0x21, n))
    return this
  }

  text(s: string): this {
    // PC858 para soportar ñ, á, é, í, ó, ú, ¡, ¿, €.
    // Sanitizamos caracteres Unicode que no viven en cp858 y acabarían como '?'.
    this.parts.push(new Uint8Array(iconv.encode(sanitizeForPrinter(s), 'cp858')))
    return this
  }

  line(s = ''): this {
    return this.text(s).raw(LF)
  }

  feed(lines = 1): this {
    // ESC d n — avanza n líneas
    this.parts.push(bytes(ESC, 0x64, Math.max(0, Math.min(255, lines))))
    return this
  }

  separator(cols = COLS_DEFAULT, char = '-'): this {
    return this.line(char.repeat(cols))
  }

  // GS V m — corte. 0 = total, 1 = parcial
  cut(partial = false): this {
    this.parts.push(bytes(GS, 0x56, partial ? 0x01 : 0x00))
    return this
  }

  // ESC p m t1 t2 — pulso al cajón. m: 0=pin2, 1=pin5.
  drawerPulse(pin: 0 | 1 = 0, onMs = 50, offMs = 250): this {
    const t1 = Math.max(1, Math.min(255, Math.round(onMs / 2)))
    const t2 = Math.max(1, Math.min(255, Math.round(offMs / 2)))
    this.parts.push(bytes(ESC, 0x70, pin, t1, t2))
    return this
  }

  raw(...b: number[]): this {
    this.parts.push(bytes(...b))
    return this
  }

  bytes(): Uint8Array {
    return concat(this.parts)
  }
}

// ── Sanitizador Unicode → cp858 ─────────────────────────────────────────────
/**
 * cp858 (Latin-1 + euro) no cubre punctuación tipográfica moderna. Traducimos
 * lo más común a ASCII para evitar que aparezcan como '?' en el ticket.
 */
export function sanitizeForPrinter(s: string): string {
  return s
    .replace(/[–—]/g, '-') // en-dash, em-dash → "-"
    .replace(/[‘’]/g, "'") // smart quotes → '
    .replace(/[“”]/g, '"') // smart double quotes → "
    .replace(/…/g, '...') // ellipsis → ...
    .replace(/ /g, ' ') // nbsp → espacio normal
}

// ── Utilidades de layout ────────────────────────────────────────────────────
export function padRight(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n)
  return s + ' '.repeat(n - s.length)
}

export function padLeft(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n)
  return ' '.repeat(n - s.length) + s
}

export function center(s: string, cols = COLS_DEFAULT): string {
  if (s.length >= cols) return s.slice(0, cols)
  const pad = Math.floor((cols - s.length) / 2)
  return ' '.repeat(pad) + s
}

/**
 * Construye una línea de 2 columnas: etiqueta a la izquierda, valor a la derecha.
 * El valor se alinea a la derecha dentro del ancho `cols`.
 */
export function labelValue(label: string, value: string, cols = COLS_DEFAULT): string {
  const space = cols - label.length - value.length
  if (space < 1) return (label + ' ' + value).slice(0, cols)
  return label + ' '.repeat(space) + value
}

/**
 * Construye una línea de ítem: nombre, cantidad, precio, total.
 * Tamaños fijos para alinear columnas tipo legacy.
 */
export function itemLine(
  name: string,
  qty: string,
  price: string,
  total: string,
  cols = COLS_DEFAULT
): string {
  const W_QTY = 5
  const W_PRICE = 8
  const W_TOTAL = 8
  const W_NAME = cols - W_QTY - W_PRICE - W_TOTAL
  return (
    padRight(name, W_NAME) +
    padLeft(qty, W_QTY) +
    padLeft(price, W_PRICE) +
    padLeft(total, W_TOTAL)
  )
}
