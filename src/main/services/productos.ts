import { randomUUID } from 'node:crypto'
import { getSqlite } from '../db/connection'
import type {
  CreateProductoInput,
  ProductoCatalogoItem,
  ProductoDto,
  ProductoSearchQuery,
  UpdateIvaInput,
  UpdateIvaResult,
  UpdateProductoInput
} from '@shared/dto'
import type { IvaModo } from '@shared/types'

function rolOf(userId: string): string | null {
  const sqlite = getSqlite()
  const row = sqlite
    .prepare(
      `SELECT t.nombre
         FROM usuario u
         JOIN tipo_usuario t ON t.id = u.tipo_usuario_id
        WHERE u.id = ?`
    )
    .get(userId) as { nombre: string } | undefined
  return row?.nombre ?? null
}

function requireAdmin(viewerUserId: string): void {
  const rol = rolOf(viewerUserId)
  if (!rol) throw new Error('Usuario no identificado')
  if (rol !== 'ADMINISTRADOR' && rol !== 'SUPERUSUARIO') {
    throw new Error('Requiere permisos de administrador')
  }
}

function nullableTrim(value: string | null | undefined): string | null {
  if (value == null) return null
  const t = String(value).trim()
  return t.length === 0 ? null : t
}

function nullableInt(value: number | null | undefined): number | null {
  if (value == null) return null
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

const VALID_IVA_MODOS: readonly IvaModo[] = ['exento', 'sumar', 'incluido'] as const

function normalizeIvaModo(raw: unknown): IvaModo {
  return VALID_IVA_MODOS.includes(raw as IvaModo) ? (raw as IvaModo) : 'exento'
}

/**
 * Búsqueda y lookup de productos. Usamos SQL crudo con better-sqlite3 en vez
 * de Drizzle para este caso, porque Drizzle puede reescribir aliases en
 * camelCase a snake_case y romper el mapeo del row. Con SQL literal, las
 * keys del row son exactamente los `AS ...` que pongamos.
 */

interface RawRow {
  id: string
  codigo: string
  nombre: string
  sustanciaActiva: string | null
  descripcion: string | null
  laboratorio: string | null
  precio: number
  ivaPorcentaje: number
  ivaModo: string | null
  existenciasTotal: number
}

const SELECT_COMMON = `
  SELECT
    p.id               AS id,
    p.codigo           AS codigo,
    p.nombre           AS nombre,
    p.sustancia_activa AS sustanciaActiva,
    p.descripcion      AS descripcion,
    p.laboratorio      AS laboratorio,
    p.precio           AS precio,
    p.iva_porcentaje   AS ivaPorcentaje,
    p.iva_modo         AS ivaModo,
    COALESCE(
      (SELECT SUM(cl.saldo) FROM caducidad_lote cl WHERE cl.producto_id = p.id),
      0
    ) AS existenciasTotal
  FROM producto p
`

function rowToDto(r: RawRow): ProductoDto {
  return {
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    sustanciaActiva: r.sustanciaActiva,
    descripcion: r.descripcion,
    laboratorio: r.laboratorio,
    precio: Number(r.precio) || 0,
    ivaPorcentaje: Number(r.ivaPorcentaje) || 0,
    ivaModo: normalizeIvaModo(r.ivaModo),
    existenciasTotal: Number(r.existenciasTotal) || 0
  }
}

export function searchProductos(q: ProductoSearchQuery): ProductoDto[] {
  const db = getSqlite()
  const limit = Math.max(1, Math.min(500, q.limit ?? 100))
  const term = q.term.trim()

  let rows: RawRow[]

  if (!term) {
    const stmt = db.prepare(
      `${SELECT_COMMON} WHERE p.activo = 1 ORDER BY p.nombre LIMIT ?`
    )
    rows = stmt.all(limit) as RawRow[]
  } else if (q.mode === 'codigo') {
    const exact = db.prepare(`${SELECT_COMMON} WHERE p.codigo = ? LIMIT 1`).all(term) as RawRow[]
    if (exact.length > 0) {
      rows = exact
    } else {
      const stmt = db.prepare(
        `${SELECT_COMMON} WHERE p.codigo LIKE ? ORDER BY p.codigo LIMIT ?`
      )
      rows = stmt.all(`${term}%`, limit) as RawRow[]
    }
  } else if (q.mode === 'sustancia') {
    const stmt = db.prepare(
      `${SELECT_COMMON} WHERE p.sustancia_activa LIKE ? ORDER BY p.nombre LIMIT ?`
    )
    rows = stmt.all(`%${term}%`, limit) as RawRow[]
  } else {
    // default: nombre
    const stmt = db.prepare(
      `${SELECT_COMMON} WHERE p.nombre LIKE ? ORDER BY p.nombre LIMIT ?`
    )
    rows = stmt.all(`%${term}%`, limit) as RawRow[]
  }

  return rows.map(rowToDto)
}

/**
 * Devuelve todos los productos activos con precio, costo y configuración de
 * IVA actual, útil para generar plantillas CSV (actualizar precios, IVA,
 * entradas de mercancía). Sin stock calculado — lightweight.
 */
export function getAllActivos(): {
  id: string
  codigo: string
  nombre: string
  precio: number
  costo: number
  ivaPorcentaje: number
  ivaModo: IvaModo
}[] {
  const db = getSqlite()
  const rows = db
    .prepare(
      `SELECT id, codigo, nombre, precio, costo,
              iva_porcentaje AS ivaPorcentaje,
              iva_modo       AS ivaModo
         FROM producto
        WHERE activo = 1
        ORDER BY nombre`
    )
    .all() as Array<{
    id: string
    codigo: string
    nombre: string
    precio: number
    costo: number
    ivaPorcentaje: number
    ivaModo: string | null
  }>
  return rows.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    precio: Number(r.precio) || 0,
    costo: Number(r.costo) || 0,
    ivaPorcentaje: Number(r.ivaPorcentaje) || 0,
    ivaModo: normalizeIvaModo(r.ivaModo)
  }))
}

