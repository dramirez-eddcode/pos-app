import { randomUUID } from 'node:crypto'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { getDb, getSqlite } from '../db/connection'
import { venta, pago, movCaja } from '../db/schema'
import type {
  CorteFinalHistItem,
  CorteHoyDto,
  CorteReimpresionDto,
  CorteTipo,
  CreateCorteResult,
  MetodoPagoTotal,
  RangoPendienteCorte,
  UltimoCorteInfo
} from '@shared/dto'
import type { MetodoPago } from '@shared/types'
import type { CorteParcialResumen, VentaTarjetaResumen } from '@shared/receipt'

/**
 * Devuelve las cifras de control del PERIODO actual (corte "en pantalla"):
 *  - Conteos y totales de ventas + cancelaciones
 *  - Entradas / salidas de caja
 *  - Totales por método de pago (excluye canceladas)
 *  - Lista de folios del periodo para la grilla de detalle
 *
 * El periodo NO se limita por día: va desde el último corte FINAL hasta el
 * momento de la consulta (la pantalla "se limpia" con cada corte final; puede
 * abarcar varios días o varias veces en un día). Si nunca ha habido corte
 * final, cubre todo lo vendido.
 */
export function getCorteHoy(): CorteHoyDto {
  const db = getDb()
  const sqlite = getSqlite()
  const ahora = new Date()
  const lastFinal = sqlite
    .prepare("SELECT fecha FROM corte WHERE tipo = 'FINAL' ORDER BY fecha DESC LIMIT 1")
    .get() as { fecha: number } | undefined
  // Consulta: estrictamente DESPUÉS del último final (fecha + 1 ms).
  const inicio = new Date(lastFinal ? lastFinal.fecha + 1 : 0)
  // Display: si nunca ha habido final, muestra desde la primera venta (o hoy).
  const inicioDisplay = lastFinal
    ? inicio
    : new Date(
        ((sqlite.prepare('SELECT MIN(fecha) AS f FROM venta').get() as { f: number | null })
          .f as number | null) ?? startOfDayMs(ahora.getTime())
      )

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

  // Método de pago por nota (query directo — un solo método → su nombre;
  // varios distintos → 'MIXTO'; sin pagos → no aparece en el mapa).
  const metodoPorVenta = new Map(
    (
      sqlite
        .prepare(
          `SELECT p.venta_id AS ventaId,
                  CASE WHEN COUNT(DISTINCT p.metodo) > 1 THEN 'MIXTO' ELSE MAX(p.metodo) END AS metodo
             FROM pago p
             JOIN venta v ON v.id = p.venta_id
            WHERE v.fecha >= ? AND v.fecha <= ?
            GROUP BY p.venta_id`
        )
        .all(inicio.getTime(), ahora.getTime()) as Array<{ ventaId: string; metodo: string }>
    ).map((r) => [r.ventaId, r.metodo])
  )

  return {
    fechaDesde: inicioDisplay.toISOString(),
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
      cancelada: f.cancelada,
      metodo: metodoPorVenta.get(f.id) ?? null
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

function startOfDayMs(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function rolOf(userId: string): string | null {
  const row = getSqlite()
    .prepare(
      `SELECT t.nombre FROM usuario u JOIN tipo_usuario t ON t.id = u.tipo_usuario_id WHERE u.id = ?`
    )
    .get(userId) as { nombre: string } | undefined
  return row?.nombre ?? null
}

function requireAdmin(viewerUserId: string): void {
  const rol = rolOf(viewerUserId)
  if (!rol) throw new Error('Usuario no identificado')
  if (rol !== 'ADMINISTRADOR' && rol !== 'SUPERUSUARIO') {
    throw new Error('Requiere permisos de administrador')
  }
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

const AGG_VENTAS_SQL = `
  SELECT
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

function aggVentasRango(folioInicio: number, folioFin: number): VentasAggRow {
  return getSqlite()
    .prepare(AGG_VENTAS_SQL)
    .get(
      folioInicio, folioFin,
      folioInicio, folioFin,
      folioInicio, folioFin,
      folioInicio, folioFin,
      folioInicio, folioFin,
      folioInicio, folioFin,
      folioInicio, folioFin
    ) as VentasAggRow
}

function aggCaja(desde: number, hasta: number): CajaAggRow {
  return getSqlite()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo = 'ENTRADA' THEN monto END), 0) AS entradas,
         COALESCE(SUM(CASE WHEN tipo = 'SALIDA' THEN monto END), 0) AS salidas
       FROM mov_caja
       WHERE fecha >= ? AND fecha <= ?`
    )
    .get(desde, hasta) as CajaAggRow
}

/**
 * Cortes PARCIAL / CAMBIO_TURNO registrados dentro de un rango de tiempo (el
 * periodo de un corte final). Se usan para imprimir en el ticket del corte
 * final el desglose de los parciales, antes del total del periodo completo.
 */
function parcialesDelPeriodo(desde: number, hasta: number): CorteParcialResumen[] {
  const rows = getSqlite()
    .prepare(
      `SELECT tipo, fecha,
              folio_inicio AS folioInicio,
              folio_fin    AS folioFin,
              (total_efectivo + total_tarjeta + total_transferencia + total_otro) AS total
         FROM corte
        WHERE tipo <> 'FINAL' AND fecha >= ? AND fecha <= ?
        ORDER BY fecha ASC`
    )
    .all(desde, hasta) as Array<{
    tipo: string
    fecha: number
    folioInicio: number
    folioFin: number
    total: number
  }>
  return rows.map((r) => ({
    tipo: r.tipo as CorteParcialResumen['tipo'],
    fecha: new Date(r.fecha).toISOString(),
    folioInicio: r.folioInicio,
    folioFin: r.folioFin,
    total: round2(Number(r.total) || 0)
  }))
}

/**
 * Notas del rango cobradas (total o parcialmente) con TARJETA, para el detalle
 * del ticket del corte final. En pago mixto sólo se reporta la parte tarjeta —
 * es lo que debe cuadrar contra los vouchers de la terminal. Excluye canceladas
 * (consistente con los totales por método del corte).
 */
function ventasConTarjeta(folioInicio: number, folioFin: number): VentaTarjetaResumen[] {
  const rows = getSqlite()
    .prepare(
      `SELECT v.folio_local AS folio, COALESCE(SUM(p.monto), 0) AS monto
         FROM pago p
         JOIN venta v ON v.id = p.venta_id
        WHERE p.metodo = 'TARJETA'
          AND v.cancelada = 0
          AND v.folio_local BETWEEN ? AND ?
        GROUP BY v.folio_local
        ORDER BY v.folio_local ASC`
    )
    .all(folioInicio, folioFin) as Array<{ folio: number; monto: number }>
  return rows
    .map((r) => ({ folio: r.folio, monto: round2(Number(r.monto) || 0) }))
    .filter((r) => r.monto > 0)
}

/**
 * Crea un registro de corte: snapshot atómico de ventas + caja. Devuelve los
 * totales calculados para que el renderer pueda imprimir el ticket de corte.
 *
 * Semántica por tipo:
 *   - PARCIAL / CAMBIO_TURNO: incremental — cubre los folios desde el último
 *     corte (folio_fin + 1) hasta el último folio vendido.
 *   - FINAL: cierre de TODO el PERIODO — desde el último corte FINAL hasta
 *     ahora, SIN límite de día (puede abarcar varios días, o hacerse varias
 *     veces en un día), incluyendo lo ya cubierto por parciales o cambios de
 *     turno intermedios (reporte "Z" del periodo). Su ticket cuadra con el
 *     "corte en pantalla", que también acumula desde el último final.
 *
 * El siguiente corte siempre arranca después del folio_fin más reciente.
 */
export function createCorte(cajeroId: string, tipo: CorteTipo): CreateCorteResult {
  const sqlite = getSqlite()
  const now = Date.now()
  const nowDate = new Date(now)

  const run = sqlite.transaction(() => {
    const lastCorte = sqlite
      .prepare('SELECT id, fecha, folio_inicio, folio_fin FROM corte ORDER BY fecha DESC LIMIT 1')
      .get() as LastCorte | undefined

    const hoy00 = startOfDayMs(now)
    let folioInicio: number
    let folioFin: number
    let fechaDesdeCaja: number

    if (tipo === 'FINAL') {
      // Todo el periodo: folios que ningún corte FINAL ha cubierto, y caja
      // desde el último final (sin límite de día).
      const lastFinal = sqlite
        .prepare(
          "SELECT fecha, folio_fin FROM corte WHERE tipo = 'FINAL' ORDER BY fecha DESC LIMIT 1"
        )
        .get() as { fecha: number; folio_fin: number } | undefined
      folioInicio = lastFinal ? lastFinal.folio_fin + 1 : 1
      const maxRow = sqlite
        .prepare('SELECT MAX(folio_local) AS m FROM venta')
        .get() as { m: number | null }
      folioFin = maxRow.m ?? folioInicio - 1
      if (folioFin < folioInicio) {
        throw new Error('No hay ventas nuevas desde el último corte final')
      }
      fechaDesdeCaja = lastFinal ? lastFinal.fecha + 1 : 0
    } else {
      folioInicio = lastCorte ? lastCorte.folio_fin + 1 : 1
      const maxRow = sqlite
        .prepare('SELECT MAX(folio_local) AS m FROM venta')
        .get() as { m: number | null }
      folioFin = maxRow.m ?? folioInicio - 1
      if (folioFin < folioInicio) {
        throw new Error('No hay ventas nuevas desde el último corte')
      }
      fechaDesdeCaja = lastCorte ? lastCorte.fecha : hoy00
    }

    const agg = aggVentasRango(folioInicio, folioFin)
    const cajaAgg = aggCaja(fechaDesdeCaja, now)

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

    // En el corte final, adjunta los parciales del PERIODO para el ticket
    // combinado y el detalle de notas con tarjeta (pago puro o mixto).
    const parciales = tipo === 'FINAL' ? parcialesDelPeriodo(fechaDesdeCaja, now) : undefined
    const tarjetas = tipo === 'FINAL' ? ventasConTarjeta(folioInicio, folioFin) : undefined

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
      },
      ...(parciales && parciales.length > 0 ? { parcialesDelDia: parciales } : {}),
      ...(tarjetas && tarjetas.length > 0 ? { ventasTarjeta: tarjetas } : {})
    }
  })

  return run()
}

