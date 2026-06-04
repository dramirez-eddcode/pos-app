import { randomUUID } from 'node:crypto'
import { getSqlite } from '../db/connection'
import type { EmpresaDto, UpdateEmpresaInput } from '@shared/dto'

/**
 * Lectura y actualización de la fila única `empresa` (datos de la sucursal
 * local que aparecen en el header del ticket, corte y cancelaciones).
 *
 * Reglas:
 *   - Lectura: pública (no requiere admin; el ticket se imprime con cualquier rol).
 *   - Escritura: sólo ADMINISTRADOR o SUPERUSUARIO.
 *   - Si no hay fila previa, se inserta una con un nuevo UUID.
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

function requireField(label: string, value: string | undefined | null): string {
  const t = (value ?? '').trim()
  if (!t) throw new Error(`Campo requerido: ${label}`)
  return t
}

export function getEmpresa(): EmpresaDto | null {
  const sqlite = getSqlite()
  const row = sqlite
    .prepare(
      `SELECT id,
              nombre_comercial AS nombreComercial,
              razon_social     AS razonSocial,
              rfc, calle, colonia, ciudad, estado,
              sucursal_nombre  AS sucursalNombre
         FROM empresa
        LIMIT 1`
    )
    .get() as
    | {
        id: string
        nombreComercial: string
        razonSocial: string
        rfc: string | null
        calle: string | null
        colonia: string | null
        ciudad: string | null
        estado: string | null
        sucursalNombre: string
      }
    | undefined

  if (!row) return null
  return {
    id: row.id,
    nombreComercial: row.nombreComercial,
    razonSocial: row.razonSocial,
    rfc: row.rfc ?? null,
    calle: row.calle ?? null,
    colonia: row.colonia ?? null,
    ciudad: row.ciudad ?? null,
    estado: row.estado ?? null,
    sucursalNombre: row.sucursalNombre
  }
}

export function updateEmpresa(viewerUserId: string, input: UpdateEmpresaInput): EmpresaDto {
  requireAdmin(viewerUserId)

  const nombreComercial = requireField('Nombre comercial', input.nombreComercial)
  const razonSocial = requireField('Razón social', input.razonSocial)
  const sucursalNombre = requireField('Sucursal', input.sucursalNombre)
  const rfc = nullableTrim(input.rfc)
  const calle = nullableTrim(input.calle)
  const colonia = nullableTrim(input.colonia)
  const ciudad = nullableTrim(input.ciudad)
  const estado = nullableTrim(input.estado)

  const sqlite = getSqlite()
  const existing = sqlite.prepare('SELECT id FROM empresa LIMIT 1').get() as
    | { id: string }
    | undefined

  const now = Date.now()
  if (existing) {
    sqlite
      .prepare(
        `UPDATE empresa
            SET nombre_comercial = ?,
                razon_social = ?,
                rfc = ?,
                calle = ?,
                colonia = ?,
                ciudad = ?,
                estado = ?,
                sucursal_nombre = ?,
                updated_at = ?
          WHERE id = ?`
      )
      .run(
        nombreComercial,
        razonSocial,
        rfc,
        calle,
        colonia,
        ciudad,
        estado,
        sucursalNombre,
        now,
        existing.id
      )
  } else {
    sqlite
      .prepare(
        `INSERT INTO empresa
           (id, nombre_comercial, razon_social, rfc, calle, colonia, ciudad,
            estado, sucursal_nombre, owner_user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        nombreComercial,
        razonSocial,
        rfc,
        calle,
        colonia,
        ciudad,
        estado,
        sucursalNombre,
        viewerUserId,
        now
      )
  }

  const updated = getEmpresa()
  if (!updated) throw new Error('No se pudo persistir la sucursal')
  return updated
}
