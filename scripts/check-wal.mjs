/**
 * Diagnóstico con node:sqlite (Node 22+ --experimental-sqlite), que SÍ lee
 * los cambios del WAL aunque no se hayan checkpointeado al archivo principal.
 *
 * Uso: node --experimental-sqlite scripts/check-wal.mjs <codigo> [ruta.db]
 */

import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const codigo = process.argv[2]
const dbPath = resolve(process.argv[3] ?? './data/farmacias-santajulia.db')

if (!codigo) {
  console.error('Uso: node --experimental-sqlite scripts/check-wal.mjs <codigo> [ruta.db]')
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL;')

console.log(`\n=== DB: ${dbPath} ===`)

const prod = db.prepare(`SELECT id, codigo, substr(nombre, 1, 40) AS nombre, costo, activo FROM producto WHERE codigo = ?`).get(codigo)
console.log('\n=== Producto ===')
console.log(prod ?? '(no encontrado)')

if (prod) {
  const lotes = db.prepare(`
    SELECT id, total, saldo,
           datetime(fecha_entrada/1000, 'unixepoch', 'localtime') AS entrada,
           date(fecha_caducidad/1000, 'unixepoch') AS caducidad
      FROM caducidad_lote
     WHERE producto_id = ?
     ORDER BY fecha_entrada DESC
  `).all(prod.id)
  console.log(`\n=== Lotes de "${prod.codigo}" (${lotes.length}) ===`)
  if (lotes.length === 0) console.log('(sin lotes)')
  else console.table(lotes)

  const suma = db.prepare(`SELECT COALESCE(SUM(saldo), 0) AS total FROM caducidad_lote WHERE producto_id = ?`).get(prod.id)
  console.log(`\n=== Existencias total: ${suma.total} ===`)

  const movs = db.prepare(`
    SELECT ms.tipo, ms.cantidad, ms.motivo,
           datetime(ms.fecha/1000, 'unixepoch', 'localtime') AS fecha
      FROM mov_stock ms
      JOIN caducidad_lote cl ON cl.id = ms.lote_id
     WHERE cl.producto_id = ?
     ORDER BY ms.fecha DESC LIMIT 10
  `).all(prod.id)
  console.log(`\n=== Movimientos de stock (${movs.length}) ===`)
  if (movs.length === 0) console.log('(sin movimientos)')
  else console.table(movs)
}

// Forzar checkpoint para dejar el WAL vacío
const cp = db.prepare('PRAGMA wal_checkpoint(TRUNCATE);').get()
console.log('\n=== Checkpoint forzado ===')
console.log(cp)

db.close()
