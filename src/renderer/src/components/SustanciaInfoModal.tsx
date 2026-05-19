import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import Modal from './Modal'
import { money } from '../lib/format'
import type { LoteInfo, ProductoDto, ProductoSearchMode } from '@shared/dto'
import type { IvaModo } from '@shared/types'

const IVA_MODO_LABEL: Record<IvaModo, string> = {
  exento: 'exento',
  sumar: 'se suma',
  incluido: 'incluido'
}

function ivaDisplay(p: Pick<ProductoDto, 'ivaModo' | 'ivaPorcentaje'>): string {
  if (p.ivaModo === 'exento') return 'Exento'
  return `${p.ivaPorcentaje}% (${IVA_MODO_LABEL[p.ivaModo]})`
}

interface Props {
  open: boolean
  onClose: () => void
}

const MODE_LABEL: Record<ProductoSearchMode, string> = {
  nombre: 'Nombre comercial',
  sustancia: 'Sustancia activa',
  codigo: 'Código'
}

const DEBOUNCE_MS = 180

function isoToYmd(iso: string): string {
  return iso.slice(0, 10)
}

function formatFichaText(p: ProductoDto, lotes: LoteInfo[]): string {
  const lines: string[] = []
  lines.push(p.nombre)
  lines.push(`Código: ${p.codigo}`)
  lines.push(`Sustancia activa: ${p.sustanciaActiva ?? '—'}`)
  lines.push(`Laboratorio: ${p.laboratorio ?? '—'}`)
  lines.push(`Precio: $${p.precio.toFixed(2)}`)
  lines.push(`IVA: ${ivaDisplay(p)}`)
  lines.push(`Existencias: ${p.existenciasTotal}`)
  if (p.descripcion) {
    lines.push('')
    lines.push('Descripción:')
    lines.push(p.descripcion)
  }
  if (lotes.length > 0) {
    lines.push('')
    lines.push('Lotes:')
    for (const l of lotes) {
      lines.push(`  ${isoToYmd(l.fechaCaducidad)} — saldo ${l.saldo} de ${l.total}`)
    }
  }
  return lines.join('\n')
}

