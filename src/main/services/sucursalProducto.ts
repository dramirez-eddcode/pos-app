import { getSqlite } from '../db/connection'
import type {
  CatalogoSucursalItem,
  SetSucursalProductoInput
} from '@shared/dto'
import type { IvaModo } from '@shared/types'

/**
 * Overrides de producto por sucursal (sólo modo MATRIZ).
 *
 * Concepto: la tabla `producto` guarda el catálogo *global* (precio, IVA y
 * datos descriptivos). Una sucursal puede tener una fila en `sucursal_producto`
 * para alterar precio o IVA, o para marcar el producto como excluido (no
 * vende ese SKU). Si no hay fila → la sucursal hereda 100% del global.
 *
 * El "set" es idempotente: actualiza o crea la fila. Si todos los overrides
 * quedan en null y excluida=false, borra la fila (no tiene sentido tenerla).
 */

const VALID_IVA_MODOS: readonly IvaModo[] = ['exento', 'sumar', 'incluido'] as const

function normalizeIvaModo(raw: unknown): IvaModo {
  return VALID_IVA_MODOS.includes(raw as IvaModo) ? (raw as IvaModo) : 'exento'
}

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

/**
 * Catálogo efectivo para una sucursal: cada producto global + su override (si
 * existe), con los valores "efectivos" ya resueltos.
 */
export function getCatalogoSucursal(
  viewerUserId: string,
  sucursalId: string
): CatalogoSucursalItem[] {
  requireAdmin(viewerUserId)
  requireMatriz()
  const sqlite = getSqlite()

  const sucursal = sqlite
    .prepare('SELECT id FROM sucursal WHERE id = ?')
    .get(sucursalId) as { id: string } | undefined
  if (!sucursal) throw new Error('Sucursal no encontrada')

  const rows = sqlite
    .prepare(
      `SELECT p.id              AS productoId,
              p.codigo, p.nombre, p.laboratorio,
              p.precio           AS precioGlobal,
              p.iva_modo         AS ivaModoGlobal,
              p.iva_porcentaje   AS ivaPorcentajeGlobal,
              p.activo           AS activoGlobal,
              sp.precio_override AS precioOverride,
              sp.iva_modo_override AS ivaModoOverride,
              sp.iva_porcentaje_override AS ivaPorcentajeOverride,
              sp.excluida AS excluida
         FROM producto p
    LEFT JOIN sucursal_producto sp
           ON sp.producto_id = p.id AND sp.sucursal_id = ?
        WHERE p.activo = 1
        ORDER BY p.nombre`
    )
    .all(sucursalId) as Array<{
    productoId: string
    codigo: string
    nombre: string
    laboratorio: string | null
    precioGlobal: number
    ivaModoGlobal: string | null
    ivaPorcentajeGlobal: number
    activoGlobal: number
    precioOverride: number | null
    ivaModoOverride: string | null
    ivaPorcentajeOverride: number | null
    excluida: number | null
  }>

  return rows.map((r) => {
    const precioGlobal = Number(r.precioGlobal) || 0
    const ivaModoGlobal = normalizeIvaModo(r.ivaModoGlobal)
    const ivaPorcentajeGlobal = Number(r.ivaPorcentajeGlobal) || 0
    const excluida = Boolean(r.excluida)

    const hasOverride =
      r.precioOverride != null ||
      r.ivaModoOverride != null ||
      r.ivaPorcentajeOverride != null ||
      excluida

    const precioEfectivo = r.precioOverride != null ? Number(r.precioOverride) : precioGlobal
    const ivaModoEfectivo =
      r.ivaModoOverride != null ? normalizeIvaModo(r.ivaModoOverride) : ivaModoGlobal
    const ivaPorcentajeEfectivo =
      r.ivaPorcentajeOverride != null
        ? Number(r.ivaPorcentajeOverride)
        : ivaPorcentajeGlobal

    return {
      productoId: r.productoId,
      codigo: r.codigo,
      nombre: r.nombre,
      laboratorio: r.laboratorio,
      precioGlobal,
      ivaModoGlobal,
      ivaPorcentajeGlobal,
      override: hasOverride
        ? {
            precio: r.precioOverride != null ? Number(r.precioOverride) : null,
            ivaModo: r.ivaModoOverride != null ? normalizeIvaModo(r.ivaModoOverride) : null,
            ivaPorcentaje:
              r.ivaPorcentajeOverride != null ? Number(r.ivaPorcentajeOverride) : null,
            excluida
          }
        : null,
      precioEfectivo,
      ivaModoEfectivo,
      ivaPorcentajeEfectivo,
      aplica: !excluida
    }
  })
}

