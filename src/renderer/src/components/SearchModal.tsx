import { useCallback, useEffect, useRef, useState } from 'react'
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
  /**
   * Se llama al cerrar SIN seleccionar (Esc, X o botón Cerrar), para que el
   * modal padre regrese el foco a su input de búsqueda. Al seleccionar NO se
   * llama: el padre enfoca su siguiente campo (cantidad, etc.) en onSelect.
   * El padre debe usar un setTimeout: su modal se re-monta al cerrarse éste.
   */
  returnFocus?: () => void
  /**
   * Si se indica, la columna "Exist." muestra el stock de ESA bodega (matriz
   * multi-bodega: entradas/salidas/traspasos con bodega elegida), no la suma
   * global de todas las bodegas.
   */
  bodegaId?: string | null
  /**
   * Selección MÚLTIPLE: marcar varias filas (Insert / Ctrl+Espacio / clic en
   * el checkbox / doble clic) y confirmarlas juntas con Enter o el botón
   * "Agregar N". La marca sobrevive al cambio de página y de término de
   * búsqueda. Default: false — comportamiento de un producto, idéntico al de
   * siempre (Insert no hace nada).
   */
  multiSelect?: boolean
  /**
   * Requerido con multiSelect: recibe los productos marcados (o el resaltado
   * si no hay marcas — así elegir 1 sigue siendo un solo Enter). Con
   * multiSelect activo, onSelect NO se invoca.
   */
  onSelectMany?: (ps: ProductoDto[]) => void
}

const MODE_LABEL: Record<ProductoSearchMode, string> = {
  nombre: 'Nombre comercial',
  sustancia: 'Sustancia activa',
  codigo: 'Código'
}

const DEBOUNCE_MS = 180
const SEARCH_LIMIT = 200

