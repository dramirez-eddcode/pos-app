import type { ProductoDto } from '@shared/dto'
import type { IvaModo } from '@shared/types'
import { calcFromBase, round2 } from '@shared/iva'

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

/**
 * Precio unitario "bruto" para mostrar en UI y ticket. Garantiza que la
 * cuenta `precio × cantidad ≈ total` coincida visualmente sin importar el
 * modo de IVA del producto:
 *   - exento   → precioUnitario (sin IVA)
 *   - incluido → precioUnitario (ya trae IVA)
 *   - sumar    → precioUnitario + IVA (lo que el cliente realmente paga por unidad)
 *
 * Se deriva de `total / cantidad` para evitar discrepancias de 1 centavo
 * entre el precio mostrado y el total de la línea.
 */
export function precioConIva(item: CartItem): number {
  if (item.cantidad <= 0) return item.precioUnitario
  return round2(item.total / item.cantidad)
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
