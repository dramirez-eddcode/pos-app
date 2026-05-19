import { randomUUID } from 'node:crypto'
import { and, eq, gt, sql } from 'drizzle-orm'
import { getDb, getSqlite } from '../db/connection'
import {
  venta,
  ventaItem,
  pago,
  caducidadLote,
  movStock,
  usuario,
  producto
} from '../db/schema'
import type {
  CancelVentaResult,
  CreateVentaInput,
  CreateVentaResult,
  VentaDetailDto
} from '@shared/dto'
import type { MetodoPago } from '@shared/types'

/**
 * Crea una venta atómicamente: cabecera + items + pagos + descuento FEFO de
 * `caducidad_lote.saldo`, registrando cada movimiento por lote en `mov_stock`
 * para que la cancelación pueda revertir exactamente al lote original.
 */
export function createVenta(input: CreateVentaInput): CreateVentaResult {
  const db = getDb()

  if (input.items.length === 0) throw new Error('La venta no tiene renglones')
  const totalPagos = input.pagos.reduce((s, p) => s + p.monto, 0)
  const totalVenta = input.items.reduce((s, i) => s + i.total, 0)
  if (totalPagos < totalVenta - 0.01) {
    throw new Error(`Los pagos (${totalPagos.toFixed(2)}) no cubren el total (${totalVenta.toFixed(2)})`)
  }

  const ventaId = randomUUID()
  const fecha = Date.now()
  const fechaDate = new Date(fecha)

  return db.transaction((tx) => {
    const nextFolio = tx
      .select({ max: sql<number | null>`MAX(${venta.folioLocal})` })
      .from(venta)
      .all()[0]?.max
    const folioLocal = (nextFolio ?? 0) + 1

    const subtotal = input.items.reduce((s, i) => s + i.importe, 0)
    const iva = input.items.reduce((s, i) => s + i.iva, 0)
    const total = +(subtotal + iva).toFixed(2)

    tx.insert(venta)
      .values({
        id: ventaId,
        folioLocal,
        cajeroId: input.cajeroId,
        fecha: fechaDate,
        subtotal: +subtotal.toFixed(2),
        iva: +iva.toFixed(2),
        descuento: 0,
        total,
        motivo: input.motivo ?? 'VENTA',
        cancelada: false
      })
      .run()

    for (const it of input.items) {
      const qty = Math.round(it.cantidad)
      if (qty <= 0) throw new Error(`Cantidad inválida (${it.cantidad}) para ${it.nombre}`)

      // FEFO: lotes con saldo disponible ordenados por caducidad más cercana primero
      const lotes = tx
        .select({ id: caducidadLote.id, saldo: caducidadLote.saldo })
        .from(caducidadLote)
        .where(and(eq(caducidadLote.productoId, it.productoId), gt(caducidadLote.saldo, 0)))
        .orderBy(caducidadLote.fechaCaducidad)
        .all()

      // Calcular consumo por lote (sin aplicar aún)
      const consumed: { loteId: string; cantidad: number }[] = []
      let remaining = qty
      for (const lot of lotes) {
        if (remaining <= 0) break
        const take = Math.min(lot.saldo, remaining)
        consumed.push({ loteId: lot.id, cantidad: take })
        remaining -= take
      }
      if (remaining > 0) {
        throw new Error(
          `Stock insuficiente para "${it.nombre}" (faltan ${remaining} de ${qty})`
        )
      }

      const vItemId = randomUUID()
      tx.insert(ventaItem)
        .values({
          id: vItemId,
          ventaId,
          productoId: it.productoId,
          loteId: consumed[0]?.loteId ?? null,
          cantidad: it.cantidad,
          precioUnitario: it.precioUnitario,
          importe: it.importe,
          iva: it.iva,
          descuento: 0
        })
        .run()

      // Aplicar cambios a lote.saldo + journal de movimientos
      for (const c of consumed) {
        tx.update(caducidadLote)
          .set({ saldo: sql`${caducidadLote.saldo} - ${c.cantidad}` })
          .where(eq(caducidadLote.id, c.loteId))
          .run()
        tx.insert(movStock)
          .values({
            id: randomUUID(),
            loteId: c.loteId,
            ventaItemId: vItemId,
            tipo: 'VENTA',
            cantidad: -c.cantidad,
            fecha: fechaDate,
            motivo: null
          })
          .run()
      }
    }

    for (const p of input.pagos) {
      tx.insert(pago)
        .values({
          id: randomUUID(),
          ventaId,
          metodo: p.metodo,
          monto: p.monto,
          referencia: p.referencia ?? null
        })
        .run()
    }

    return {
      ventaId,
      folioLocal,
      fecha: fechaDate.toISOString()
    }
  })
}

/**
 * Cancela una venta:
 *  1. Marca `venta.cancelada = true` (+ canceladaPor, canceladaEn)
 *  2. Para cada mov_stock tipo=VENTA de esta venta, crea el mov inverso
 *     (CANCELACION_VENTA) y suma la cantidad al `caducidad_lote.saldo`.
 * No toca los pagos — eso es tema contable (cambio físico de dinero).
 */