// ── Reimpresión de cortes finales (sólo admin/superusuario) ──────────────────

export function listCortesFinales(viewerUserId: string, limit = 30): CorteFinalHistItem[] {
  requireAdmin(viewerUserId)
  const rows = getSqlite()
    .prepare(
      `SELECT c.id, c.fecha,
              c.folio_inicio AS folioInicio,
              c.folio_fin    AS folioFin,
              (c.total_efectivo + c.total_tarjeta
               + c.total_transferencia + c.total_otro) AS total,
              u.nombre AS cajero
         FROM corte c
         LEFT JOIN usuario u ON u.id = c.cajero_id
        WHERE c.tipo = 'FINAL'
        ORDER BY c.fecha DESC
        LIMIT ?`
    )
    .all(Math.max(1, Math.min(200, limit))) as Array<{
    id: string
    fecha: number
    folioInicio: number
    folioFin: number
    total: number
    cajero: string | null
  }>
  return rows.map((r) => ({
    id: r.id,
    fecha: new Date(r.fecha).toISOString(),
    folioInicio: r.folioInicio,
    folioFin: r.folioFin,
    total: round2(Number(r.total) || 0),
    cajero: r.cajero ?? null
  }))
}

/**
 * Reconstruye los datos del ticket de un corte ya registrado para reimprimirlo.
 * Los totales por método vienen del snapshot del corte; los conteos y el
 * desglose subtotal/IVA se recalculan del rango de folios (es estable).
 */
