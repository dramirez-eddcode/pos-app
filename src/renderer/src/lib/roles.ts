import type { SessionUser } from '@shared/dto'

/**
 * Formatea el rol normalizado (uppercase en DB) a un display amigable.
 */
export function formatRol(rol: string | null | undefined): string {
  if (!rol) return '—'
  const map: Record<string, string> = {
    ADMINISTRADOR: 'Administrador',
    CAJERO: 'Cajero',
    SUPERVISOR: 'Supervisor',
    SUPERUSUARIO: 'Superusuario'
  }
  return map[rol.toUpperCase()] ?? rol
}

/**
 * Roles que pueden operar procesos especiales (F10): entradas de mercancía,
 * ajustes de inventario, traspasos, cambios de precios.
 */
const ADMIN_ROLES = new Set(['ADMINISTRADOR', 'SUPERVISOR', 'SUPERUSUARIO'])

export function isAdminLike(user: Pick<SessionUser, 'rol'> | null | undefined): boolean {
  if (!user) return false
  return ADMIN_ROLES.has(user.rol.toUpperCase())
}