export default function SearchModal({
  open,
  onClose,
  onSelect,
  allowZeroStock = false,
  returnFocus,
  bodegaId,
  multiSelect = false,
  onSelectMany
}: Props) {
  const [mode, setMode] = useState<ProductoSearchMode>('nombre')
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<ProductoDto[]>([])
  const [loading, setLoading] = useState(false)
  const [idx, setIdx] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  // Marcados del modo multi (Map por id): vive APARTE de results, así la
  // selección sobrevive al cambio de término y al paginado.
  const [marked, setMarked] = useState<Map<string, ProductoDto>>(new Map())
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
    setMarked(new Map())
    // Con delay: al abrir desde otro modal (F5) el padre se desmonta en el
    // mismo render y un focus síncrono se pierde. Segundo intento por si otro
    // modal en transición robó el foco entre tanto.
    const t1 = setTimeout(() => inputRef.current?.focus(), 50)
    const t2 = setTimeout(() => {
      const el = inputRef.current
      if (el && document.activeElement !== el) el.focus()
    }, 200)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [open])

  // Búsqueda con debounce
  useEffect(() => {
    if (!open) return
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await window.api.productos.search({
          mode,
          term,
          limit: SEARCH_LIMIT,
          bodegaId: bodegaId ?? null
        })
        setResults(r)
        setIdx(0)
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [term, mode, open, bodegaId])

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

  // Marca/desmarca una fila del modo multi (respeta la regla de stock).
  const toggleMark = useCallback(
    (p: ProductoDto) => {
      if (!allowZeroStock && p.existenciasTotal <= 0) {
        toast.error('Sin existencias', {
          description: `"${p.nombre}" no tiene existencias disponibles`
        })
        return
      }
      setMarked((prev) => {
        const next = new Map(prev)
        if (next.has(p.id)) next.delete(p.id)
        else next.set(p.id, p)
        return next
      })
    },
    [allowZeroStock]
  )

  // Confirma la selección múltiple: los marcados, o la fila resaltada si no
  // hay ninguno (así elegir 1 producto sigue costando un solo Enter).
  const commitMany = useCallback(() => {
    let list: ProductoDto[]
    if (marked.size > 0) {
      list = [...marked.values()]
    } else {
      const sel = results[idx]
      if (!sel) return
      if (!allowZeroStock && sel.existenciasTotal <= 0) {
        toast.error('Sin existencias', {
          description: `"${sel.nombre}" no tiene existencias disponibles`
        })
        return
      }
      list = [sel]
    }
    onSelectMany?.(list)
    onClose()
  }, [marked, results, idx, allowZeroStock, onSelectMany, onClose])

  const rotateMode = useCallback(() => {
    setMode((m) => (m === 'nombre' ? 'sustancia' : m === 'sustancia' ? 'codigo' : 'nombre'))
  }, [])

  // Cierre SIN selección (Esc / X / Cerrar): devuelve el foco al padre.
  const cancel = useCallback(() => {
    onClose()
    returnFocus?.()
  }, [onClose, returnFocus])

  // Listener propio del modal: F9 (cambiar modo), Esc (cerrar), ↑/↓ (navegar)
  // y Enter (agregar). Se registra en capture phase para ganarle al useShortcut
  // global del POSPage. Las flechas/Enter van a nivel ventana (no en el input)
  // para que la navegación funcione aunque el foco esté en otro lado (p. ej.
  // tras hacer clic en una fila de la tabla).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (e.key === 'F9') {
        e.preventDefault()
        e.stopPropagation()
        rotateMode()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancel()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (tag === 'SELECT') return // el select de paginación usa las flechas
        e.preventDefault()
        e.stopPropagation()
        setIdx((i) =>
          e.key === 'ArrowDown' ? Math.min(results.length - 1, i + 1) : Math.max(0, i - 1)
        )
      } else if (multiSelect && (e.key === 'Insert' || (e.ctrlKey && e.code === 'Space'))) {
        // Marcar en ráfaga: ni Insert ni Ctrl+Espacio escriben en el input, y
        // tras marcar se auto-avanza a la siguiente fila (estilo explorador).
        e.preventDefault()
        e.stopPropagation()
        const sel = results[idx]
        if (sel) {
          toggleMark(sel)
          setIdx((i) => Math.min(results.length - 1, i + 1))
        }
      } else if (e.key === 'Enter') {
        // En botones/selects, Enter conserva su acción nativa (p. ej. Cerrar)
        if (tag === 'BUTTON' || tag === 'SELECT') return
        e.preventDefault()
        e.stopPropagation()
        if (multiSelect) {
          commitMany()
        } else {
          const sel = results[idx]
          if (sel) commit(sel)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, cancel, rotateMode, results, idx, commit, multiSelect, toggleMark, commitMany])

  return (
    <Modal open={open} title="Búsqueda de producto" onClose={cancel} maxWidth="max-w-4xl">
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
          <div className="text-xs text-muted-foreground pt-5 text-right">
            {loading ? (
              <Spinner size={14} label="Buscando…" />
            ) : results.length >= SEARCH_LIMIT ? (
              `${SEARCH_LIMIT}+ resultados · escribe para acotar`
            ) : (
              `${results.length} resultado${results.length === 1 ? '' : 's'}`
            )}
            {multiSelect && marked.size > 0 && (
              <div className="font-semibold text-emerald-700">
                {marked.size} marcado{marked.size === 1 ? '' : 's'}
              </div>
            )}
          </div>
        </div>

        <div className="border border-border rounded overflow-auto h-[420px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/40 border-b border-border">
              <tr className="text-left">
                {multiSelect && <th className="px-2 py-1 w-8" />}
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
                  <td
                    colSpan={multiSelect ? 6 : 5}
                    className="px-2 py-8 text-center text-muted-foreground"
                  >
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
                    onDoubleClick={() => (multiSelect ? toggleMark(p) : commit(p))}
                    className={`border-b border-border/60 cursor-pointer ${
                      i === idx ? 'bg-primary/10' : ''
                    } ${multiSelect && marked.has(p.id) ? 'bg-emerald-50' : ''} ${
                      blocked ? 'opacity-60' : ''
                    }`}
                    title={blocked ? 'Sin existencias — no se puede agregar' : undefined}
                  >
                    {multiSelect && (
                      <td
                        className="px-2 py-1 text-center"
                        onClick={(e) => {
                          e.stopPropagation()
                          setIdx(i)
                          toggleMark(p)
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={marked.has(p.id)}
                          readOnly
                          tabIndex={-1}
                          className="pointer-events-none align-middle"
                        />
                      </td>
                    )}
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
          {multiSelect ? (
            <>
              <span className="font-mono">Insert</span>/<span className="font-mono">Ctrl+Espacio</span>{' '}
              marcar · <span className="font-mono">Enter</span> agregar marcados ·{' '}
              <span className="font-mono">F9</span> modo · <span className="font-mono">Esc</span>{' '}
              cancelar
            </>
          ) : (
            <>
              <span className="font-mono">↑/↓</span> navegar ·{' '}
              <span className="font-mono">Enter</span> agregar · <span className="font-mono">F9</span>{' '}
              modo · <span className="font-mono">Esc</span> cerrar
            </>
          )}
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

        <div className="flex items-center gap-2 shrink-0">
          {multiSelect && (
            <button
              type="button"
              onClick={commitMany}
              disabled={marked.size === 0}
              className="px-3 py-1 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
            >
              Agregar {marked.size} seleccionado{marked.size === 1 ? '' : 's'}
            </button>
          )}
          <button
            type="button"
            onClick={cancel}
            className="px-3 py-1 border border-border rounded hover:bg-muted"
          >
            Cerrar
          </button>
        </div>
      </footer>
    </Modal>
  )
}
