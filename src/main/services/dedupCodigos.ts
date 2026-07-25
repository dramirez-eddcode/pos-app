import { getSqlite } from '../db/connection'
import { requireAdminOrSupervisor } from './permisos'
import type { DedupApplyResult, DedupParItem, DedupPreviewResult } from '@shared/dto'

/**
 * Fusión de productos duplicados por CERO INICIAL en el código.
 *
 * El sistema legacy pierde los ceros iniciales del EAN (Access guarda el
 * código como número), así que el catálogo termina con pares del mismo
 * producto: "0780083140588" y "780083140588". El precio se actualiza en uno
 * y las existencias viven en el otro.
 *
 * Regla de fusión (determinística, para que matriz y sucursales converjan):
 *   - QUEDA el código CORTO (sin ceros iniciales — como lo maneja el legacy y
 *     los procesos del negocio). La búsqueda por código tolera el cero
 *     inicial (productos.getByCodigo), así el escáner que lee el EAN completo
 *     sigue encontrando el producto.
 *   - Los lotes del duplicado se REAPUNTAN al que queda (las existencias se
 *     suman moviéndolas, nunca se alteran cantidades).
 *   - El historial (renglones de venta, histórico de precios, overrides por
 *     sucursal) también se reapunta — nada se pierde.
 *   - PRECIO final = el MÁS ALTO del par. Nombre/sustancia = los del producto
 *     actualizado más recientemente.
 *   - El duplicado se ELIMINA del catálogo (ya sin referencias).
 *
 * Se puede correr en MATRIZ y en cada SUCURSAL (el stock es local en cada
 * equipo): mismo criterio → mismo resultado. Idempotente: correrla de nuevo
 * sin duplicados nuevos no hace nada.
 */

interface ProdRow {
  id: string
  codigo: string
  nombre: string
  sustanciaActiva: string | null
  precio: number
  costo: number
  activo: number
  updatedAt: number
}

/** Grupos de productos cuyo código sólo difiere en ceros iniciales. */
function gruposDuplicados(): ProdRow[][] {
  const sqlite = getSqlite()
  const rows = sqlite
    .prepare(
      `SELECT id, codigo, nombre,
              sustancia_activa AS sustanciaActiva,
              precio, costo, activo,
              updated_at AS updatedAt
         FROM producto
        WHERE codigo <> ''
          AND codigo NOT GLOB '*[^0-9]*'
          AND LTRIM(codigo, '0') <> ''
          AND LTRIM(codigo, '0') IN (
            SELECT LTRIM(codigo, '0')
              FROM producto
             WHERE codigo <> '' AND codigo NOT GLOB '*[^0-9]*'
             GROUP BY LTRIM(codigo, '0')
            HAVING COUNT(*) > 1
          )
        ORDER BY LTRIM(codigo, '0'), LENGTH(codigo) ASC, codigo ASC`
    )
    .all() as ProdRow[]

  const map = new Map<string, ProdRow[]>()
  for (const r of rows) {
    const key = r.codigo.replace(/^0+/, '')
    const g = map.get(key)
    if (g) g.push(r)
    else map.set(key, [r])
  }
  // El ORDER BY garantiza que el primero de cada grupo es el código CORTO
  // (sin ceros iniciales) — ése es el que queda.
  return [...map.values()].filter((g) => g.length > 1)
}

function existenciaDe(productoId: string): number {
  const row = getSqlite()
    .prepare('SELECT COALESCE(SUM(saldo), 0) AS s FROM caducidad_lote WHERE producto_id = ?')
    .get(productoId) as { s: number }
  return Number(row.s) || 0
}

export function previewDedupCodigos(viewerUserId: string): DedupPreviewResult {
  requireAdminOrSupervisor(viewerUserId)
  const pares: DedupParItem[] = []
  for (const grupo of gruposDuplicados()) {
    const queda = grupo[0]!
    const precioFinal = Math.max(...grupo.map((p) => Number(p.precio) || 0))
    for (const dup of grupo.slice(1)) {
      pares.push({
        codigoQueda: queda.codigo,
        codigoElimina: dup.codigo,
        nombre: queda.nombre,
        existenciaQueda: existenciaDe(queda.id),
        existenciaElimina: existenciaDe(dup.id),
        precioQueda: queda.precio,
        precioElimina: dup.precio,
        precioFinal
      })
    }
  }
  return { pares }
}

export function applyDedupCodigos(viewerUserId: string): DedupApplyResult {
  requireAdminOrSupervisor(viewerUserId)
  const sqlite = getSqlite()
  const grupos = gruposDuplicados()

  const updLotes = sqlite.prepare('UPDATE caducidad_lote SET producto_id = ? WHERE producto_id = ?')
  const updVentaItem = sqlite.prepare('UPDATE venta_item SET producto_id = ? WHERE producto_id = ?')
  const updPrecioHist = sqlite.prepare(
    'UPDATE precio_historico SET producto_id = ? WHERE producto_id = ?'
  )
  // Overrides por sucursal: se mueven al que queda; si ya tiene override para
  // esa sucursal, gana el suyo y el del duplicado se descarta.
  const updSucProd = sqlite.prepare(
    'UPDATE OR IGNORE sucursal_producto SET producto_id = ? WHERE producto_id = ?'
  )
  const delSucProd = sqlite.prepare('DELETE FROM sucursal_producto WHERE producto_id = ?')
  const delProducto = sqlite.prepare('DELETE FROM producto WHERE id = ?')
  const updSurvivor = sqlite.prepare(
    `UPDATE producto
        SET nombre = ?, sustancia_activa = ?, precio = ?, costo = ?, activo = 1, updated_at = ?
      WHERE id = ?`
  )

  let fusionados = 0
  let unidadesMovidas = 0

  const run = sqlite.transaction(() => {
    const now = Date.now()
    for (const grupo of grupos) {
      const queda = grupo[0]!
      const masReciente = grupo.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
      // Precio final: el MÁS ALTO del grupo (regla del negocio).
      const precioFinal = Math.max(...grupo.map((p) => Number(p.precio) || 0))
      for (const dup of grupo.slice(1)) {
        unidadesMovidas += existenciaDe(dup.id)
        updLotes.run(queda.id, dup.id)
        updVentaItem.run(queda.id, dup.id)
        updPrecioHist.run(queda.id, dup.id)
        updSucProd.run(queda.id, dup.id)
        delSucProd.run(dup.id)
        delProducto.run(dup.id)
        fusionados++
      }
      // Costo: conserva el del que queda salvo que no tuviera (0) y el más
      // reciente sí — típico cuando las entradas se registraron en el duplicado.
      const costo = queda.costo > 0 ? queda.costo : masReciente.costo
      updSurvivor.run(
        masReciente.nombre,
        masReciente.sustanciaActiva,
        precioFinal,
        costo,
        now,
        queda.id
      )
    }
  })

  run()
  return { fusionados, unidadesMovidas }
}
