import { randomUUID } from 'node:crypto'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { getDb, getSqlite } from '../db/connection'
import { venta, pago, movCaja } from '../db/schema'
import type {
  CorteFinalHistItem,
  CorteHoyDto,
  CortePendienteDia,
  CorteReimpresionDto,
  CorteTipo,
  CreateCorteResult,
  MetodoPagoTotal,
  RangoPendienteCorte,
  UltimoCorteInfo
} from '@shared/dto'
import type { MetodoPago } from '@shared/types'
import type { CorteParcialResumen } from '@shared/receipt'

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

function startOfDayMs(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function ymdLocal(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
 * día del corte final). Se usan para imprimir en el ticket del corte final el
 * desglose de los parciales del día, antes del total del día completo.
 */
function parcialesDelDia(desde: number, hasta: number): CorteParcialResumen[] {
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
 * Crea un registro de corte: snapshot atómico de ventas + caja. Devuelve los
 * totales calculados para que el renderer pueda imprimir el ticket de corte.
 *
 * Semántica por tipo:
 *   - PARCIAL / CAMBIO_TURNO: incremental — cubre los folios desde el último
 *     corte (folio_fin + 1) hasta el último folio vendido.
 *   - FINAL: cierre de TODO el día (00:00 → ahora), sin importar cuántos
 *     parciales o cambios de turno haya habido en medio (reporte "Z" diario).
 *     Su ticket cuadra con el "corte en pantalla" del día completo.
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
      // Todo el día: del primer al último folio vendido HOY, y caja desde 00:00.
      const rango = sqlite
        .prepare(
          'SELECT MIN(folio_local) AS a, MAX(folio_local) AS b FROM venta WHERE fecha >= ? AND fecha <= ?'
        )
        .get(hoy00, now) as { a: number | null; b: number | null }
      if (rango.a == null || rango.b == null) {
        throw new Error('No hay ventas hoy — el corte final cierra el día completo')
      }
      folioInicio = rango.a
      folioFin = rango.b
      fechaDesdeCaja = hoy00
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

    // En el corte final, adjunta los parciales del día para el ticket combinado.
    const parciales = tipo === 'FINAL' ? parcialesDelDia(hoy00, now) : undefined

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
      ...(parciales && parciales.length > 0 ? { parcialesDelDia: parciales } : {})
    }
  })

  return run()
}

// ── Cortes finales pendientes de días anteriores ─────────────────────────────

/**
 * Días ANTERIORES a hoy con ventas que ningún corte cubre (se olvidó el corte
 * final). Agrupa los folios sin cubrir por día local. Se cierran del más
 * antiguo al más reciente para conservar la cadena de folios.
 */
export function getCortesPendientesDias(): CortePendienteDia[] {
  const sqlite = getSqlite()
  const last = sqlite
    .prepare('SELECT folio_fin FROM corte ORDER BY fecha DESC LIMIT 1')
    .get() as { folio_fin: number } | undefined
  const desdeFolio = last ? last.folio_fin + 1 : 1
  const hoy00 = startOfDayMs(Date.now())

  const rows = sqlite
    .prepare(
      `SELECT folio_local AS folio, fecha, total, cancelada
         FROM venta
        WHERE folio_local >= ? AND fecha < ?
        ORDER BY folio_local`
    )
    .all(desdeFolio, hoy00) as Array<{
    folio: number
    fecha: number
    total: number
    cancelada: number
  }>

  const porDia = new Map<string, CortePendienteDia>()
  for (const r of rows) {
    const key = ymdLocal(r.fecha)
    let g = porDia.get(key)
    if (!g) {
      g = { fecha: key, folioInicio: r.folio, folioFin: r.folio, notas: 0, total: 0 }
      porDia.set(key, g)
    }
    g.folioFin = Math.max(g.folioFin, r.folio)
    g.folioInicio = Math.min(g.folioInicio, r.folio)
    g.notas++
    if (!r.cancelada) g.total += Number(r.total) || 0
  }

  return [...porDia.values()]
    .map((g) => ({ ...g, total: round2(g.total) }))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))
}

