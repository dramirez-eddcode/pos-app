import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/connection'
import { caducidadLote, movStock, producto } from '../db/schema'
import type { CreateEntradaInput, CreateEntradaResult } from '@shared/dto'

/**
 * Registra una entrada de mercancía: por cada ítem crea un nuevo lote en
 * `caducidad_lote`, un registro en el journal `mov_stock` tipo=ENTRADA, y
 * actualiza `producto.costo` al más reciente (convención simple; más adelante
 * podemos guardar histórico de costos).
 *
 * Todo dentro de una misma transacción — si falla un ítem, nada se persiste.
 */
export function createEntrada(input: CreateEntradaInput): CreateEntradaResult {
  const db = getDb()

  if (input.items.length === 0) throw new Error('Sin items para registrar')

  return db.transaction((tx) => {
    let lotesCreados = 0
    let unidadesIngresadas = 0
    let productosActualizados = 0
    let totalCosto = 0

    const now = Date.now()
    const nowDate = new Date(now)
    // Default caducidad si no se provee: hoy + 2 años
    const defaultCaducidad = new Date(nowDate.getFullYear() + 2, nowDate.getMonth(), nowDate.getDate())

    for (const it of input.items) {
      const qty = Math.round(it.cantidad)
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`Cantidad inválida (${it.cantidad}) para "${it.nombre}"`)
      }
      if (!Number.isFinite(it.costo) || it.costo < 0) {
        throw new Error(`Costo inválido (${it.costo}) para "${it.nombre}"`)
      }

      const caducidad = it.fechaCaducidad ? new Date(it.fechaCaducidad) : defaultCaducidad

      const loteId = randomUUID()
      tx.insert(caducidadLote)
        .values({
          id: loteId,
          productoId: it.productoId,
          total: qty,
          saldo: qty,
          fechaCaducidad: caducidad,
          fechaEntrada: nowDate
        })
        .run()

      tx.insert(movStock)
        .values({
          id: randomUUID(),
          loteId,
          ventaItemId: null,
          tipo: 'ENTRADA',
          cantidad: qty,
          fecha: nowDate,
          motivo: input.motivo ?? `ENTRADA por ${input.usuarioId}`
        })
        .run()

      tx.update(producto)
        .set({ costo: it.costo, updatedAt: nowDate })
        .where(eq(producto.id, it.productoId))
        .run()

      lotesCreados++
      unidadesIngresadas += qty
      productosActualizados++
      totalCosto += qty * it.costo
    }

    return {
      lotesCreados,
      unidadesIngresadas,
      productosActualizados,
      totalCosto: +totalCosto.toFixed(2)
    }
  })
}
