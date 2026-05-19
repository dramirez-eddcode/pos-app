import { randomUUID } from 'node:crypto'
import { getSqlite } from '../db/connection'
import type { CreateAjustesInput, CreateAjustesResult } from '@shared/dto'

/**
 * Registra ajustes de inventario. Cada item apunta a un lote específico y
 * establece un nuevo saldo. La diferencia (delta) queda registrada como
 * mov_stock tipo=AJUSTE con el motivo capturado.
 *
 * Todo en una sola transacción: si cualquier item falla, nada se persiste.
 *
 * Reglas:
 *  - `nuevoSaldo >= 0` (el stock no puede ser negativo)
 *  - delta=0 se silencia (no inserta mov_stock, no cambia saldo)
 */
export function createAjustes(input: CreateAjustesInput): CreateAjustesResult {
  const sqlite = getSqlite()

  if (input.items.length === 0) throw new Error('Sin ajustes a registrar')

  const run = sqlite.transaction(() => {
    let ajustesAplicados = 0
    let deltaTotal = 0
    const now = Date.now()

    const getLote = sqlite.prepare('SELECT id, total, saldo FROM caducidad_lote WHERE id = ?')
    const updLote = sqlite.prepare('UPDATE caducidad_lote SET saldo = ? WHERE id = ?')
    const insMov = sqlite.prepare(
      `INSERT INTO mov_stock (id, lote_id, venta_item_id, tipo, cantidad, fecha, motivo)
       VALUES (?, ?, NULL, 'AJUSTE', ?, ?, ?)`
    )

    for (const it of input.items) {
      const nuevo = Math.round(it.nuevoSaldo)
      if (!Number.isFinite(nuevo) || nuevo < 0) {
        throw new Error(`Nuevo saldo inválido (${it.nuevoSaldo}) para ${it.productoNombre}`)
      }

      const lote = getLote.get(it.loteId) as
        | { id: string; total: number; saldo: number }
        | undefined
      if (!lote) throw new Error(`Lote ${it.loteId} no encontrado`)

      const delta = nuevo - lote.saldo
      if (delta === 0) continue // nada que hacer

      updLote.run(nuevo, lote.id)

      const motivoTexto = it.nota && it.nota.trim() ? `${it.motivo}: ${it.nota.trim()}` : it.motivo
      insMov.run(randomUUID(), lote.id, delta, now, `${motivoTexto} por ${input.cajeroId}`)

      ajustesAplicados++
      deltaTotal += delta
    }

    return {
      ajustesAplicados,
      deltaTotalUnidades: deltaTotal
    }
  })

  return run()
}
