/**
 * Previsualiza en consola el ticket que saldría por la EPSON.
 * Uso: npx tsx scripts/preview-receipt.ts
 *
 * Nota: los comandos ESC/POS (ESC ..., GS ...) no son visibles en el ticket
 * impreso; sólo afectan formato (centrado, bold, cut, etc.). Este preview
 * los filtra y muestra sólo el texto que el cliente verá.
 */

import iconv from 'iconv-lite'
import { buildTestReceiptBytes } from '../src/main/printer/receipt'

function stripEscposCommands(bytes: Uint8Array): Uint8Array {
  const out: number[] = []
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]!
    if (b === 0x1b) {
      // ESC: tamaño variable según comando
      const cmd = bytes[i + 1]
      if (cmd === 0x40) i += 2 // ESC @
      else if (cmd === 0x74) i += 3 // ESC t n
      else if (cmd === 0x61) i += 3 // ESC a n
      else if (cmd === 0x45) i += 3 // ESC E n
      else if (cmd === 0x64) i += 3 // ESC d n
      else if (cmd === 0x70) i += 5 // ESC p m t1 t2
      else i += 2 // fallback
    } else if (b === 0x1d) {
      // GS
      const cmd = bytes[i + 1]
      if (cmd === 0x21) i += 3 // GS ! n
      else if (cmd === 0x56) i += 3 // GS V n
      else i += 2
    } else {
      out.push(b)
      i++
    }
  }
  return new Uint8Array(out)
}

const bytes = buildTestReceiptBytes()
const text = iconv.decode(Buffer.from(stripEscposCommands(bytes)), 'cp858')

console.log('─'.repeat(50))
console.log('PREVIEW del ticket de prueba (texto que verá el cliente)')
console.log('─'.repeat(50))
console.log(text)
console.log('─'.repeat(50))
console.log(`Tamaño: ${bytes.length} bytes ESC/POS totales`)
