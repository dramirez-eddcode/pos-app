import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRightLeft, ChevronLeft } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import { money } from '../lib/format'
import type { TraspasoHistDetalle, TraspasoHistItem } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
}

export default function TraspasosListModal({ open, onClose }: Props) {
  const [list, setList] = useState<TraspasoHistItem[]>([])
  const [loading, setLoading] = useState(false)
  const [detalle, setDetalle] = useState<TraspasoHistDetalle | null>(null)
  const [loadingDet, setLoadingDet] = useState(false)

  useEffect(() => {
    if (!open) {
      setDetalle(null)
      return
    }
    setLoading(true)
    window.api.traspaso
      .list()
      .then(setList)
      .catch((e) => toast.error('No se pudo cargar el historial', { description: String(e) }))
      .finally(() => setLoading(false))
  }, [open])

  const verDetalle = useCallback(async (folio: string) => {
    setLoadingDet(true)
    try {
      const d = await window.api.traspaso.detalle(folio)
      if (!d) {
        toast.error('No se encontró el detalle del traspaso')
        return
      }
      setDetalle(d)
    } finally {
      setLoadingDet(false)
    }
  }, [])

  return (
    <Modal
      open={open}
      title={detalle ? 'Detalle del traspaso' : 'Historial de traspasos'}
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <div className="relative">
        <div className="p-4 text-sm">
          {/* ── Vista lista ──────────────────────────────────────────────── */}
          {!detalle && (
            <div className="border border-border rounded overflow-auto max-h-[60vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-40">Fecha</th>
                    <th className="px-2 py-1.5">Origen → Sucursal</th>
                    <th className="px-2 py-1.5 w-20 text-right">Líneas</th>
                    <th className="px-2 py-1.5 w-24 text-right">Unidades</th>
                    <th className="px-2 py-1.5 w-20 text-center">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={5} className="px-2 py-8">
                        <span className="flex items-center justify-center">
                          <Spinner label="Cargando…" />
                        </span>
                      </td>
                    </tr>
                  )}
                  {!loading && list.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-8 text-center text-muted-foreground italic">
                        Aún no se ha generado ningún traspaso.
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    list.map((t) => (
                      <tr key={t.folio} className="border-b border-border/60">
                        <td className="px-2 py-1 font-mono">
                          {new Date(t.fecha).toLocaleString('es-MX')}
                        </td>
                        <td className="px-2 py-1">
                          {t.bodegaOrigen}{' '}
                          <ArrowRightLeft className="inline size-3 text-muted-foreground" />{' '}
                          <span className="font-medium">{t.sucursalNombre}</span>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            folio {t.folio.slice(0, 8)}…
                          </div>
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{t.lineas}</td>
                        <td className="px-2 py-1 text-right font-mono font-semibold">
                          {t.unidades.toLocaleString('es-MX')}
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => verDetalle(t.folio)}
                            className="px-2 py-1 border border-border rounded hover:bg-muted text-[11px]"
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Vista detalle ────────────────────────────────────────────── */}
          {detalle && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setDetalle(null)}
                className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
              >
                <ChevronLeft className="size-3.5" /> Volver al historial
              </button>

              <div className="rounded border border-border bg-muted/20 p-3 text-xs grid grid-cols-2 gap-x-6 gap-y-1">
                <div><span className="text-muted-foreground">Fecha: </span>{new Date(detalle.fecha).toLocaleString('es-MX')}</div>
                <div><span className="text-muted-foreground">Folio: </span><span className="font-mono">{detalle.folio}</span></div>
                <div><span className="text-muted-foreground">Origen: </span>{detalle.bodegaOrigen}</div>
                <div><span className="text-muted-foreground">Sucursal: </span><span className="font-medium">{detalle.sucursalNombre}</span></div>
                <div><span className="text-muted-foreground">Líneas: </span>{detalle.lineas}</div>
                <div><span className="text-muted-foreground">Unidades: </span><span className="font-semibold">{detalle.unidades.toLocaleString('es-MX')}</span></div>
              </div>

              <div className="border border-border rounded overflow-auto max-h-[45vh]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                    <tr className="text-left">
                      <th className="px-2 py-1.5 w-32 font-mono">Código</th>
                      <th className="px-2 py-1.5">Producto</th>
                      <th className="px-2 py-1.5 w-20 text-right">Cantidad</th>
                      <th className="px-2 py-1.5 w-24 text-right">Costo</th>
                      <th className="px-2 py-1.5 w-28 text-center">Caducidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.items.map((l, i) => (
                      <tr key={i} className="border-b border-border/60">
                        <td className="px-2 py-1 font-mono">{l.codigo}</td>
                        <td className="px-2 py-1">{l.nombre}</td>
                        <td className="px-2 py-1 text-right font-mono">{l.cantidad}</td>
                        <td className="px-2 py-1 text-right font-mono">${money(l.costo)}</td>
                        <td className="px-2 py-1 text-center font-mono">{l.caducidad || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <footer className="flex justify-end px-4 py-2 border-t border-border bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
          >
            Cerrar
          </button>
        </footer>

        {loadingDet && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60">
            <Spinner label="Cargando detalle…" />
          </div>
        )}
      </div>
    </Modal>
  )
}
