/**
 * Diagnóstico rápido de distribución de stock por producto.
 * Uso: npx tsx scripts/diag-stock.ts [ruta.db]
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'

const require = createRequire(import.meta.url)
const dbPath = process.argv[2] ?? './data/farmacias-santajulia.db'
const bytes = readFileSync(dbPath)
const SQL = await initSqlJs({
  locateFile: (f: string) => join(dirname(require.resolve('sql.js')), f)
})
const db = new SQL.Database(new Uint8Array(bytes))

const q = (sql: string): Record<string, unknown>[] => {
  const r = db.exec(sql)
  if (!r.length) return []
  const cols = r[0]!.columns
  return r[0]!.values.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])))
}

console.log(`\nArchivo: ${dbPath}`)

console.log('\n=== Totales ===')
console.table(
  q(`SELECT
       (SELECT COUNT(*) FROM producto) AS total_productos,
       (SELECT COUNT(*) FROM caducidad_lote WHERE saldo > 0) AS lotes_con_saldo,
       (SELECT SUM(saldo) FROM caducidad_lote) AS unidades_en_stock`)
)

console.log('\n=== Distribución de productos por stock ===')
console.table(
  q(`SELECT
       CASE
         WHEN existencias = 0 THEN '0 (sin stock)'
         WHEN existencias BETWEEN 1 AND 10 THEN '1-10'
         WHEN existencias BETWEEN 11 AND 100 THEN '11-100'
         ELSE '>100'
       END AS rango,
       COUNT(*) AS n_productos
     FROM (
       SELECT p.id, COALESCE(
         (SELECT SUM(cl.saldo) FROM caducidad_lote cl WHERE cl.producto_id = p.id),
         0
       ) AS existencias
       FROM producto p
     )
     GROUP BY rango
     ORDER BY 1`)
)

console.log('\n=== Top 15 productos con más existencias ===')
console.table(
  q(`SELECT substr(p.nombre, 1, 40) AS nombre, p.codigo,
            SUM(cl.saldo) AS existencias,
            COUNT(cl.id) AS lotes
     FROM producto p
     JOIN caducidad_lote cl ON cl.producto_id = p.id AND cl.saldo > 0
     GROUP BY p.id
     ORDER BY existencias DESC
     LIMIT 15`)
)

db.close()
