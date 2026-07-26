import { getSqlite } from '../db/connection'
import { folioMovimiento } from '@shared/dto'
import type {
  KardexItem,
  KardexTipo,
  MovimientoDetalle,
  MovimientoHistItem,
  MovimientoLinea
} from '@shared/dto'

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
  numero: number
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
  numero: number
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
      `SELECT m.folio, m.numero, m.tipo, m.fecha,
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
      `SELECT t.folio, t.numero, t.fecha,
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
      numero: Number(r.numero) || 0,
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
      numero: Number(r.numero) || 0,
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

// Lote "sin caducidad" (sentinel de cargaInicial/traspasos): no se muestra fecha.
const SIN_CADUCIDAD_MS = Date.UTC(2099, 11, 31)

/**
 * Kárdex por producto: TODOS los movimientos de stock del producto (ventas,
 * cancelaciones, entradas, salidas, ajustes, traspasos y carga inicial) en
 * orden cronológico, con el saldo acumulado después de cada uno. Sale del
 * journal `mov_stock` (cantidad firmada), así que el saldo del último renglón
 * coincide con la existencia actual.
 */
export function getKardexProducto(productoId: string): KardexItem[] {
  const sqlite = getSqlite()
  // docFolio: el journal no guarda la referencia al documento, pero cada
  // operación usa el MISMO timestamp en toda su transacción (journal y
  // documento comparten el `now`), así que el documento se resuelve por
  // fecha exacta + tipo (movimiento) o fecha exacta (traspaso).
  const rows = sqlite
    .prepare(
      `SELECT ms.tipo, ms.cantidad, ms.fecha, ms.motivo,
              cl.fecha_caducidad AS caducidadMs,
              b.nombre           AS bodega,
              v.folio_local      AS ventaFolio,
              (SELECT m2.folio  FROM movimiento m2
                WHERE m2.fecha = ms.fecha AND m2.tipo = ms.tipo LIMIT 1) AS movFolio,
              (SELECT m2.numero FROM movimiento m2
                WHERE m2.fecha = ms.fecha AND m2.tipo = ms.tipo LIMIT 1) AS movNumero,
              (SELECT t2.folio  FROM traspaso t2
                WHERE t2.fecha = ms.fecha LIMIT 1) AS trasFolio,
              (SELECT t2.numero FROM traspaso t2
                WHERE t2.fecha = ms.fecha LIMIT 1) AS trasNumero
         FROM mov_stock ms
         JOIN caducidad_lote cl ON cl.id = ms.lote_id
         LEFT JOIN bodega b     ON b.id = cl.bodega_id
         LEFT JOIN venta_item vi ON vi.id = ms.venta_item_id
         LEFT JOIN venta v       ON v.id = vi.venta_id
        WHERE cl.producto_id = ?
        ORDER BY ms.fecha ASC, ms.rowid ASC`
    )
    .all(productoId) as Array<{
    tipo: string
    cantidad: number
    fecha: number
    motivo: string | null
    caducidadMs: number
    bodega: string | null
    ventaFolio: number | null
    movFolio: string | null
    movNumero: number | null
    trasFolio: string | null
    trasNumero: number | null
  }>

  // El motivo guarda "… por <uuid>" para auditoría; se limpia para mostrar.
  const UUID_SUFFIX = / por [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  // "TRASPASO <uuid-completo> …" → "Traspaso <8 chars>… …" (legible, rastreable)
  const TRASPASO_UUID = /TRASPASO ([0-9a-f]{8})[0-9a-f-]{28}/i

  let saldo = 0
  return rows.map((r) => {
    const cantidad = Number(r.cantidad) || 0
    saldo += cantidad
    const tipo = (
      ['ENTRADA', 'SALIDA', 'AJUSTE', 'VENTA', 'CANCELACION_VENTA'].includes(r.tipo)
        ? r.tipo
        : 'AJUSTE'
    ) as KardexTipo

    // Documento al que pertenece el renglón (sólo entradas/salidas; en
    // ventas/ajustes/carga inicial un match casual por fecha sería un falso
    // positivo). La referencia muestra su folio corto: E-12 / S-4 / T-7 —
    // p. ej. una entrada por traspaso recibido enlaza a su documento E-n con
    // TODAS las líneas que venían en ese traspaso.
    let docFolio: string | null = null
    let referencia: string | null = null
    if (tipo === 'ENTRADA' || tipo === 'SALIDA') {
      if (r.movFolio) {
        docFolio = r.movFolio
        referencia = folioMovimiento(tipo, Number(r.movNumero) || 0)
      } else if (r.trasFolio) {
        docFolio = r.trasFolio
        referencia = folioMovimiento('TRASPASO', Number(r.trasNumero) || 0)
      }
    } else if (tipo === 'VENTA') {
      referencia = r.ventaFolio != null ? `Venta #${r.ventaFolio}` : 'Venta'
    } else if (tipo === 'CANCELACION_VENTA') {
      referencia = r.ventaFolio != null ? `Cancelación venta #${r.ventaFolio}` : 'Cancelación de venta'
    }

    const motivo = r.motivo
      ? r.motivo.replace(UUID_SUFFIX, '').replace(TRASPASO_UUID, 'Traspaso $1…')
      : null

    return {
      fecha: new Date(r.fecha).toISOString(),
      tipo,
      cantidad,
      saldo,
      motivo,
      referencia,
      caducidad:
        Number(r.caducidadMs) === SIN_CADUCIDAD_MS
          ? null
          : new Date(Number(r.caducidadMs)).toISOString().slice(0, 10),
      bodega: r.bodega ?? null,
      docFolio
    }
  })
}

export function getMovimientoDetalle(folio: string): MovimientoDetalle | null {
  const sqlite = getSqlite()

  const mov = sqlite
    .prepare(
      `SELECT m.folio, m.numero, m.tipo, m.fecha,
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
      numero: Number(mov.numero) || 0,
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
      `SELECT t.folio, t.numero, t.fecha,
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
    numero: Number(t.numero) || 0,
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