export default function SustanciaInfoModal({ open, onClose }: Props) {
  const [mode, setMode] = useState<ProductoSearchMode>('sustancia')
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<ProductoDto[]>([])
  const [loading, setLoading] = useState(false)
  const [idx, setIdx] = useState(0)
  const [lotes, setLotes] = useState<LoteInfo[]>([])
  const [loadingLotes, setLoadingLotes] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)

  const rotateMode = useCallback(() => {
    setMode((m) => (m === 'nombre' ? 'sustancia' : m === 'sustancia' ? 'codigo' : 'nombre'))
  }, [])

  useEffect(() => {
    if (!open) return
    setTerm('')
    setResults([])
    setLotes([])
    setIdx(0)
    setMode('sustancia')
    setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])

  // F9 + Esc en capture phase (ignora foco en input, como en SearchModal)
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
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
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [open, onClose, rotateMode])

  // Búsqueda con debounce
  useEffect(() => {
    if (!open) return
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await window.api.productos.search({ mode, term, limit: 200 })
        setResults(r)
        setIdx(0)
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [term, mode, open])

  // Auto-scroll de la fila seleccionada
  useEffect(() => {
    const tb = tableBodyRef.current
    if (!tb || idx < 0 || idx >= results.length) return
    const row = tb.children[idx] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [idx, results.length])

  // Carga los lotes del producto seleccionado cuando cambia
  const selected = results[idx]
  useEffect(() => {
    if (!selected) {
      setLotes([])
      return
    }
    setLoadingLotes(true)
    window.api.productos
      .getLotes(selected.id)
      .then(setLotes)
      .catch((e) => {
        console.error('[F7] getLotes error:', e)
        setLotes([])
      })
      .finally(() => setLoadingLotes(false))
  }, [selected?.id])

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIdx((i) => Math.min(results.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIdx((i) => Math.max(0, i - 1))
    }
  }

  const copyFicha = useCallback(async () => {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(formatFichaText(selected, lotes))
      toast.success('Ficha copiada al portapapeles')
    } catch (e) {
      toast.error('No pude copiar', {
        description: e instanceof Error ? e.message : String(e)
      })
    }
  }, [selected, lotes])

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayMs = today.getTime()

  return (
    <Modal
      open={open}
      title="Información de medicamentos — F7"
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      <div className="p-4 text-sm">
        <div className="grid grid-cols-[1fr_400px] gap-4 h-[65vh] min-h-0">
          {/* Izquierda: búsqueda + lista */}
          <section className="flex flex-col min-h-0 space-y-2">
            <div>
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
                      ? 'Ej. paracetamol, ibuprofeno, amoxicilina…'
                      : 'Ej. aspirina, tempra, advil…'
                }
                autoComplete="off"
              />
            </div>

            <div className="flex-1 min-h-0 border border-border rounded overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                  <tr className="text-left">
                    <th className="px-2 py-1 w-[110px] font-mono">Código</th>
                    <th className="px-2 py-1">Nombre comercial</th>
                    <th className="px-2 py-1">Sustancia activa</th>
                    <th className="px-2 py-1 w-14 text-right">Exist.</th>
                  </tr>
                </thead>
                <tbody ref={tableBodyRef}>
                  {results.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-8 text-center text-muted-foreground italic">
                        {loading ? 'Buscando…' : term ? 'Sin resultados' : 'Escribe para buscar'}
                      </td>
                    </tr>
                  )}
                  {results.map((p, i) => (
                    <tr
                      key={p.id}
                      onClick={() => setIdx(i)}
                      className={`border-b border-border/60 cursor-pointer ${
                        i === idx ? 'bg-primary/10' : ''
                      }`}
                    >
                      <td className="px-2 py-1 font-mono">{p.codigo}</td>
                      <td className="px-2 py-1">{p.nombre}</td>
                      <td className="px-2 py-1 text-muted-foreground truncate max-w-[200px]">
                        {p.sustanciaActiva ?? ''}
                      </td>
                      <td
                        className={`px-2 py-1 text-right font-mono ${
                          p.existenciasTotal === 0 ? 'text-muted-foreground' : ''
                        }`}
                      >
                        {p.existenciasTotal}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-[10px] text-muted-foreground">
              {results.length > 0
                ? `${results.length} resultado${results.length === 1 ? '' : 's'}`
                : ''}
            </div>
          </section>

          {/* Derecha: ficha del producto */}
          <aside className="border border-border rounded bg-background flex flex-col min-h-0">
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground italic text-xs p-6 text-center">
                Selecciona un producto de la izquierda para ver su ficha completa
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-auto p-4 space-y-3 text-xs">
                  <header className="space-y-1">
                    <h3 className="text-base font-bold leading-tight">{selected.nombre}</h3>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      Código: {selected.codigo}
                    </div>
                  </header>

                  <div className="border-t border-border pt-2 space-y-2">
                    <Campo label="Sustancia activa">
                      <span className="font-medium">
                        {selected.sustanciaActiva ?? (
                          <span className="italic text-muted-foreground">sin información</span>
                        )}
                      </span>
                    </Campo>

                    <Campo label="Laboratorio">
                      {selected.laboratorio ?? (
                        <span className="italic text-muted-foreground">sin información</span>
                      )}
                    </Campo>

                    <Campo label="Descripción">
                      {selected.descripcion ? (
                        <div className="whitespace-pre-wrap">{selected.descripcion}</div>
                      ) : (
                        <span className="italic text-muted-foreground">
                          sin información (se puede agregar en una versión futura como
                          catálogo editable)
                        </span>
                      )}
                    </Campo>
                  </div>

                  <div className="border-t border-border pt-2 grid grid-cols-3 gap-2 font-mono">
                    <Mini label="Precio" value={`$${money(selected.precio)}`} highlight />
                    <Mini label="IVA" value={ivaDisplay(selected)} />
                    <Mini
                      label="Existencias"
                      value={String(selected.existenciasTotal)}
                      highlight
                    />
                  </div>

                  <div className="border-t border-border pt-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                      Lotes {loadingLotes ? '(cargando…)' : `(${lotes.length})`}
                    </div>
                    {!loadingLotes && lotes.length === 0 && (
                      <div className="text-muted-foreground italic text-[11px]">
                        Sin lotes registrados
                      </div>
                    )}
                    {lotes.length > 0 && (
                      <table className="w-full text-[11px] font-mono">
                        <thead className="border-b border-border">
                          <tr className="text-left">
                            <th className="py-1">Caducidad</th>
                            <th className="py-1 text-right">Saldo</th>
                            <th className="py-1 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lotes.map((l) => {
                            const caducadoMs = new Date(l.fechaCaducidad).getTime()
                            const vencido = caducadoMs < todayMs
                            return (
                              <tr
                                key={l.id}
                                className={`border-b border-border/60 ${
                                  vencido ? 'text-red-700' : l.saldo === 0 ? 'text-muted-foreground' : ''
                                }`}
                              >
                                <td className="py-0.5">
                                  {isoToYmd(l.fechaCaducidad)}
                                  {vencido && <span className="ml-1 text-[9px]">(vencido)</span>}
                                </td>
                                <td className="py-0.5 text-right">{l.saldo}</td>
                                <td className="py-0.5 text-right text-muted-foreground">
                                  {l.total}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                <footer className="border-t border-border p-2 bg-muted/20 flex justify-end">
                  <button
                    type="button"
                    onClick={copyFicha}
                    className="inline-flex items-center gap-1.5 px-3 py-1 border border-border rounded hover:bg-muted text-xs"
                    title="Copiar la ficha al portapapeles"
                  >
                    <Copy className="size-3.5" />
                    Copiar ficha
                  </button>
                </footer>
              </>
            )}
          </aside>
        </div>
      </div>

      <footer className="flex justify-between items-center px-4 py-2 border-t border-border bg-muted/20 text-xs">
        <div className="text-muted-foreground">
          <span className="font-mono">↑/↓</span> navegar ·{' '}
          <span className="font-mono">F9</span> cambiar modo · <span className="font-mono">Esc</span>{' '}
          cerrar
        </div>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1 border border-border rounded hover:bg-muted"
        >
          Cerrar
        </button>
      </footer>
    </Modal>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs leading-relaxed">{children}</div>
    </div>
  )
}

function Mini({
  label,
  value,
  highlight
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[9px] uppercase text-muted-foreground sans-serif">{label}</div>
      <div
        className={`text-right ${highlight ? 'text-sm font-bold text-blue-700' : 'text-xs'}`}
      >
        {value}
      </div>
    </div>
  )
}
