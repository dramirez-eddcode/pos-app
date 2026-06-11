import { randomUUID } from 'node:crypto'
import { getSqlite } from '../db/connection'
import type {
  CreateSucursalInput,
  SucursalDto,
  UpdateSucursalInput
} from '@shared/dto'

/**
 * CRUD de sucursales — sólo disponible en modo MATRIZ. En modo SUCURSAL la
 * tabla `sucursal` tiene 1 fila (la local), creada por el wizard, y no se toca
 * desde este servicio.
 *
 * Permisos:
 *   - Lectura: cualquier admin (validado en cada caller)
 *   - Escritura: ADMINISTRADOR / SUPERUSUARIO
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

function requireMatriz(): void {
  const sqlite = getSqlite()
  const row = sqlite
    .prepare(`SELECT tipo FROM instalacion WHERE id = 1`)
    .get() as { tipo: string } | undefined
  if (!row || row.tipo !== 'MATRIZ') {
    throw new Error('Esta operación sólo está disponible en modo MATRIZ')
  }
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value == null) return null
  const t = String(value).trim()
  return t.length === 0 ? null : t
}

function requireField(label: string, value: string | undefined | null): string {
  const t = (value ?? '').trim()
  if (!t) throw new Error(`Campo requerido: ${label}`)
  return t
}

function rowToDto(r: {
  id: string
  codigo: string
  nombre: string
  razonSocial: string | null
  rfc: string | null
  calle: string | null
  colonia: string | null
  cp: string | null
  ciudad: string | null
  estado: string | null
  activa: number
  createdAt: number
  updatedAt: number
}): SucursalDto {
  return {
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    razonSocial: r.razonSocial,
    rfc: r.rfc,
    calle: r.calle,
    colonia: r.colonia,
    cp: r.cp,
    ciudad: r.ciudad,
    estado: r.estado,
    activa: Boolean(r.activa),
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString()
  }
}

export function listSucursales(viewerUserId: string): SucursalDto[] {
  requireAdmin(viewerUserId)
  requireMatriz()
  const sqlite = getSqlite()
  const rows = sqlite
    .prepare(
      `SELECT id, codigo, nombre,
              razon_social AS razonSocial,
              rfc, calle, colonia, cp, ciudad, estado, activa,
              created_at   AS createdAt,
              updated_at   AS updatedAt
         FROM sucursal
        ORDER BY activa DESC, codigo`
    )
    .all() as Array<{
    id: string
    codigo: string
    nombre: string
    razonSocial: string | null
    rfc: string | null
    calle: string | null
    colonia: string | null
    cp: string | null
    ciudad: string | null
    estado: string | null
    activa: number
    createdAt: number
    updatedAt: number
  }>
  return rows.map(rowToDto)
}

export function createSucursal(
  viewerUserId: string,
  input: CreateSucursalInput
): { id: string } {
  requireAdmin(viewerUserId)
  requireMatriz()

  const codigo = requireField('Código', input.codigo).toUpperCase()
  const nombre = requireField('Nombre', input.nombre)

  const sqlite = getSqlite()
  const dupe = sqlite.prepare('SELECT 1 FROM sucursal WHERE codigo = ?').get(codigo)
  if (dupe) throw new Error(`Ya existe una sucursal con código "${codigo}"`)

  const id = randomUUID()
  const now = Date.now()
  sqlite
    .prepare(
      `INSERT INTO sucursal
         (id, codigo, nombre, razon_social, rfc, calle, colonia, cp, ciudad, estado,
          activa, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      id,
      codigo,
      nombre,
      trimOrNull(input.razonSocial),
      trimOrNull(input.rfc),
      trimOrNull(input.calle),
      trimOrNull(input.colonia),
      trimOrNull(input.cp),
      trimOrNull(input.ciudad),
      trimOrNull(input.estado),
      now,
      now
    )
  return { id }
}

export function updateSucursal(viewerUserId: string, input: UpdateSucursalInput): { ok: true } {
  requireAdmin(viewerUserId)
  requireMatriz()
  if (!input.id) throw new Error('ID requerido')

  const codigo = requireField('Código', input.codigo).toUpperCase()
  const nombre = requireField('Nombre', input.nombre)

  const sqlite = getSqlite()
  const target = sqlite.prepare('SELECT id FROM sucursal WHERE id = ?').get(input.id) as
    | { id: string }
    | undefined
  if (!target) throw new Error('Sucursal no encontrada')

  const dupe = sqlite
    .prepare('SELECT 1 FROM sucursal WHERE codigo = ? AND id <> ?')
    .get(codigo, input.id)
  if (dupe) throw new Error(`Ya existe otra sucursal con código "${codigo}"`)

  const now = Date.now()
  sqlite
    .prepare(
      `UPDATE sucursal
          SET codigo = ?, nombre = ?, razon_social = ?, rfc = ?,
              calle = ?, colonia = ?, cp = ?, ciudad = ?, estado = ?,
              updated_at = ?
        WHERE id = ?`
    )
    .run(
      codigo,
      nombre,
      trimOrNull(input.razonSocial),
      trimOrNull(input.rfc),
      trimOrNull(input.calle),
      trimOrNull(input.colonia),
      trimOrNull(input.cp),
      trimOrNull(input.ciudad),
      trimOrNull(input.estado),
      now,
      input.id
    )
  return { ok: true }
}

export function toggleActivaSucursal(
  viewerUserId: string,
  sucursalId: string,
  activa: boolean
): { ok: true } {
  requireAdmin(viewerUserId)
  requireMatriz()
  const sqlite = getSqlite()
  const target = sqlite.prepare('SELECT id FROM sucursal WHERE id = ?').get(sucursalId) as
    | { id: string }
    | undefined
  if (!target) throw new Error('Sucursal no encontrada')
  sqlite
    .prepare('UPDATE sucursal SET activa = ?, updated_at = ? WHERE id = ?')
    .run(activa ? 1 : 0, Date.now(), sucursalId)
  return { ok: true }
}
