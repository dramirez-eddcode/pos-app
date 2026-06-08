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
  const fresh = !existsSync(dbPath)
  if (fresh) {
    mkdirSync(dirname(dbPath), { recursive: true })
    console.log(`[db] Inicializando DB nueva en ${dbPath}`)
  } else {
    console.log(`[db] Abriendo ${dbPath}`)
  }
  _sqlite = new Database(dbPath)
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('foreign_keys = ON')

  ensureSchema(_sqlite)
  seedDefaults(_sqlite)

  _db = drizzle(_sqlite, { schema })
  return _db
}

/**
 * Schema completo (post-migraciones) para una DB recién creada. Sólo se aplica
 * si no existe la tabla `usuario` (señal de DB virgen). En DBs con datos no
 * corre; los ALTER incrementales viven en ensureSchema().
 */
const BOOTSTRAP_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS instalacion (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tipo TEXT NOT NULL,
  sucursal_activa_id TEXT,
  matriz_id TEXT,
  propietario_nombre TEXT,
  configured_at INTEGER,
  schema_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sucursal (
  id TEXT PRIMARY KEY NOT NULL,
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  razon_social TEXT,
  rfc TEXT,
  calle TEXT,
  colonia TEXT,
  ciudad TEXT,
  estado TEXT,
  activa INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sucursal_codigo_unique ON sucursal (codigo);

CREATE TABLE IF NOT EXISTS empresa (
  id TEXT PRIMARY KEY NOT NULL,
  nombre_comercial TEXT NOT NULL,
  razon_social TEXT NOT NULL,
  rfc TEXT,
  calle TEXT,
  colonia TEXT,
  ciudad TEXT,
  estado TEXT,
  sucursal_nombre TEXT NOT NULL,
  owner_user_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tipo_usuario (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  nombre TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tipo_usuario_nombre_unique ON tipo_usuario (nombre);

CREATE TABLE IF NOT EXISTS usuario (
  id TEXT PRIMARY KEY NOT NULL,
  login TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  nombre TEXT NOT NULL,
  tipo_usuario_id INTEGER NOT NULL REFERENCES tipo_usuario(id),
  activo INTEGER NOT NULL DEFAULT 1,
  puede_cancelar INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS usuario_login_unique ON usuario (login);

CREATE TABLE IF NOT EXISTS producto (
  id TEXT PRIMARY KEY NOT NULL,
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  sustancia_activa TEXT,
  descripcion TEXT,
  laboratorio TEXT,
  precio REAL NOT NULL,
  costo REAL NOT NULL DEFAULT 0,
  iva_porcentaje INTEGER NOT NULL DEFAULT 0,
  iva_modo TEXT NOT NULL DEFAULT 'exento',
  stock_maximo INTEGER DEFAULT 0,
  stock_minimo INTEGER DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS producto_codigo_unique ON producto (codigo);
CREATE INDEX IF NOT EXISTS producto_nombre_idx ON producto (nombre);
CREATE INDEX IF NOT EXISTS producto_sustancia_idx ON producto (sustancia_activa);

CREATE TABLE IF NOT EXISTS caducidad_lote (
  id TEXT PRIMARY KEY NOT NULL,
  producto_id TEXT NOT NULL REFERENCES producto(id),
  total INTEGER NOT NULL,
  saldo INTEGER NOT NULL,
  fecha_caducidad INTEGER NOT NULL,
  fecha_entrada INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS caducidad_producto_idx ON caducidad_lote (producto_id, fecha_caducidad);

CREATE TABLE IF NOT EXISTS venta (
  id TEXT PRIMARY KEY NOT NULL,
  folio_local INTEGER NOT NULL,
  cajero_id TEXT NOT NULL REFERENCES usuario(id),
  fecha INTEGER NOT NULL,
  subtotal REAL NOT NULL,
  iva REAL NOT NULL,
  descuento REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  motivo TEXT NOT NULL DEFAULT 'VENTA',
  cancelada INTEGER NOT NULL DEFAULT 0,
  cancelada_por TEXT REFERENCES usuario(id),
  cancelada_en INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS venta_folio_local_unique ON venta (folio_local);
CREATE INDEX IF NOT EXISTS venta_fecha_idx ON venta (fecha);

CREATE TABLE IF NOT EXISTS venta_item (
  id TEXT PRIMARY KEY NOT NULL,
  venta_id TEXT NOT NULL REFERENCES venta(id) ON DELETE CASCADE,
  producto_id TEXT NOT NULL REFERENCES producto(id),
  lote_id TEXT REFERENCES caducidad_lote(id),
  cantidad REAL NOT NULL,
  precio_unitario REAL NOT NULL,
  importe REAL NOT NULL,
  iva REAL NOT NULL,
  descuento REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pago (
  id TEXT PRIMARY KEY NOT NULL,
  venta_id TEXT NOT NULL REFERENCES venta(id) ON DELETE CASCADE,
  metodo TEXT NOT NULL,
  monto REAL NOT NULL,
  referencia TEXT
);

CREATE TABLE IF NOT EXISTS corte (
  id TEXT PRIMARY KEY NOT NULL,
  cajero_id TEXT NOT NULL REFERENCES usuario(id),
  fecha INTEGER NOT NULL,
  folio_inicio INTEGER NOT NULL,
  folio_fin INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  total_efectivo REAL NOT NULL DEFAULT 0,
  total_tarjeta REAL NOT NULL DEFAULT 0,
  total_transferencia REAL NOT NULL DEFAULT 0,
  total_otro REAL NOT NULL DEFAULT 0,
  entradas_caja REAL NOT NULL DEFAULT 0,
  salidas_caja REAL NOT NULL DEFAULT 0,
  cancelaciones REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mov_caja (
  id TEXT PRIMARY KEY NOT NULL,
  fecha INTEGER NOT NULL,
  cajero_id TEXT NOT NULL REFERENCES usuario(id),
  tipo TEXT NOT NULL,
  concepto TEXT NOT NULL,
  monto REAL NOT NULL,
  corte_id TEXT REFERENCES corte(id)
);

CREATE TABLE IF NOT EXISTS sucursal_producto (
  sucursal_id TEXT NOT NULL REFERENCES sucursal(id) ON DELETE CASCADE,
  producto_id TEXT NOT NULL REFERENCES producto(id) ON DELETE CASCADE,
  precio_override REAL,
  iva_modo_override TEXT,
  iva_porcentaje_override INTEGER,
  excluida INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (sucursal_id, producto_id)
);
CREATE INDEX IF NOT EXISTS sucursal_producto_producto_idx ON sucursal_producto (producto_id);
`

function tableExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare(`SELECT 1 AS v FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name) as { v: number } | undefined
  return Boolean(row)
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
  // Bootstrap completo para DBs vírgenes (no hay tabla usuario aún).
  if (!tableExists(sqlite, 'usuario')) {
    sqlite.exec(BOOTSTRAP_SCHEMA_SQL)
    console.log('[db] Bootstrap inicial aplicado (tablas base creadas).')
  }

  // Tablas agregadas en fases posteriores — idempotentes vía IF NOT EXISTS.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      iva_porcentaje_default INTEGER NOT NULL DEFAULT 16,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS instalacion (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tipo TEXT NOT NULL,
      sucursal_activa_id TEXT,
      matriz_id TEXT,
      propietario_nombre TEXT,
      configured_at INTEGER,
      ultimo_import_en INTEGER,
      schema_version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sucursal (
      id TEXT PRIMARY KEY NOT NULL,
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      razon_social TEXT,
      rfc TEXT,
      calle TEXT,
      colonia TEXT,
      ciudad TEXT,
      estado TEXT,
      activa INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sucursal_codigo_unique ON sucursal (codigo);

    CREATE TABLE IF NOT EXISTS sucursal_producto (
      sucursal_id TEXT NOT NULL REFERENCES sucursal(id) ON DELETE CASCADE,
      producto_id TEXT NOT NULL REFERENCES producto(id) ON DELETE CASCADE,
      precio_override REAL,
      iva_modo_override TEXT,
      iva_porcentaje_override INTEGER,
      excluida INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (sucursal_id, producto_id)
    );
    CREATE INDEX IF NOT EXISTS sucursal_producto_producto_idx ON sucursal_producto (producto_id);
  `)

  // Bodegas (gestión multi-bodega desde matriz). El inventario se separa por
  // bodega vía caducidad_lote.bodega_id. Siempre existe la "Bodega Principal".
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS bodega (
      id TEXT PRIMARY KEY NOT NULL,
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      calle TEXT,
      colonia TEXT,
      ciudad TEXT,
      estado TEXT,
      es_principal INTEGER NOT NULL DEFAULT 0,
      activa INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS bodega_codigo_unique ON bodega (codigo);
  `)
  // Bodega principal por default (idempotente). Id fijo para poder backfillear.
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO bodega
         (id, codigo, nombre, es_principal, activa, created_at, updated_at)
       VALUES ('bodega-principal', 'PRINCIPAL', 'Bodega Principal', 1, 1, ?, ?)`
    )
    .run(Date.now(), Date.now())

  // caducidad_lote.bodega_id — cada lote pertenece a una bodega. ALTER + backfill
  // de lotes existentes a la bodega principal.
  const hasBodegaId = sqlite
    .prepare(`SELECT 1 AS v FROM pragma_table_info('caducidad_lote') WHERE name = 'bodega_id'`)
    .get() as { v: number } | undefined
  if (!hasBodegaId) {
    sqlite.exec(`ALTER TABLE caducidad_lote ADD COLUMN bodega_id TEXT`)
    sqlite.exec(`UPDATE caducidad_lote SET bodega_id = 'bodega-principal' WHERE bodega_id IS NULL`)
  }

  // instalacion.ultimo_import_en — agregado en Fase 4 (rastreo del último .farma aplicado).
  const hasUltImport = sqlite
    .prepare(`SELECT 1 AS v FROM pragma_table_info('instalacion') WHERE name = 'ultimo_import_en'`)
    .get() as { v: number } | undefined
  if (!hasUltImport) {
    sqlite.exec(`ALTER TABLE instalacion ADD COLUMN ultimo_import_en INTEGER`)
  }

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

  // Historial de traspasos bodega → sucursal (matriz). Guarda encabezado + las
  // líneas como JSON, para listar y ver detalle. Vive en la BD → se respalda.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS traspaso (
      folio TEXT PRIMARY KEY NOT NULL,
      fecha INTEGER NOT NULL,
      usuario_id TEXT,
      bodega_origen_id TEXT,
      bodega_origen_nombre TEXT,
      sucursal_id TEXT,
      sucursal_codigo TEXT,
      sucursal_nombre TEXT,
      lineas INTEGER NOT NULL DEFAULT 0,
      unidades INTEGER NOT NULL DEFAULT 0,
      items_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS traspaso_fecha_idx ON traspaso (fecha);
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
 * Datos mínimos siempre presentes:
 *   - 4 roles base (idempotente, INSERT OR IGNORE)
 *
 * El usuario admin y los datos de empresa los crea el wizard de primer arranque
 * (cuando `instalacion` está en blanco). Aquí ya no se inserta seed automático.
 */
function seedDefaults(sqlite: Database.Database): void {
  const insertRol = sqlite.prepare('INSERT OR IGNORE INTO tipo_usuario (nombre) VALUES (?)')
  for (const rol of ['CAJERO', 'ADMINISTRADOR', 'SUPERVISOR', 'SUPERUSUARIO']) {
    insertRol.run(rol)
  }

  // Config de negocio: fila única id=1 con IVA default 16% (idempotente).
  sqlite
    .prepare(
      'INSERT OR IGNORE INTO config (id, iva_porcentaje_default, updated_at) VALUES (1, 16, ?)'
    )
    .run(Date.now())
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
