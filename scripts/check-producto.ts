/**
 * Chequeo rápido del estado de un producto específico.
 * Uso: npx tsx scripts/check-producto.ts <codigo> [ruta.db]
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'

const require = createRequire(import.meta.url)
const codigo = process.argv[2]
const dbPath = process.argv[3] ?? './data/farmacias-santajulia.db'

if (!codigo) {
  console.error('Uso: npx tsx scripts/check-producto.ts <codigo> [ruta.db]')
  process.exit(1)
}

const bytes = readFileSync(dbPath)
const SQL = await initSqlJs({
  locateFile: (f: string) => join(dirname(require.resolve('sql.js')), f)
})
const db = new SQL.Database(new Uint8Array(bytes))

const q = (sql: string, params: unknown[] = []): Record<string, unknown>[] => {
  const stmt = db.prepare(sql)
  const rows: Record<string, unknown>[] = []
  stmt.bind(params as never)
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

console.log(`\nBuscando código: "${codigo}" en ${dbPath}\n`)

console.log('=== Producto ===')
console.table(q(`SELECT id, codigo, substr(nombre, 1, 40) AS nombre, precio, costo, activo FROM producto WHERE codigo = ?`, [codigo]))

console.log('\n=== Todos los lotes de este producto ===')
console.table(
  q(
    `SELECT cl.id, cl.total, cl.saldo,
            datetime(cl.fecha_entrada/1000, 'unixepoch', 'localtime') AS entrada,
            date(cl.fecha_caducidad/1000, 'unixepoch') AS caducidad
       FROM caducidad_lote cl
       JOIN producto p ON p.id = cl.producto_id
      WHERE p.codigo = ?
      ORDER BY cl.fecha_entrada DESC`,
    [codigo]
  )
)

console.log('\n=== Suma de saldo (lo que debería verse en F5) ===')
console.table(
  q(
    `SELECT COALESCE(SUM(cl.saldo), 0) AS existencias_total
       FROM caducidad_lote cl
       JOIN producto p ON p.id = cl.producto_id
      WHERE p.codigo = ?`,
    [codigo]
  )
)

console.log('\n=== Movimientos recientes (mov_stock) ===')
console.table(
  q(
    `SELECT ms.tipo, ms.cantidad,
            datetime(ms.fecha/1000, 'unixepoch', 'localtime') AS fecha,
            ms.motivo
       FROM mov_stock ms
       JOIN caducidad_lote cl ON cl.id = ms.lote_id
       JOIN producto p ON p.id = cl.producto_id
      WHERE p.codigo = ?
      ORDER BY ms.fecha DESC
      LIMIT 10`,
    [codigo]
  )
)

db.close()
