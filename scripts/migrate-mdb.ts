/**
 * Migrador .mdb legacy → SQLite nuevo.
 *
 * Usa sql.js (WASM puro) para evitar el problema de ABI de better-sqlite3
 * compilado contra Electron. El archivo resultante es SQLite estándar que
 * better-sqlite3 abre sin problema en runtime de la app.
 *
 * Flujo:
 *   1. PowerShell dumpea tablas del .mdb a JSON en temp.
 *   2. Se crea un SQLite vacío con sql.js.
 *   3. Se aplica drizzle/0000_overrated_kang.sql (schema).
 *   4. Bulk insert con prepared statements.
 *   5. Se exporta la DB como archivo binario.
 *
 * Migra:
 *   - empresa         (1 fila, datos de la sucursal local)
 *   - tipo_usuario    (catálogo base de 4 roles)
 *   - usuario         (con rehash bcrypt de passwords legacy)
 *   - producto        (sólo ESTATUS='A'; código normalizado a TEXT)
 *   - caducidad_lote  (sólo lotes con SALDO > 0)
 *
 * Uso:
 *   npm run migrate:mdb -- --mdb "../Requerimientos/db_v1_legacy_system.mdb" \
 *                          --password "intercod2004" \
 *                          --out "./data/farmacias-santajulia.db" \
 *                          [--force]
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { randomUUID, createRequire } from 'node:crypto'
import { createRequire as cjsRequire } from 'node:module'
import initSqlJs, { type Database } from 'sql.js'
import bcrypt from 'bcryptjs'

const require = cjsRequire(import.meta.url)

// ── Args ────────────────────────────────────────────────────────────────────
type Args = { mdb: string; password: string; out: string; force: boolean }

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(k)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const mdb = get('--mdb')
  const password = get('--password')
  const out = get('--out') ?? './data/migrated.db'
  const force = argv.includes('--force')
  if (!mdb || !password) {
    console.error(
      'Uso: npm run migrate:mdb -- --mdb <ruta.mdb> --password <pwd> [--out <ruta.db>] [--force]'
    )
    process.exit(1)
  }
  return { mdb: resolve(mdb), password, out: resolve(out), force }
}

// ── Dump .mdb via PowerShell ────────────────────────────────────────────────
type Dump = {
  empresa: LegacyEmpresa[]
  tipousuario: LegacyTipoUsuario[]
  usuario: LegacyUsuario[]
  producto: LegacyProducto[]
  caducidad: LegacyCaducidad[]
}

type LegacyEmpresa = {
  id_emp: number
  NOMBRE_EMPRESA: string | null
  RAZONSOCIAL_EMPRESA: string | null
  RFC_EMPRESA: string | null
  CALLE_EMPRESA: string | null
  COLONIA_EMPRESA: string | null
  CIUDAD_EMPRESA: string | null
  ESTADO_EMPRESA: string | null
  SUCURSAL_EMPRESA: string | null
  SUCURSALCALLE_EMPRESA: string | null
  SUCURSALCOLONIA_EMPRESA: string | null
  SUCURSALCIUDAD_EMPRESA: string | null
  SUCURSALESTADO_EMPRESA: string | null
}

type LegacyTipoUsuario = { ID_TIPOUSUARIO: number; NOMBRE_tipousuario: string }

type LegacyUsuario = {
  ID_USUARIO: number
  LOGIN_USUARIO: string
  PASSWORD_USUARIO: string | null
  ID_TIPOUSUARIO: number
  NOMBRE_USUARIO: string | null
  CANCELA_USUARIO: string | null
}

type LegacyProducto = {
  ID_PRODUCTO: number
  CODIGO_PRODUCTO: number
  NOMBRE_PRODUCTO: string | null
  SUSTANCIA_PRODUCTO: string | null
  PRECIO_PRODUCTO: number | null
  COSTO_PRODUCTO: number | null
  ID_LABORATORIO: number | null
  MAX_PRODUCTO: number | null
  MIN_PRODUCTO: number | null
  IVA_PRODUCTO: number | null
  ESTATUS_PRODUCTO: string | null
}

type LegacyCaducidad = {
  ID_CADUCIDAD: number
  CODIGO_PRODUCTO: number
  TOTAL_CADUCIDAD: number
  SALDO_CADUCIDAD: number
  FECHA_CADUCIDAD: string | null
}

function dumpMdb(mdb: string, password: string): { dump: Dump; tmpDir: string } {
  const here = dirname(fileURLToPath(import.meta.url))
  const ps1 = join(here, 'mdb-dump.ps1')
  const tmpDir = join(tmpdir(), `mdb-dump-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })

  console.log(`\n▸ Dumpeando .mdb → ${tmpDir}`)
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ps1,
      '-Mdb',
      mdb,
      '-Password',
      password,
      '-OutDir',
      tmpDir
    ],
    { stdio: 'inherit', shell: false }
  )
  if (r.status !== 0) throw new Error(`mdb-dump.ps1 exit code ${r.status}`)

  const read = <T>(name: string): T[] => JSON.parse(readFileSync(join(tmpDir, `${name}.json`), 'utf8')) as T[]
  const dump: Dump = {
    empresa: read<LegacyEmpresa>('empresa'),
    tipousuario: read<LegacyTipoUsuario>('tipousuario'),
    usuario: read<LegacyUsuario>('usuario'),
    producto: read<LegacyProducto>('producto'),
    caducidad: read<LegacyCaducidad>('caducidad')
  }
  return { dump, tmpDir }
}

// ── Transformaciones ───────────────────────────────────────────────────────
function normalizeCodigo(raw: number | null | undefined): string {
  if (raw == null) return ''
  const s = Number(raw).toFixed(0)
  // EAN-13 que perdió ceros a la izquierda en el Double legacy: pad a 13.
  if (/^\d+$/.test(s) && s.length >= 10 && s.length <= 12) return s.padStart(13, '0')
  return s
}

function hashPassword(plain: string | null | undefined): string {
  const pwd = plain && plain.trim() !== '' ? plain : randomUUID()
  return bcrypt.hashSync(pwd, 10)
}

function parseDate(iso: string | null | undefined): number {
  if (!iso) return Date.now()
  const d = new Date(iso)
  return isNaN(d.getTime()) ? Date.now() : d.getTime()
}

const b = (v: boolean): number => (v ? 1 : 0)

// ── sql.js init (carga WASM desde node_modules) ────────────────────────────
async function initDb(): Promise<Database> {
  const sqlJsPkg = require.resolve('sql.js')
  const sqlJsDistDir = dirname(sqlJsPkg) // .../sql.js/dist
  const SQL = await initSqlJs({ locateFile: (file: string) => join(sqlJsDistDir, file) })
  return new SQL.Database()
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs()
  console.log('▸ Migración .mdb → SQLite (sql.js WASM)')
  console.log(`  origen: ${args.mdb}`)
  console.log(`  destino: ${args.out}`)

  if (existsSync(args.out)) {
    if (!args.force) {
      console.error(`\n✗ ${args.out} ya existe. Usa --force para sobrescribir.`)
      process.exit(1)
    }
    console.log('  (--force) eliminando archivo existente...')
    rmSync(args.out, { force: true })
  }
  mkdirSync(dirname(args.out), { recursive: true })

  const { dump, tmpDir } = dumpMdb(args.mdb, args.password)
  console.log(`  dump OK: empresa=${dump.empresa.length} tipousuario=${dump.tipousuario.length} usuario=${dump.usuario.length} producto=${dump.producto.length} caducidad=${dump.caducidad.length}`)

  const db = await initDb()
  db.run('PRAGMA foreign_keys = ON;')

  // Schema — aplica todas las migraciones de drizzle/ en orden
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const migrationsDir = resolve(scriptDir, '..', 'drizzle')
  const { readdirSync } = await import('node:fs')
  const sqlFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  console.log(`\n▸ Aplicando ${sqlFiles.length} migraciones Drizzle`)
  for (const f of sqlFiles) {
    const sql = readFileSync(resolve(migrationsDir, f), 'utf8')
    db.run(sql)
    console.log(`  ✓ ${f}`)
  }

  // Un único transacción para todo el bulk insert
  db.run('BEGIN TRANSACTION;')

  // ── tipo_usuario ──────────────────────────────────────────────────────────
  const stmtTipo = db.prepare('INSERT INTO tipo_usuario (id, nombre) VALUES (?, ?)')
  for (const t of dump.tipousuario) stmtTipo.run([t.ID_TIPOUSUARIO, t.NOMBRE_tipousuario])
  stmtTipo.free()
  console.log(`  ✓ tipo_usuario: ${dump.tipousuario.length}`)

  // ── empresa ───────────────────────────────────────────────────────────────
  const sucursalId = randomUUID()
  const emp = dump.empresa[0]
  if (emp) {
    const stmtEmp = db.prepare(
      'INSERT INTO empresa (id, nombre_comercial, razon_social, rfc, calle, colonia, ciudad, estado, sucursal_nombre, owner_user_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    stmtEmp.run([
      sucursalId,
      emp.NOMBRE_EMPRESA ?? 'Farmacias MS',
      emp.RAZONSOCIAL_EMPRESA ?? 'SIN RAZÓN SOCIAL',
      emp.RFC_EMPRESA,
      emp.SUCURSALCALLE_EMPRESA ?? emp.CALLE_EMPRESA,
      emp.SUCURSALCOLONIA_EMPRESA ?? emp.COLONIA_EMPRESA,
      emp.SUCURSALCIUDAD_EMPRESA ?? emp.CIUDAD_EMPRESA,
      emp.SUCURSALESTADO_EMPRESA ?? emp.ESTADO_EMPRESA,
      emp.SUCURSAL_EMPRESA ?? 'Sucursal',
      null,
      Date.now()
    ])
    stmtEmp.free()
    console.log(`  ✓ empresa: 1 (sucursal_id=${sucursalId})`)
  } else {
    console.log('  ⚠ EMPRESA legacy vacía — se omite')
  }

  // ── usuario ───────────────────────────────────────────────────────────────
  const stmtUser = db.prepare(
    'INSERT INTO usuario (id, login, password_hash, nombre, tipo_usuario_id, activo, puede_cancelar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const u of dump.usuario) {
    stmtUser.run([
      randomUUID(),
      u.LOGIN_USUARIO,
      hashPassword(u.PASSWORD_USUARIO),
      u.NOMBRE_USUARIO ?? u.LOGIN_USUARIO,
      u.ID_TIPOUSUARIO,
      b(true),
      b((u.CANCELA_USUARIO ?? 'N').trim().toUpperCase() === 'S'),
      Date.now()
    ])
  }
  stmtUser.free()
  console.log(`  ✓ usuario: ${dump.usuario.length} (passwords rehasheados con bcrypt)`)

  // ── producto ──────────────────────────────────────────────────────────────
  const stmtProd = db.prepare(
    'INSERT INTO producto (id, codigo, nombre, sustancia_activa, descripcion, laboratorio, precio, costo, iva_porcentaje, stock_maximo, stock_minimo, activo, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const codigoToProductoId = new Map<string, string>()
  const seenCodigo = new Set<string>()
  let prodSkippedDup = 0
  let prodInserted = 0
  for (const p of dump.producto) {
    if ((p.ESTATUS_PRODUCTO ?? '').toUpperCase() !== 'A') continue
    const id = randomUUID()
    const codigo = normalizeCodigo(p.CODIGO_PRODUCTO)
    if (codigo === '' || seenCodigo.has(codigo)) {
      // Colisión (rara vez dos productos activos compartían código en legacy)
      prodSkippedDup++
      continue
    }
    seenCodigo.add(codigo)
    codigoToProductoId.set(String(Number(p.CODIGO_PRODUCTO).toFixed(0)), id)
    stmtProd.run([
      id,
      codigo,
      (p.NOMBRE_PRODUCTO ?? '').trim() || '(sin nombre)',
      p.SUSTANCIA_PRODUCTO?.trim() || null,
      null,
      null,
      p.PRECIO_PRODUCTO ?? 0,
      p.COSTO_PRODUCTO ?? 0,
      p.IVA_PRODUCTO ?? 0,
      p.MAX_PRODUCTO ?? 0,
      p.MIN_PRODUCTO ?? 0,
      b(true),
      Date.now()
    ])
    prodInserted++
  }
  stmtProd.free()
  console.log(`  ✓ producto: ${prodInserted} insertados${prodSkippedDup ? `, ${prodSkippedDup} duplicados descartados` : ''}`)

  // ── caducidad_lote ────────────────────────────────────────────────────────
  const stmtLote = db.prepare(
    'INSERT INTO caducidad_lote (id, producto_id, total, saldo, fecha_caducidad, fecha_entrada) VALUES (?, ?, ?, ?, ?, ?)'
  )
  let lotesInserted = 0
  let lotesOrphan = 0
  for (const c of dump.caducidad) {
    const key = String(Number(c.CODIGO_PRODUCTO).toFixed(0))
    const productoId = codigoToProductoId.get(key)
    if (!productoId) {
      lotesOrphan++
      continue
    }
    const ms = parseDate(c.FECHA_CADUCIDAD)
    stmtLote.run([randomUUID(), productoId, c.TOTAL_CADUCIDAD, c.SALDO_CADUCIDAD, ms, ms])
    lotesInserted++
  }
  stmtLote.free()
  console.log(`  ✓ caducidad_lote: ${lotesInserted}${lotesOrphan ? `, ${lotesOrphan} descartados (producto inactivo/ausente)` : ''}`)

  db.run('COMMIT;')

  // Exportar a archivo
  const bytes = db.export()
  writeFileSync(args.out, Buffer.from(bytes))
  db.close()

  rmSync(tmpDir, { recursive: true, force: true })
  console.log(`\n✅ Migración completa → ${args.out}`)
}

main().catch((e) => {
  console.error('\n✗ Error:', e)
  process.exit(1)
})