export function getByCodigo(codigo: string): ProductoDto | null {
  const db = getSqlite()
  const row = db
    .prepare(`${SELECT_COMMON} WHERE p.codigo = ? LIMIT 1`)
    .get(codigo.trim()) as RawRow | undefined
  return row ? rowToDto(row) : null
}

/**
 * Devuelve todos los lotes con saldo > 0 unidos a producto, ordenados por
 * nombre del producto y caducidad. Usado para generar plantillas CSV de
 * ajustes de inventario (una fila por lote).
 */
export function getAllLotesActivos(): Array<{
  loteId: string
  productoId: string
  codigo: string
  nombre: string
  caducidad: string // YYYY-MM-DD
  saldo: number
  total: number
}> {
  const db = getSqlite()
  const rows = db
    .prepare(
      `SELECT cl.id AS loteId, cl.producto_id AS productoId, p.codigo, p.nombre,
              cl.fecha_caducidad AS fechaCaducidad, cl.saldo, cl.total
         FROM caducidad_lote cl
         JOIN producto p ON p.id = cl.producto_id
        WHERE cl.saldo > 0
        ORDER BY p.nombre, cl.fecha_caducidad`
    )
    .all() as Array<{
    loteId: string
    productoId: string
    codigo: string
    nombre: string
    fechaCaducidad: number
    saldo: number
    total: number
  }>
  return rows.map((r) => ({
    loteId: r.loteId,
    productoId: r.productoId,
    codigo: r.codigo,
    nombre: r.nombre,
    caducidad: new Date(r.fechaCaducidad).toISOString().slice(0, 10),
    saldo: r.saldo,
    total: r.total
  }))
}

/**
 * Devuelve los lotes de un producto (todos, incluyendo con saldo 0 — por si
 * el admin quiere ajustar un lote "vacío" hacia arriba). Ordenados por fecha
 * de caducidad ascendente (el más próximo a vencer primero, siguiendo FEFO).
 */
export function getLotesByProducto(
  productoId: string
): {
  id: string
  total: number
  saldo: number
  fechaCaducidad: string
  fechaEntrada: string
}[] {
  const db = getSqlite()
  const rows = db
    .prepare(
      `SELECT id, total, saldo, fecha_caducidad, fecha_entrada
         FROM caducidad_lote
        WHERE producto_id = ?
        ORDER BY fecha_caducidad ASC, fecha_entrada ASC`
    )
    .all(productoId) as Array<{
    id: string
    total: number
    saldo: number
    fecha_caducidad: number
    fecha_entrada: number
  }>
  return rows.map((r) => ({
    id: r.id,
    total: r.total,
    saldo: r.saldo,
    fechaCaducidad: new Date(r.fecha_caducidad).toISOString(),
    fechaEntrada: new Date(r.fecha_entrada).toISOString()
  }))
}

