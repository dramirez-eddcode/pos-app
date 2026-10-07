import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import type { StockBodegaItem } from '@shared/dto'

interface FilaLote {
  key: string
  /** null = lote nuevo (aún no existe en BD). */
  loteId: string | null
  caducidad: string // YYYY-MM-DD
  cantidad: string // texto para permitir el campo vacío mientras teclean
}

interface Props {
  open: boolean
  onClose: () => void
  userId: string
  bodegaId: string
  item: StockBodegaItem
  /** Guardado con éxito: el padre recarga el stock y cierra. */
  onSaved: () => void
}

/**
 * Redistribuye las existencias de un producto entre sus lotes SIN cambiar el
 * total: mover cantidades, crear lotes nuevos (con caducidad) y eliminar
 * lotes. Reglas visibles en vivo: mínimo 1 lote, máximo tantos lotes como
 * unidades, y la suma repartida debe cuadrar EXACTO con la existencia — el
 * botón Guardar queda bloqueado hasta que cuadre. El backend
 * (stock.redistribuirLotes) revalida todo y además rechaza si la existencia
 * cambió mientras se capturaba (venta/entrada en paralelo).
 */
export default function RedistribuirLotesModal({
  open,
  onClose,
  userId,
  bodegaId,
  item,
  onSaved
}: Props) {
  const total = item.existencias
  const [filas, setFilas] = useState<FilaLote[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setFilas(
      item.lotes.map((l) => ({
        key: l.loteId,
        loteId: l.loteId,
        caducidad: l.caducidad,
        cantidad: String(l.saldo)
      }))
    )
  }, [open, item])

  const repartidas = useMemo(
    () => filas.reduce((s, f) => s + (parseInt(f.cantidad, 10) || 0), 0),
    [filas]
  )
  const filasValidas = filas.every(
    (f) =>
      /^\d+$/.test(f.cantidad.trim()) &&
      parseInt(f.cantidad, 10) >= 1 &&
      /^\d{4}-\d{2}-\d{2}$/.test(f.caducidad)
  )
  const cuadra = repartidas === total && filasValidas && filas.length >= 1 && filas.length <= total
  const diferencia = total - repartidas
  const fechasRepetidas = useMemo(() => {
    const fechas = filas.map((f) => f.caducidad).filter(Boolean)
    return new Set(fechas).size !== fechas.length
  }, [filas])

  const setFila = (key: string, patch: Partial<FilaLote>): void => {
    setFilas((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)))
  }

  const quitarFila = (key: string): void => {
    setFilas((prev) => (prev.length <= 1 ? prev : prev.filter((f) => f.key !== key)))
  }

  const agregarFila = (): void => {
    setFilas((prev) =>
      prev.length >= total
        ? prev
        : [...prev, { key: crypto.randomUUID(), loteId: null, caducidad: '', cantidad: '' }]
    )
  }

  const guardar = async (): Promise<void> => {
    if (!cuadra || saving) return
    setSaving(true)
    try {
      const r = await window.api.inventario.redistribuirLotes({
        usuarioId: userId,
        bodegaId,
        productoId: item.productoId,
        totalEsperado: total,
        lotes: filas.map((f) => ({
          loteId: f.loteId,
          caducidad: f.caducidad,
          cantidad: parseInt(f.cantidad, 10)
        }))
      })
      toast.success('Lotes redistribuidos', {
        description: `${r.lotesCreados} nuevo(s) · ${r.lotesEnCero} eliminado(s) · el total sigue en ${total.toLocaleString('es-MX')}`
      })
      onSaved()
    } catch (e) {
      toast.error('No se pudo redistribuir', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title={`Ajustar lotes — ${item.nombre}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="p-4 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground border border-dashed border-border rounded px-3 py-2">
          Reparte las <strong>{total.toLocaleString('es-MX')}</strong> existencias entre lotes:
          mueve cantidades, agrega lotes nuevos o elimina alguno (su cantidad se reparte en los
          demás). La existencia total <strong>no cambia</strong> — sólo cómo está repartida. El
          movimiento queda registrado en el kárdex como ajuste.
        </p>

        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-b border-border">
              <tr className="text-left">
                <th className="px-2 py-1.5">Caducidad</th>
                <th className="px-2 py-1.5 w-28 text-right">Cantidad</th>
                <th className="px-2 py-1.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.key} className="border-b border-border/60">
                  <td className="px-2 py-1">
                    <input
                      type="date"
                      value={f.caducidad}
                      disabled={saving}
                      onChange={(e) => setFila(f.key, { caducidad: e.target.value })}
                      className={`border rounded px-1.5 py-1 font-mono text-xs ${
                        /^\d{4}-\d{2}-\d{2}$/.test(f.caducidad)
                          ? 'border-border'
                          : 'border-red-400 bg-red-50'
                      }`}
                    />
                    {f.loteId === null && (
                      <span className="ml-1.5 text-[10px] uppercase text-green-700 border border-green-300 bg-green-50 rounded px-1">
                        nuevo
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={f.cantidad}
                      disabled={saving}
                      onChange={(e) => setFila(f.key, { cantidad: e.target.value.replace(/[^\d]/g, '') })}
                      className={`w-20 border rounded px-1.5 py-1 font-mono text-right text-xs ${
                        /^\d+$/.test(f.cantidad.trim()) && parseInt(f.cantidad, 10) >= 1
                          ? 'border-border'
                          : 'border-red-400 bg-red-50'
                      }`}
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => quitarFila(f.key)}
                      disabled={saving || filas.length <= 1}
                      className="p-1 rounded text-red-600 hover:bg-red-50 disabled:opacity-30 cursor-pointer"
                      title={
                        filas.length <= 1
                          ? 'Debe quedar al menos 1 lote'
                          : f.loteId
                            ? 'Eliminar este lote (quedará en 0; reparte su cantidad en los demás)'
                            : 'Quitar esta fila'
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={agregarFila}
            disabled={saving || filas.length >= total}
            className="inline-flex items-center gap-1 px-2.5 py-1 border border-border rounded text-xs hover:bg-muted disabled:opacity-40 cursor-pointer"
            title={
              filas.length >= total
                ? `Máximo ${total} lotes (uno por unidad)`
                : 'Agregar un lote nuevo con su caducidad'
            }
          >
            <Plus className="size-3.5" /> Agregar lote
          </button>
          <div
            className={`text-xs font-mono font-semibold ${
              repartidas === total ? 'text-green-700' : 'text-red-700'
            }`}
          >
            Repartidas {repartidas.toLocaleString('es-MX')} de {total.toLocaleString('es-MX')}
            {diferencia !== 0 &&
              (diferencia > 0 ? ` (faltan ${diferencia})` : ` (sobran ${-diferencia})`)}
          </div>
        </div>

        {fechasRepetidas && (
          <p className="text-[11px] text-amber-700">
            Hay dos lotes con la misma fecha de caducidad — está permitido, pero revisa que sea
            intencional.
          </p>
        )}
      </div>

      <footer className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted/20">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={!cuadra || saving}
          className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
          title={cuadra ? '' : 'La suma repartida debe ser exactamente igual a la existencia total'}
        >
          {saving ? (
            <>
              <Spinner size={14} /> Guardando…
            </>
          ) : (
            'Guardar reparto'
          )}
        </button>
      </footer>
    </Modal>
  )
}
