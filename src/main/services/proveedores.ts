import { randomUUID } from 'node:crypto'
import { getSqlite } from '../db/connection'
import type { CreateProveedorInput, ProveedorDto, UpdateProveedorInput } from '@shared/dto'

/**
 * Catálogo de proveedores de la matriz. Se vincula de forma OPCIONAL a las
 * entradas de mercancía (movimiento.proveedor_id/nombre) para dejar registrado
 * de quién llegó cada compra.
 *
 * Lectura (list) sin gate de rol — se usa en el selector de entradas. Las
 * mutaciones requieren ADMINISTRADOR/SUPERUSUARIO. No se borran: se desactivan
 * (las entradas históricas conservan el nombre denormalizado).
 */

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

interface ProveedorRow {
  id: string
  nombre: string
  rfc: string | null
  telefono: string | null
  email: string | null
  contacto: string | null
  notas: string | null
  activo: number
  createdAt: number
  updatedAt: number
}

function rowToDto(r: ProveedorRow): ProveedorDto {
  return {
    id: r.id,
    nombre: r.nombre,
    rfc: r.rfc,
    telefono: r.telefono,
    email: r.email,
    contacto: r.contacto,
    notas: r.notas,
    activo: Boolean(r.activo),
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString()
  }
}

export function listProveedores(): ProveedorDto[] {
  const rows = getSqlite()
    .prepare(
      `SELECT id, nombre, rfc, telefono, email, contacto, notas, activo,
              created_at AS createdAt,
              updated_at AS updatedAt
         FROM proveedor
        ORDER BY activo DESC, nombre`
    )
    .all() as ProveedorRow[]
  return rows.map(rowToDto)
}

export function createProveedor(
  viewerUserId: string,
  input: CreateProveedorInput
): { id: string } {
  requireAdmin(viewerUserId)
  const nombre = (input.nombre ?? '').trim()
  if (!nombre) throw new Error('Nombre requerido')

  const sqlite = getSqlite()
  const dupe = sqlite
    .prepare('SELECT 1 FROM proveedor WHERE nombre = ? COLLATE NOCASE')
    .get(nombre)
  if (dupe) throw new Error(`Ya existe un proveedor llamado "${nombre}"`)

  const id = randomUUID()
  const now = Date.now()
  sqlite
    .prepare(
      `INSERT INTO proveedor
         (id, nombre, rfc, telefono, email, contacto, notas, activo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      id,
      nombre,
      nullableTrim(input.rfc),
      nullableTrim(input.telefono),
      nullableTrim(input.email),
      nullableTrim(input.contacto),
      nullableTrim(input.notas),
      now,
      now
    )
  return { id }
}

export function updateProveedor(
  viewerUserId: string,
  input: UpdateProveedorInput
): { ok: true } {
  requireAdmin(viewerUserId)
  if (!input.id) throw new Error('ID requerido')
  const nombre = (input.nombre ?? '').trim()
  if (!nombre) throw new Error('Nombre requerido')

  const sqlite = getSqlite()
  const current = sqlite.prepare('SELECT id FROM proveedor WHERE id = ?').get(input.id) as
    | { id: string }
    | undefined
  if (!current) throw new Error('Proveedor no encontrado')

  const dupe = sqlite
    .prepare('SELECT id FROM proveedor WHERE nombre = ? COLLATE NOCASE AND id <> ?')
    .get(nombre, input.id) as { id: string } | undefined
  if (dupe) throw new Error(`Ya existe otro proveedor llamado "${nombre}"`)

  sqlite
    .prepare(
      `UPDATE proveedor
          SET nombre = ?, rfc = ?, telefono = ?, email = ?, contacto = ?, notas = ?,
              updated_at = ?
        WHERE id = ?`
    )
    .run(
      nombre,
      nullableTrim(input.rfc),
      nullableTrim(input.telefono),
      nullableTrim(input.email),
      nullableTrim(input.contacto),
      nullableTrim(input.notas),
      Date.now(),
      input.id
    )
  return { ok: true }
}

export function toggleActivoProveedor(
  viewerUserId: string,
  proveedorId: string,
  activo: boolean
): { ok: true } {
  requireAdmin(viewerUserId)
  const sqlite = getSqlite()
  const target = sqlite.prepare('SELECT id FROM proveedor WHERE id = ?').get(proveedorId) as
    | { id: string }
    | undefined
  if (!target) throw new Error('Proveedor no encontrado')
  sqlite
    .prepare('UPDATE proveedor SET activo = ?, updated_at = ? WHERE id = ?')
    .run(activo ? 1 : 0, Date.now(), proveedorId)
  return { ok: true }
}
