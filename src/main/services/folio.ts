import { sql } from 'drizzle-orm'
import { getDb } from '../db/connection'
import { venta } from '../db/schema'

/**
 * Devuelve el siguiente folio_local disponible para esta sucursal.
 * Idempotente en sí misma: no incrementa hasta que se inserte la venta.
 *
 * Usamos max(folio_local) + 1 bajo transacción; como el POS no es
 * concurrente dentro de una misma caja, no necesitamos locking adicional.
 */
export function peekNextFolio(): number {
  const db = getDb()
  const rows = db
    .select({ max: sql<number | null>`MAX(${venta.folioLocal})` })
    .from(venta)
    .all()
  const current = rows[0]?.max ?? 0
  return (current ?? 0) + 1
}