export function cancelVenta(
  ventaId: string,
  canceladorUserId: string,
  motivo: string | null = null
): CancelVentaResult {
  const db = getDb()

  return db.transaction((tx) => {
    const v = tx.select().from(venta).where(eq(venta.id, ventaId)).all()[0]
    if (!v) throw new Error('Venta no encontrada')
    if (v.cancelada) throw new Error(`Folio ${v.folioLocal} ya estaba cancelado`)

    const items = tx.select({ id: ventaItem.id }).from(ventaItem).where(eq(ventaItem.ventaId, ventaId)).all()

    const now = Date.now()
    const nowDate = new Date(now)

    for (const it of items) {
      const movs = tx
        .select()
        .from(movStock)
        .where(and(eq(movStock.ventaItemId, it.id), eq(movStock.tipo, 'VENTA')))
        .all()
      for (const m of movs) {
        // Reponer saldo: sumar lo que se restó (m.cantidad es negativo en VENTA)
        tx.update(caducidadLote)
          .set({ saldo: sql`${caducidadLote.saldo} + ${-m.cantidad}` })
          .where(eq(caducidadLote.id, m.loteId))
          .run()
        tx.insert(movStock)
          .values({
            id: randomUUID(),
            loteId: m.loteId,
            ventaItemId: it.id,
            tipo: 'CANCELACION_VENTA',
            cantidad: -m.cantidad, // signo opuesto al original
            fecha: nowDate,
            motivo
          })
          .run()
      }
    }

    tx.update(venta)
      .set({
        cancelada: true,
        canceladaPor: canceladorUserId,
        canceladaEn: nowDate
      })
      .where(eq(venta.id, ventaId))
      .run()

    return {
      ok: true,
      folioLocal: v.folioLocal,
      canceladaEn: nowDate.toISOString()
    }
  })
}

/**
 * Suma de ventas no canceladas de antier, ayer y hoy (cada ventana de 24h
 * delimitada por medianoche local). Usado por el atajo "Pausa" del POS para
 * mostrar el indicador sutil en la esquina inferior derecha.
 */
export function getTotalesRecientes(): { antier: number; ayer: number; hoy: number } {
  const sqlite = getSqlite()
  const ahora = new Date()
  const hoyInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime()
  const ayerInicio = hoyInicio - 24 * 60 * 60 * 1000
  const antierInicio = hoyInicio - 2 * 24 * 60 * 60 * 1000

  const row = sqlite
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN fecha >= ? AND fecha < ? THEN total END), 0) AS antier,
         COALESCE(SUM(CASE WHEN fecha >= ? AND fecha < ? THEN total END), 0) AS ayer,
         COALESCE(SUM(CASE WHEN fecha >= ? THEN total END), 0) AS hoy
       FROM venta
       WHERE cancelada = 0 AND fecha >= ?`
    )
    .get(
      antierInicio,
      ayerInicio,
      ayerInicio,
      hoyInicio,
      hoyInicio,
      antierInicio
    ) as { antier: number; ayer: number; hoy: number }

  return {
    antier: Number(row.antier) || 0,
    ayer: Number(row.ayer) || 0,
    hoy: Number(row.hoy) || 0
  }
}

/**
 * Devuelve una venta por folio_local con items + producto + pagos.
 * Usada por la pantalla de cancelaciones (F11) para mostrar el detalle antes
 * de confirmar.
 */
export function getVentaByFolio(folioLocal: number): VentaDetailDto | null {
  const db = getDb()

  const vRows = db
    .select({
      id: venta.id,
      folioLocal: venta.folioLocal,
      fecha: venta.fecha,
      subtotal: venta.subtotal,
      iva: venta.iva,
      descuento: venta.descuento,
      total: venta.total,
      motivo: venta.motivo,
      cancelada: venta.cancelada,
      canceladaEn: venta.canceladaEn,
      cajero: usuario.nombre
    })
    .from(venta)
    .leftJoin(usuario, eq(usuario.id, venta.cajeroId))
    .where(eq(venta.folioLocal, folioLocal))
    .all()

  const v = vRows[0]
  if (!v) return null

  const items = db
    .select({
      id: ventaItem.id,
      cantidad: ventaItem.cantidad,
      precioUnitario: ventaItem.precioUnitario,
      importe: ventaItem.importe,
      iva: ventaItem.iva,
      descuento: ventaItem.descuento,
      codigo: producto.codigo,
      nombre: producto.nombre
    })
    .from(ventaItem)
    .leftJoin(producto, eq(producto.id, ventaItem.productoId))
    .where(eq(ventaItem.ventaId, v.id))
    .all()

  const pagos = db
    .select({ metodo: pago.metodo, monto: pago.monto, referencia: pago.referencia })
    .from(pago)
    .where(eq(pago.ventaId, v.id))
    .all()

  return {
    id: v.id,
    folioLocal: v.folioLocal,
    fecha: (v.fecha as Date).toISOString(),
    cajero: v.cajero ?? '—',
    subtotal: v.subtotal,
    iva: v.iva,
    descuento: v.descuento,
    total: v.total,
    motivo: v.motivo,
    cancelada: v.cancelada,
    canceladaEn: v.canceladaEn ? (v.canceladaEn as Date).toISOString() : null,
    items: items.map((i) => ({
      id: i.id,
      codigo: i.codigo ?? '',
      nombre: i.nombre ?? '(producto eliminado)',
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario,
      importe: i.importe,
      iva: i.iva,
      total: +(i.importe + i.iva - (i.descuento ?? 0)).toFixed(2)
    })),
    pagos: pagos.map((p) => ({
      metodo: p.metodo as MetodoPago,
      monto: p.monto,
      referencia: p.referencia
    }))
  }
}
