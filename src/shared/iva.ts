import type { IvaModo } from './types'

/** Redondeo a 2 decimales (centavos). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export interface IvaDesglose {
  importe: number // neto, sin IVA
  iva: number
  total: number // lo que paga el cliente (precio de venta)
}

/**
 * Descompone un monto bruto en {importe, iva, total} según el modo de IVA.
 *   exento   → sin IVA
 *   sumar    → el monto dado es neto; el IVA se agrega encima
 *   incluido → el monto dado ya trae IVA; se desglosa del total
 *
 * Única fuente de verdad del cálculo de IVA: la usan el carrito del POS
 * (lib/cart) y el preview de precio en el alta/edición de productos.
 */
export function calcFromBase(base: number, ivaPorcentaje: number, ivaModo: IvaModo): IvaDesglose {
  if (ivaModo === 'exento' || ivaPorcentaje <= 0) {
    const importe = round2(base)
    return { importe, iva: 0, total: importe }
  }
  const tasa = ivaPorcentaje / 100
  if (ivaModo === 'incluido') {
    const total = round2(base)
    const importe = round2(total / (1 + tasa))
    const iva = round2(total - importe)
    return { importe, iva, total }
  }
  // 'sumar'
  const importe = round2(base)
  const iva = round2(importe * tasa)
  return { importe, iva, total: round2(importe + iva) }
}
