import { randomUUID } from 'node:crypto'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { getDb, getSqlite } from '../db/connection'
import { venta, pago, movCaja } from '../db/schema'
import type {
  CorteHoyDto,
  CorteTipo,
  CreateCorteResult,
  MetodoPagoTotal,
  RangoPendienteCorte,
  UltimoCorteInfo
} from '@shared/dto'
import type { MetodoPago } from '@shared/types'

/**
 * Devuelve las cifras de control del día (corte "en pantalla"):
 *  - Conteos y totales de ventas + cancelaciones
 *  - Entradas / salidas de caja
 *  - Totales por método de pago (excluye canceladas)
 *  - Lista de folios del día para la grilla de detalle
 *
 * El "día" es desde 00:00:00 local hasta el momento de la consulta.
 */
export function getCorteHoy(): CorteHoyDto {
  const db = getDb()
  const ahora = new Date()
  const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())

  const agg = db
    .select({
      foliosVendidos: sql<number>`COALESCE(COUNT(CASE WHEN cancelada = 0 THEN 1 END), 0)`.mapWith(
        Number
      ),
      foliosCancelados: sql<number>`COALESCE(COUNT(CASE WHEN cancelada = 1 THEN 1 END), 0)`.mapWith(
        Number
      ),
      ventaDelDia:
        sql<number>`COALESCE(SUM(CASE WHEN cancelada = 0 THEN total END), 0)`.mapWith(Number),
      montoCancelado:
        sql<number>`COALESCE(SUM(CASE WHEN cancelada = 1 THEN total END), 0)`.mapWith(Number),
      subtotalDelDia:
        sql<number>`COALESCE(SUM(CASE WHEN cancelada = 0 THEN subtotal END), 0)`.mapWith(Number),
      ivaDelDia:
        sql<number>`COALESCE(SUM(CASE WHEN cancelada = 0 THEN iva END), 0)`.mapWith(Number)
    })
    .from(venta)
    .where(and(gte(venta.fecha, inicio), lte(venta.fecha, ahora)))
    .all()[0]!

  const caja = db
    .select({
      entradas:
        sql<number>`COALESCE(SUM(CASE WHEN tipo = 'ENTRADA' THEN monto END), 0)`.mapWith(Number),
      salidas:
        sql<number>`COALESCE(SUM(CASE WHEN tipo = 'SALIDA' THEN monto END), 0)`.mapWith(Number)
    })
    .from(movCaja)
    .where(and(gte(movCaja.fecha, inicio), lte(movCaja.fecha, ahora)))
    .all()[0] ?? { entradas: 0, salidas: 0 }

  const porMetodo = db
    .select({
      metodo: pago.metodo,
      monto: sql<number>`COALESCE(SUM(${pago.monto}), 0)`.mapWith(Number),
      ventas: sql<number>`COUNT(DISTINCT ${pago.ventaId})`.mapWith(Number)
    })
    .from(pago)
    .innerJoin(venta, eq(venta.id, pago.ventaId))
    .where(
      and(eq(venta.cancelada, false), gte(venta.fecha, inicio), lte(venta.fecha, ahora))
    )
    .groupBy(pago.metodo)
    .all()

  const folios = db
    .select({
      id: venta.id,
      folioLocal: venta.folioLocal,
      fecha: venta.fecha,
      total: venta.total,
      cancelada: venta.cancelada
    })
    .from(venta)
    .where(and(gte(venta.fecha, inicio), lte(venta.fecha, ahora)))
    .orderBy(venta.folioLocal)
    .all()

  return {
    fechaDesde: inicio.toISOString(),
    fechaHasta: ahora.toISOString(),
    foliosVendidos: agg.foliosVendidos,
    foliosCancelados: agg.foliosCancelados,
    ventaDelDia: round2(agg.ventaDelDia),
    montoCancelado: round2(agg.montoCancelado),
    subtotalDelDia: round2(agg.subtotalDelDia),
    ivaDelDia: round2(agg.ivaDelDia),
    entradasCaja: round2(caja.entradas),
    salidasCaja: round2(caja.salidas),
    porMetodoPago: porMetodo.map<MetodoPagoTotal>((p) => ({
      metodo: p.metodo as MetodoPago,
      monto: round2(p.monto),
      ventas: p.ventas
    })),
    folios: folios.map((f) => ({
      id: f.id,
      folioLocal: f.folioLocal,
      fecha: (f.fecha as Date).toISOString(),
      total: round2(f.total),
      cancelada: f.cancelada
    })),
    ultimoCorte: getUltimoCorteInfo(),
    pendiente: getRangoPendiente()
  }
}

