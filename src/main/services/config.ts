import { getSqlite } from '../db/connection'
import type { ConfigDto, UpdateConfigInput } from '@shared/dto'

/**
 * Config de negocio (fila única id=1). Por ahora sólo el IVA default que la
 * matriz usa como tasa sugerida al crear productos. A diferencia de los
 * settings de hardware (settings.json, por PC), esto vive en la DB y viaja por
 * USB a las sucursales.
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

function clampPorcentaje(value: unknown): number {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
}

export function getConfig(): ConfigDto {
  const sqlite = getSqlite()
  const row = sqlite
    .prepare('SELECT iva_porcentaje_default AS ivaPorcentajeDefault FROM config WHERE id = 1')
    .get() as { ivaPorcentajeDefault: number } | undefined
  return { ivaPorcentajeDefault: row ? clampPorcentaje(row.ivaPorcentajeDefault) : 16 }
}

export function updateConfig(viewerUserId: string, patch: UpdateConfigInput): ConfigDto {
  requireAdmin(viewerUserId)
  const sqlite = getSqlite()
  if (patch.ivaPorcentajeDefault != null) {
    const v = clampPorcentaje(patch.ivaPorcentajeDefault)
    sqlite
      .prepare(
        `INSERT INTO config (id, iva_porcentaje_default, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           iva_porcentaje_default = excluded.iva_porcentaje_default,
           updated_at = excluded.updated_at`
      )
      .run(v, Date.now())
  }
  return getConfig()
}