/**
 * Aplica un override. Pasar campos como `null` indica "quitar este override".
 * Si tras la operación todos los valores quedan en null y excluida=false, se
 * elimina la fila completa (vuelve al global puro).
 */
export function setSucursalProductoOverride(
  viewerUserId: string,
  input: SetSucursalProductoInput
): { ok: true } {
  requireAdmin(viewerUserId)
  requireMatriz()

  const sqlite = getSqlite()

  // Validaciones
  const sucursal = sqlite
    .prepare('SELECT id FROM sucursal WHERE id = ?')
    .get(input.sucursalId) as { id: string } | undefined
  if (!sucursal) throw new Error('Sucursal no encontrada')

  const producto = sqlite
    .prepare('SELECT id FROM producto WHERE id = ?')
    .get(input.productoId) as { id: string } | undefined
  if (!producto) throw new Error('Producto no encontrado')

  let precioOverride: number | null = null
  if (input.precio !== undefined) {
    if (input.precio === null) precioOverride = null
    else {
      if (!Number.isFinite(input.precio) || input.precio < 0) {
        throw new Error('Precio override inválido')
      }
      precioOverride = Number(input.precio)
    }
  }

  let ivaModoOverride: string | null = null
  if (input.ivaModo !== undefined) {
    if (input.ivaModo === null) ivaModoOverride = null
    else {
      if (!VALID_IVA_MODOS.includes(input.ivaModo)) {
        throw new Error(`Modo IVA inválido: ${input.ivaModo}`)
      }
      ivaModoOverride = input.ivaModo
    }
  }

  let ivaPorcentajeOverride: number | null = null
  if (input.ivaPorcentaje !== undefined) {
    if (input.ivaPorcentaje === null) ivaPorcentajeOverride = null
    else {
      const n = Math.round(Number(input.ivaPorcentaje))
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new Error('Porcentaje IVA override inválido (0–100)')
      }
      ivaPorcentajeOverride = n
    }
  }

  const excluida = Boolean(input.excluida)

  // Lee override actual para fusionar con el nuevo (campos no enviados conservan valor)
  const current = sqlite
    .prepare(
      `SELECT precio_override AS precioOverride,
              iva_modo_override AS ivaModoOverride,
              iva_porcentaje_override AS ivaPorcentajeOverride,
              excluida
         FROM sucursal_producto
        WHERE sucursal_id = ? AND producto_id = ?`
    )
    .get(input.sucursalId, input.productoId) as
    | {
        precioOverride: number | null
        ivaModoOverride: string | null
        ivaPorcentajeOverride: number | null
        excluida: number
      }
    | undefined

  // Si un campo no fue enviado en el input (undefined), conservar el actual.
  const finalPrecio =
    input.precio === undefined ? current?.precioOverride ?? null : precioOverride
  const finalIvaModo =
    input.ivaModo === undefined ? current?.ivaModoOverride ?? null : ivaModoOverride
  const finalIvaPct =
    input.ivaPorcentaje === undefined
      ? current?.ivaPorcentajeOverride ?? null
      : ivaPorcentajeOverride
  const finalExcluida = input.excluida === undefined ? Boolean(current?.excluida) : excluida

  const allEmpty =
    finalPrecio == null && finalIvaModo == null && finalIvaPct == null && !finalExcluida

  if (allEmpty) {
    sqlite
      .prepare('DELETE FROM sucursal_producto WHERE sucursal_id = ? AND producto_id = ?')
      .run(input.sucursalId, input.productoId)
    return { ok: true }
  }

  const now = Date.now()
  sqlite
    .prepare(
      `INSERT INTO sucursal_producto
         (sucursal_id, producto_id, precio_override, iva_modo_override,
          iva_porcentaje_override, excluida, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sucursal_id, producto_id) DO UPDATE SET
         precio_override = excluded.precio_override,
         iva_modo_override = excluded.iva_modo_override,
         iva_porcentaje_override = excluded.iva_porcentaje_override,
         excluida = excluded.excluida,
         updated_at = excluded.updated_at`
    )
    .run(
      input.sucursalId,
      input.productoId,
      finalPrecio,
      finalIvaModo,
      finalIvaPct,
      finalExcluida ? 1 : 0,
      now
    )

  return { ok: true }
}

export function clearSucursalProductoOverride(
  viewerUserId: string,
  sucursalId: string,
  productoId: string
): { ok: true } {
  requireAdmin(viewerUserId)
  requireMatriz()
  const sqlite = getSqlite()
  sqlite
    .prepare('DELETE FROM sucursal_producto WHERE sucursal_id = ? AND producto_id = ?')
    .run(sucursalId, productoId)
  return { ok: true }
}
