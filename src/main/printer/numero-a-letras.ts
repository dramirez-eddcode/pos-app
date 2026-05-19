/**
 * Convierte un número a texto en español (enteros 0-999,999) + centavos.
 * Uso en tickets: "( UN PESOS 00/100 M.N. )"
 *
 * Nota: el legacy usa "PESOS" invariable (singular también) — mantenemos esa
 * convención para coincidir exactamente con el ticket de referencia.
 */

const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE']
const ESPECIALES = [
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISEIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE'
]
const DECENAS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
const CENTENAS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS'
]

function centenas(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'CIEN'
  const c = Math.floor(n / 100)
  const resto = n % 100
  return [CENTENAS[c], decenas(resto)].filter(Boolean).join(' ')
}

function decenas(n: number): string {
  if (n < 10) return UNIDADES[n]
  if (n < 20) return ESPECIALES[n - 10]
  if (n < 30) {
    // 20 → "VEINTE"; 21 → "VEINTIUNO" (pero legacy usa "VEINTE Y UNO" en algunos casos; mantenemos moderna)
    if (n === 20) return 'VEINTE'
    return 'VEINTI' + UNIDADES[n - 20].toLowerCase()
  }
  const d = Math.floor(n / 10)
  const u = n % 10
  return u === 0 ? DECENAS[d] : `${DECENAS[d]} Y ${UNIDADES[u]}`
}

function entero(n: number): string {
  if (n === 0) return 'CERO'
  if (n < 1000) return centenas(n)
  if (n < 1_000_000) {
    const miles = Math.floor(n / 1000)
    const resto = n % 1000
    const milesStr = miles === 1 ? 'MIL' : `${centenas(miles)} MIL`
    if (resto === 0) return milesStr
    return `${milesStr} ${centenas(resto)}`
  }
  // Para montos por encima de 999,999 caemos en algo simple; la farmacia jamás
  // va a facturar un ticket de 7 cifras en efectivo, pero por si acaso:
  return String(Math.round(n))
}

/**
 * "( UN PESOS 00/100 M.N. )"  — formato exacto del legacy.
 */
export function montoEnLetras(monto: number): string {
  const parte = Math.floor(monto)
  const cent = Math.round((monto - parte) * 100)
  const letras = entero(parte).toUpperCase()
  const centStr = cent.toString().padStart(2, '0')
  return `( ${letras} PESOS ${centStr}/100 M.N. )`
}
