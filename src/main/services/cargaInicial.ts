import { randomUUID } from 'node:crypto'
import { getSqlite } from '../db/connection'
import type { CargaInicialInput, CargaInicialResult } from '@shared/dto'

/**
 * Carga inicial de inventario (migración / arranque de sucursal).
 *
 * IDEMPOTENTE: por cada (código, caducidad) FIJA el saldo del lote al valor
 * indicado en vez de sumarlo. Re-ejecutar el mismo CSV deja el inventario igual
 * (no duplica). Cada cambio deja registro en `mov_stock` (auditable):
 *   - lote nuevo            → ENTRADA  (+cantidad)
 *   - lote existente ajustado → AJUSTE (delta = nuevo - anterior)
 *   - reemplazo (saldo→0)   → AJUSTE  (-saldo previo)
 *
 * Con `reemplazarBodega = true`, los lotes de la bodega que NO vengan en el CSV
 * se ponen en saldo 0 (la bodega queda EXACTAMENTE como el CSV).
 */

// Lote "sin caducidad": fecha sentinel fija para que el matcheo sea estable.
const SIN_CADUCIDAD_MS = Date.UTC(2099, 11, 31)

function caducidadToMs(ymd: string | null | undefined): number {
  const s = (ymd ?? '').trim()
  if (!s) return SIN_CADUCIDAD_MS
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return SIN_CADUCIDAD_MS
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(ms) ? ms : SIN_CADUCIDAD_MS
}

interface LoteRow {
  id: string
  total: number
  saldo: number
}

export function cargaInicialInventario(input: CargaInicialInput): CargaInicialResult {
  const sqlite = getSqlite()
  if (!input.items || input.items.length === 0) throw new Error('Sin items para cargar')

  const bodegaId = input.bodegaId || 'bodega-principal'
  const bodega = sqlite.prepare('SELECT id, activa FROM bodega WHERE id = ?').get(bodegaId) as
    | { id: string; activa: number }
    | undefined
  if (!bodega) throw new Error('Bodega destino no encontrada')
  if (!bodega.activa) throw new Error('La bodega destino está desactivada')

  const result: CargaInicialResult = {
    lotesCreados: 0,
    lotesActualizados: 0,
    lotesSinCambio: 0,
    lotesPuestosCero: 0,
    unidadesTotal: 0,
    noEncontrados: [],
    invalidos: []
  }

  const selProd = sqlite.prepare('SELECT id FROM producto WHERE codigo = ?')
  const selLote = sqlite.prepare(
    `SELECT id, total, saldo FROM caducidad_lote
      WHERE producto_id = ? AND bodega_id = ? AND fecha_caducidad = ?
      ORDER BY fecha_entrada ASC LIMIT 1`
  )
  const insLote = sqlite.prepare(
    `INSERT INTO caducidad_lote (id, producto_id, bodega_id, total, saldo, fecha_caducidad, fecha_entrada)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const updSaldoTotal = sqlite.prepare('UPDATE caducidad_lote SET saldo = ?, total = ? WHERE id = ?')
  const zeroLote = sqlite.prepare('UPDATE caducidad_lote SET saldo = 0 WHERE id = ?')
  const insMov = sqlite.prepare(
    `INSERT INTO mov_stock (id, lote_id, venta_item_id, tipo, cantidad, fecha, motivo)
     VALUES (?, ?, NULL, ?, ?, ?, ?)`
  )

  const motivo = `CARGA_INICIAL por ${input.usuarioId}`

  const run = sqlite.transaction(() => {
    const now = Date.now()
    const tocados = new Set<string>() // lotes que aparecen en el CSV

    for (const it of input.items) {
      const codigo = String(it.codigo ?? '').trim()
      if (!codigo) {
        result.invalidos.push('(código vacío)')
        continue
      }
      const cantidad = Math.round(Number(it.cantidad))
      if (!Number.isFinite(cantidad) || cantidad < 0) {
        result.invalidos.push(codigo)
        continue
      }

      const prod = selProd.get(codigo) as { id: string } | undefined
      if (!prod) {
        result.noEncontrados.push(codigo)
        continue
      }

      const fechaMs = caducidadToMs(it.fechaCaducidad)
      const lote = selLote.get(prod.id, bodegaId, fechaMs) as LoteRow | undefined

      if (lote) {
        tocados.add(lote.id)
        if (lote.saldo === cantidad) {
          result.lotesSinCambio++
        } else {
          const delta = cantidad - lote.saldo
          const nuevoTotal = Math.max(lote.total, cantidad)
          updSaldoTotal.run(cantidad, nuevoTotal, lote.id)
          insMov.run(randomUUID(), lote.id, 'AJUSTE', delta, now, motivo)
          result.lotesActualizados++
        }
      } else {
        if (cantidad === 0) {
          // Nada que crear para un saldo 0 inexistente.
          result.lotesSinCambio++
          continue
        }
        const loteId = randomUUID()
        insLote.run(loteId, prod.id, bodegaId, cantidad, cantidad, fechaMs, now)
        insMov.run(randomUUID(), loteId, 'ENTRADA', cantidad, now, motivo)
        tocados.add(loteId)
        result.lotesCreados++
      }
      result.unidadesTotal += cantidad
    }

    // Reconciliación total: lo que no vino en el CSV se pone en 0.
    if (input.reemplazarBodega) {
      const restantes = sqlite
        .prepare('SELECT id, total, saldo FROM caducidad_lote WHERE bodega_id = ? AND saldo <> 0')
        .all(bodegaId) as LoteRow[]
      for (const l of restantes) {
        if (tocados.has(l.id)) continue
        insMov.run(randomUUID(), l.id, 'AJUSTE', -l.saldo, now, `${motivo} (reset)`)
        zeroLote.run(l.id)
        result.lotesPuestosCero++
      }
    }
  })

  run()

  // Dedup de códigos no encontrados para el reporte.
  result.noEncontrados = [...new Set(result.noEncontrados)]
  result.invalidos = [...new Set(result.invalidos)]
  return result
}
