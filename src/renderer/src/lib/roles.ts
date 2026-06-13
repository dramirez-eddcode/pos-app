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

/**
 * Administrador "completo": ADMINISTRADOR o SUPERUSUARIO. A diferencia de
 * isAdminLike, EXCLUYE al SUPERVISOR. Úsalo para acciones que el supervisor NO
 * debe hacer (respaldo, configuración, usuarios, datos de sucursal, salidas,
 * ajustes, generar traspasos, entradas). El supervisor de sucursal sólo puede
 * recibir traspasos y actualizar datos (catálogo, precios, IVA, .farma, .dat).
 */
export function isFullAdmin(user: Pick<SessionUser, 'rol'> | null | undefined): boolean {
  if (!user) return false
  const r = user.rol.toUpperCase()
  return r === 'ADMINISTRADOR' || r === 'SUPERUSUARIO'
}

export function isSupervisor(user: Pick<SessionUser, 'rol'> | null | undefined): boolean {
  if (!user) return false
  return user.rol.toUpperCase() === 'SUPERVISOR'
}
