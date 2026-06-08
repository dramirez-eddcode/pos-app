import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import Modal from './Modal'
import SearchModal from './SearchModal'
import InfoTooltip from './InfoTooltip'
import Spinner from './Spinner'
import type { LoteInfo, ProductoDto, SalidaItemInput } from '@shared/dto'
import type { MotivoSalida } from '@shared/types'

interface Row extends SalidaItemInput {
  fechaCaducidad: string
}

interface Props {
  open: boolean
  onClose: () => void
  userId: string
  userNombre: string
}

const MOTIVO_OPTIONS: { value: MotivoSalida; label: string; hint: string }[] = [
  { value: 'CADUCIDAD', label: 'Caducidad', hint: 'Lote vencido o próximo a vencer, se retira' },
  { value: 'MERMA', label: 'Merma', hint: 'Producto dañado, roto, derramado' },
  { value: 'TRASPASO', label: 'Traspaso', hint: 'Se mueve a otra sucursal' },
  { value: 'MUESTRA', label: 'Muestra / regalo', hint: 'Entregado sin cobro' },
  { value: 'AJUSTE', label: 'Ajuste', hint: 'Corrección de inventario' },
  { value: 'OTRO', label: 'Otro', hint: 'Usa el campo de nota para explicar' }
]

function isoToYmd(iso: string): string {
  return iso.slice(0, 10)
}

