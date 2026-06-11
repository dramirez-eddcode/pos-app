import { randomUUID } from 'node:crypto'
import { getSqlite } from '../db/connection'
import type { CreateSalidaInput, CreateSalidaResult, MovimientoLinea } from '@shared/dto'

/**
 * Registra salidas de inventario (equivalente al "Registro de Salidas" del
 * legacy). Cada item resta una cantidad específica del saldo del lote, con
 * un motivo (caducidad, merma, traspaso, muestra, ajuste, otro).
 *
 * Se diferencia de Ajustes de inventario en la semántica de captura:
 *  - Ajustes: "el nuevo saldo es X" (computa delta automáticamente)
 *  - Salidas: "salieron N unidades" (captura directa del delta negativo)
 *
 * Todas las líneas deben salir de la MISMA bodega (si `input.bodegaId` viene,
 * se valida contra ella). Además del journal, deja un documento con folio en
 * `movimiento` (tipo=SALIDA) para el historial y su impresión en PDF.
 *
 * Todo dentro de una transacción. mov_stock recibe tipo=SALIDA con cantidad
 * negativa (delta aplicado al lote).
 */
export function createSalida(input: CreateSalidaInput): CreateSalidaResult {
  const sqlite = getSqlite()

  if (input.items.length === 0) throw new Error('Sin salidas a registrar')

  const usuario = sqlite
    .prepare('SELECT nombre FROM usuario WHERE id = ?')
    .get(input.cajeroId) as { nombre: string } | undefined

  const run = sqlite.transaction(() => {
    let itemsCreados = 0
    let unidadesTotales = 0
    let valorTotal = 0
    const now = Date.now()

    const getLote = sqlite.prepare(
      `SELECT cl.id, cl.saldo, cl.bodega_id AS bodegaId,
              cl.fecha_caducidad AS fechaCaducidad,
              p.codigo, p.nombre, p.costo
         FROM caducidad_lote cl
         JOIN producto p ON p.id = cl.producto_id
        WHERE cl.id = ?`
    )
    const updLote = sqlite.prepare('UPDATE caducidad_lote SET saldo = ? WHERE id = ?')
    const insMov = sqlite.prepare(
      `INSERT INTO mov_stock (id, lote_id, venta_item_id, tipo, cantidad, fecha, motivo)
       VALUES (?, ?, NULL, 'SALIDA', ?, ?, ?)`
    )

    const lineas: MovimientoLinea[] = []
    const motivos = new Set<string>()
    let bodegaId: string | null = input.bodegaId ?? null

    for (const it of input.items) {
      const qty = Math.round(it.cantidad)
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`Cantidad inválida (${it.cantidad}) para ${it.productoNombre}`)
      }

      const lote = getLote.get(it.loteId) as
        | {
            id: string
            saldo: number
            bodegaId: string | null
            fechaCaducidad: number
            codigo: string
            nombre: string
            costo: number
          }
        | undefined
      if (!lote) throw new Error(`Lote ${it.loteId} no encontrado`)
      if (qty > lote.saldo) {
        throw new Error(
          `"${it.productoNombre}" — el lote solo tiene ${lote.saldo}, se quieren sacar ${qty}`
        )
      }

      // Una salida es un documento de UNA bodega; no se mezclan lotes de varias.
      if (bodegaId == null) bodegaId = lote.bodegaId
      else if (lote.bodegaId !== bodegaId) {
        throw new Error(`"${it.productoNombre}" — el lote no pertenece a la bodega de la salida`)
      }

      const nuevoSaldo = lote.saldo - qty
      updLote.run(nuevoSaldo, lote.id)

      const motivoTexto = it.nota && it.nota.trim() ? `${it.motivo}: ${it.nota.trim()}` : it.motivo
      insMov.run(randomUUID(), lote.id, -qty, now, `${motivoTexto} por ${input.cajeroId}`)

      const costo = Number(lote.costo) || 0
      lineas.push({
        codigo: lote.codigo,
        nombre: lote.nombre,
        cantidad: qty,
        costo,
        caducidad: new Date(Number(lote.fechaCaducidad)).toISOString().slice(0, 10),
        motivo: motivoTexto
      })
      motivos.add(it.motivo)

      itemsCreados++
      unidadesTotales += qty
      valorTotal += qty * costo
    }

    const bodega = bodegaId
      ? (sqlite.prepare('SELECT nombre FROM bodega WHERE id = ?').get(bodegaId) as
          | { nombre: string }
          | undefined)
      : undefined

    // Documento del historial (misma transacción).
    const movimientoId = randomUUID()
    sqlite
      .prepare(
        `INSERT INTO movimiento
           (folio, tipo, fecha, usuario_id, usuario_nombre, bodega_id, bodega_nombre,
            motivo, lineas, unidades, valor, items_json)
         VALUES (?, 'SALIDA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        movimientoId,
        now,
        input.cajeroId,
        usuario?.nombre ?? null,
        bodegaId,
        bodega?.nombre ?? null,
        [...motivos].join(', '),
        lineas.length,
        unidadesTotales,
        +valorTotal.toFixed(2),
        JSON.stringify(lineas)
      )

    return { movimientoId, itemsCreados, unidadesTotales }
  })

  return run()
}