/**
 * Actualiza la configuración de IVA (modo + tasa) de uno o varios productos.
 * Si el modo es 'exento', la tasa queda en 0 sin importar lo que mande el
 * input. Si es 'sumar' o 'incluido', la tasa debe estar en [0, 100].
 *
 * No deja rastro en un histórico propio (a diferencia de precios): es una
 * configuración fiscal, no un cambio con motivos comerciales.
 */
export function updateIvaProductos(input: UpdateIvaInput): UpdateIvaResult {
  const sqlite = getSqlite()
  if (input.items.length === 0) throw new Error('Sin productos a actualizar')

  const run = sqlite.transaction(() => {
    let actualizados = 0
    const now = Date.now()

    const getProd = sqlite.prepare(
      `SELECT id, iva_porcentaje AS ivaPorcentaje, iva_modo AS ivaModo
         FROM producto WHERE id = ?`
    )
    const updProd = sqlite.prepare(
      `UPDATE producto
          SET iva_modo = ?, iva_porcentaje = ?, updated_at = ?
        WHERE id = ?`
    )

    for (const it of input.items) {
      if (!VALID_IVA_MODOS.includes(it.nuevoModo)) {
        throw new Error(`Modo de IVA inválido (${it.nuevoModo}) para ${it.productoNombre}`)
      }
      const prod = getProd.get(it.productoId) as
        | { id: string; ivaPorcentaje: number; ivaModo: string | null }
        | undefined
      if (!prod) throw new Error(`Producto ${it.productoNombre} no encontrado`)

      const nuevoModo = it.nuevoModo
      const nuevoPorcentaje =
        nuevoModo === 'exento'
          ? 0
          : Math.max(0, Math.min(100, Math.round(Number(it.nuevoPorcentaje) || 0)))

      if (nuevoModo !== 'exento' && (!Number.isFinite(it.nuevoPorcentaje) || it.nuevoPorcentaje < 0)) {
        throw new Error(`Porcentaje de IVA inválido para ${it.productoNombre}`)
      }

      const actualModo = normalizeIvaModo(prod.ivaModo)
      const actualPorcentaje = Number(prod.ivaPorcentaje) || 0
      if (actualModo === nuevoModo && actualPorcentaje === nuevoPorcentaje) continue

      updProd.run(nuevoModo, nuevoPorcentaje, now, prod.id)
      actualizados++
    }

    return { actualizados }
  })

  return run()
}

/**
 * Lista completa del catálogo (activos + inactivos) para el módulo de admin.
 * Incluye stock min/max y existencias totales para visibilidad de gestión.
 */
export function listCatalogo(viewerUserId: string): ProductoCatalogoItem[] {
  requireAdmin(viewerUserId)
  const db = getSqlite()
  const rows = db
    .prepare(
      `SELECT p.id, p.codigo, p.nombre,
              p.sustancia_activa AS sustanciaActiva,
              p.descripcion, p.laboratorio,
              p.precio, p.costo,
              p.iva_porcentaje   AS ivaPorcentaje,
              p.iva_modo         AS ivaModo,
              p.stock_maximo     AS stockMaximo,
              p.stock_minimo     AS stockMinimo,
              p.activo,
              COALESCE(
                (SELECT SUM(cl.saldo) FROM caducidad_lote cl WHERE cl.producto_id = p.id),
                0
              ) AS existenciasTotal
         FROM producto p
        ORDER BY p.activo DESC, p.nombre`
    )
    .all() as Array<{
    id: string
    codigo: string
    nombre: string
    sustanciaActiva: string | null
    descripcion: string | null
    laboratorio: string | null
    precio: number
    costo: number
    ivaPorcentaje: number
    ivaModo: string | null
    stockMaximo: number | null
    stockMinimo: number | null
    activo: number
    existenciasTotal: number
  }>

  return rows.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    sustanciaActiva: r.sustanciaActiva ?? null,
    descripcion: r.descripcion ?? null,
    laboratorio: r.laboratorio ?? null,
    precio: Number(r.precio) || 0,
    costo: Number(r.costo) || 0,
    ivaPorcentaje: Number(r.ivaPorcentaje) || 0,
    ivaModo: normalizeIvaModo(r.ivaModo),
    stockMaximo: r.stockMaximo == null ? null : Number(r.stockMaximo),
    stockMinimo: r.stockMinimo == null ? null : Number(r.stockMinimo),
    activo: Boolean(r.activo),
    existenciasTotal: Number(r.existenciasTotal) || 0
  }))
}

