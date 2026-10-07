import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Merge } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import { money } from '../lib/format'
import { useSession } from '../stores/session'
import type { DedupParItem } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
  /** Se llama tras fusionar, para que la pantalla padre refresque contadores. */
  onDone?: () => void
}

/**
 * Corrección de códigos duplicados por cero inicial (legacy pierde los ceros
 * del EAN). Muestra la vista previa de pares y fusiona al confirmar: queda el
 * código corto (sin cero), las existencias se suman moviendo los lotes (no se
 * altera ninguna cantidad) y el precio final es el MÁS ALTO del par.
 */
export default function DedupCodigosModal({ open, onClose, onDone }: Props) {
  const { user } = useSession()
  const [pares, setPares] = useState<DedupParItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  // Sombreado con ↑/↓ para repasar los pares antes de fusionar.
  const [selRow, setSelRow] = useState(-1)
  const paresTbodyRef = useRef<HTMLTableSectionElement>(null)
  useEffect(() => {
    setSelRow(-1)
  }, [pares])
  useEffect(() => {
    if (selRow < 0) return
    const row = paresTbodyRef.current?.children[selRow] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [selRow])

  const cargar = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const r = await window.api.productos.dedupPreview(user.id)
      setPares(r.pares)
    } catch (e) {
      toast.error('No pude buscar duplicados', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (open) {
      cargar()
    } else {
      setPares(null)
    }
  }, [open, cargar])

  const aplicar = useCallback(async () => {
    if (!user || applying) return
    setApplying(true)
    try {
      const r = await window.api.productos.dedupApply(user.id)
      toast.success(`${r.fusionados} duplicado${r.fusionados === 1 ? '' : 's'} fusionado${r.fusionados === 1 ? '' : 's'}`, {
        description:
          r.unidadesMovidas > 0
            ? `${r.unidadesMovidas} unidades se movieron al código que queda (las existencias no cambiaron de total).`
            : 'No había existencias que mover.'
      })
      onDone?.()
      onClose()
    } catch (e) {
      toast.error('No se pudo fusionar', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setApplying(false)
    }
  }, [user, applying, onDone, onClose])

  const confirmar = useCallback(() => {
    if (!pares || pares.length === 0) return
    toast.warning(`¿Fusionar ${pares.length} duplicado${pares.length === 1 ? '' : 's'}?`, {
      id: 'dedup-confirm',
      description:
        'Queda el código largo, las existencias del duplicado se le suman y el duplicado se elimina del catálogo. No se puede deshacer (haz respaldo antes si tienes duda).',
      duration: 10000,
      action: { label: 'Sí, fusionar', onClick: () => aplicar() }
    })
  }, [pares, aplicar])

  return (
    <Modal open={open} title="Corregir códigos duplicados" onClose={onClose} maxWidth="max-w-3xl">
      <div className="p-4 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Detecta productos repetidos cuyo código sólo difiere en el <strong>cero inicial</strong>{' '}
          (p. ej. <span className="font-mono">0780083140588</span> y{' '}
          <span className="font-mono">780083140588</span>, herencia del sistema legacy). Al
          fusionar: queda el <strong>código corto</strong> (sin el cero — el escáner lo sigue
          encontrando aunque lea el EAN completo), las existencias del duplicado{' '}
          <strong>se le suman moviendo sus lotes</strong> (ninguna cantidad se altera), el
          historial se conserva, y el <strong>precio final es el más alto</strong> de los dos.
        </p>

        {loading && (
          <div className="py-8 flex justify-center">
            <Spinner label="Buscando duplicados…" />
          </div>
        )}

        {!loading && pares && pares.length === 0 && (
          <div className="py-8 text-center text-muted-foreground italic">
            No se encontraron códigos duplicados por cero inicial. El catálogo está limpio.
          </div>
        )}

        {!loading && pares && pares.length > 0 && (
          <div
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
              const tgt = e.target as HTMLElement | null
              if (tgt instanceof HTMLInputElement || tgt instanceof HTMLSelectElement) return
              if (!pares || pares.length === 0) return
              e.preventDefault()
              e.stopPropagation()
              setSelRow((i) =>
                e.key === 'ArrowDown' ? Math.min(pares.length - 1, i + 1) : Math.max(0, i - 1)
              )
            }}
            className="border border-border rounded overflow-auto max-h-[50vh] focus:outline-none focus:ring-1 focus:ring-primary/40"
            title="↑/↓ recorren los pares para revisarlos"
          >
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                <tr className="text-left">
                  <th className="px-2 py-1.5">Producto</th>
                  <th className="px-2 py-1.5">Queda</th>
                  <th className="px-2 py-1.5">Se elimina</th>
                  <th className="px-2 py-1.5 text-right">Exist. final</th>
                  <th className="px-2 py-1.5 text-right">Precio final</th>
                </tr>
              </thead>
              <tbody ref={paresTbodyRef}>
                {pares.map((p, i) => (
                  <tr
                    key={i}
                    onClick={(e) => {
                      setSelRow(i)
                      ;(e.currentTarget.closest('[tabindex]') as HTMLElement | null)?.focus()
                    }}
                    className={`border-b border-border/60 cursor-pointer ${
                      i === selRow ? 'bg-primary/10' : 'hover:bg-muted/40'
                    }`}
                  >
                    <td className="px-2 py-1">{p.nombre}</td>
                    <td className="px-2 py-1 font-mono">
                      {p.codigoQueda}
                      <div className="text-[10px] text-muted-foreground">
                        {p.existenciaQueda} pzas · ${money(p.precioQueda)}
                      </div>
                    </td>
                    <td className="px-2 py-1 font-mono text-red-700">
                      {p.codigoElimina}
                      <div className="text-[10px] text-red-600/70">
                        {p.existenciaElimina} pzas · ${money(p.precioElimina)}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-right font-mono font-semibold">
                      {p.existenciaQueda + p.existenciaElimina}
                    </td>
                    <td
                      className={`px-2 py-1 text-right font-mono font-semibold ${
                        p.precioFinal !== p.precioQueda ? 'text-amber-700' : ''
                      }`}
                    >
                      ${money(p.precioFinal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && pares && pares.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Los precios en <span className="text-amber-700 font-semibold">ámbar</span> cambiarán en
            el código que queda (se toma el más alto). Después de fusionar en la matriz, genera
            el <span className="font-mono">.farma</span> para las sucursales y corre esta misma
            corrección en cada una (su inventario es local).
          </p>
        )}
      </div>

      <footer className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted/20">
        <button
          type="button"
          onClick={onClose}
          disabled={applying}
          className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
        >
          Cerrar
        </button>
        {pares && pares.length > 0 && (
          <button
            type="button"
            onClick={confirmar}
            disabled={applying || loading}
            className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded cursor-pointer hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
          >
            {applying ? (
              <>
                <Spinner size={14} /> Fusionando…
              </>
            ) : (
              <>
                <Merge className="size-3.5" />
                Fusionar {pares.length} duplicado{pares.length === 1 ? '' : 's'}
              </>
            )}
          </button>
        )}
      </footer>
    </Modal>
  )
}
