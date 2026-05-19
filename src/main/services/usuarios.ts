import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getSqlite } from '../db/connection'
import type { CreateUsuarioInput, UsuarioListItem } from '@shared/dto'

/**
 * Gestión mínima de usuarios local (Opción A del plan previo). Alcance:
 *   - Listar usuarios gestionables según rol del que consulta
 *   - Crear usuario
 *   - Resetear password
 *   - Activar/desactivar (soft delete)
 *
 * Reglas de acceso:
 *   - Cajero / Supervisor: sin acceso a este módulo.
 *   - Administrador: solo puede ver/crear/modificar CAJEROS.
 *   - Superusuario: puede con cualquier rol.
 *   - Nadie puede desactivarse a sí mismo (anti-lockout).
 *
 * Seguridad: todos los métodos reciben el `viewerUserId` y verifican su rol
 * contra DB (no se confía en el renderer).
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

function requireAdmin(viewerUserId: string): string {
  const rol = rolOf(viewerUserId)
  if (!rol) throw new Error('Usuario no identificado')
  if (rol !== 'ADMINISTRADOR' && rol !== 'SUPERUSUARIO') {
    throw new Error('Requiere permisos de administrador')
  }
  return rol
}

function canManageRole(viewerRol: string, targetRol: string): boolean {
  if (viewerRol === 'SUPERUSUARIO') return true
  if (viewerRol === 'ADMINISTRADOR') return targetRol === 'CAJERO'
  return false
}

export function listUsuarios(viewerUserId: string): UsuarioListItem[] {
  const viewerRol = requireAdmin(viewerUserId)
  const sqlite = getSqlite()

  const sql =
    viewerRol === 'SUPERUSUARIO'
      ? `SELECT u.id, u.login, u.nombre, u.activo, u.puede_cancelar AS puedeCancelar,
                u.created_at AS createdAt, t.nombre AS rol
           FROM usuario u
           JOIN tipo_usuario t ON t.id = u.tipo_usuario_id
          ORDER BY CASE t.nombre
                     WHEN 'SUPERUSUARIO' THEN 1
                     WHEN 'ADMINISTRADOR' THEN 2
                     WHEN 'SUPERVISOR' THEN 3
                     WHEN 'CAJERO' THEN 4
                     ELSE 5 END, u.login`
      : `SELECT u.id, u.login, u.nombre, u.activo, u.puede_cancelar AS puedeCancelar,
                u.created_at AS createdAt, t.nombre AS rol
           FROM usuario u
           JOIN tipo_usuario t ON t.id = u.tipo_usuario_id
          WHERE t.nombre = 'CAJERO'
          ORDER BY u.login`

  const rows = sqlite.prepare(sql).all() as Array<{
    id: string
    login: string
    nombre: string
    activo: number
    puedeCancelar: number
    createdAt: number
    rol: string
  }>
  return rows.map((r) => ({
    id: r.id,
    login: r.login,
    nombre: r.nombre,
    rol: r.rol,
    activo: Boolean(r.activo),
    puedeCancelar: Boolean(r.puedeCancelar),
    createdAt: new Date(r.createdAt).toISOString()
  }))
}

export function createUsuario(
  creatorUserId: string,
  input: CreateUsuarioInput
): { id: string } {
  const viewerRol = requireAdmin(creatorUserId)
  if (!canManageRole(viewerRol, input.rol)) {
    throw new Error(`Un ${viewerRol} no puede crear usuarios con rol ${input.rol}`)
  }

  const login = (input.login ?? '').trim().toLowerCase()
  const nombre = (input.nombre ?? '').trim()
  const password = input.password ?? ''
  if (!login) throw new Error('Login requerido')
  if (!/^[a-z0-9._-]+$/i.test(login)) {
    throw new Error('Login solo puede tener letras, números y . _ -')
  }
  if (!nombre) throw new Error('Nombre requerido')
  if (password.length < 3) throw new Error('Password muy corto (mínimo 3 caracteres)')

  const sqlite = getSqlite()
  const exists = sqlite.prepare('SELECT 1 FROM usuario WHERE login = ?').get(login)
  if (exists) throw new Error(`El login "${login}" ya existe`)

  const tipo = sqlite
    .prepare('SELECT id FROM tipo_usuario WHERE nombre = ?')
    .get(input.rol) as { id: number } | undefined
  if (!tipo) throw new Error(`Rol inválido: ${input.rol}`)

  const id = randomUUID()
  const hash = bcrypt.hashSync(password, 10)
  sqlite
    .prepare(
      `INSERT INTO usuario (id, login, password_hash, nombre, tipo_usuario_id,
                            activo, puede_cancelar, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(id, login, hash, nombre, tipo.id, input.puedeCancelar ? 1 : 0, Date.now())

  return { id }
}

export function resetPassword(
  resetterUserId: string,
  targetUserId: string,
  newPassword: string
): void {
  const viewerRol = requireAdmin(resetterUserId)
  if (!newPassword || newPassword.length < 3) {
    throw new Error('Password muy corto (mínimo 3 caracteres)')
  }

  const sqlite = getSqlite()
  const target = sqlite
    .prepare(
      `SELECT u.id, t.nombre AS rol
         FROM usuario u
         JOIN tipo_usuario t ON t.id = u.tipo_usuario_id
        WHERE u.id = ?`
    )
    .get(targetUserId) as { id: string; rol: string } | undefined
  if (!target) throw new Error('Usuario no encontrado')

  if (!canManageRole(viewerRol, target.rol)) {
    throw new Error(`Un ${viewerRol} no puede modificar usuarios con rol ${target.rol}`)
  }

  const hash = bcrypt.hashSync(newPassword, 10)
  sqlite.prepare('UPDATE usuario SET password_hash = ? WHERE id = ?').run(hash, targetUserId)
}

export function toggleActivoUsuario(
  viewerUserId: string,
  targetUserId: string,
  activo: boolean
): void {
  const viewerRol = requireAdmin(viewerUserId)
  if (viewerUserId === targetUserId) {
    throw new Error('No puedes cambiar tu propio estado activo')
  }

  const sqlite = getSqlite()
  const target = sqlite
    .prepare(
      `SELECT u.id, t.nombre AS rol
         FROM usuario u
         JOIN tipo_usuario t ON t.id = u.tipo_usuario_id
        WHERE u.id = ?`
    )
    .get(targetUserId) as { id: string; rol: string } | undefined
  if (!target) throw new Error('Usuario no encontrado')

  if (!canManageRole(viewerRol, target.rol)) {
    throw new Error(`Un ${viewerRol} no puede modificar usuarios con rol ${target.rol}`)
  }

  sqlite.prepare('UPDATE usuario SET activo = ? WHERE id = ?').run(activo ? 1 : 0, targetUserId)
}
