import { getSqlite } from '../db/connection'
import type { MovimientoDetalle, MovimientoHistItem, MovimientoLinea } from '@shared/dto'

/**
 * Historial unificado de movimientos de inventario de la matriz:
 *
 *   - ENTRADA / SALIDA → tabla `movimiento` (documentos con folio + líneas JSON)
 *   - TRASPASO         → tabla `traspaso` (encabezado + líneas JSON)
 *
 * Ambas viven en la BD, así que el historial viaja en el respaldo .bak.
 * El detalle alimenta tanto la vista del modal como la impresión en PDF.
 */

function parseLineas(json: string | null | undefined): MovimientoLinea[] {
  try {
    const arr = JSON.parse(json ?? '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/**
 * Completa cada línea con la sustancia activa del catálogo (lookup por código
 * al momento de leer — así aplica también a documentos guardados antes).
 */
function conSustancia(items: MovimientoLinea[]): MovimientoLinea[] {
  if (items.length === 0) return items
  const sel = getSqlite().prepare(
    'SELECT sustancia_activa AS sustancia FROM producto WHERE codigo = ?'
  )
  return items.map((l) => ({
    ...l,
    sustancia:
      (sel.get(l.codigo) as { sustancia: string | null } | undefined)?.sustancia ?? null
  }))
}

function valorDeLineas(items: MovimientoLinea[]): number {
  const total = items.reduce(
    (s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo) || 0),
    0
  )
  return +total.toFixed(2)
}

interface MovRow {
  folio: string
  tipo: string
  fecha: number
  bodega: string | null
  usuario: string | null
  proveedor: string | null
  motivo: string | null
  lineas: number
  unidades: number
  valor: number
  itemsJson: string
}

interface TraspasoRow {
  folio: string
  fecha: number
  bodega: string | null
  destino: string | null
  destinoTipo: string | null
  usuario: string | null
  lineas: number
  unidades: number
  itemsJson: string
}

// Traspasos antiguos (sin destino_tipo) eran siempre a sucursal.
function tipoDestino(raw: string | null): 'SUCURSAL' | 'BODEGA' {
  return raw === 'BODEGA' ? 'BODEGA' : 'SUCURSAL'
}

export function listMovimientos(): MovimientoHistItem[] {
  const sqlite = getSqlite()

  const movs = sqlite
    .prepare(
      `SELECT m.folio, m.tipo, m.fecha,
              m.bodega_nombre    AS bodega,
              m.usuario_nombre   AS usuario,
              m.proveedor_nombre AS proveedor,
              m.motivo, m.lineas, m.unidades, m.valor,
              m.items_json       AS itemsJson
         FROM movimiento m`
    )
    .all() as MovRow[]

  const traspasos = sqlite
    .prepare(
      `SELECT t.folio, t.fecha,
              t.bodega_origen_nombre AS bodega,
              t.sucursal_nombre      AS destino,
              t.destino_tipo         AS destinoTipo,
              u.nombre               AS usuario,
              t.lineas, t.unidades,
              t.items_json           AS itemsJson
         FROM traspaso t
         LEFT JOIN usuario u ON u.id = t.usuario_id`
    )
    .all() as TraspasoRow[]

  const items: MovimientoHistItem[] = [
    ...movs.map((r) => ({
      folio: r.folio,
      tipo: (r.tipo === 'SALIDA' ? 'SALIDA' : 'ENTRADA') as MovimientoHistItem['tipo'],
      fecha: new Date(r.fecha).toISOString(),
      bodega: r.bodega ?? '—',
      destino: null,
      destinoTipo: null,
      usuario: r.usuario ?? null,
      proveedor: r.proveedor ?? null,
      lineas: Number(r.lineas) || 0,
      unidades: Number(r.unidades) || 0,
      valor: Number(r.valor) || 0
    })),
    ...traspasos.map((r) => ({
      folio: r.folio,
      tipo: 'TRASPASO' as const,
      fecha: new Date(r.fecha).toISOString(),
      bodega: r.bodega ?? '—',
      destino: r.destino ?? '—',
      destinoTipo: tipoDestino(r.destinoTipo),
      usuario: r.usuario ?? null,
      proveedor: null,
      lineas: Number(r.lineas) || 0,
      unidades: Number(r.unidades) || 0,
      valor: valorDeLineas(parseLineas(r.itemsJson))
    }))
  ]

  items.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
  return items
}

export function getMovimientoDetalle(folio: string): MovimientoDetalle | null {
  const sqlite = getSqlite()

  const mov = sqlite
    .prepare(
      `SELECT m.folio, m.tipo, m.fecha,
              m.bodega_nombre    AS bodega,
              m.usuario_nombre   AS usuario,
              m.proveedor_nombre AS proveedor,
              m.motivo, m.lineas, m.unidades, m.valor,
              m.items_json       AS itemsJson
         FROM movimiento m WHERE m.folio = ?`
    )
    .get(folio) as MovRow | undefined
  if (mov) {
    return {
      folio: mov.folio,
      tipo: mov.tipo === 'SALIDA' ? 'SALIDA' : 'ENTRADA',
      fecha: new Date(mov.fecha).toISOString(),
      bodega: mov.bodega ?? '—',
      destino: null,
      destinoTipo: null,
      usuario: mov.usuario ?? null,
      proveedor: mov.proveedor ?? null,
      lineas: Number(mov.lineas) || 0,
      unidades: Number(mov.unidades) || 0,
      valor: Number(mov.valor) || 0,
      motivo: mov.motivo ?? null,
      items: conSustancia(parseLineas(mov.itemsJson))
    }
  }

  const t = sqlite
    .prepare(
      `SELECT t.folio, t.fecha,
              t.bodega_origen_nombre AS bodega,
              t.sucursal_nombre      AS destino,
              t.destino_tipo         AS destinoTipo,
              u.nombre               AS usuario,
              t.lineas, t.unidades,
              t.items_json           AS itemsJson
         FROM traspaso t
         LEFT JOIN usuario u ON u.id = t.usuario_id
        WHERE t.folio = ?`
    )
    .get(folio) as TraspasoRow | undefined
  if (!t) return null

  const items = conSustancia(parseLineas(t.itemsJson))
  return {
    folio: t.folio,
    tipo: 'TRASPASO',
    fecha: new Date(t.fecha).toISOString(),
    bodega: t.bodega ?? '—',
    destino: t.destino ?? '—',
    destinoTipo: tipoDestino(t.destinoTipo),
    usuario: t.usuario ?? null,
    proveedor: null,
    lineas: Number(t.lineas) || 0,
    unidades: Number(t.unidades) || 0,
    valor: valorDeLineas(items),
    motivo: null,
    items
  }
}