export function createProducto(viewerUserId: string, input: CreateProductoInput): { id: string } {
  requireAdmin(viewerUserId)

  const codigo = (input.codigo ?? '').trim()
  const nombre = (input.nombre ?? '').trim()
  if (!codigo) throw new Error('Código requerido')
  if (!nombre) throw new Error('Nombre requerido')
  if (!Number.isFinite(input.precio) || input.precio < 0) {
    throw new Error('Precio inválido')
  }
  const costo = Number.isFinite(input.costo as number) && (input.costo as number) >= 0
    ? Number(input.costo)
    : 0
  if (!VALID_IVA_MODOS.includes(input.ivaModo)) {
    throw new Error(`Modo de IVA inválido: ${input.ivaModo}`)
  }
  const ivaPorcentaje =
    input.ivaModo === 'exento'
      ? 0
      : Math.max(0, Math.min(100, Math.round(Number(input.ivaPorcentaje) || 0)))

  const sqlite = getSqlite()
  const exists = sqlite.prepare('SELECT 1 FROM producto WHERE codigo = ?').get(codigo)
  if (exists) throw new Error(`Ya existe un producto con código "${codigo}"`)

  const id = randomUUID()
  const now = Date.now()
  sqlite
    .prepare(
      `INSERT INTO producto
         (id, codigo, nombre, sustancia_activa, descripcion, laboratorio,
          precio, costo, iva_porcentaje, iva_modo, stock_maximo, stock_minimo,
          activo, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
    .run(
      id,
      codigo,
      nombre,
      nullableTrim(input.sustanciaActiva),
      nullableTrim(input.descripcion),
      nullableTrim(input.laboratorio),
      Number(input.precio),
      costo,
      ivaPorcentaje,
      input.ivaModo,
      nullableInt(input.stockMaximo) ?? 0,
      nullableInt(input.stockMinimo) ?? 0,
      now
    )

  return { id }
}

/**
 * Actualiza datos catálogo del producto: codigo, nombre, sustancia, descripción,
 * laboratorio, costo, stock min/max. NO modifica precio ni IVA (esos viven en
 * sus propios módulos con audit). NO modifica `activo` (toggleActivoProducto).
 */
export function updateProductoBasico(
  viewerUserId: string,
  input: UpdateProductoInput
): { ok: true } {
  requireAdmin(viewerUserId)
  if (!input.id) throw new Error('ID requerido')

  const codigo = (input.codigo ?? '').trim()
  const nombre = (input.nombre ?? '').trim()
  if (!codigo) throw new Error('Código requerido')
  if (!nombre) throw new Error('Nombre requerido')

  const sqlite = getSqlite()
  const current = sqlite
    .prepare('SELECT id FROM producto WHERE id = ?')
    .get(input.id) as { id: string } | undefined
  if (!current) throw new Error('Producto no encontrado')

  const dupe = sqlite
    .prepare('SELECT id FROM producto WHERE codigo = ? AND id <> ?')
    .get(codigo, input.id) as { id: string } | undefined
  if (dupe) throw new Error(`Ya existe otro producto con código "${codigo}"`)

  const costo =
    input.costo != null && Number.isFinite(input.costo) && input.costo >= 0
      ? Number(input.costo)
      : null

  const now = Date.now()
  sqlite
    .prepare(
      `UPDATE producto
          SET codigo = ?, nombre = ?, sustancia_activa = ?, descripcion = ?,
              laboratorio = ?,
              costo = COALESCE(?, costo),
              stock_maximo = ?, stock_minimo = ?,
              updated_at = ?
        WHERE id = ?`
    )
    .run(
      codigo,
      nombre,
      nullableTrim(input.sustanciaActiva),
      nullableTrim(input.descripcion),
      nullableTrim(input.laboratorio),
      costo,
      nullableInt(input.stockMaximo) ?? 0,
      nullableInt(input.stockMinimo) ?? 0,
      now,
      input.id
    )

  return { ok: true }
}

export function toggleActivoProducto(
  viewerUserId: string,
  productoId: string,
  activo: boolean
): { ok: true } {
  requireAdmin(viewerUserId)
  const sqlite = getSqlite()
  const target = sqlite.prepare('SELECT id FROM producto WHERE id = ?').get(productoId) as
    | { id: string }
    | undefined
  if (!target) throw new Error('Producto no encontrado')
  sqlite
    .prepare('UPDATE producto SET activo = ?, updated_at = ? WHERE id = ?')
    .run(activo ? 1 : 0, Date.now(), productoId)
  return { ok: true }
}
