/**
 * Muestra el histórico de cambios de precio.
 * Uso: node --experimental-sqlite scripts/check-precios.mjs [ruta.db]
 */

import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const dbPath = resolve(process.argv[2] ?? './data/farmacias-santajulia.db')
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL;')

console.log(`\n=== Últimos 20 cambios de precio (${dbPath}) ===`)
const rows = db
  .prepare(
    `SELECT p.codigo,
            substr(p.nombre, 1, 40) AS nombre,
            printf('%.2f', h.precio_anterior) AS antes,
            printf('%.2f', h.precio_nuevo) AS ahora,
            printf('%+.2f', h.precio_nuevo - h.precio_anterior) AS delta,
            h.motivo,
            datetime(h.fecha / 1000, 'unixepoch', 'localtime') AS fecha
       FROM precio_historico h
       JOIN producto p ON p.id = h.producto_id
       ORDER BY h.fecha DESC
       LIMIT 20`
  )
  .all()

if (rows.length === 0) console.log('(sin cambios de precio registrados)')
else console.table(rows)

db.close()
