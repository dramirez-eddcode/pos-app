import { randomUUID } from 'node:crypto'
import { getSqlite } from '../db/connection'
import type { CreateSalidaInput, CreateSalidaResult } from '@shared/dto'

/**
 * Registra salidas de inventario (equivalente al "Registro de Salidas" del
 * legacy). Cada item resta una cantidad específica del saldo del lote, con
 * un motivo (caducidad, merma, traspaso, muestra, ajuste, otro).
 *
 * Se diferencia de Ajustes de inventario en la semántica de captura:
 *  - Ajustes: "el nuevo saldo es X" (computa delta automáticamente)
 *  - Salidas: "salieron N unidades" (captura directa del delta negativo)
 *
 * Todo dentro de una transacción. mov_stock recibe tipo=SALIDA con cantidad
 * negativa (delta aplicado al lote).
 */
export function createSalida(input: CreateSalidaInput): CreateSalidaResult {
  const sqlite = getSqlite()

  if (input.items.length === 0) throw new Error('Sin salidas a registrar')

  const run = sqlite.transaction(() => {
    let itemsCreados = 0
    let unidadesTotales = 0
    const now = Date.now()

    const getLote = sqlite.prepare('SELECT id, saldo FROM caducidad_lote WHERE id = ?')
    const updLote = sqlite.prepare('UPDATE caducidad_lote SET saldo = ? WHERE id = ?')
    const insMov = sqlite.prepare(
      `INSERT INTO mov_stock (id, lote_id, venta_item_id, tipo, cantidad, fecha, motivo)
       VALUES (?, ?, NULL, 'SALIDA', ?, ?, ?)`
    )

    for (const it of input.items) {
      const qty = Math.round(it.cantidad)
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`Cantidad inválida (${it.cantidad}) para ${it.productoNombre}`)
      }

      const lote = getLote.get(it.loteId) as { id: string; saldo: number } | undefined
      if (!lote) throw new Error(`Lote ${it.loteId} no encontrado`)
      if (qty > lote.saldo) {
        throw new Error(
          `"${it.productoNombre}" — el lote solo tiene ${lote.saldo}, se quieren sacar ${qty}`
        )
      }

      const nuevoSaldo = lote.saldo - qty
      updLote.run(nuevoSaldo, lote.id)

      const motivoTexto = it.nota && it.nota.trim() ? `${it.motivo}: ${it.nota.trim()}` : it.motivo
      insMov.run(randomUUID(), lote.id, -qty, now, `${motivoTexto} por ${input.cajeroId}`)

      itemsCreados++
      unidadesTotales += qty
    }

    return { itemsCreados, unidadesTotales }
  })

  return run()
}