/**
 * Registra el corte FINAL de un día anterior que quedó pendiente. Igual que el
 * corte final normal, cubre TODO ese día (del primer al último folio del día,
 * y la caja completa de ese día), aunque haya tenido parciales. El corte queda
 * fechado al final del día (23:59:59) para que la cadena quede consistente.
 *
 * Reglas:
 *  - Lo puede hacer CUALQUIER usuario (igual que el corte normal).
 *  - Sólo procede una vez: al crearse, esos folios quedan cubiertos y el día
 *    deja de estar pendiente (no se puede repetir).
 *  - Debe cerrarse primero el día pendiente más antiguo.
 */
export function createCorteFinalPendiente(cajeroId: string, fechaYmd: string): CreateCorteResult {
  const m = (fechaYmd ?? '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) throw new Error(`Fecha inválida: ${fechaYmd}`)
  const dia00 = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  const diaFin = dia00 + 24 * 3600 * 1000 - 1
  const hoy00 = startOfDayMs(Date.now())
  if (dia00 >= hoy00) {
    throw new Error('Ese día aún no termina — usa el corte final normal')
  }

  const sqlite = getSqlite()
  const run = sqlite.transaction(() => {
    const lastCorte = sqlite
      .prepare('SELECT id, fecha, folio_inicio, folio_fin FROM corte ORDER BY fecha DESC LIMIT 1')
      .get() as LastCorte | undefined
    const primerSinCubrir = lastCorte ? lastCorte.folio_fin + 1 : 1

    // El día más antiguo con folios sin cubrir debe ser exactamente el pedido.
    const min = sqlite
      .prepare('SELECT MIN(fecha) AS f FROM venta WHERE folio_local >= ?')
      .get(primerSinCubrir) as { f: number | null }
    if (min.f == null || min.f >= hoy00) {
      throw new Error('No hay días anteriores pendientes de corte')
    }
    const masAntiguo00 = startOfDayMs(min.f)
    if (masAntiguo00 !== dia00) {
      throw new Error(
        `Primero cierra el día pendiente más antiguo (${ymdLocal(masAntiguo00)})`
      )
    }

    const sinCubrir = sqlite
      .prepare('SELECT MAX(folio_local) AS m FROM venta WHERE fecha <= ?')
      .get(diaFin) as { m: number | null }
    if ((sinCubrir.m ?? 0) < primerSinCubrir) {
      throw new Error('Ese día ya está cubierto por un corte')
    }

    // Cobertura: TODO el día pendiente (no sólo lo que faltaba por cubrir).
    const rango = sqlite
      .prepare(
        'SELECT MIN(folio_local) AS a, MAX(folio_local) AS b FROM venta WHERE fecha >= ? AND fecha <= ?'
      )
      .get(dia00, diaFin) as { a: number | null; b: number | null }
    if (rango.a == null || rango.b == null) {
      throw new Error('Ese día no tiene ventas')
    }
    const folioInicio = rango.a
    const folioFin = rango.b

    const agg = aggVentasRango(folioInicio, folioFin)
    const cajaAgg = aggCaja(dia00, diaFin)

    const corteId = randomUUID()
    sqlite
      .prepare(
        `INSERT INTO corte (
           id, cajero_id, fecha, folio_inicio, folio_fin, tipo,
           total_efectivo, total_tarjeta,
           total_transferencia, total_otro,
           entradas_caja, salidas_caja, cancelaciones
         ) VALUES (?, ?, ?, ?, ?, 'FINAL', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        corteId,
        cajeroId,
        diaFin,
        folioInicio,
        folioFin,
        agg.total_efectivo,
        agg.total_tarjeta,
        agg.total_transferencia,
        agg.total_otro,
        cajaAgg.entradas,
        cajaAgg.salidas,
        agg.cancelaciones
      )

    const efectivoEsperado = round2(agg.total_efectivo + cajaAgg.entradas - cajaAgg.salidas)
    const parciales = parcialesDelDia(dia00, diaFin)

    return {
      corteId,
      folioInicio,
      folioFin,
      fecha: new Date(diaFin).toISOString(),
      tipo: 'FINAL' as CorteTipo,
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
      ...(parciales.length > 0 ? { parcialesDelDia: parciales } : {})
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

  // Reimpresión del corte final: reconstruye también los parciales de ese día.
  const dia00 = startOfDayMs(c.fecha)
  const parciales =
    c.tipo === 'FINAL' ? parcialesDelDia(dia00, dia00 + 24 * 3600 * 1000 - 1) : undefined

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
    ...(parciales && parciales.length > 0 ? { parcialesDelDia: parciales } : {})
  }
}
