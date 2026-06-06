import { randomUUID } from 'node:crypto'
import { getSqlite } from '../db/connection'
import type { BodegaDto, CreateBodegaInput, UpdateBodegaInput } from '@shared/dto'

/**
 * Gestión de bodegas (almacenes lógicos de la matriz). El inventario se separa
 * por bodega (caducidad_lote.bodega_id). Siempre existe la "Bodega Principal"
 * (id 'bodega-principal'), que no se puede desactivar.
 *
 * Lectura (list) sin gate de rol — se usa en selectores (entradas). Las
 * mutaciones requieren ADMINISTRADOR/SUPERUSUARIO.
 */

const PRINCIPAL_ID = 'bodega-principal'

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

interface BodegaRow {
  id: string
  codigo: string
  nombre: string
  calle: string | null
  colonia: string | null
  ciudad: string | null
  estado: string | null
  esPrincipal: number
  activa: number
  existenciasTotal: number
  createdAt: number
  updatedAt: number
}

function rowToDto(r: BodegaRow): BodegaDto {
  return {
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    calle: r.calle,
    colonia: r.colonia,
    ciudad: r.ciudad,
    estado: r.estado,
    esPrincipal: Boolean(r.esPrincipal),
    activa: Boolean(r.activa),
    existenciasTotal: Number(r.existenciasTotal) || 0,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString()
  }
}

export function listBodegas(): BodegaDto[] {
  const sqlite = getSqlite()
  const rows = sqlite
    .prepare(
      `SELECT b.id, b.codigo, b.nombre, b.calle, b.colonia, b.ciudad, b.estado,
              b.es_principal AS esPrincipal,
              b.activa,
              b.created_at  AS createdAt,
              b.updated_at  AS updatedAt,
              COALESCE(
                (SELECT SUM(cl.saldo) FROM caducidad_lote cl WHERE cl.bodega_id = b.id),
                0
              ) AS existenciasTotal
         FROM bodega b
        ORDER BY b.es_principal DESC, b.activa DESC, b.nombre`
    )
    .all() as BodegaRow[]
  return rows.map(rowToDto)
}

export function createBodega(viewerUserId: string, input: CreateBodegaInput): { id: string } {
  requireAdmin(viewerUserId)
  const codigo = (input.codigo ?? '').trim()
  const nombre = (input.nombre ?? '').trim()
  if (!codigo) throw new Error('Código requerido')
  if (!nombre) throw new Error('Nombre requerido')

  const sqlite = getSqlite()
  const dupe = sqlite.prepare('SELECT 1 FROM bodega WHERE codigo = ?').get(codigo)
  if (dupe) throw new Error(`Ya existe una bodega con código "${codigo}"`)

  const id = randomUUID()
  const now = Date.now()
  sqlite
    .prepare(
      `INSERT INTO bodega
         (id, codigo, nombre, calle, colonia, ciudad, estado, es_principal, activa, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
    )
    .run(
      id,
      codigo,
      nombre,
      nullableTrim(input.calle),
      nullableTrim(input.colonia),
      nullableTrim(input.ciudad),
      nullableTrim(input.estado),
      now,
      now
    )
  return { id }
}

export function updateBodega(viewerUserId: string, input: UpdateBodegaInput): { ok: true } {
  requireAdmin(viewerUserId)
  if (!input.id) throw new Error('ID requerido')
  const codigo = (input.codigo ?? '').trim()
  const nombre = (input.nombre ?? '').trim()
  if (!codigo) throw new Error('Código requerido')
  if (!nombre) throw new Error('Nombre requerido')

  const sqlite = getSqlite()
  const current = sqlite.prepare('SELECT id FROM bodega WHERE id = ?').get(input.id) as
    | { id: string }
    | undefined
  if (!current) throw new Error('Bodega no encontrada')

  const dupe = sqlite
    .prepare('SELECT id FROM bodega WHERE codigo = ? AND id <> ?')
    .get(codigo, input.id) as { id: string } | undefined
  if (dupe) throw new Error(`Ya existe otra bodega con código "${codigo}"`)

  sqlite
    .prepare(
      `UPDATE bodega
          SET codigo = ?, nombre = ?, calle = ?, colonia = ?, ciudad = ?, estado = ?,
              updated_at = ?
        WHERE id = ?`
    )
    .run(
      codigo,
      nombre,
      nullableTrim(input.calle),
      nullableTrim(input.colonia),
      nullableTrim(input.ciudad),
      nullableTrim(input.estado),
      Date.now(),
      input.id
    )
  return { ok: true }
}

export function toggleActivaBodega(
  viewerUserId: string,
  bodegaId: string,
  activa: boolean
): { ok: true } {
  requireAdmin(viewerUserId)
  if (bodegaId === PRINCIPAL_ID && !activa) {
    throw new Error('La bodega principal no se puede desactivar')
  }
  const sqlite = getSqlite()
  const target = sqlite.prepare('SELECT id FROM bodega WHERE id = ?').get(bodegaId) as
    | { id: string }
    | undefined
  if (!target) throw new Error('Bodega no encontrada')
  sqlite
    .prepare('UPDATE bodega SET activa = ?, updated_at = ? WHERE id = ?')
    .run(activa ? 1 : 0, Date.now(), bodegaId)
  return { ok: true }
}
