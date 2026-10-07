import { randomUUID } from 'node:crypto'
import { getSqlite } from '../db/connection'
import { requireAdminOrSupervisor } from './permisos'
import type {
  RedistribuirLotesInput,
  RedistribuirLotesResult,
  StockBodegaItem,
  StockBodegaResult
} from '@shared/dto'

/**
 * Consulta de stock por bodega (solo lectura) para apoyar el inventario físico.
 * Agrega los lotes con saldo > 0 por producto, calcula KPIs (valor a costo,
 * bajo mínimo, lotes por vencer / vencidos) y devuelve el detalle de lotes
 * en orden FEFO (caducidad ascendente).
 */

const DIA_MS = 86_400_000
const VENTANA_POR_VENCER_DIAS = 90

interface Row {
  loteId: string
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

export function getStockPorBodega(bodegaId: string, incluirCero = false): StockBodegaResult {
  const sqlite = getSqlite()
  if (!bodegaId) throw new Error('Bodega requerida')

  const rows = sqlite
    .prepare(
      `SELECT cl.id             AS loteId,
              p.id              AS productoId,
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
      loteId: r.loteId,
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

  // Los KPIs se calculan SOLO con lo que tiene stock (no cambian al incluir 0).
  const skusConStock = items.length

  // Opcional: agrega los productos activos que NO tienen existencia en esta
  // bodega (existencia 0). Útil para confirmar que el producto SÍ está en el
  // catálogo aunque su stock sea 0.
  if (incluirCero) {
    const conStock = new Set(items.map((it) => it.productoId))
    const activos = sqlite
      .prepare(
        `SELECT p.id AS productoId, p.codigo, p.nombre,
                p.sustancia_activa AS sustanciaActiva,
                p.costo, p.precio, p.stock_minimo AS stockMinimo
           FROM producto p
          WHERE p.activo = 1
          ORDER BY p.nombre ASC`
      )
      .all() as Array<{
      productoId: string
      codigo: string
      nombre: string
      sustanciaActiva: string | null
      costo: number
      precio: number
      stockMinimo: number
    }>
    for (const r of activos) {
      if (conStock.has(r.productoId)) continue
      items.push({
        productoId: r.productoId,
        codigo: r.codigo,
        nombre: r.nombre,
        sustanciaActiva: r.sustanciaActiva ?? null,
        activo: true,
        costo: Number(r.costo) || 0,
        precio: Number(r.precio) || 0,
        stockMinimo: Number(r.stockMinimo) || 0,
        existencias: 0,
        valorCosto: 0,
        bajoMinimo: false,
        proximaCaducidad: null,
        lotes: []
      })
    }
    items.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }

  return {
    resumen: {
      skusConStock,
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

/**
 * Corrige la fecha de caducidad de un lote SIN tocar el saldo. Útil para
 * arreglar lotes capturados con fecha equivocada (p. ej. en la migración).
 */
export function updateLoteCaducidad(
  viewerUserId: string,
  loteId: string,
  fechaYmd: string
): { ok: true; caducidad: string } {
  requireAdminOrSupervisor(viewerUserId)
  const m = (fechaYmd ?? '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) throw new Error('Fecha inválida (formato esperado: AAAA-MM-DD)')
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (!Number.isFinite(ms)) throw new Error('Fecha inválida')

  const sqlite = getSqlite()
  const lote = sqlite.prepare('SELECT id FROM caducidad_lote WHERE id = ?').get(loteId) as
    | { id: string }
    | undefined
  if (!lote) throw new Error('Lote no encontrado')

  sqlite.prepare('UPDATE caducidad_lote SET fecha_caducidad = ? WHERE id = ?').run(ms, loteId)
  return { ok: true, caducidad: new Date(ms).toISOString().slice(0, 10) }
}

function ymdToMs(fechaYmd: string): number {
  const m = (fechaYmd ?? '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) throw new Error(`Fecha inválida "${fechaYmd}" (formato esperado: AAAA-MM-DD)`)
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (!Number.isFinite(ms)) throw new Error(`Fecha inválida "${fechaYmd}"`)
  return ms
}

/**
 * Redistribuye las existencias de un producto entre sus lotes de UNA bodega
 * SIN cambiar el total: cambia cantidades, crea lotes nuevos (con caducidad)
 * y "elimina" lotes dejándolos en saldo 0 — NUNCA con DELETE, porque
 * mov_stock.lote_id y venta_item.lote_id los referencian (el kárdex se
 * rompería). Deja mov_stock tipo=AJUSTE por lote con deltas que suman 0, así
 * el saldo acumulado del kárdex sigue cuadrando y queda auditoría (usuario en
 * el motivo, fecha del movimiento). Reglas: mínimo 1 lote, máximo tantos
 * lotes como unidades, y la suma repartida debe ser EXACTAMENTE el total.
 */
export function redistribuirLotes(input: RedistribuirLotesInput): RedistribuirLotesResult {
  requireAdminOrSupervisor(input.usuarioId)
  const sqlite = getSqlite()

  const total = Math.round(Number(input.totalEsperado))
  if (!Number.isInteger(total) || total <= 0) throw new Error('Sin existencias que repartir')
  if (!input.bodegaId) throw new Error('Bodega requerida')
  if (!input.lotes || input.lotes.length === 0) throw new Error('Debe quedar al menos 1 lote')
  if (input.lotes.length > total) {
    throw new Error(`Máximo ${total} lotes (uno por unidad)`)
  }

  // Validación de líneas ANTES de tocar la BD.
  let suma = 0
  const vistos = new Set<string>()
  const lineas = input.lotes.map((l) => {
    if (!Number.isInteger(l.cantidad) || l.cantidad < 1) {
      throw new Error('Cada lote debe quedar con una cantidad entera de al menos 1')
    }
    if (l.loteId) {
      if (vistos.has(l.loteId)) throw new Error('Lote repetido en la captura')
      vistos.add(l.loteId)
    }
    suma += l.cantidad
    return { loteId: l.loteId ?? null, cantidad: l.cantidad, fechaMs: ymdToMs(l.caducidad) }
  })
  if (suma !== total) {
    throw new Error(`La suma repartida (${suma}) debe ser exactamente ${total}`)
  }

  const run = sqlite.transaction(() => {
    const now = Date.now()

    const bodega = sqlite
      .prepare('SELECT id, activa FROM bodega WHERE id = ?')
      .get(input.bodegaId) as { id: string; activa: number } | undefined
    if (!bodega) throw new Error('Bodega no encontrada')
    if (!bodega.activa) throw new Error('La bodega está desactivada')

    // Estado actual DENTRO de la transacción: si alguien vendió o metió
    // mercancía entre abrir el ajuste y guardar, se rechaza (guard de
    // concurrencia contra el total que el usuario vio en pantalla).
    const actuales = sqlite
      .prepare(
        `SELECT id, total, saldo FROM caducidad_lote
          WHERE producto_id = ? AND bodega_id = ? AND saldo > 0`
      )
      .all(input.productoId, input.bodegaId) as Array<{
      id: string
      total: number
      saldo: number
    }>
    const totalActual = actuales.reduce((s, l) => s + l.saldo, 0)
    if (totalActual !== total) {
      throw new Error(
        `Las existencias cambiaron mientras capturabas (ahora son ${totalActual}). Vuelve a abrir el ajuste.`
      )
    }
    const porId = new Map(actuales.map((l) => [l.id, l]))
    for (const ln of lineas) {
      if (ln.loteId && !porId.has(ln.loteId)) {
        throw new Error('Un lote de la captura ya no existe en esta bodega — vuelve a abrir el ajuste')
      }
    }

    const updSaldoTotal = sqlite.prepare(
      'UPDATE caducidad_lote SET saldo = ?, total = ? WHERE id = ?'
    )
    const updFecha = sqlite.prepare('UPDATE caducidad_lote SET fecha_caducidad = ? WHERE id = ?')
    const insLote = sqlite.prepare(
      `INSERT INTO caducidad_lote (id, producto_id, bodega_id, total, saldo, fecha_caducidad, fecha_entrada)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    // Tipo AJUSTE (no ENTRADA/SALIDA): no hay movimiento físico ni documento
    // con folio, y el kárdex no intenta ligarle un documento por fecha.
    const insMov = sqlite.prepare(
      `INSERT INTO mov_stock (id, lote_id, venta_item_id, tipo, cantidad, fecha, motivo)
       VALUES (?, ?, NULL, 'AJUSTE', ?, ?, ?)`
    )
    const motivo = `REDISTRIBUCION DE LOTES por ${input.usuarioId}` // el kárdex limpia el " por <uuid>"

    let lotesCreados = 0
    let lotesModificados = 0
    let lotesEnCero = 0

    // 1) Lotes existentes que siguen en la captura: delta de saldo y/o fecha.
    for (const ln of lineas) {
      if (!ln.loteId) continue
      const lote = porId.get(ln.loteId)!
      porId.delete(ln.loteId)
      const delta = ln.cantidad - lote.saldo
      if (delta !== 0) {
        updSaldoTotal.run(ln.cantidad, Math.max(lote.total, ln.cantidad), lote.id)
        insMov.run(randomUUID(), lote.id, delta, now, motivo)
        lotesModificados++
      }
      updFecha.run(ln.fechaMs, lote.id) // idempotente si la fecha no cambió
    }

    // 2) Lotes existentes QUITADOS de la captura → saldo 0 (nunca DELETE).
    for (const lote of porId.values()) {
      updSaldoTotal.run(0, lote.total, lote.id)
      insMov.run(randomUUID(), lote.id, -lote.saldo, now, motivo)
      lotesModificados++
      lotesEnCero++
    }

    // 3) Lotes nuevos.
    for (const ln of lineas) {
      if (ln.loteId) continue
      const loteId = randomUUID()
      insLote.run(loteId, input.productoId, input.bodegaId, ln.cantidad, ln.cantidad, ln.fechaMs, now)
      insMov.run(randomUUID(), loteId, ln.cantidad, now, motivo)
      lotesCreados++
    }

    return { ok: true as const, lotesCreados, lotesModificados, lotesEnCero }
  })

  return run()
}
