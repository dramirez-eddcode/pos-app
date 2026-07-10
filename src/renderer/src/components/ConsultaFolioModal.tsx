import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import { folio as fmtFolio, money } from '../lib/format'
import type { VentaDetailDto } from '@shared/dto'

const METODO_LABEL: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transferencia',
  OTRO: 'Otro'
}

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * Consulta de una venta por su número de folio — cualquier folio histórico de
 * esta instalación, sin límite de fecha. Sólo lectura: muestra el detalle
 * (productos, pagos, cajero, cancelación) como el del corte en pantalla.
 */
export default function ConsultaFolioModal({ open, onClose }: Props) {
  const [folioTxt, setFolioTxt] = useState('')
  const [venta, setVenta] = useState<VentaDetailDto | null>(null)
  const [buscando, setBuscando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setFolioTxt('')
    setVenta(null)
    setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])

  const buscar = useCallback(async (n: number) => {
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Captura un número de folio válido')
      return
    }
    setBuscando(true)
    try {
      const d = await window.api.ventas.byFolio(n)
      if (!d) {
        toast.error(`No existe el folio ${fmtFolio(n)}`)
        return
      }
      setVenta(d)
      setFolioTxt(String(n))
    } catch (e) {
      toast.error(`No se pudo consultar el folio ${fmtFolio(n)}`, {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBuscando(false)
    }
  }, [])

  const onKeyFolio = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      buscar(Math.round(parseFloat(folioTxt)))
    }
  }

  return (
    <Modal open={open} title="Consultar folio" onClose={onClose} maxWidth="max-w-2xl">
      <div className="relative">
        <div className="p-4 text-sm space-y-3 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Número de folio <span className="font-mono">(Enter busca)</span> — cualquier
                venta del historial
              </label>
              <input
                ref={inputRef}
                type="number"
                min={1}
                step={1}
                value={folioTxt}
                onChange={(e) => setFolioTxt(e.target.value)}
                onKeyDown={onKeyFolio}
                placeholder="Ej. 494"
                className="w-full border border-border rounded px-2 py-1.5 font-mono"
              />
            </div>
            <button
              type="button"
              onClick={() => buscar(Math.round(parseFloat(folioTxt)))}
              disabled={buscando || !folioTxt}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-medium"
            >
              {buscando ? <Spinner size={14} /> : 'Buscar'}
            </button>
            <button
              type="button"
              onClick={() => venta && buscar(venta.folioLocal - 1)}
              disabled={buscando || !venta || venta.folioLocal <= 1}
              title="Folio anterior"
              className="px-2 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => venta && buscar(venta.folioLocal + 1)}
              disabled={buscando || !venta}
              title="Folio siguiente"
              className="px-2 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {!venta && !buscando && (
            <div className="border border-dashed border-border rounded px-3 py-6 text-center text-xs text-muted-foreground italic">
              Teclea un folio y presiona Enter para ver el detalle de esa venta.
            </div>
          )}

          {venta && (
            <section className="border border-border rounded">
              <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide flex justify-between items-center">
                <span>
                  Detalle de venta — <span className="font-mono">Folio {fmtFolio(venta.folioLocal)}</span>
                </span>
                {venta.cancelada && (
                  <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-[10px] font-semibold">
                    CANCELADA
                  </span>
                )}
              </header>
              <div className="p-3 space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {new Date(venta.fecha).toLocaleString('es-MX')} · Cajero {venta.cajero}
                  </span>
                  <span>Motivo: {venta.motivo}</span>
                </div>
                {venta.cancelada && venta.canceladaEn && (
                  <div className="text-xs border border-red-200 bg-red-50 text-red-800 rounded px-3 py-1.5">
                    Cancelada el {new Date(venta.canceladaEn).toLocaleString('es-MX')}
                  </div>
                )}
                <div className="border border-border rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-b border-border">
                      <tr className="text-left">
                        <th className="px-2 py-1 w-12 text-right">Cant</th>
                        <th className="px-2 py-1">Producto</th>
                        <th className="px-2 py-1 w-24 text-right">Precio</th>
                        <th className="px-2 py-1 w-24 text-right">Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {venta.items.map((it) => (
                        <tr key={it.id} className="border-b border-border/60">
                          <td className="px-2 py-1 text-right font-mono">{it.cantidad}</td>
                          <td className="px-2 py-1">
                            <div>{it.nombre}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              {it.codigo}
                            </div>
                          </td>
                          <td className="px-2 py-1 text-right font-mono">
                            {money(it.precioUnitario)}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">{money(it.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                  <div className="border border-border rounded px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                      Subtotal
                    </div>
                    <div className="text-right">{money(venta.subtotal)}</div>
                  </div>
                  <div className="border border-border rounded px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                      IVA
                    </div>
                    <div className="text-right">{money(venta.iva)}</div>
                  </div>
                  <div className="border border-border rounded px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                      Total
                    </div>
                    <div className="text-right font-bold text-blue-700">{money(venta.total)}</div>
                  </div>
                </div>
                {venta.pagos.length > 0 && (
                  <div className="text-xs">
                    <div className="text-muted-foreground mb-1">Pagos:</div>
                    <div className="font-mono space-y-0.5">
                      {venta.pagos.map((p, i) => (
                        <div key={i} className="flex justify-between">
                          <span>
                            {METODO_LABEL[p.metodo] ?? p.metodo}
                            {p.referencia && (
                              <span className="text-muted-foreground"> · ref {p.referencia}</span>
                            )}
                          </span>
                          <span>{money(p.monto)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        <footer className="flex justify-between items-center px-4 py-2 border-t border-border bg-muted/20">
          <div className="text-xs text-muted-foreground">
            Sólo consulta — no modifica nada. <span className="font-mono">‹ ›</span> navegan al
            folio anterior/siguiente.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
          >
            Cerrar
          </button>
        </footer>
      </div>
    </Modal>
  )
}
