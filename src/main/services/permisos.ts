import { getSqlite } from '../db/connection'

/**
 * Helpers de autorización por rol, compartidos entre servicios.
 *
 * Roles: SUPERUSUARIO, ADMINISTRADOR, SUPERVISOR, CAJERO.
 *
 *  - requireAdmin: sólo ADMINISTRADOR y SUPERUSUARIO (operaciones sensibles:
 *    generar traspasos, salidas, ajustes, usuarios, datos de empresa, etc.).
 *  - requireAdminOrSupervisor: ADMINISTRADOR/SUPERUSUARIO en cualquier modo, y
 *    SUPERVISOR sólo en instalaciones tipo SUCURSAL. Es lo que un supervisor de
 *    sucursal puede hacer: recibir traspasos, aplicar actualizaciones de la
 *    matriz (.farma) o del legacy (.dat), editar catálogo, precios e IVA.
 */

export function rolDeUsuario(userId: string): string | null {
  const row = getSqlite()
    .prepare(
      `SELECT t.nombre
         FROM usuario u
         JOIN tipo_usuario t ON t.id = u.tipo_usuario_id
        WHERE u.id = ?`
    )
    .get(userId) as { nombre: string } | undefined
  return row?.nombre ?? null
}

export function modoInstalacion(): string | null {
  const row = getSqlite().prepare('SELECT tipo FROM instalacion WHERE id = 1').get() as
    | { tipo: string }
    | undefined
  return row?.tipo ?? null
}

export function requireAdmin(userId: string): void {
  const rol = rolDeUsuario(userId)
  if (!rol) throw new Error('Usuario no identificado')
  if (rol !== 'ADMINISTRADOR' && rol !== 'SUPERUSUARIO') {
    throw new Error('Requiere permisos de administrador')
  }
}

export function requireAdminOrSupervisor(userId: string): void {
  const rol = rolDeUsuario(userId)
  if (!rol) throw new Error('Usuario no identificado')
  if (rol === 'ADMINISTRADOR' || rol === 'SUPERUSUARIO') return
  if (rol === 'SUPERVISOR' && modoInstalacion() === 'SUCURSAL') return
  throw new Error('Requiere permisos de administrador o supervisor')
}
