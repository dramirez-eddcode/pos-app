import { getSqlite } from '../db/connection'
import type { StockBodegaItem, StockBodegaResult } from '@shared/dto'

/**
 * Consulta de stock por bodega (solo lectura) para apoyar el inventario físico.
 * Agrega los lotes con saldo > 0 por producto, calcula KPIs (valor a costo,
 * bajo mínimo, lotes por vencer / vencidos) y devuelve el detalle de lotes
 * en orden FEFO (caducidad ascendente).
 */

const DIA_MS = 86_400_000
const VENTANA_POR_VENCER_DIAS = 90

interface Row {
  productoId: string
  codigo: string
  nombre: string
  sustanciaActiva: string | null
  activo: number
  costo: number
  precio: number
  stockMinimo: number
  saldo: number
  fechaCaducidad: number
}

export function getStockPorBodega(bodegaId: string): StockBodegaResult {
  const sqlite = getSqlite()
  if (!bodegaId) throw new Error('Bodega requerida')

  const rows = sqlite
    .prepare(
      `SELECT p.id              AS productoId,
              p.codigo          AS codigo,
              p.nombre          AS nombre,
              p.sustancia_activa AS sustanciaActiva,
              p.activo          AS activo,
              p.costo           AS costo,
              p.precio          AS precio,
              p.stock_minimo    AS stockMinimo,
              cl.saldo          AS saldo,
              cl.fecha_caducidad AS fechaCaducidad
         FROM caducidad_lote cl
         JOIN producto p ON p.id = cl.producto_id
        WHERE cl.bodega_id = ? AND cl.saldo > 0
        ORDER BY p.nombre ASC, cl.fecha_caducidad ASC`
    )
    .all(bodegaId) as Row[]

  const now = Date.now()
  const limitePorVencer = now + VENTANA_POR_VENCER_DIAS * DIA_MS

  const map = new Map<string, StockBodegaItem>()
  let lotesCount = 0
  let vencidos = 0
  let porVencer = 0

  for (const r of rows) {
    const ms = Number(r.fechaCaducidad)
    const vencido = ms < now
    const pv = !vencido && ms <= limitePorVencer
    lotesCount++
    if (vencido) vencidos++
    else if (pv) porVencer++

    let item = map.get(r.productoId)
    if (!item) {
      item = {
        productoId: r.productoId,
        codigo: r.codigo,
        nombre: r.nombre,
        sustanciaActiva: r.sustanciaActiva ?? null,
        activo: Boolean(r.activo),
        costo: Number(r.costo) || 0,
        precio: Number(r.precio) || 0,
        stockMinimo: Number(r.stockMinimo) || 0,
        existencias: 0,
        valorCosto: 0,
        bajoMinimo: false,
        proximaCaducidad: null,
        lotes: []
      }
      map.set(r.productoId, item)
    }
    const saldo = Number(r.saldo) || 0
    item.existencias += saldo
    item.lotes.push({
      caducidad: new Date(ms).toISOString().slice(0, 10),
      saldo,
      vencido,
      porVencer: pv
    })
  }

  const items = [...map.values()]
  let unidades = 0
  let valorCosto = 0
  let bajoMinimo = 0
  for (const it of items) {
    it.valorCosto = +(it.existencias * it.costo).toFixed(2)
    it.bajoMinimo = it.stockMinimo > 0 && it.existencias < it.stockMinimo
    it.proximaCaducidad = it.lotes.length > 0 ? it.lotes[0]!.caducidad : null
    unidades += it.existencias
    valorCosto += it.valorCosto
    if (it.bajoMinimo) bajoMinimo++
  }

  return {
    resumen: {
      skusConStock: items.length,
      unidades,
      valorCosto: +valorCosto.toFixed(2),
      lotes: lotesCount,
      bajoMinimo,
      porVencer,
      vencidos
    },
    items
  }
}
