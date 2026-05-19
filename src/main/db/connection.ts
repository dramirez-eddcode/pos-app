import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as schema from './schema'

type Db = BetterSQLite3Database<typeof schema>

let _db: Db | null = null
let _sqlite: Database.Database | null = null

/**
 * Resuelve la ruta de la DB SQLite según el contexto:
 *
 *   1. Si POS_DB_PATH está seteado en env → usarlo (override explícito).
 *   2. En dev → <appPath>/data/farmacias-santajulia.db (la que migramos).
 *   3. En prod → <userData>/data/farmacias.db (instalación del cliente).
 *
 * En prod, si el archivo aún no existe y hay un seed en <resourcesPath>/data/seed.db,
 * se copia como arranque limpio de sucursal nueva.
 */
export function resolveDbPath(): string {
  const envPath = process.env['POS_DB_PATH']
  if (envPath) return envPath

  if (is.dev) {
    return join(app.getAppPath(), 'data', 'farmacias-santajulia.db')
  }

  const prodPath = join(app.getPath('userData'), 'data', 'farmacias.db')
  if (!existsSync(prodPath)) {
    mkdirSync(dirname(prodPath), { recursive: true })
    const seedPath = join(process.resourcesPath, 'data', 'seed.db')
    if (existsSync(seedPath)) {
      copyFileSync(seedPath, prodPath)
      console.log(`[db] Copiado seed ${seedPath} → ${prodPath}`)
    }
  }
  return prodPath
}

export function getDb(): Db {
  if (_db) return _db

  const dbPath = resolveDbPath()
  if (!existsSync(dbPath)) {
    throw new Error(
      `[db] Archivo SQLite no encontrado: ${dbPath}. ` +
        'Corre `npm run migrate:mdb ...` para generarlo, o seta POS_DB_PATH.'
    )
  }

  console.log(`[db] Abriendo ${dbPath}`)
  _sqlite = new Database(dbPath)
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('foreign_keys = ON')

  ensureSchema(_sqlite)

  _db = drizzle(_sqlite, { schema })
  return _db
}

/**
 * Bootstrap de tablas agregadas después de la migración inicial desde el .mdb.
 * Usa `CREATE TABLE IF NOT EXISTS` para ser idempotente tanto en DBs recién
 * migradas (que ya las tienen) como en DBs que ya estaban en uso.
 *
 * Cuando agreguemos más cambios de schema en Fase 3+, esto se reemplaza por
 * un mecanismo de migraciones propio (drizzle-kit + __drizzle_migrations).
 */
function ensureSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS mov_stock (
      id TEXT PRIMARY KEY NOT NULL,
      lote_id TEXT NOT NULL REFERENCES caducidad_lote(id) ON UPDATE no action ON DELETE no action,
      venta_item_id TEXT REFERENCES venta_item(id) ON UPDATE no action ON DELETE set null,
      tipo TEXT NOT NULL,
      cantidad INTEGER NOT NULL,
      fecha INTEGER NOT NULL,
      motivo TEXT
    );
    CREATE INDEX IF NOT EXISTS mov_stock_lote_idx ON mov_stock (lote_id);
    CREATE INDEX IF NOT EXISTS mov_stock_venta_item_idx ON mov_stock (venta_item_id);

    CREATE TABLE IF NOT EXISTS precio_historico (
      id TEXT PRIMARY KEY NOT NULL,
      producto_id TEXT NOT NULL REFERENCES producto(id) ON UPDATE no action ON DELETE no action,
      precio_anterior REAL NOT NULL,
      precio_nuevo REAL NOT NULL,
      cajero_id TEXT NOT NULL REFERENCES usuario(id) ON UPDATE no action ON DELETE no action,
      fecha INTEGER NOT NULL,
      motivo TEXT
    );
    CREATE INDEX IF NOT EXISTS precio_historico_producto_idx ON precio_historico (producto_id, fecha);
  `)

  // producto.iva_modo — agregado en Fase 3. ADD COLUMN es idempotente sólo si
  // validamos antes (SQLite no soporta IF NOT EXISTS en ALTER TABLE hasta 3.35).
  const hasIvaModo = sqlite
    .prepare(`SELECT 1 AS v FROM pragma_table_info('producto') WHERE name = 'iva_modo'`)
    .get() as { v: number } | undefined
  if (!hasIvaModo) {
    sqlite.exec(
      `ALTER TABLE producto ADD COLUMN iva_modo TEXT NOT NULL DEFAULT 'exento'`
    )
  }

  // Unificación débito/crédito → TARJETA. Agrega corte.total_tarjeta si no
  // existe, colapsa los dos campos viejos (que quedan muertos pero presentes
  // físicamente) y normaliza pago.metodo legacy.
  const hasTotalTarjeta = sqlite
    .prepare(`SELECT 1 AS v FROM pragma_table_info('corte') WHERE name = 'total_tarjeta'`)
    .get() as { v: number } | undefined
  if (!hasTotalTarjeta) {
    sqlite.exec(
      `ALTER TABLE corte ADD COLUMN total_tarjeta REAL NOT NULL DEFAULT 0;
       UPDATE corte
          SET total_tarjeta = COALESCE(total_tarjeta_debito, 0) + COALESCE(total_tarjeta_credito, 0)
        WHERE total_tarjeta = 0
          AND (COALESCE(total_tarjeta_debito, 0) > 0 OR COALESCE(total_tarjeta_credito, 0) > 0);`
    )
  }
  sqlite
    .prepare(`UPDATE pago SET metodo = 'TARJETA' WHERE metodo IN ('TARJETA_DEBITO', 'TARJETA_CREDITO')`)
    .run()
}

/**
 * Acceso directo al handle de better-sqlite3 para queries manuales (ej. cuando
 * Drizzle hace cosas raras con aliases en SELECT).
 */
export function getSqlite(): Database.Database {
  getDb() // garantiza que esté inicializado
  return _sqlite!
}

export function closeDb(): void {
  if (_sqlite) {
    _sqlite.close()
    _sqlite = null
    _db = null
  }
}

export { schema }
