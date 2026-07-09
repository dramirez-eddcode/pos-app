import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import Modal from './Modal'
import SearchModal from './SearchModal'
import InfoTooltip from './InfoTooltip'
import Spinner from './Spinner'
import ConfirmMovimientoModal from './ConfirmMovimientoModal'
import type { BodegaDto, LoteInfo, ProductoDto, SalidaItemInput } from '@shared/dto'
import type { MotivoSalida } from '@shared/types'

// Renglón capturado. El motivo y la nota NO van por renglón: son de TODA la
// salida (se eligen una vez y se aplican a todas las líneas al guardar).
interface Row {
  loteId: string
  productoNombre: string
  codigo: string
  saldoActual: number
  cantidad: number
  fechaCaducidad: string
}

interface Props {
  open: boolean
  onClose: () => void
  userId: string
  userNombre: string
  onSaved?: () => void
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

export default function SalidasModal({ open, onClose, userId, userNombre, onSaved }: Props) {
  const [items, setItems] = useState<Row[]>([])
  const [current, setCurrent] = useState<ProductoDto | null>(null)
  const [lotes, setLotes] = useState<LoteInfo[]>([])
  const [codigo, setCodigo] = useState('')
  const [loteId, setLoteId] = useState('')
  // 'auto' (default): capturas la cantidad total y se reparte FEFO entre los
  // lotes (el más próximo a caducar primero). 'lote': eliges lote específico.
  const [modo, setModo] = useState<'auto' | 'lote'>('auto')
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState<MotivoSalida>('CADUCIDAD')
  const [nota, setNota] = useState('')
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [bodegas, setBodegas] = useState<BodegaDto[]>([])
  const [bodegaId, setBodegaId] = useState('')

  const codRef = useRef<HTMLInputElement>(null)
  const loteRef = useRef<HTMLSelectElement>(null)
  const cantRef = useRef<HTMLInputElement>(null)
  // Renglón "activo" de la tabla, para repasar lo capturado: clic o flechas
  // lo sombrean y recorren.
  const [selRow, setSelRow] = useState(-1)
  const tablaRef = useRef<HTMLDivElement>(null)
  const tbodyRef = useRef<HTMLTableSectionElement>(null)

  const reset = useCallback(() => {
    setItems([])
    setCurrent(null)
    setLotes([])
    setCodigo('')
    setLoteId('')
    setCantidad('')
    setMotivo('CADUCIDAD')
    setNota('')
    setPreview(false)
    setModo('auto')
    setSelRow(-1)
  }, [])

  const resetRow = useCallback(() => {
    setCurrent(null)
    setLotes([])
    setCodigo('')
    setLoteId('')
    setCantidad('')
    // motivo y nota NO se limpian: son de toda la salida
    setTimeout(() => codRef.current?.focus(), 30)
  }, [])

  useEffect(() => {
    if (!open) return
    reset()
    setTimeout(() => codRef.current?.focus(), 80)
    // En matriz puede haber varias bodegas: la salida se captura por bodega.
    window.api.bodegas
      .list()
      .then((bs) => {
        const activas = bs.filter((b) => b.activa)
        setBodegas(activas)
        const principal = activas.find((b) => b.esPrincipal) ?? activas[0]
        setBodegaId(principal?.id ?? '')
      })
      .catch(() => {})
  }, [open, reset])

  const setFromProduct = useCallback(
    async (p: ProductoDto) => {
      setCurrent(p)
      setCodigo(p.codigo)
      try {
        // getLotes ya regresa sólo lotes con saldo > 0 (no se puede sacar de nada)
        const ls = await window.api.productos.getLotes(p.id, bodegaId || undefined)
        setLotes(ls)
        if (ls.length === 0) {
          toast.warning(`"${p.nombre}" no tiene lotes con saldo en esta bodega`, {
            description: 'Los lotes agotados no aparecen porque no hay nada que sacar.'
          })
          setLoteId('')
          return
        }
        if (modo === 'auto') {
          setLoteId('')
        } else {
          const first = ls[0]!
          setLoteId(first.id)
        }
        setTimeout(() => cantRef.current?.focus(), 30)
      } catch (e) {
        toast.error('No se pudieron cargar los lotes', {
          description: e instanceof Error ? e.message : String(e)
        })
      }
    },
    [bodegaId, modo]
  )

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

  // Lo ya capturado (pendiente) por lote, para no exceder el saldo real.
  const pendienteDeLote = useCallback(
    (id: string): number =>
      items.filter((it) => it.loteId === id).reduce((s, it) => s + it.cantidad, 0),
    [items]
  )

  // Disponible total del producto en la bodega (saldos menos pendientes).
  const disponibleTotal = lotes.reduce(
    (s, l) => s + Math.max(0, l.saldo - pendienteDeLote(l.id)),
    0
  )

  const addItem = useCallback(() => {
    if (!current) {
      toast.error('Busca un producto primero')
      return
    }
    const qty = Math.round(parseFloat(cantidad))
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Cantidad inválida (debe ser > 0)')
      return
    }

    if (modo === 'auto') {
      // Reparto FEFO: descuenta del lote más próximo a caducar hacia adelante
      // (getLotes ya viene en ese orden), respetando lo ya capturado.
      if (lotes.length === 0) {
        toast.error('El producto no tiene lotes con saldo')
        return
      }
      if (qty > disponibleTotal) {
        toast.error(
          `Excedes lo disponible: hay ${disponibleTotal} unidad${disponibleTotal === 1 ? '' : 'es'}${
            disponibleTotal !== lotes.reduce((s, l) => s + l.saldo, 0)
              ? ' (contando lo ya capturado)'
              : ''
          }`
        )
        return
      }
      const nuevos: Row[] = []
      let restante = qty
      for (const l of lotes) {
        if (restante <= 0) break
        const disp = Math.max(0, l.saldo - pendienteDeLote(l.id))
        if (disp <= 0) continue
        const toma = Math.min(disp, restante)
        restante -= toma
        nuevos.push({
          loteId: l.id,
          productoNombre: current.nombre,
          codigo: current.codigo,
          saldoActual: l.saldo,
          cantidad: toma,
          fechaCaducidad: l.fechaCaducidad
        })
      }
      setItems((prev) => [...prev, ...nuevos])
      if (nuevos.length > 1) {
        toast.success(`${qty} unidades repartidas en ${nuevos.length} lotes (FEFO)`)
      }
    } else {
      const l = lotes.find((x) => x.id === loteId)
      if (!l) {
        toast.error('Selecciona un lote')
        return
      }
      // Suma lo que ya está pendiente para este lote
      const pendiente = pendienteDeLote(l.id)
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
          fechaCaducidad: l.fechaCaducidad
        }
      ])
    }
    resetRow()
  }, [current, lotes, loteId, cantidad, modo, disponibleTotal, pendienteDeLote, resetRow])

  // Al cambiar de modo con un producto cargado, ajusta el prefill del lote.
  const onModoChange = (m: 'auto' | 'lote'): void => {
    setModo(m)
    if (lotes.length === 0) return
    if (m === 'auto') setLoteId('')
    else setLoteId(lotes[0]!.id)
    setTimeout(() => cantRef.current?.focus(), 30)
  }

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
      // El motivo/nota (de toda la salida) se aplica a cada línea al guardar.
      const notaLimpia = nota.trim() || null
      const r = await window.api.salidas.create({
        cajeroId: userId,
        bodegaId: bodegaId || null,
        items: items.map<SalidaItemInput>(({ fechaCaducidad: _omit, ...rest }) => ({
          ...rest,
          motivo,
          nota: notaLimpia
        }))
      })
      toast.success(
        `Salida registrada: ${r.itemsCreados} ${r.itemsCreados === 1 ? 'línea' : 'líneas'}, ${r.unidadesTotales} unidad${r.unidadesTotales === 1 ? '' : 'es'}`,
        {
          description: `Folio S-${r.numero} · Registrada por ${userNombre}`,
          duration: 10000,
          action: {
            label: 'Imprimir PDF',
            onClick: () => {
              window.api.movimientos.pdf(r.movimientoId).then((p) => {
                if (!p.ok && !p.cancelled) {
                  toast.error('No se pudo generar el PDF', { description: p.error })
                }
              })
            }
          }
        }
      )
      onSaved?.()
      onClose()
    } catch (e) {
      toast.error('Falló el guardado', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setSaving(false)
    }
  }, [items, motivo, nota, userId, userNombre, bodegaId, onSaved, onClose])

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

  // ↑/↓ con la tabla enfocada recorren y sombrean los renglones capturados
  // (para repasar lo ingresado). preventDefault evita que la navegación
  // genérica del modal se lleve el foco a otro campo.
  const onKeyTabla = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (items.length === 0) return
    e.preventDefault()
    setSelRow((i) =>
      e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)
    )
  }

  // Mantén visible el renglón activo y ajusta si la lista cambia.
  useEffect(() => {
    if (selRow < 0) return
    if (selRow > items.length - 1) {
      setSelRow(items.length - 1)
      return
    }
    const row = tbodyRef.current?.children[selRow] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [selRow, items.length])

  // Abre el preview de confirmación (no registra todavía).
  const pedirConfirmacion = useCallback(() => {
    if (items.length === 0) {
      toast.error('No hay salidas que registrar')
      return
    }
    setPreview(true)
  }, [items])

  // Totales
  const totalUnidades = items.reduce((s, i) => s + i.cantidad, 0)

  return (
    <>
      <Modal
        open={open && !searchOpen}
        title="Registro de salidas de inventario"
        onClose={onClose}
        maxWidth="max-w-4xl"
      >
        <div className="p-4 text-sm space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Bodega origen (matriz multi-bodega) */}
          {bodegas.length > 1 && (
            <section className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap font-medium">
                Bodega origen:
              </label>
              <select
                className="border border-border rounded px-2 py-1.5 bg-background text-sm"
                value={bodegaId}
                onChange={(e) => {
                  setBodegaId(e.target.value)
                  resetRow()
                }}
                disabled={items.length > 0}
                title={
                  items.length > 0
                    ? 'Hay salidas capturadas: una salida pertenece a una sola bodega'
                    : undefined
                }
              >
                {bodegas.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nombre}
                    {b.esPrincipal ? ' (principal)' : ''}
                  </option>
                ))}
              </select>
              {items.length > 0 && (
                <span className="text-[10px] text-muted-foreground italic">
                  Bloqueada: ya hay líneas capturadas de esta bodega.
                </span>
              )}
            </section>
          )}

          {/* Motivo de TODA la salida — se elige ANTES de capturar */}
          <section className="border border-border rounded p-3 bg-muted/10">
            <div className="grid grid-cols-[220px_1fr] gap-2">
              <div>
                <label className="flex items-center text-xs text-muted-foreground mb-1">
                  Motivo de la salida
                  <InfoTooltip title="Motivo — aplica a toda la lista" align="start">
                    Un solo motivo para <strong>todas las líneas</strong> de esta salida. Queda
                    en <span className="font-mono">mov_stock</span> con tipo{' '}
                    <span className="font-mono">SALIDA</span>. Si es "Otro", usa la nota para
                    explicar.
                  </InfoTooltip>
                </label>
                <select
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value as MotivoSalida)}
                  className="w-full border border-border rounded px-2 py-1.5 bg-background text-xs"
                >
                  {MOTIVO_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value} title={m.hint}>
                      {m.label}
                    </option>
                  ))}
                </select>
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
                />
              </div>
            </div>
          </section>

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

            {/* Modo de salida */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Lote:</span>
              <div className="inline-flex border border-border rounded overflow-hidden">
                <button
                  type="button"
                  onClick={() => onModoChange('auto')}
                  className={`px-3 py-1 ${
                    modo === 'auto'
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'bg-background hover:bg-muted'
                  }`}
                >
                  Automático (FEFO)
                </button>
                <button
                  type="button"
                  onClick={() => onModoChange('lote')}
                  className={`px-3 py-1 border-l border-border ${
                    modo === 'lote'
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'bg-background hover:bg-muted'
                  }`}
                >
                  Elegir lote
                </button>
              </div>
              <InfoTooltip title="Modo de salida" align="start">
                <strong>Automático:</strong> capturas la cantidad total y el sistema descuenta
                empezando por el lote <strong>más próximo a caducar</strong> (FEFO), repartiendo
                entre lotes si hace falta.
                <div className="mt-1">
                  <strong>Elegir lote:</strong> tú decides de qué lote específico sale.
                </div>
              </InfoTooltip>
            </div>

            <div className="grid grid-cols-[1fr_140px] gap-2">
              {modo === 'lote' ? (
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
              ) : (
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Lotes</label>
                  <div className="border border-dashed border-border rounded px-2 py-1.5 bg-muted/20 text-xs text-muted-foreground">
                    {current && lotes.length > 0 ? (
                      <>
                        {lotes.length} lote{lotes.length === 1 ? '' : 's'} · disponible{' '}
                        <span className="font-mono font-semibold text-foreground">
                          {disponibleTotal}
                        </span>{' '}
                        — descuenta del más próximo a caducar
                      </>
                    ) : (
                      'Busca un producto — el lote se descuenta automático (FEFO)'
                    )}
                  </div>
                </div>
              )}
              <div>
                <label className="flex items-center text-xs text-muted-foreground mb-1">
                  Cantidad
                  <InfoTooltip title="Unidades que salen" align="center">
                    {modo === 'auto' ? (
                      <>
                        Cuántas unidades salen en total. Se descuentan empezando por el lote más
                        próximo a caducar, repartiendo entre lotes si hace falta. Debe ser{' '}
                        <strong>{'≤'} disponible</strong> del producto en la bodega.
                      </>
                    ) : (
                      <>
                        Cuántas unidades se retiran del lote. Se resta directo del saldo. Debe
                        ser <strong>{'≤'} saldo actual</strong> del lote.
                      </>
                    )}
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
                  max={modo === 'auto' ? disponibleTotal || undefined : currentLote?.saldo ?? undefined}
                  className="w-full border border-border rounded px-2 py-1.5 font-mono text-right"
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  onKeyDown={onKeyCantidad}
                  disabled={modo === 'auto' ? !current || lotes.length === 0 : !loteId}
                />
              </div>
            </div>

            <div className="flex justify-between items-center">
              <div className="text-xs text-muted-foreground">
                Registrada por: <span className="font-semibold">{userNombre}</span>
              </div>
              <button
                type="button"
                onClick={addItem}
                disabled={
                  (modo === 'auto' ? !current || lotes.length === 0 : !loteId) || !cantidad
                }
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
            <div
              ref={tablaRef}
              tabIndex={0}
              onKeyDown={onKeyTabla}
              title="Clic en un renglón (o flechas con la tabla enfocada) para recorrer lo capturado"
              className="overflow-auto max-h-[260px] focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background border-b border-border">
                  <tr className="text-left">
                    <th className="px-2 py-1">Producto</th>
                    <th className="px-2 py-1 w-24">Caducidad</th>
                    <th className="px-2 py-1 w-16 text-right">Saldo</th>
                    <th className="px-2 py-1 w-16 text-right">Sale</th>
                    <th className="px-2 py-1 w-16 text-right">Queda</th>
                    <th className="px-2 py-1 w-8" />
                  </tr>
                </thead>
                <tbody ref={tbodyRef}>
                  {items.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-2 py-6 text-center text-muted-foreground italic"
                      >
                        Sin salidas — captura una arriba
                      </td>
                    </tr>
                  )}
                  {items.map((it, i) => {
                    const queda = it.saldoActual - it.cantidad
                    return (
                      <tr
                        key={i}
                        onClick={() => {
                          setSelRow(i)
                          tablaRef.current?.focus()
                        }}
                        className={`border-b border-border/60 cursor-pointer ${
                          i === selRow ? 'bg-primary/10' : 'hover:bg-muted/40'
                        }`}
                      >
                        <td className="px-2 py-1">
                          <div>{it.productoNombre}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {it.codigo}
                          </div>
                        </td>
                        <td className="px-2 py-1 font-mono text-[11px]">
                          {isoToYmd(it.fechaCaducidad)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{it.saldoActual}</td>
                        <td className="px-2 py-1 text-right font-mono font-semibold text-red-700">
                          -{it.cantidad}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{queda}</td>
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
              onClick={pedirConfirmacion}
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
        returnFocus={() => setTimeout(() => codRef.current?.focus(), 100)}
      />

      {open && preview && (
        <ConfirmMovimientoModal
          title="Confirmar salida de inventario"
          encabezado={
            <span>
              Motivo:{' '}
              <strong>{MOTIVO_OPTIONS.find((m) => m.value === motivo)?.label ?? motivo}</strong>
              {nota.trim() && <span className="text-muted-foreground"> · {nota.trim()}</span>}
            </span>
          }
          lineas={items.map((it) => ({
            codigo: it.codigo,
            nombre: it.productoNombre,
            cantidad: it.cantidad,
            detalle: isoToYmd(it.fechaCaducidad)
          }))}
          detalleHeader="Caducidad"
          confirmLabel="Sí, registrar salida"
          procesando={saving}
          onConfirm={save}
          onCancel={() => setPreview(false)}
        />
      )}
    </>
  )
}
