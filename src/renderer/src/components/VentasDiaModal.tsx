import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import { folio as fmtFolio, money } from '../lib/format'
import { useSession } from '../stores/session'
import type { VentaDetailDto, VentasDiaDto } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
}

const PAGO_LABEL: Record<string, string> = {
  EFECTIVO: 'Efec.',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transf.',
  OTRO: 'Otro',
  MIXTO: 'Mixto'
}

const PAGO_BADGE: Record<string, string> = {
  EFECTIVO: 'bg-green-100 text-green-900',
  TARJETA: 'bg-blue-100 text-blue-900',
  TRANSFERENCIA: 'bg-violet-100 text-violet-900',
  OTRO: 'bg-muted text-muted-foreground',
  MIXTO: 'bg-amber-100 text-amber-900'
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

/**
 * Consulta histórica de ventas por día (calendario). Sólo SUPERUSUARIO y
 * ADMINISTRADOR (el backend `ventas.getVentasDia` lo exige también): a
 * diferencia del corte en pantalla, no está limitada al periodo en curso.
 */
export default function VentasDiaModal({ open, onClose }: Props) {
  const { user } = useSession()
  const [dia, setDia] = useState<string>(() => toYmd(new Date()))
  const [data, setData] = useState<VentasDiaDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [selId, setSelId] = useState<string | null>(null)
  const [detail, setDetail] = useState<VentaDetailDto | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const hoyYmd = toYmd(new Date())

  const load = useCallback(
    async (d: string) => {
      if (!user) return
      setLoading(true)
      try {
        const r = await window.api.ventas.dia(user.id, d)
        setData(r)
        setSelId(null)
        setDetail(null)
      } catch (e) {
        toast.error('No pude cargar las ventas del día', {
          description: e instanceof Error ? e.message : String(e)
        })
      } finally {
        setLoading(false)
      }
    },
    [user]
  )

  useEffect(() => {
    if (!open) return
    const d = toYmd(new Date())
    setDia(d)
    load(d)
  }, [open, load])

  const cambiarDia = (d: string): void => {
    if (!d || d > hoyYmd) return
    setDia(d)
    load(d)
  }

  const shiftDia = (delta: number): void => {
    const d = ymdToDate(dia)
    d.setDate(d.getDate() + delta)
    cambiarDia(toYmd(d))
  }

  const verDetalle = async (folioLocal: number, id: string): Promise<void> => {
    setSelId(id)
    setLoadingDetail(true)
    try {
      const d = await window.api.ventas.byFolio(folioLocal)
      setDetail(d)
    } catch (e) {
      toast.error('No pude cargar la venta', { description: String(e) })
    } finally {
      setLoadingDetail(false)
    }
  }

  const fechaTitulo = ymdToDate(dia).toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })

  return (
    <Modal open={open} title="Ventas por día" onClose={onClose} maxWidth="max-w-4xl">
      <div className="p-4 space-y-4 text-sm">
        {/* Filtro de calendario */}
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label htmlFor="ventas-dia" className="block text-xs text-muted-foreground mb-1">
              Día a consultar
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => shiftDia(-1)}
                className="p-1.5 border border-border rounded hover:bg-muted"
                title="Día anterior"
                aria-label="Día anterior"
              >
                <ChevronLeft className="size-4" />
              </button>
              <input
                id="ventas-dia"
                type="date"
                value={dia}
                max={hoyYmd}
                onChange={(e) => cambiarDia(e.target.value)}
                className="border border-border rounded px-2 py-1.5 bg-background font-mono"
              />
              <button
                type="button"
                onClick={() => shiftDia(1)}
                disabled={dia >= hoyYmd}
                className="p-1.5 border border-border rounded hover:bg-muted disabled:opacity-40"
                title="Día siguiente"
                aria-label="Día siguiente"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 text-xs text-muted-foreground pb-2 capitalize">{fechaTitulo}</div>
          {loading && <Spinner size={16} />}
        </div>

        {/* Resumen del día */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Stat label="Notas vendidas" value={String(data.foliosVendidos)} />
            <Stat label="Canceladas" value={String(data.foliosCancelados)} />
            <Stat label="Total vendido" value={`$${money(data.totalVendido)}`} bold />
            <Stat label="Monto cancelado" value={`$${money(data.montoCancelado)}`} />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {/* Lista de ventas del día */}
          <section className="border border-border rounded flex flex-col min-w-0">
            <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide flex justify-between items-center">
              <span>Ventas del día</span>
              <span className="text-[10px] text-muted-foreground normal-case">
                {data?.ventas.length ?? 0}
              </span>
            </header>
            <div className="overflow-auto max-h-[380px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background border-b border-border z-10">
                  <tr className="text-left">
                    <th className="px-2 py-1">Folio</th>
                    <th className="px-2 py-1">Hora</th>
                    <th className="px-2 py-1 w-20">Pago</th>
                    <th className="px-2 py-1 text-right">Total</th>
                    <th className="px-2 py-1 w-12 text-center">Canc.</th>
                  </tr>
                </thead>
                <tbody>
                  {(!data || data.ventas.length === 0) && (
                    <tr>
                      <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground italic">
                        {loading ? 'Cargando…' : 'Sin ventas ese día'}
                      </td>
                    </tr>
                  )}
                  {data?.ventas.map((f) => {
                    const t = new Date(f.fecha)
                    const sel = f.id === selId
                    return (
                      <tr
                        key={f.id}
                        onClick={() => verDetalle(f.folioLocal, f.id)}
                        className={`border-b border-border/60 cursor-pointer ${
                          sel
                            ? f.cancelada
                              ? 'bg-red-100'
                              : 'bg-primary/10'
                            : f.cancelada
                              ? 'bg-red-50'
                              : 'hover:bg-muted/40'
                        } ${f.cancelada ? 'text-red-700 line-through' : ''}`}
                      >
                        <td className="px-2 py-1 font-mono">{fmtFolio(f.folioLocal)}</td>
                        <td className="px-2 py-1 font-mono text-[11px]">
                          {t.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-2 py-1">
                          {f.metodo && (
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                PAGO_BADGE[f.metodo] ?? 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {PAGO_LABEL[f.metodo] ?? f.metodo}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 font-mono text-right">{money(f.total)}</td>
                        <td className="px-2 py-1 text-center">
                          {f.cancelada ? <span className="text-red-700 text-[10px]">SI</span> : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Detalle de la venta seleccionada */}
          <section className="border border-border rounded min-w-0">
            <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide flex justify-between items-center">
              <span>
                Detalle de venta
                {detail && (
                  <>
                    {' — '}
                    <span className="font-mono">Folio {fmtFolio(detail.folioLocal)}</span>
                    {detail.cancelada && (
                      <span className="ml-2 text-red-700 normal-case font-normal">(cancelada)</span>
                    )}
                  </>
                )}
              </span>
              {loadingDetail && <span className="text-[10px] normal-case">cargando…</span>}
            </header>
            <div className="p-3 text-xs">
              {!detail && !loadingDetail && (
                <div className="py-6 text-center text-muted-foreground italic">
                  Haz clic en una venta para ver su detalle
                </div>
              )}
              {detail && (
                <div className="space-y-2">
                  <div className="text-muted-foreground">
                    {new Date(detail.fecha).toLocaleString('es-MX')} · Cajero: {detail.cajero}
                  </div>
                  <div className="border border-border rounded overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-muted/40 border-b border-border">
                        <tr className="text-left">
                          <th className="px-2 py-1 w-10 text-right">Cant</th>
                          <th className="px-2 py-1">Producto</th>
                          <th className="px-2 py-1 w-20 text-right">Importe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.map((it) => (
                          <tr key={it.id} className="border-b border-border/60">
                            <td className="px-2 py-1 text-right font-mono">{it.cantidad}</td>
                            <td className="px-2 py-1">
                              <div>{it.nombre}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">
                                {it.codigo}
                              </div>
                            </td>
                            <td className="px-2 py-1 text-right font-mono">{money(it.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="Subtotal" value={`$${money(detail.subtotal)}`} />
                    <Stat label="IVA" value={`$${money(detail.iva)}`} />
                    <Stat label="Total" value={`$${money(detail.total)}`} bold />
                  </div>
                  {detail.pagos.length > 0 && (
                    <div className="border-t border-border pt-2">
                      <div className="text-muted-foreground mb-1">Pagos:</div>
                      <div className="font-mono space-y-0.5">
                        {detail.pagos.map((p, i) => (
                          <div key={i} className="flex justify-between">
                            <span>{p.metodo}</span>
                            <span>${money(p.monto)}</span>
                          </div>
                        ))}
                        {detail.cambio > 0 && (
                          <>
                            <div className="flex justify-between border-t border-border/60 pt-0.5">
                              <span>Recibido</span>
                              <span>${money(detail.recibido)}</span>
                            </div>
                            <div className="flex justify-between text-green-700">
                              <span>Cambio</span>
                              <span>${money(detail.cambio)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <footer className="flex justify-end px-4 py-3 border-t border-border bg-muted/20">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
        >
          Cerrar
        </button>
      </footer>
    </Modal>
  )
}

function Stat({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`font-mono text-right ${bold ? 'font-bold text-blue-700' : ''}`}>{value}</div>
    </div>
  )
}
