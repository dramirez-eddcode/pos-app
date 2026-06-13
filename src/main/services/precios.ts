import { randomUUID } from 'node:crypto'
import { getSqlite } from '../db/connection'
import { requireAdminOrSupervisor } from './permisos'
import type { UpdatePreciosInput, UpdatePreciosResult } from '@shared/dto'

/**
 * Actualiza precios de venta de uno o varios productos. Cada cambio deja
 * una fila en `precio_historico` con el precio anterior y el nuevo, para
 * auditoría posterior. Todo en una sola transacción.
 *
 * Si el nuevo precio es igual al actual, se silencia esa línea (no cuenta
 * como actualización ni genera historia).
 */
export function updatePrecios(input: UpdatePreciosInput): UpdatePreciosResult {
  requireAdminOrSupervisor(input.cajeroId)
  const sqlite = getSqlite()
  if (input.items.length === 0) throw new Error('Sin precios a actualizar')

  const run = sqlite.transaction(() => {
    let actualizados = 0
    const now = Date.now()

    const getProd = sqlite.prepare('SELECT id, precio FROM producto WHERE id = ?')
    const updProd = sqlite.prepare(
      'UPDATE producto SET precio = ?, updated_at = ? WHERE id = ?'
    )
    const insHist = sqlite.prepare(
      `INSERT INTO precio_historico (id, producto_id, precio_anterior, precio_nuevo, cajero_id, fecha, motivo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    for (const it of input.items) {
      const nuevo = Math.round(Number(it.nuevoPrecio) * 100) / 100
      if (!Number.isFinite(nuevo) || nuevo < 0) {
        throw new Error(`Precio inválido (${it.nuevoPrecio}) para ${it.productoNombre}`)
      }

      const prod = getProd.get(it.productoId) as { id: string; precio: number } | undefined
      if (!prod) throw new Error(`Producto ${it.productoNombre} no encontrado`)

      if (prod.precio === nuevo) continue

      updProd.run(nuevo, now, prod.id)
      const motivoTexto = it.nota && it.nota.trim() ? `${it.motivo}: ${it.nota.trim()}` : it.motivo
      insHist.run(
        randomUUID(),
        prod.id,
        prod.precio,
        nuevo,
        input.cajeroId,
        now,
        `${motivoTexto} por ${input.cajeroId}`
      )
      actualizados++
    }

    return { actualizados }
  })

  return run()
}
