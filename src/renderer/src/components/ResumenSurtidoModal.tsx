import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Printer } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import { useSession } from '../stores/session'
import type { ResumenSurtidoDto } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

/**
 * Resumen de surtido (admin): consolida los traspasos a sucursal del rango en
 * una lista de productos SIN repetir, con el total enviado y la existencia que
 * queda. Se imprime con una columna "Pedir" en blanco para marcar faltantes a
 * mano — la base del pedido a proveedor que arman las cajeras.
 */
export default function ResumenSurtidoModal({ open, onClose }: Props) {
  const { user } = useSession()
  const hoy = toYmd(new Date())
  const [desde, setDesde] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 6)
    return toYmd(d)
  })
  const [hasta, setHasta] = useState(hoy)
  const [data, setData] = useState<ResumenSurtidoDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [imprimiendo, setImprimiendo] = useState(false)
  const [selRow, setSelRow] = useState(-1)
  const tablaRef = useRef<HTMLDivElement>(null)
  const tbodyRef = useRef<HTMLTableSectionElement>(null)

  const cargar = useCallback(
    async (d: string, h: string) => {
      if (!user || !d || !h) return
      setLoading(true)
      try {
        const r = await window.api.traspaso.resumenSurtido(user.id, d, h)
        setData(r)
        setSelRow(-1)
      } catch (e) {
        toast.error('No pude generar el resumen', {
          description: e instanceof Error ? e.message : String(e)
        })
      } finally {
        setLoading(false)
      }
    },
    [user]
  )

  useEffect(() => {
    if (open) cargar(desde, hasta)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const imprimir = useCallback(async () => {
    if (!user || !data) return
    setImprimiendo(true)
    try {
      const r = await window.api.traspaso.resumenImprimir(user.id, data.desde, data.hasta)
      if (r.ok) toast.success('Resumen enviado a imprimir')
      else if (!r.cancelled) toast.error('Falló la impresión', { description: r.error })
    } finally {
      setImprimiendo(false)
    }
  }, [user, data])

  // ↑/↓ con la tabla enfocada sombrean renglones (revisión producto por producto).
  const onKeyTabla = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const tgt = e.target as HTMLElement | null
    if (tgt instanceof HTMLInputElement) return
    const total = data?.items.length ?? 0
    if (total === 0) return
    e.preventDefault()
    e.stopPropagation()
    setSelRow((i) => (e.key === 'ArrowDown' ? Math.min(total - 1, i + 1) : Math.max(0, i - 1)))
  }

  useEffect(() => {
    if (selRow < 0) return
    const row = tbodyRef.current?.children[selRow] as HTMLElement | undefined
    const cont = tbodyRef.current?.closest('.overflow-auto') as HTMLElement | null
    if (!row || !cont) return
    const headerH = cont.querySelector('thead')?.getBoundingClientRect().height ?? 0
    const rowTop = row.offsetTop
    const rowBottom = rowTop + row.offsetHeight
    if (rowTop - headerH < cont.scrollTop) cont.scrollTop = Math.max(0, rowTop - headerH)
    else if (rowBottom > cont.scrollTop + cont.clientHeight) {
      cont.scrollTop = rowBottom - cont.clientHeight
    }
  }, [selRow])

  return (
    <Modal open={open} title="Resumen de surtido a sucursales" onClose={onClose} maxWidth="max-w-4xl">
      <div className="p-4 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Junta <strong>todos los traspasos a sucursal</strong> del periodo en una sola lista{' '}
          <strong>sin repetir productos</strong>: total enviado y existencia que queda. Imprime la
          hoja (trae columna <strong>"Pedir"</strong> en blanco) para marcar faltantes y dársela a
          las cajeras — en el pedido a proveedor cada producto se captura con su existencia
          actual, y ellas pueden agregar lo que vean faltante aunque no se haya surtido.
        </p>

        {/* Rango de fechas */}
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label htmlFor="rs-desde" className="block text-xs text-muted-foreground mb-1">
              Desde
            </label>
            <input
              id="rs-desde"
              type="date"
              value={desde}
              max={hasta}
              onChange={(e) => setDesde(e.target.value)}
              className="border border-border rounded px-2 py-1.5 bg-background font-mono"
            />
          </div>
          <div>
            <label htmlFor="rs-hasta" className="block text-xs text-muted-foreground mb-1">
              Hasta
            </label>
            <input
              id="rs-hasta"
              type="date"
              value={hasta}
              max={hoy}
              onChange={(e) => setHasta(e.target.value)}
              className="border border-border rounded px-2 py-1.5 bg-background font-mono"
            />
          </div>
          <button
            type="button"
            onClick={() => cargar(desde, hasta)}
            disabled={loading}
            className="px-4 py-1.5 border border-border rounded cursor-pointer hover:bg-muted disabled:opacity-50"
          >
            {loading ? (
              <>
                <Spinner size={14} /> Generando…
              </>
            ) : (
              'Generar'
            )}
          </button>
          {data && (
            <div className="flex-1 text-right text-xs text-muted-foreground">
              {data.traspasos.length} traspaso{data.traspasos.length === 1 ? '' : 's'} ·{' '}
              {data.items.length} producto{data.items.length === 1 ? '' : 's'} ·{' '}
              {data.totalUnidades.toLocaleString('es-MX')} unidades
            </div>
          )}
        </div>

        {/* Traspasos incluidos */}
        {data && data.traspasos.length > 0 && (
          <div className="text-[11px] text-muted-foreground border border-dashed border-border rounded px-3 py-1.5">
            Incluye:{' '}
            {data.traspasos
              .map((t) => `T-${t.numero} → ${t.destino} (${t.unidades.toLocaleString('es-MX')} u)`)
              .join(' · ')}
          </div>
        )}

        {/* Tabla consolidada */}
        <div
          ref={tablaRef}
          tabIndex={0}
          onKeyDown={onKeyTabla}
          title="Con la tabla enfocada: ↑/↓ recorren y sombrean los renglones"
          className="border border-border rounded overflow-auto max-h-[48vh] focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
              <tr className="text-left">
                <th className="px-2 py-1.5 w-8 text-right">#</th>
                <th className="px-2 py-1.5 w-32 font-mono">Código</th>
                <th className="px-2 py-1.5">Producto</th>
                <th className="px-2 py-1.5 w-20 text-right">Enviado</th>
                <th className="px-2 py-1.5 w-24 text-right">Existencia</th>
                <th className="px-2 py-1.5 w-16 text-right">Dest.</th>
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {(!data || data.items.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-2 py-8 text-center text-muted-foreground italic">
                    {loading
                      ? 'Generando…'
                      : 'Sin traspasos a sucursal en el periodo seleccionado.'}
                  </td>
                </tr>
              )}
              {data?.items.map((it, i) => (
                <tr
                  key={it.codigo}
                  onClick={() => {
                    setSelRow(i)
                    tablaRef.current?.focus()
                  }}
                  className={`border-b border-border/60 cursor-pointer ${
                    i === selRow ? 'bg-primary/10' : 'hover:bg-muted/40'
                  } ${it.existencia === 0 ? 'text-red-800' : ''}`}
                >
                  <td className="px-2 py-1 text-right text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1 font-mono">{it.codigo}</td>
                  <td className="px-2 py-1">{it.nombre}</td>
                  <td className="px-2 py-1 text-right font-mono font-semibold">
                    {it.enviado.toLocaleString('es-MX')}
                  </td>
                  <td
                    className={`px-2 py-1 text-right font-mono ${
                      it.existencia === 0 ? 'font-bold text-red-700' : ''
                    }`}
                  >
                    {it.existencia.toLocaleString('es-MX')}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                    {it.destinos}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Las existencias en <span className="text-red-700 font-semibold">rojo</span> quedaron en
          cero. "Dest." = a cuántas farmacias se envió el producto en el periodo.
        </p>
      </div>

      <footer className="flex justify-between items-center px-4 py-3 border-t border-border bg-muted/20">
        <button
          type="button"
          onClick={imprimir}
          disabled={imprimiendo || loading || !data || data.items.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground rounded cursor-pointer hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
        >
          {imprimiendo ? <Spinner size={14} /> : <Printer className="size-3.5" />}
          Imprimir lista (con columna "Pedir")
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-1.5 border border-border rounded cursor-pointer hover:bg-muted text-sm"
        >
          Cerrar
        </button>
      </footer>
    </Modal>
  )
}
