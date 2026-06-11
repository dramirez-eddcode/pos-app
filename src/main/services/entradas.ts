import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../db/connection'
import { caducidadLote, movStock, producto } from '../db/schema'
import type { CreateEntradaInput, CreateEntradaResult, MovimientoLinea } from '@shared/dto'

/**
 * Registra una entrada de mercancía: por cada ítem crea un nuevo lote en
 * `caducidad_lote`, un registro en el journal `mov_stock` tipo=ENTRADA, y
 * actualiza `producto.costo` al más reciente (convención simple; más adelante
 * podemos guardar histórico de costos).
 *
 * Además deja un documento con folio en `movimiento` (tipo=ENTRADA) con las
 * líneas en JSON, para el historial de movimientos y su impresión en PDF.
 *
 * Todo dentro de una misma transacción — si falla un ítem, nada se persiste.
 */
export function createEntrada(input: CreateEntradaInput): CreateEntradaResult {
  const db = getDb()

  if (input.items.length === 0) throw new Error('Sin items para registrar')

  // Bodega destino: la indicada o, por robustez, la principal.
  const sqlite = getSqlite()
  const bodegaId = input.bodegaId || 'bodega-principal'
  const bodega = sqlite
    .prepare('SELECT id, nombre, activa FROM bodega WHERE id = ?')
    .get(bodegaId) as { id: string; nombre: string; activa: number } | undefined
  if (!bodega) throw new Error('Bodega destino no encontrada')
  if (!bodega.activa) throw new Error('La bodega destino está desactivada')

  const usuario = sqlite
    .prepare('SELECT nombre FROM usuario WHERE id = ?')
    .get(input.usuarioId) as { nombre: string } | undefined

  // Proveedores POR RENGLÓN (opcionales): se validan una vez por id y el
  // nombre queda denormalizado en cada línea del documento, así el historial
  // no depende de que sigan activos. A nivel documento se guarda el resumen
  // (un solo proveedor → su nombre; varios → nombres unidos).
  const selProveedor = sqlite.prepare('SELECT id, nombre FROM proveedor WHERE id = ?')
  const proveedoresCache = new Map<string, { id: string; nombre: string }>()
  const proveedorDe = (id: string | null | undefined): { id: string; nombre: string } | null => {
    if (!id) return null
    let p = proveedoresCache.get(id)
    if (!p) {
      p = selProveedor.get(id) as { id: string; nombre: string } | undefined
      if (!p) throw new Error('Proveedor no encontrado')
      proveedoresCache.set(id, p)
    }
    return p
  }

  const insMovimiento = sqlite.prepare(
    `INSERT INTO movimiento
       (folio, tipo, fecha, usuario_id, usuario_nombre, bodega_id, bodega_nombre,
        proveedor_id, proveedor_nombre, motivo, lineas, unidades, valor, items_json)
     VALUES (?, 'ENTRADA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  return db.transaction((tx) => {
    let lotesCreados = 0
    let unidadesIngresadas = 0
    let productosActualizados = 0
    let totalCosto = 0

    const now = Date.now()
    const nowDate = new Date(now)
    // Default caducidad si no se provee: hoy + 2 años
    const defaultCaducidad = new Date(nowDate.getFullYear() + 2, nowDate.getMonth(), nowDate.getDate())

    const lineas: MovimientoLinea[] = []

    for (const it of input.items) {
      const qty = Math.round(it.cantidad)
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`Cantidad inválida (${it.cantidad}) para "${it.nombre}"`)
      }
      if (!Number.isFinite(it.costo) || it.costo < 0) {
        throw new Error(`Costo inválido (${it.costo}) para "${it.nombre}"`)
      }

      const caducidad = it.fechaCaducidad ? new Date(it.fechaCaducidad) : defaultCaducidad
      const proveedorLinea = proveedorDe(it.proveedorId)

      const loteId = randomUUID()
      tx.insert(caducidadLote)
        .values({
          id: loteId,
          productoId: it.productoId,
          bodegaId,
          total: qty,
          saldo: qty,
          fechaCaducidad: caducidad,
          fechaEntrada: nowDate
        })
        .run()

      tx.insert(movStock)
        .values({
          id: randomUUID(),
          loteId,
          ventaItemId: null,
          tipo: 'ENTRADA',
          cantidad: qty,
          fecha: nowDate,
          motivo: input.motivo ?? `ENTRADA por ${input.usuarioId}`
        })
        .run()

      tx.update(producto)
        .set({ costo: it.costo, updatedAt: nowDate })
        .where(eq(producto.id, it.productoId))
        .run()

      lineas.push({
        codigo: it.codigo,
        nombre: it.nombre,
        cantidad: qty,
        costo: it.costo,
        caducidad: caducidad.toISOString().slice(0, 10),
        proveedor: proveedorLinea?.nombre ?? null
      })

      lotesCreados++
      unidadesIngresadas += qty
      productosActualizados++
      totalCosto += qty * it.costo
    }

    // Resumen de proveedores a nivel documento: un solo proveedor distinto →
    // id + nombre; varios → sólo los nombres unidos (sin id).
    const distintos = [...proveedoresCache.values()]
    const provId = distintos.length === 1 ? distintos[0]!.id : null
    const provNombre =
      distintos.length === 0 ? null : distintos.map((p) => p.nombre).join(', ')

    // Documento del historial — misma transacción (misma conexión SQLite).
    const movimientoId = randomUUID()
    insMovimiento.run(
      movimientoId,
      now,
      input.usuarioId,
      usuario?.nombre ?? null,
      bodega.id,
      bodega.nombre,
      provId,
      provNombre,
      input.motivo ?? null,
      lineas.length,
      unidadesIngresadas,
      +totalCosto.toFixed(2),
      JSON.stringify(lineas)
    )

    return {
      movimientoId,
      lotesCreados,
      unidadesIngresadas,
      productosActualizados,
      totalCosto: +totalCosto.toFixed(2)
    }
  })
}