export default function SalidasModal({ open, onClose, userId, userNombre }: Props) {
  const [items, setItems] = useState<Row[]>([])
  const [current, setCurrent] = useState<ProductoDto | null>(null)
  const [lotes, setLotes] = useState<LoteInfo[]>([])
  const [codigo, setCodigo] = useState('')
  const [loteId, setLoteId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState<MotivoSalida>('CADUCIDAD')
  const [nota, setNota] = useState('')
  const [saving, setSaving] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const codRef = useRef<HTMLInputElement>(null)
  const loteRef = useRef<HTMLSelectElement>(null)
  const cantRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setItems([])
    setCurrent(null)
    setLotes([])
    setCodigo('')
    setLoteId('')
    setCantidad('')
    setMotivo('CADUCIDAD')
    setNota('')
  }, [])

  const resetRow = useCallback(() => {
    setCurrent(null)
    setLotes([])
    setCodigo('')
    setLoteId('')
    setCantidad('')
    setNota('')
    setTimeout(() => codRef.current?.focus(), 30)
  }, [])

  useEffect(() => {
    if (!open) return
    reset()
    setTimeout(() => codRef.current?.focus(), 80)
  }, [open, reset])

  const setFromProduct = useCallback(async (p: ProductoDto) => {
    setCurrent(p)
    setCodigo(p.codigo)
    try {
      const ls = await window.api.productos.getLotes(p.id)
      // En salidas sólo mostramos lotes con saldo > 0 (no se puede sacar de nada)
      const activos = ls.filter((l) => l.saldo > 0)
      setLotes(activos)
      if (activos.length === 0) {
        toast.warning(`"${p.nombre}" no tiene lotes con saldo`, {
          description: 'Los lotes agotados no aparecen porque no hay nada que sacar.'
        })
        setLoteId('')
        return
      }
      const first = activos[0]!
      setLoteId(first.id)
      setTimeout(() => cantRef.current?.focus(), 30)
    } catch (e) {
      toast.error('No se pudieron cargar los lotes', {
        description: e instanceof Error ? e.message : String(e)
      })
    }
  }, [])

  const lookupByCode = useCallback(async () => {
    const c = codigo.trim()
    if (!c) return
    const p = await window.api.productos.byCodigo(c)
    if (!p) {
      toast.error(`Producto "${c}" no encontrado`)
      return
    }
    await setFromProduct(p)
  }, [codigo, setFromProduct])

  const currentLote = lotes.find((l) => l.id === loteId)

  const addItem = useCallback(() => {
    if (!current) {
      toast.error('Busca un producto primero')
      return
    }
    const l = lotes.find((x) => x.id === loteId)
    if (!l) {
      toast.error('Selecciona un lote')
      return
    }
    const qty = Math.round(parseFloat(cantidad))
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Cantidad inválida (debe ser > 0)')
      return
    }
    // Suma lo que ya está pendiente para este lote
    const pendiente = items
      .filter((it) => it.loteId === l.id)
      .reduce((s, it) => s + it.cantidad, 0)
    if (pendiente + qty > l.saldo) {
      const disponible = Math.max(0, l.saldo - pendiente)
      toast.error(
        `Excedes el saldo: lote tiene ${l.saldo}, ${pendiente > 0 ? `ya pendiente ${pendiente}, disponible ${disponible}` : ''}`
      )
      return
    }
    setItems((prev) => [
      ...prev,
      {
        loteId: l.id,
        productoNombre: current.nombre,
        codigo: current.codigo,
        saldoActual: l.saldo,
        cantidad: qty,
        motivo,
        nota: nota.trim() || null,
        fechaCaducidad: l.fechaCaducidad
      }
    ])
    resetRow()
  }, [current, lotes, loteId, cantidad, motivo, nota, items, resetRow])

  const removeItem = useCallback((i: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }, [])

  const save = useCallback(async () => {
    if (items.length === 0) {
      toast.error('No hay salidas que registrar')
      return
    }
    setSaving(true)
    try {
      const r = await window.api.salidas.create({
        cajeroId: userId,
        items: items.map(({ fechaCaducidad: _omit, ...rest }) => rest)
      })
      toast.success(
        `Salida registrada: ${r.itemsCreados} ${r.itemsCreados === 1 ? 'línea' : 'líneas'}, ${r.unidadesTotales} unidad${r.unidadesTotales === 1 ? '' : 'es'}`,
        { description: `Registrada por ${userNombre}` }
      )
      onClose()
    } catch (e) {
      toast.error('Falló el guardado', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setSaving(false)
    }
  }, [items, userId, userNombre, onClose])

  const onKeyCode = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      lookupByCode()
    } else if (e.key === 'F5') {
      e.preventDefault()
      setSearchOpen(true)
    }
  }
  const onKeyCantidad = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addItem()
    }
  }

  // Totales
  const totalUnidades = items.reduce((s, i) => s + i.cantidad, 0)

  return (
    <>
      <Modal
        open={open && !searchOpen}
        title="Registro de salidas de tienda"
        onClose={onClose}
        maxWidth="max-w-4xl"
      >
        <div className="p-4 text-sm space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Formulario de captura */}
          <section className="border border-border rounded p-3 bg-muted/10 space-y-3">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Código o nombre{' '}
                  <span className="font-mono">(Enter busca · F5 abre búsqueda)</span>
                </label>
                <input
                  ref={codRef}
                  type="text"
                  className="w-full border border-border rounded px-2 py-1.5 font-mono"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  onKeyDown={onKeyCode}
                  placeholder="EAN-13 o SKU interno…"
                  autoComplete="off"
                />
              </div>
              <div className="self-end">
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="px-3 py-1.5 border border-border rounded hover:bg-muted"
                >
                  Buscar (F5)
                </button>
              </div>
            </div>

            {current && (
              <div className="text-xs bg-background border border-border rounded px-3 py-2">
                <span className="text-muted-foreground">Producto: </span>
                <span className="font-semibold">{current.nombre}</span>
                <span className="text-muted-foreground ml-2 font-mono">{current.codigo}</span>
                <span className="text-muted-foreground ml-3">
                  Existencias totales:{' '}
                  <span className="font-mono font-semibold">{current.existenciasTotal}</span>
                </span>
              </div>
            )}

            <div className="grid grid-cols-[1fr_140px_1fr] gap-2">
              <div>
                <label className="flex items-center text-xs text-muted-foreground mb-1">
                  Lote (FEFO)
                  <InfoTooltip title="Lote del que sale la mercancía" align="start">
                    Solo se muestran lotes <strong>con saldo {'>'} 0</strong>, ordenados por
                    caducidad. Selecciona de qué lote sale — si la salida es por caducidad, será
                    el más próximo a vencer.
                  </InfoTooltip>
                </label>
                <select
                  ref={loteRef}
                  value={loteId}
                  onChange={(e) => setLoteId(e.target.value)}
                  disabled={!current || lotes.length === 0}
                  className="w-full border border-border rounded px-2 py-1.5 bg-background text-xs font-mono"
                >
                  <option value="">— elige lote —</option>
                  {lotes.map((l) => (
                    <option key={l.id} value={l.id}>
                      Cad. {isoToYmd(l.fechaCaducidad)} · saldo {l.saldo}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flex items-center text-xs text-muted-foreground mb-1">
                  Cantidad
                  <InfoTooltip title="Unidades que salen" align="center">
                    Cuántas unidades se retiran del lote. Se resta directo del saldo. Debe ser{' '}
                    <strong>{'≤'} saldo actual</strong> del lote.
                    <div className="mt-1.5 pt-1.5 border-t border-primary-foreground/20 italic">
                      Ej: un lote de aspirinas vencido con 7 unidades → captura{' '}
                      <strong>7</strong> con motivo Caducidad.
                    </div>
                  </InfoTooltip>
                </label>
                <input
                  ref={cantRef}
                  type="number"
                  min={1}
                  step={1}
                  max={currentLote?.saldo ?? undefined}
                  className="w-full border border-border rounded px-2 py-1.5 font-mono text-right"
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  onKeyDown={onKeyCantidad}
                  disabled={!loteId}
                />
              </div>
              <div>
                <label className="flex items-center text-xs text-muted-foreground mb-1">
                  Motivo
                  <InfoTooltip title="Motivo de salida" align="end">
                    La razón queda en <span className="font-mono">mov_stock</span> con tipo{' '}
                    <span className="font-mono">SALIDA</span>. Si es "Otro", usa la nota para
                    explicar.
                  </InfoTooltip>
                </label>
                <select
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value as MotivoSalida)}
                  disabled={!loteId}
                  className="w-full border border-border rounded px-2 py-1.5 bg-background text-xs"
                >
                  {MOTIVO_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value} title={m.hint}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Nota (opcional)</label>
              <input
                type="text"
                maxLength={200}
                className="w-full border border-border rounded px-2 py-1.5 text-xs"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder='Ej: "Traspaso a Torres Landa", "Muestra Dr. Pérez", "Caducaron 15 abril"…'
                disabled={!loteId}
              />
            </div>

            <div className="flex justify-between items-center">
              <div className="text-xs text-muted-foreground">
                Registrada por: <span className="font-semibold">{userNombre}</span>
              </div>
              <button
                type="button"
                onClick={addItem}
                disabled={!loteId || !cantidad}
                className="px-4 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-medium"
              >
                Agregar salida
              </button>
            </div>
          </section>

          {/* Tabla de salidas pendientes */}
          <section className="border border-border rounded">
            <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide flex justify-between">
              <span>Salidas a registrar</span>
              <span className="text-[10px] normal-case text-muted-foreground">
                {items.length} línea{items.length === 1 ? '' : 's'}
                {items.length > 0 && ` · ${totalUnidades} unidades`}
              </span>
            </header>
            <div className="overflow-auto max-h-[260px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background border-b border-border">
                  <tr className="text-left">
                    <th className="px-2 py-1">Producto</th>
                    <th className="px-2 py-1 w-24">Caducidad</th>
                    <th className="px-2 py-1 w-16 text-right">Saldo</th>
                    <th className="px-2 py-1 w-16 text-right">Sale</th>
                    <th className="px-2 py-1 w-16 text-right">Queda</th>
                    <th className="px-2 py-1 w-28">Motivo</th>
                    <th className="px-2 py-1 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-2 py-6 text-center text-muted-foreground italic"
                      >
                        Sin salidas — captura una arriba
                      </td>
                    </tr>
                  )}
                  {items.map((it, i) => {
                    const queda = it.saldoActual - it.cantidad
                    return (
                      <tr key={i} className="border-b border-border/60">
                        <td className="px-2 py-1">
                          <div>{it.productoNombre}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {it.codigo}
                          </div>
                          {it.nota && (
                            <div className="text-[10px] text-muted-foreground italic">
                              {it.nota}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1 font-mono text-[11px]">
                          {isoToYmd(it.fechaCaducidad)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{it.saldoActual}</td>
                        <td className="px-2 py-1 text-right font-mono font-semibold text-red-700">
                          -{it.cantidad}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{queda}</td>
                        <td className="px-2 py-1 text-[11px]">{it.motivo}</td>
                        <td className="px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => removeItem(i)}
                            className="p-1 hover:bg-red-50 rounded text-red-700"
                            title="Quitar"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <footer className="flex justify-between items-center px-4 py-3 border-t border-border bg-muted/20">
          <div className="text-xs text-muted-foreground">
            Cada línea crea un <span className="font-mono">mov_stock</span> tipo=SALIDA y resta
            del saldo del lote.
          </div>
          <div className="flex gap-2">
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
              onClick={save}
              disabled={saving || items.length === 0}
              className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
            >
              {saving ? (
                <>
                  <Spinner size={14} /> Guardando…
                </>
              ) : (
                'Registrar salida'
              )}
            </button>
          </div>
        </footer>
      </Modal>

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(p) => setFromProduct(p)}
        allowZeroStock
      />
    </>
  )
}
