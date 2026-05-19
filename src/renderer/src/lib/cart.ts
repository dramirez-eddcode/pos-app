import type { ProductoDto } from '@shared/dto'
import type { IvaModo } from '@shared/types'

export interface CartItem {
  productoId: string
  codigo: string
  nombre: string
  cantidad: number
  precioUnitario: number
  ivaPorcentaje: number
  ivaModo: IvaModo
  importe: number
  iva: number
  total: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Descompone un monto bruto en {importe, iva, total} según el modo de IVA.
 *   exento   → sin IVA
 *   sumar    → el monto dado es neto; se agrega IVA encima
 *   incluido → el monto dado ya trae IVA; se desglosa del total
 */
function calcFromBase(
  base: number,
  ivaPorcentaje: number,
  ivaModo: IvaModo
): { importe: number; iva: number; total: number } {
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

export function makeCartItem(p: ProductoDto, cantidad = 1): CartItem {
  const base = cantidad * p.precio
  const { importe, iva, total } = calcFromBase(base, p.ivaPorcentaje, p.ivaModo)
  return {
    productoId: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    cantidad,
    precioUnitario: p.precio,
    ivaPorcentaje: p.ivaPorcentaje,
    ivaModo: p.ivaModo,
    importe,
    iva,
    total
  }
}

export function withCantidad(item: CartItem, cantidad: number): CartItem {
  if (cantidad <= 0) return item
  const base = cantidad * item.precioUnitario
  const { importe, iva, total } = calcFromBase(base, item.ivaPorcentaje, item.ivaModo)
  return { ...item, cantidad, importe, iva, total }
}

export interface CartTotals {
  subtotal: number
  iva: number
  total: number
  itemCount: number
  unitCount: number
}

export function calcTotals(items: CartItem[]): CartTotals {
  let subtotal = 0
  let iva = 0
  let unitCount = 0
  for (const i of items) {
    subtotal += i.importe
    iva += i.iva
    unitCount += i.cantidad
  }
  subtotal = round2(subtotal)
  iva = round2(iva)
  return {
    subtotal,
    iva,
    total: round2(subtotal + iva),
    itemCount: items.length,
    unitCount
  }
}
