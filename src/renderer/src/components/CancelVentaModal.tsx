import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { toast } from 'sonner'
import Modal from './Modal'
import { money, folio as fmtFolio } from '../lib/format'
import { useSession } from '../stores/session'
import { useSettings } from '../stores/settings'
import type { VentaDetailDto } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
  onCancelled: (folio: number) => void
  currentUserId: string
}

export default function CancelVentaModal({ open, onClose, onCancelled, currentUserId }: Props) {
  const { user } = useSession()
  const { settings } = useSettings()
  const [folioInput, setFolioInput] = useState('')
  const [detail, setDetail] = useState<VentaDetailDto | null>(null)
  const [searching, setSearching] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [confirmStep, setConfirmStep] = useState(false)
  const folioRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setFolioInput('')
    setDetail(null)
    setSearching(false)
    setCancelling(false)
    setConfirmStep(false)
    setTimeout(() => folioRef.current?.focus(), 50)
  }, [open])

  const buscar = useCallback(async () => {
    const n = parseInt(folioInput.replace(/,/g, ''), 10)
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Folio inválido')
      return
    }
    setSearching(true)
    try {
      const v = await window.api.ventas.byFolio(n)
      if (!v) {
        toast.error(`Folio ${fmtFolio(n)} no encontrado`)
        setDetail(null)
        return
      }
      setDetail(v)
      setConfirmStep(false)
    } finally {
      setSearching(false)
    }
  }, [folioInput])

  const onKeyFolio = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      buscar()
    }
  }

  const doCancel = useCallback(async () => {
    if (!detail) return
    if (detail.cancelada) {
      toast.error('Esta venta ya está cancelada')
      return
    }
    setCancelling(true)
    try {
      const r = await window.api.ventas.cancel(detail.id, currentUserId, null)
      toast.success(`Folio ${fmtFolio(r.folioLocal)} cancelado`, {
        description: 'Los productos se reintegraron al inventario'
      })

      // Ticket de cancelación (best-effort: si falla la impresión, la cancelación
      // ya está persistida, sólo avisamos).
      if (settings?.printerName && user?.sucursal) {
        const pr = await window.api.printer.printCancel(settings.printerName, {
          empresa: {
            nombreComercial: user.sucursal.nombreComercial,
            rfc: user.sucursal.rfc ?? null,
            sucursalNombre: user.sucursal.sucursalNombre,
            calle: user.sucursal.calle ?? null,
            colonia: user.sucursal.colonia ?? null
          },
          folioOriginal: detail.folioLocal,
          fechaOriginal: detail.fecha,
          fechaCancelacion: r.canceladaEn,
          totalCancelado: detail.total,
          cajeroOriginal: detail.cajero,
          cajeroCancelador: user.nombre,
          motivo: null
        })
        if (!pr.ok) {
          toast.warning('Cancelación registrada, pero falló la impresión', {
            description: (pr.stderr || pr.stdout).trim()
          })
        }
      }

      onCancelled(r.folioLocal)
      onClose()
    } catch (e) {
      toast.error('No se pudo cancelar', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setCancelling(false)
    }
  }, [detail, currentUserId, onCancelled, onClose, settings?.printerName, user])

  return (
    <Modal open={open} title="Cancelaciones" onClose={onClose} maxWidth="max-w-2xl">
      <div className="p-4 space-y-4 text-sm">
        {/* Búsqueda de folio */}
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label htmlFor="folio" className="block text-xs text-muted-foreground mb-1">
              No. de folio a cancelar
            </label>
            <input
              id="folio"
              ref={folioRef}
              type="text"
              inputMode="numeric"
              className="w-full border border-border rounded px-2 py-1.5 font-mono"
              value={folioInput}
              onChange={(e) => setFolioInput(e.target.value)}
              onKeyDown={onKeyFolio}
              placeholder="Ej. 190730"
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            onClick={buscar}
            disabled={!folioInput || searching}
            className="px-4 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50"
          >
            {searching ? 'Buscando…' : 'Buscar'}
          </button>
        </div>

        {/* Detalle */}
        {detail && (
          <div className="border border-border rounded p-3 space-y-3 bg-muted/10">
            <header className="flex justify-between items-baseline">
              <div>
                <div className="text-xs text-muted-foreground">Folio</div>
                <div className="font-mono text-lg font-semibold">{fmtFolio(detail.folioLocal)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Fecha</div>
                <div className="font-mono">{new Date(detail.fecha).toLocaleString('es-MX')}</div>
                <div className="text-xs text-muted-foreground mt-1">Cajero: {detail.cajero}</div>
              </div>
            </header>

            {detail.cancelada && (
              <div className="bg-red-50 border border-red-300 text-red-900 rounded px-3 py-2 text-xs">
                Esta venta ya fue cancelada
                {detail.canceladaEn
                  ? ` el ${new Date(detail.canceladaEn).toLocaleString('es-MX')}`
                  : ''}
                .
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
                  {detail.items.map((it) => (
                    <tr key={it.id} className="border-b border-border/60">
                      <td className="px-2 py-1 text-right font-mono">{it.cantidad}</td>
                      <td className="px-2 py-1">
                        <div>{it.nombre}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{it.codigo}</div>
                      </td>
                      <td className="px-2 py-1 text-right font-mono">{money(it.precioUnitario)}</td>
                      <td className="px-2 py-1 text-right font-mono">{money(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <Field label="Subtotal" value={money(detail.subtotal)} />
              <Field label="IVA" value={money(detail.iva)} />
              <Field label="Total" value={money(detail.total)} highlight />
            </div>

            {detail.pagos.length > 0 && (
              <div className="text-xs border-t border-border pt-2">
                <div className="text-muted-foreground mb-1">Pagos:</div>
                <div className="font-mono space-y-0.5">
                  {detail.pagos.map((p, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{p.metodo}</span>
                      <span>{money(p.monto)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="flex justify-between items-center px-4 py-3 border-t border-border bg-muted/20">
        <div className="text-xs text-muted-foreground">
          {detail && !detail.cancelada && !confirmStep
            ? 'Revisa el detalle y pulsa "Cancelar venta"'
            : detail && confirmStep
              ? '¿Seguro? El inventario regresa al estado previo a esta venta.'
              : ''}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={cancelling}
            className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
          >
            Cerrar
          </button>
          {detail && !detail.cancelada && (
            <>
              {!confirmStep ? (
                <button
                  type="button"
                  onClick={() => setConfirmStep(true)}
                  className="px-4 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium"
                >
                  Cancelar venta
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmStep(false)}
                    disabled={cancelling}
                    className="px-3 py-1.5 border border-border rounded hover:bg-muted text-sm"
                  >
                    No, regresar
                  </button>
                  <button
                    type="button"
                    onClick={doCancel}
                    disabled={cancelling}
                    className="px-4 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 text-sm font-semibold"
                  >
                    {cancelling ? 'Cancelando…' : 'Sí, cancelar'}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </footer>
    </Modal>
  )
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`border border-border rounded p-2 ${highlight ? 'bg-background' : ''}`}>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`font-mono text-right ${highlight ? 'text-base font-bold text-blue-700' : ''}`}>
        {value}
      </div>
    </div>
  )
}