export function getCorteReimpresion(viewerUserId: string, corteId: string): CorteReimpresionDto {
  requireAdmin(viewerUserId)
  const sqlite = getSqlite()
  const c = sqlite
    .prepare(
      `SELECT c.id, c.fecha, c.tipo,
              c.folio_inicio AS folioInicio,
              c.folio_fin    AS folioFin,
              c.total_efectivo      AS efectivo,
              c.total_tarjeta       AS tarjeta,
              c.total_transferencia AS transferencia,
              c.total_otro          AS otro,
              c.entradas_caja       AS entradasCaja,
              c.salidas_caja        AS salidasCaja,
              c.cancelaciones,
              u.nombre AS cajero
         FROM corte c
         LEFT JOIN usuario u ON u.id = c.cajero_id
        WHERE c.id = ?`
    )
    .get(corteId) as
    | {
        id: string
        fecha: number
        tipo: string
        folioInicio: number
        folioFin: number
        efectivo: number
        tarjeta: number
        transferencia: number
        otro: number
        entradasCaja: number
        salidasCaja: number
        cancelaciones: number
        cajero: string | null
      }
    | undefined
  if (!c) throw new Error('Corte no encontrado')

  const agg = aggVentasRango(c.folioInicio, c.folioFin)
  const efectivoEsperado = round2(c.efectivo + c.entradasCaja - c.salidasCaja)

  // Reimpresión del corte final: reconstruye los parciales de SU periodo
  // (entre el corte final anterior y éste) y el detalle de notas con tarjeta.
  const prevFinal =
    c.tipo === 'FINAL'
      ? (sqlite
          .prepare("SELECT MAX(fecha) AS f FROM corte WHERE tipo = 'FINAL' AND fecha < ?")
          .get(c.fecha) as { f: number | null })
      : null
  const parciales =
    c.tipo === 'FINAL' ? parcialesDelPeriodo((prevFinal?.f ?? -1) + 1, c.fecha) : undefined
  const tarjetas = c.tipo === 'FINAL' ? ventasConTarjeta(c.folioInicio, c.folioFin) : undefined

  return {
    fecha: new Date(c.fecha).toISOString(),
    tipo: c.tipo as CorteTipo,
    cajero: c.cajero ?? '—',
    folioInicio: c.folioInicio,
    folioFin: c.folioFin,
    foliosVendidos: agg.folios_vendidos,
    foliosCancelados: agg.folios_cancelados,
    subtotal: round2(agg.subtotal),
    iva: round2(agg.iva),
    total: round2(agg.total),
    efectivo: round2(c.efectivo),
    tarjeta: round2(c.tarjeta),
    transferencia: round2(c.transferencia),
    otro: round2(c.otro),
    entradasCaja: round2(c.entradasCaja),
    salidasCaja: round2(c.salidasCaja),
    cancelaciones: round2(c.cancelaciones),
    efectivoEsperado,
    ...(parciales && parciales.length > 0 ? { parcialesDelDia: parciales } : {}),
    ...(tarjetas && tarjetas.length > 0 ? { ventasTarjeta: tarjetas } : {})
  }
}
