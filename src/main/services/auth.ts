import { eq, and } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { getDb } from '../db/connection'
import { usuario, tipoUsuario, empresa } from '../db/schema'
import type { LoginResult, SessionUser } from '@shared/dto'

export async function login(loginName: string, password: string): Promise<LoginResult> {
  const db = getDb()
  const trimmed = loginName.trim()
  if (!trimmed || !password) return { ok: false, error: 'Usuario y contraseña son requeridos' }

  const rows = db
    .select({
      id: usuario.id,
      login: usuario.login,
      passwordHash: usuario.passwordHash,
      nombre: usuario.nombre,
      tipoUsuarioId: usuario.tipoUsuarioId,
      activo: usuario.activo,
      puedeCancelar: usuario.puedeCancelar,
      rol: tipoUsuario.nombre
    })
    .from(usuario)
    .leftJoin(tipoUsuario, eq(tipoUsuario.id, usuario.tipoUsuarioId))
    .where(and(eq(usuario.login, trimmed), eq(usuario.activo, true)))
    .all()

  const u = rows[0]
  if (!u) return { ok: false, error: 'Usuario o contraseña incorrectos' }

  const ok = bcrypt.compareSync(password, u.passwordHash)
  if (!ok) return { ok: false, error: 'Usuario o contraseña incorrectos' }

  const emp = db.select().from(empresa).all()[0]

  const session: SessionUser = {
    id: u.id,
    login: u.login,
    nombre: u.nombre,
    tipoUsuarioId: u.tipoUsuarioId,
    rol: u.rol ?? 'DESCONOCIDO',
    puedeCancelar: u.puedeCancelar,
    sucursal: emp
      ? {
          id: emp.id,
          nombreComercial: emp.nombreComercial,
          razonSocial: emp.razonSocial,
          sucursalNombre: emp.sucursalNombre,
          rfc: emp.rfc ?? null,
          calle: emp.calle ?? null,
          colonia: emp.colonia ?? null,
          ciudad: emp.ciudad ?? null,
          estado: emp.estado ?? null
        }
      : null
  }
  return { ok: true, user: session }
}
