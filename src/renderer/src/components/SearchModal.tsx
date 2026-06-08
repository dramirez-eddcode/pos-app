import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { toast } from 'sonner'
import Modal from './Modal'
import Spinner from './Spinner'
import { money } from '../lib/format'
import type { ProductoDto, ProductoSearchMode } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (p: ProductoDto) => void
  /**
   * Si true, permite seleccionar productos aunque tengan existencias=0.
   * Default: false (flujo de venta — no permitir vender sin stock).
   * Debe ir a true en el flujo de Entrada de mercancía, donde el usuario
   * busca productos precisamente para agregarles stock.
   */
  allowZeroStock?: boolean
}

const MODE_LABEL: Record<ProductoSearchMode, string> = {
  nombre: 'Nombre comercial',
  sustancia: 'Sustancia activa',
  codigo: 'Código'
}

const DEBOUNCE_MS = 180
const SEARCH_LIMIT = 200

export default function SearchModal({ open, onClose, onSelect, allowZeroStock = false }: Props) {
  const [mode, setMode] = useState<ProductoSearchMode>('nombre')
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<ProductoDto[]>([])
  const [loading, setLoading] = useState(false)
  const [idx, setIdx] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const inputRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLTableSectionElement>(null)

  // Paginación: la página se deriva de la fila seleccionada (idx) para no romper
  // la navegación con teclado (↑/↓ saltan de página automáticamente).
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize))
  const page = Math.min(Math.floor(idx / pageSize), totalPages - 1)
  const pageStart = page * pageSize
  const pageItems = results.slice(pageStart, pageStart + pageSize)

  useEffect(() => {
    if (!open) return
    setTerm('')
    setResults([])
    setIdx(0)
    inputRef.current?.focus()
  }, [open])

  // Búsqueda con debounce
  useEffect(() => {
    if (!open) return
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await window.api.productos.search({ mode, term, limit: SEARCH_LIMIT })
        setResults(r)
        setIdx(0)
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [term, mode, open])

  // Auto-scroll a la fila seleccionada (índice relativo a la página visible)
  useEffect(() => {
    const tbody = tableRef.current
    if (!tbody) return
    const row = tbody.children[idx - pageStart] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [idx, pageStart])

  const commit = useCallback(
    (p: ProductoDto) => {
      if (!allowZeroStock && p.existenciasTotal <= 0) {
        toast.error('Sin existencias', {
          description: `"${p.nombre}" no tiene existencias disponibles`
        })
        return
      }
      onSelect(p)
      onClose()
    },
    [onSelect, onClose, allowZeroStock]
  )

  const rotateMode = useCallback(() => {
    setMode((m) => (m === 'nombre' ? 'sustancia' : m === 'sustancia' ? 'codigo' : 'nombre'))
  }, [])

  // Listener propio del modal: F9 (cambiar modo) y Esc (cerrar). Se registra
  // en capture phase para ganarle al useShortcut global del POSPage.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'F9') {
        e.preventDefault()
        e.stopPropagation()
        rotateMode()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose, rotateMode])

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIdx((i) => Math.min(results.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const sel = results[idx]
      if (sel) commit(sel)
    }
  }

  return (
    <Modal open={open} title="Búsqueda de producto" onClose={onClose} maxWidth="max-w-4xl">
      <div className="p-4 space-y-3">
        <div className="flex gap-3 items-center">
          <div className="flex-1">
            <label className="block text-xs text-muted-foreground mb-1">
              Buscar por <span className="font-semibold">{MODE_LABEL[mode]}</span>{' '}
              <span className="text-[10px]">(F9 alterna)</span>
            </label>
            <input
              ref={inputRef}
              type="text"
              className="w-full border border-border rounded px-2 py-1.5"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={onKey}
              placeholder={
                mode === 'codigo'
                  ? 'Código EAN-13 o SKU interno…'
                  : mode === 'sustancia'
                    ? 'Ej. paracetamol, ibuprofeno…'
                    : 'Ej. aspirina, singril, tempra…'
              }
              autoComplete="off"
            />
          </div>
          <div className="text-xs text-muted-foreground pt-5">
            {loading ? (
              <Spinner size={14} label="Buscando…" />
            ) : results.length >= SEARCH_LIMIT ? (
              `${SEARCH_LIMIT}+ resultados · escribe para acotar`
            ) : (
              `${results.length} resultado${results.length === 1 ? '' : 's'}`
            )}
          </div>
        </div>

        <div className="border border-border rounded overflow-auto h-[420px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/40 border-b border-border">
              <tr className="text-left">
                <th className="px-2 py-1 w-[120px] font-mono">Código</th>
                <th className="px-2 py-1">Nombre comercial</th>
                <th className="px-2 py-1">Sustancia activa</th>
                <th className="px-2 py-1 w-20 text-right">Precio</th>
                <th className="px-2 py-1 w-16 text-right">Exist.</th>
              </tr>
            </thead>
            <tbody ref={tableRef}>
              {results.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-8 text-center text-muted-foreground">
                    {loading ? (
                      <span className="inline-flex items-center justify-center">
                        <Spinner label="Buscando…" />
                      </span>
                    ) : term ? (
                      'Sin resultados'
                    ) : (
                      'Escribe para buscar'
                    )}
                  </td>
                </tr>
              )}
              {pageItems.map((p, localI) => {
                const i = pageStart + localI
                const sinStock = p.existenciasTotal <= 0
                // En modo allowZeroStock, los 0 no son "bloqueados" — sólo informativos
                const blocked = sinStock && !allowZeroStock
                return (
                  <tr
                    key={p.id}
                    onClick={() => setIdx(i)}
                    onDoubleClick={() => commit(p)}
                    className={`border-b border-border/60 cursor-pointer ${
                      i === idx ? 'bg-primary/10' : ''
                    } ${blocked ? 'opacity-60' : ''}`}
                    title={blocked ? 'Sin existencias — no se puede agregar' : undefined}
                  >
                    <td className="px-2 py-1 font-mono">{p.codigo}</td>
                    <td className="px-2 py-1">{p.nombre}</td>
                    <td className="px-2 py-1 text-muted-foreground truncate max-w-[220px]">
                      {p.sustanciaActiva ?? ''}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{money(p.precio)}</td>
                    <td
                      className={`px-2 py-1 text-right font-mono ${
                        sinStock
                          ? allowZeroStock
                            ? 'text-muted-foreground'
                            : 'text-red-700 font-semibold'
                          : ''
                      }`}
                    >
                      {p.existenciasTotal}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <footer className="flex justify-between items-center gap-3 px-4 py-2 border-t border-border bg-muted/20 text-xs">
        <div className="text-muted-foreground hidden md:block">
          <span className="font-mono">↑/↓</span> navegar · <span className="font-mono">Enter</span>{' '}
          agregar · <span className="font-mono">F9</span> modo · <span className="font-mono">Esc</span>{' '}
          cerrar
        </div>

        {results.length > 0 && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="border border-border rounded px-1.5 py-1 bg-background"
              title="Resultados por página"
            >
              {[10, 20, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n}/pág
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setIdx(Math.max(0, pageStart - pageSize))}
              disabled={page <= 0}
              className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40"
            >
              ‹
            </button>
            <span className="whitespace-nowrap">
              Pág {page + 1}/{totalPages}
            </span>
            <button
              type="button"
              onClick={() => setIdx(Math.min(results.length - 1, pageStart + pageSize))}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40"
            >
              ›
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1 border border-border rounded hover:bg-muted shrink-0"
        >
          Cerrar
        </button>
      </footer>
    </Modal>
  )
}
