/**
 * Script rápido de verificación: abre el SQLite migrado y reporta conteos + samples.
 * Uso: npx tsx scripts/verify-db.ts <ruta.db>
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'

const require = createRequire(import.meta.url)

async function main(): Promise<void> {
  const dbPath = process.argv[2]
  if (!dbPath) {
    console.error('Uso: npx tsx scripts/verify-db.ts <ruta.db>')
    process.exit(1)
  }
  const bytes = readFileSync(dbPath)
  const size = statSync(dbPath).size
  console.log(`Archivo: ${dbPath} (${(size / 1024 / 1024).toFixed(2)} MB)`)

  const sqlJsDist = dirname(require.resolve('sql.js'))
  const SQL = await initSqlJs({ locateFile: (file: string) => join(sqlJsDist, file) })
  const db = new SQL.Database(new Uint8Array(bytes))

  const tables = ['empresa', 'tipo_usuario', 'usuario', 'producto', 'caducidad_lote', 'venta', 'venta_item', 'pago', 'corte', 'mov_caja']
  console.log('\n=== Conteos ===')
  for (const t of tables) {
    const r = db.exec(`SELECT COUNT(*) AS n FROM ${t}`)
    const n = r[0]?.values?.[0]?.[0] ?? 0
    console.log(`  ${t.padEnd(20)} ${n}`)
  }

  console.log('\n=== Muestra: empresa ===')
  console.table(rowsOf(db, 'SELECT id, nombre_comercial, sucursal_nombre, rfc, ciudad FROM empresa'))

  console.log('\n=== Muestra: tipo_usuario ===')
  console.table(rowsOf(db, 'SELECT id, nombre FROM tipo_usuario'))

  console.log('\n=== Muestra: usuario (sin hash completo) ===')
  console.table(
    rowsOf(
      db,
      "SELECT login, nombre, tipo_usuario_id, puede_cancelar, substr(password_hash, 1, 20) || '...' AS hash_preview FROM usuario"
    )
  )

  console.log('\n=== Muestra: producto (5 con código largo) ===')
  console.table(
    rowsOf(
      db,
      "SELECT substr(codigo, 1, 20) AS codigo, substr(nombre, 1, 35) AS nombre, substr(sustancia_activa, 1, 25) AS sustancia, precio, iva_porcentaje FROM producto WHERE length(codigo) >= 10 LIMIT 5"
    )
  )

  console.log('\n=== Muestra: producto (5 con SKU corto) ===')
  console.table(
    rowsOf(
      db,
      "SELECT codigo, substr(nombre, 1, 35) AS nombre, precio FROM producto WHERE length(codigo) < 7 LIMIT 5"
    )
  )

  console.log('\n=== Distribución length(codigo) ===')
  console.table(
    rowsOf(
      db,
      'SELECT length(codigo) AS len, COUNT(*) AS n FROM producto GROUP BY length(codigo) ORDER BY len'
    )
  )

  console.log('\n=== Muestra: caducidad_lote (top 5 por saldo) ===')
  console.table(
    rowsOf(
      db,
      `SELECT substr(p.nombre, 1, 35) AS producto, l.total, l.saldo,
              date(l.fecha_caducidad / 1000, 'unixepoch') AS caduca
         FROM caducidad_lote l
         JOIN producto p ON p.id = l.producto_id
         ORDER BY l.saldo DESC
         LIMIT 5`
    )
  )

  console.log('\n=== Últimas 10 ventas ===')
  console.table(
    rowsOf(
      db,
      `SELECT
         v.folio_local AS folio,
         datetime(v.fecha / 1000, 'unixepoch', 'localtime') AS fecha,
         u.login AS cajero,
         printf('%.2f', v.total) AS total,
         CASE v.cancelada WHEN 1 THEN 'SI' ELSE '' END AS cancel,
         (SELECT COUNT(*) FROM venta_item vi WHERE vi.venta_id = v.id) AS items,
         (SELECT GROUP_CONCAT(metodo || ':' || printf('%.2f', monto), ' ')
            FROM pago p WHERE p.venta_id = v.id) AS pagos
       FROM venta v
       LEFT JOIN usuario u ON u.id = v.cajero_id
       ORDER BY v.fecha DESC
       LIMIT 10`
    )
  )

  console.log('\n=== Integridad referencial ===')
  console.table(
    rowsOf(
      db,
      `SELECT 'lotes_huerfanos' AS check_, COUNT(*) AS n FROM caducidad_lote l LEFT JOIN producto p ON p.id = l.producto_id WHERE p.id IS NULL
       UNION ALL
       SELECT 'usuarios_sin_rol', COUNT(*) FROM usuario u LEFT JOIN tipo_usuario t ON t.id = u.tipo_usuario_id WHERE t.id IS NULL`
    )
  )

  db.close()
}

function rowsOf(db: initSqlJs.Database, sql: string): Record<string, unknown>[] {
  const r = db.exec(sql)
  if (r.length === 0) return []
  const cols = r[0]!.columns
  return r[0]!.values.map((row) => {
    const o: Record<string, unknown> = {}
    cols.forEach((c, i) => (o[c] = row[i]))
    return o
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