function getUltimoCorteInfo(): UltimoCorteInfo | null {
  const sqlite = getSqlite()
  const row = sqlite
    .prepare(
      `SELECT c.id, c.tipo, c.fecha, c.folio_inicio, c.folio_fin,
              (c.total_efectivo + c.total_tarjeta
               + c.total_transferencia + c.total_otro) AS total,
              u.nombre AS cajero
         FROM corte c
         LEFT JOIN usuario u ON u.id = c.cajero_id
         ORDER BY c.fecha DESC
         LIMIT 1`
    )
    .get() as
    | {
        id: string
        tipo: string
        fecha: number
        folio_inicio: number
        folio_fin: number
        total: number
        cajero: string | null
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    tipo: row.tipo as UltimoCorteInfo['tipo'],
    fecha: new Date(row.fecha).toISOString(),
    folioInicio: row.folio_inicio,
    folioFin: row.folio_fin,
    total: round2(row.total),
    cajero: row.cajero
  }
}

function getRangoPendiente(): RangoPendienteCorte | null {
  const sqlite = getSqlite()
  const last = sqlite
    .prepare('SELECT folio_fin FROM corte ORDER BY fecha DESC LIMIT 1')
    .get() as { folio_fin: number } | undefined
  const max = sqlite
    .prepare('SELECT MAX(folio_local) AS m FROM venta')
    .get() as { m: number | null }

  const folioInicio = last ? last.folio_fin + 1 : 1
  const folioFin = max.m ?? 0
  const cantidad = folioFin >= folioInicio ? folioFin - folioInicio + 1 : 0
  if (cantidad === 0) return null
  return { folioInicio, folioFin, cantidad }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ── Corte / snapshot ────────────────────────────────────────────────────────

interface LastCorte {
  id: string
  fecha: number
  folio_inicio: number
  folio_fin: number
}

interface VentasAggRow {
  total_efectivo: number
  total_tarjeta: number
  total_transferencia: number
  total_otro: number
  cancelaciones: number
  folios_vendidos: number
  folios_cancelados: number
  subtotal: number
  iva: number
  total: number
}

interface CajaAggRow {
  entradas: number
  salidas: number
}

/**
 * Crea un registro de corte: snapshot atómico de las ventas + caja desde el
 * último corte (o desde el inicio del día si no hay ninguno). Devuelve los
 * totales calculados para que el renderer pueda imprimir el ticket de corte.
 *
 * Semántica: cualquier tipo de corte (Parcial, Final, Cambio de turno) cierra
 * el rango de folios cubierto. El siguiente corte empieza en folio_fin + 1.
 */
export function createCorte(cajeroId: string, tipo: CorteTipo): CreateCorteResult {
  const sqlite = getSqlite()
  const now = Date.now()
  const nowDate = new Date(now)

  const run = sqlite.transaction(() => {
    const lastCorte = sqlite
      .prepare('SELECT id, fecha, folio_inicio, folio_fin FROM corte ORDER BY fecha DESC LIMIT 1')
      .get() as LastCorte | undefined

    const folioInicio = lastCorte ? lastCorte.folio_fin + 1 : 1

    const maxRow = sqlite
      .prepare('SELECT MAX(folio_local) AS m FROM venta')
      .get() as { m: number | null }
    const folioFin = maxRow.m ?? folioInicio - 1

    if (folioFin < folioInicio) {
      throw new Error('No hay ventas nuevas desde el último corte')
    }

    const agg = sqlite
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN p.metodo = 'EFECTIVO' AND v.cancelada = 0 THEN p.monto END), 0) AS total_efectivo,
           COALESCE(SUM(CASE WHEN p.metodo = 'TARJETA' AND v.cancelada = 0 THEN p.monto END), 0) AS total_tarjeta,
           COALESCE(SUM(CASE WHEN p.metodo = 'TRANSFERENCIA' AND v.cancelada = 0 THEN p.monto END), 0) AS total_transferencia,
           COALESCE(SUM(CASE WHEN p.metodo = 'OTRO' AND v.cancelada = 0 THEN p.monto END), 0) AS total_otro,
           COALESCE((SELECT SUM(v2.total) FROM venta v2 WHERE v2.folio_local BETWEEN ? AND ? AND v2.cancelada = 1), 0) AS cancelaciones,
           (SELECT COUNT(*) FROM venta v3 WHERE v3.folio_local BETWEEN ? AND ? AND v3.cancelada = 0) AS folios_vendidos,
           (SELECT COUNT(*) FROM venta v4 WHERE v4.folio_local BETWEEN ? AND ? AND v4.cancelada = 1) AS folios_cancelados,
           (SELECT COALESCE(SUM(v5.subtotal), 0) FROM venta v5 WHERE v5.folio_local BETWEEN ? AND ? AND v5.cancelada = 0) AS subtotal,
           (SELECT COALESCE(SUM(v6.iva), 0) FROM venta v6 WHERE v6.folio_local BETWEEN ? AND ? AND v6.cancelada = 0) AS iva,
           (SELECT COALESCE(SUM(v7.total), 0) FROM venta v7 WHERE v7.folio_local BETWEEN ? AND ? AND v7.cancelada = 0) AS total
         FROM venta v
         LEFT JOIN pago p ON p.venta_id = v.id
         WHERE v.folio_local BETWEEN ? AND ?`
      )
      .get(
        folioInicio, folioFin,
        folioInicio, folioFin,
        folioInicio, folioFin,
        folioInicio, folioFin,
        folioInicio, folioFin,
        folioInicio, folioFin,
        folioInicio, folioFin
      ) as VentasAggRow

    const fechaDesde = lastCorte
      ? lastCorte.fecha
      : new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()

    const cajaAgg = sqlite
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN tipo = 'ENTRADA' THEN monto END), 0) AS entradas,
           COALESCE(SUM(CASE WHEN tipo = 'SALIDA' THEN monto END), 0) AS salidas
         FROM mov_caja
         WHERE fecha >= ? AND fecha <= ?`
      )
      .get(fechaDesde, now) as CajaAggRow

    const corteId = randomUUID()
    sqlite
      .prepare(
        `INSERT INTO corte (
           id, cajero_id, fecha, folio_inicio, folio_fin, tipo,
           total_efectivo, total_tarjeta,
           total_transferencia, total_otro,
           entradas_caja, salidas_caja, cancelaciones
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        corteId,
        cajeroId,
        now,
        folioInicio,
        folioFin,
        tipo,
        agg.total_efectivo,
        agg.total_tarjeta,
        agg.total_transferencia,
        agg.total_otro,
        cajaAgg.entradas,
        cajaAgg.salidas,
        agg.cancelaciones
      )

    const efectivoEsperado = round2(agg.total_efectivo + cajaAgg.entradas - cajaAgg.salidas)

    return {
      corteId,
      folioInicio,
      folioFin,
      fecha: nowDate.toISOString(),
      tipo,
      totales: {
        foliosVendidos: agg.folios_vendidos,
        foliosCancelados: agg.folios_cancelados,
        subtotal: round2(agg.subtotal),
        iva: round2(agg.iva),
        total: round2(agg.total),
        efectivo: round2(agg.total_efectivo),
        tarjeta: round2(agg.total_tarjeta),
        transferencia: round2(agg.total_transferencia),
        otro: round2(agg.total_otro),
        entradasCaja: round2(cajaAgg.entradas),
        salidasCaja: round2(cajaAgg.salidas),
        cancelaciones: round2(agg.cancelaciones),
        efectivoEsperado
      }
    }
  })

  return run()
}
