import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { toast } from 'sonner'
import { ArrowRightLeft, Search, Trash2, Upload } from 'lucide-react'
import Papa from 'papaparse'
import Modal from './Modal'
import SearchModal from './SearchModal'
import Spinner from './Spinner'
import BusyOverlay from './BusyOverlay'
import ConfirmMovimientoModal from './ConfirmMovimientoModal'
import { money } from '../lib/format'
import type { BodegaDto, CrearTraspasoResult, ProductoDto, StockBodegaItem, SucursalDto } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
  userId: string
  /**
   * Destino libre (modo SUCURSAL): en lugar del catálogo de sucursales (que
   * solo existe en la matriz), el destino se captura como código + nombre.
   * Permite mandar a cualquier sucursal o de regreso a la matriz.
   */
  destinoLibre?: boolean
}

const PAGE_SIZES = [10, 20, 50, 100]

export default function TraspasoModal({ open, onClose, userId, destinoLibre = false }: Props) {
  const [bodegas, setBodegas] = useState<BodegaDto[]>([])
  const [sucursales, setSucursales] = useState<SucursalDto[]>([])
  const [bodegaId, setBodegaId] = useState('')
  // Destino en matriz: 'suc:<id>' (archivo .traspaso) o 'bod:<id>' (interno).
  const [destinoKey, setDestinoKey] = useState('')
  const [destinoCodigo, setDestinoCodigo] = useState('')
  const [destinoNombre, setDestinoNombre] = useState('')
  const [stock, setStock] = useState<StockBodegaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [preview, setPreview] = useState(false)
  // cantidad a traspasar por código
  const [cant, setCant] = useState<Record<string, string>>({})
  const [filtro, setFiltro] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [searchOpen, setSearchOpen] = useState(false)
  // Captura rápida (flujo tipo entradas): código → cantidad → agregar.
  const [capCodigo, setCapCodigo] = useState('')
  const [capItem, setCapItem] = useState<StockBodegaItem | null>(null)
  const [capCantidad, setCapCantidad] = useState('')
  // Ver únicamente los renglones capturados (default): la tabla funciona como
  // la lista del traspaso en construcción; ver todo el stock es opcional.
  const [soloSeleccion, setSoloSeleccion] = useState(true)
  const capCodigoRef = useRef<HTMLInputElement>(null)
  const capCantRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setStock([])
    setCant({})
    setFiltro('')
    setDestinoCodigo('')
    setDestinoNombre('')
    setPreview(false)
    setCapCodigo('')
    setCapItem(null)
    setCapCantidad('')
    setSoloSeleccion(true)
    setTimeout(() => capCodigoRef.current?.focus(), 120)
    const cargas: Promise<void>[] = [
      window.api.bodegas.list().then((bs) => {
        const bodActivas = bs.filter((b) => b.activa)
        setBodegas(bodActivas)
        setBodegaId((bodActivas.find((b) => b.esPrincipal) ?? bodActivas[0])?.id ?? '')
      })
    ]
    if (!destinoLibre) {
      cargas.push(
        window.api.sucursales.list(userId).then((ss) => {
          const sucActivas = ss.filter((s) => s.activa)
          setSucursales(sucActivas)
          setDestinoKey(sucActivas[0] ? `suc:${sucActivas[0].id}` : '')
        })
      )
    }
    Promise.all(cargas).catch(() => {})
  }, [open, userId, destinoLibre])

  // Si el destino interno elegido pasa a ser la bodega origen, se invalida.
  useEffect(() => {
    if (destinoKey === `bod:${bodegaId}`) setDestinoKey('')
  }, [bodegaId, destinoKey])

  const cargarStock = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
    try {
      const r = await window.api.inventario.stockBodega(id)
      setStock(r.items)
    } catch (e) {
      toast.error('No se pudo cargar el stock de la bodega', {
        description: e instanceof Error ? e.message : String(e)
      })
      setStock([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && bodegaId) {
      setCant({})
      setCapCodigo('')
      setCapItem(null)
      setCapCantidad('')
      cargarStock(bodegaId)
    }
  }, [open, bodegaId, cargarStock])

  const cantDe = useCallback(
    (codigo: string): number => {
      const n = Math.round(Number(cant[codigo]))
      return Number.isFinite(n) && n > 0 ? n : 0
    },
    [cant]
  )

  const filtered = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    let base = stock
    if (soloSeleccion) base = base.filter((it) => cantDe(it.codigo) > 0)
    if (!q) return base
    return base.filter(
      (it) => it.codigo.toLowerCase().includes(q) || it.nombre.toLowerCase().includes(q)
    )
  }, [stock, filtro, soloSeleccion, cantDe])

  useEffect(() => {
    setPage(1)
  }, [filtro, bodegaId, pageSize, soloSeleccion])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageSafe = Math.min(page, totalPages)
  const pageItems = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize)

  const setCantidad = (codigo: string, value: string): void => {
    setCant((prev) => ({ ...prev, [codigo]: value }))
  }

  const seleccion = useMemo(() => {
    const byCodigo = new Map(stock.map((s) => [s.codigo, s]))
    let lineas = 0
    let unidades = 0
    let valor = 0
    const items: { codigo: string; cantidad: number }[] = []
    for (const [codigo, val] of Object.entries(cant)) {
      const n = Math.round(Number(val))
      if (!Number.isFinite(n) || n <= 0) continue
      const item = byCodigo.get(codigo)
      const disp = item?.existencias ?? 0
      const cantidad = Math.min(n, disp) // nunca más que lo disponible
      if (cantidad <= 0) continue
      lineas++
      unidades += cantidad
      valor += cantidad * (Number(item?.costo) || 0)
      items.push({ codigo, cantidad })
    }
    return { lineas, unidades, valor: +valor.toFixed(2), items }
  }, [cant, stock])

  const onFileCsv = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase()
      })
      const rows = parsed.data.filter((r) => (r.codigo ?? '').trim())
      const next: Record<string, string> = {}
      for (const r of rows) {
        const c = (r.codigo ?? '').trim()
        const q = (r.cantidad ?? '').trim()
        if (c && q) next[c] = q
      }
      setCant((prev) => ({ ...prev, ...next }))
      toast.success(`CSV aplicado: ${Object.keys(next).length} cantidades`)
    } catch (err) {
      toast.error('Error leyendo CSV', { description: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  const generar = useCallback(async () => {
    if (!bodegaId) return toast.error('Selecciona la bodega origen')
    if (destinoLibre) {
      if (!destinoCodigo.trim()) return toast.error('Captura el código del destino')
      if (!destinoNombre.trim()) return toast.error('Captura el nombre del destino')
    } else if (!destinoKey) {
      return toast.error('Selecciona el destino')
    }
    if (seleccion.items.length === 0) return toast.error('Indica cantidades a traspasar')
    const esInterno = !destinoLibre && destinoKey.startsWith('bod:')
    setGenerando(true)
    try {
      let r: CrearTraspasoResult
      if (esInterno) {
        // Traspaso interno: mismo equipo, sin archivo — atómico.
        r = await window.api.traspaso.entreBodegas(userId, {
          bodegaOrigenId: bodegaId,
          bodegaDestinoId: destinoKey.slice(4),
          items: seleccion.items
        })
      } else {
        r = await window.api.traspaso.crear(userId, {
          bodegaOrigenId: bodegaId,
          ...(destinoLibre
            ? { destino: { codigo: destinoCodigo.trim(), nombre: destinoNombre.trim() } }
            : { sucursalId: destinoKey.slice(4) }),
          items: seleccion.items
        })
      }
      if (r.cancelled) return
      if (!r.ok) {
        if (r.faltantes && r.faltantes.length > 0) {
          toast.error('Stock insuficiente en la bodega', {
            description: r.faltantes
              .slice(0, 6)
              .map((f) => `${f.codigo}: pides ${f.pedido}, hay ${f.disponible}`)
              .join(' · ')
          })
        } else {
          toast.error('No se pudo generar el traspaso', { description: r.error })
        }
        return
      }
      const folio = r.folio
      const folioCorto = `T-${r.numero}`
      toast.success(
        `${esInterno ? 'Traspaso entre bodegas realizado' : 'Traspaso generado'} · ${r.unidades?.toLocaleString('es-MX')} unidades`,
        {
          description: esInterno
            ? `Folio ${folioCorto} · ${r.lineas} líneas · el stock ya está en la bodega destino`
            : `Folio ${folioCorto} · ${r.lineas} líneas · guardado en ${r.path}`,
          duration: 10000,
          action: folio
            ? {
                label: 'Imprimir PDF',
                onClick: () => {
                  window.api.movimientos.pdf(folio).then((p) => {
                    if (!p.ok && !p.cancelled) {
                      toast.error('No se pudo generar el PDF', { description: p.error })
                    }
                  })
                }
              }
            : undefined
        }
      )
      onClose()
    } catch (e) {
      toast.error('Falló el traspaso', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setGenerando(false)
    }
  }, [bodegaId, destinoKey, destinoLibre, destinoCodigo, destinoNombre, seleccion.items, userId, onClose])

  // ── Captura rápida (flujo tipo entradas) ─────────────────────────────────
  const fijarCaptura = useCallback((it: StockBodegaItem) => {
    setCapItem(it)
    setCapCodigo(it.codigo)
    setCapCantidad('')
    setTimeout(() => {
      capCantRef.current?.focus()
      capCantRef.current?.select()
    }, 120)
  }, [])

  // Producto elegido en la búsqueda (F5) → queda listo en la captura rápida.
  const onProductoBuscado = useCallback(
    (p: ProductoDto) => {
      const it = stock.find((s) => s.codigo === p.codigo)
      if (!it) {
        toast.warning(`"${p.nombre}" no tiene existencias en esta bodega`, {
          description: 'Sólo se puede traspasar stock disponible en la bodega origen.'
        })
        return
      }
      fijarCaptura(it)
    },
    [stock, fijarCaptura]
  )

  const buscarCaptura = useCallback(async () => {
    const c = capCodigo.trim()
    if (!c) return
    const it = stock.find((s) => s.codigo === c)
    if (it) {
      fijarCaptura(it)
      return
    }
    const p = await window.api.productos.byCodigo(c)
    if (!p) {
      toast.error(`Producto "${c}" no encontrado`)
    } else {
      toast.warning(`"${p.nombre}" no tiene existencias en esta bodega`, {
        description: 'Sólo se puede traspasar stock disponible en la bodega origen.'
      })
    }
  }, [capCodigo, stock, fijarCaptura])

  // Agrega la cantidad capturada al renglón (suma a lo que ya llevara),
  // topada a lo disponible — nunca recorta en silencio: avisa con toast.
  const agregarCaptura = useCallback(() => {
    if (!capItem) {
      toast.error('Busca un producto primero')
      return
    }
    const n = Math.round(Number(capCantidad))
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Cantidad inválida (debe ser 1 o mayor)')
      return
    }
    const previa = cantDe(capItem.codigo)
    const total = previa + n
    const final = Math.min(total, capItem.existencias)
    if (total > capItem.existencias) {
      toast.warning(`Sólo hay ${capItem.existencias} disponibles de "${capItem.nombre}"`, {
        description:
          previa > 0
            ? `Ya llevabas ${previa} capturadas; se ajustó al máximo disponible.`
            : 'Se ajustó al máximo disponible.'
      })
    }
    setCant((prev) => ({ ...prev, [capItem.codigo]: String(final) }))
    setCapItem(null)
    setCapCodigo('')
    setCapCantidad('')
    setTimeout(() => capCodigoRef.current?.focus(), 30)
  }, [capItem, capCantidad, cantDe])

  const onKeyCapCodigo = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      buscarCaptura()
    } else if (e.key === 'F5') {
      e.preventDefault()
      setSearchOpen(true)
    }
  }

  const onKeyCapCantidad = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      agregarCaptura()
    }
  }

  const onKeyFiltro = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'F5') {
      e.preventDefault()
      setSearchOpen(true)
    }
  }

  // Valida y abre el preview de confirmación (no genera todavía).
  const pedirConfirmacion = useCallback(() => {
    if (!bodegaId) return toast.error('Selecciona la bodega origen')
    if (destinoLibre) {
      if (!destinoCodigo.trim()) return toast.error('Captura el código del destino')
      if (!destinoNombre.trim()) return toast.error('Captura el nombre del destino')
    } else if (!destinoKey) {
      return toast.error('Selecciona el destino')
    }
    if (seleccion.items.length === 0) return toast.error('Indica cantidades a traspasar')
    setPreview(true)
  }, [bodegaId, destinoLibre, destinoCodigo, destinoNombre, destinoKey, seleccion.items])

  return (
    <>
    <Modal
      open={open && !searchOpen}
      title={destinoLibre ? 'Generar traspaso' : 'Traspaso de inventario'}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      <div className="relative">
        <div className="p-4 space-y-3 text-sm">
          <div className="rounded border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            {destinoLibre ? (
              <>
                Mueve stock de tu inventario hacia <strong>otra sucursal o la matriz</strong>.
                Descuenta de tu bodega (FEFO, conservando caducidades) y genera un archivo{' '}
                <span className="font-mono">.traspaso</span> para llevar por USB. El destino se
                captura libre: usa el <strong>código</strong> con el que está dado de alta en la
                matriz para que el equipo receptor lo valide.
              </>
            ) : (
              <>
                Mueve stock de una bodega hacia una <strong>sucursal</strong> (genera archivo{' '}
                <span className="font-mono">.traspaso</span> para llevar por USB y cargarlo en{' '}
                <strong>Procesos → Recibir traspaso</strong>) o hacia <strong>otra bodega</strong>{' '}
                de esta matriz (movimiento interno inmediato, sin archivo). Siempre descuenta FEFO
                conservando caducidades.
              </>
            )}
          </div>

          {/* Origen / destino */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 items-end">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Bodega origen</label>
              <select value={bodegaId} onChange={(e) => setBodegaId(e.target.value)} className="w-full border border-border rounded px-2 py-1.5 bg-background">
                {bodegas.length === 0 && <option value="">(sin bodegas)</option>}
                {bodegas.map((b) => (
                  <option key={b.id} value={b.id}>{b.nombre}{b.esPrincipal ? ' (principal)' : ''}</option>
                ))}
              </select>
            </div>
            <div className="hidden md:flex items-center justify-center pb-1.5 text-muted-foreground">
              <ArrowRightLeft className="size-4" />
            </div>
            {destinoLibre ? (
              <div>
                <div className="grid grid-cols-[110px_1fr] gap-2">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      Código destino <span className="text-red-600 font-semibold">*</span>
                    </label>
                    <input
                      type="text"
                      value={destinoCodigo}
                      onChange={(e) => setDestinoCodigo(e.target.value)}
                      placeholder="S02 / MATRIZ"
                      className={`w-full border rounded px-2 py-1.5 font-mono ${
                        destinoCodigo.trim() ? 'border-border' : 'border-red-400 bg-red-50'
                      }`}
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      Nombre destino <span className="text-red-600 font-semibold">*</span>
                    </label>
                    <input
                      type="text"
                      value={destinoNombre}
                      onChange={(e) => setDestinoNombre(e.target.value)}
                      placeholder="Sucursal Centro / Bodega Matriz"
                      className={`w-full border rounded px-2 py-1.5 ${
                        destinoNombre.trim() ? 'border-border' : 'border-red-400 bg-red-50'
                      }`}
                      autoComplete="off"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-red-600 mt-1">
                  <span className="font-semibold">*</span> Código y nombre del destino son
                  obligatorios para crear el traspaso.
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Destino</label>
                <select
                  value={destinoKey}
                  onChange={(e) => setDestinoKey(e.target.value)}
                  className="w-full border border-border rounded px-2 py-1.5 bg-background"
                >
                  <option value="">— elige destino —</option>
                  {sucursales.length > 0 && (
                    <optgroup label="Sucursales (archivo .traspaso por USB)">
                      {sucursales.map((s) => (
                        <option key={s.id} value={`suc:${s.id}`}>
                          {s.nombre}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {bodegas.filter((b) => b.id !== bodegaId).length > 0 && (
                    <optgroup label="Bodegas (traspaso interno inmediato)">
                      {bodegas
                        .filter((b) => b.id !== bodegaId)
                        .map((b) => (
                          <option key={b.id} value={`bod:${b.id}`}>
                            {b.nombre}
                            {b.esPrincipal ? ' (principal)' : ''}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              </div>
            )}
          </div>

          {/* Captura rápida: código → cantidad → agregar (flujo tipo entradas) */}
          <section className="border border-border rounded p-3 bg-muted/10 space-y-2">
            <div className="grid grid-cols-[1fr_120px_auto_auto] gap-2 items-end">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Código <span className="font-mono">(Enter busca · F5 abre búsqueda)</span>
                </label>
                <input
                  ref={capCodigoRef}
                  type="text"
                  value={capCodigo}
                  onChange={(e) => setCapCodigo(e.target.value)}
                  onKeyDown={onKeyCapCodigo}
                  placeholder="EAN-13 o SKU interno…"
                  className="w-full border border-border rounded px-2 py-1.5 font-mono"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Cantidad</label>
                <input
                  ref={capCantRef}
                  type="number"
                  min={1}
                  step={1}
                  value={capCantidad}
                  onChange={(e) => setCapCantidad(e.target.value)}
                  onKeyDown={onKeyCapCantidad}
                  disabled={!capItem}
                  className="w-full border border-border rounded px-2 py-1.5 font-mono text-right"
                />
              </div>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="px-3 py-1.5 border border-border rounded hover:bg-muted text-xs"
              >
                Buscar (F5)
              </button>
              <button
                type="button"
                onClick={agregarCaptura}
                disabled={!capItem || !capCantidad}
                className="px-4 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-medium"
              >
                Agregar
              </button>
            </div>
            {capItem && (
              <div className="text-xs bg-background border border-border rounded px-3 py-1.5">
                <span className="font-semibold">{capItem.nombre}</span>
                <span className="text-muted-foreground ml-2 font-mono">{capItem.codigo}</span>
                <span className="text-muted-foreground ml-3">
                  Disponible: <span className="font-mono font-semibold">{capItem.existencias}</span>
                </span>
                {cantDe(capItem.codigo) > 0 && (
                  <span className="text-muted-foreground ml-3">
                    Ya capturadas:{' '}
                    <span className="font-mono font-semibold">{cantDe(capItem.codigo)}</span>
                  </span>
                )}
              </div>
            )}
          </section>

          {/* Filtro + sólo seleccionados + CSV */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 relative min-w-[220px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filtrar por código o nombre…"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                onKeyDown={onKeyFiltro}
                className="w-full pl-7 pr-2 py-1.5 border border-border rounded"
              />
            </div>
            <button
              type="button"
              onClick={() => setSoloSeleccion((v) => !v)}
              className={`px-3 py-1.5 border rounded text-xs ${
                soloSeleccion
                  ? 'border-border hover:bg-muted'
                  : 'bg-primary text-primary-foreground border-primary font-medium'
              }`}
              title={
                soloSeleccion
                  ? 'Mostrar todo el stock de la bodega (para capturar cantidades directo en la tabla)'
                  : 'Volver a ver sólo los renglones del traspaso'
              }
            >
              {soloSeleccion
                ? 'Ver todo el stock'
                : `Sólo seleccionados (${seleccion.lineas})`}
            </button>
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted cursor-pointer text-xs">
              <Upload className="size-3.5" />
              Cargar cantidades (CSV)
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFileCsv} />
            </label>
          </div>

          {/* Tabla */}
          <div className="border border-border rounded overflow-auto max-h-[45vh]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-mono w-32">Código</th>
                  <th className="px-2 py-1.5">Nombre</th>
                  <th className="px-2 py-1.5 w-24 text-right">Disponible</th>
                  <th className="px-2 py-1.5 w-32 text-right">A traspasar</th>
                  <th className="px-2 py-1.5 w-24 text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={5} className="px-2 py-8"><span className="flex items-center justify-center"><Spinner label="Cargando stock…" /></span></td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={5} className="px-2 py-8 text-center text-muted-foreground italic">
                    {stock.length === 0
                      ? 'Esta bodega no tiene existencias.'
                      : soloSeleccion
                        ? 'Aún no capturas cantidades — usa la captura rápida de arriba.'
                        : 'Sin coincidencias.'}
                  </td></tr>
                )}
                {!loading && pageItems.map((it) => {
                  const n = cantDe(it.codigo)
                  const raw = Math.round(Number(cant[it.codigo]))
                  const excede = Number.isFinite(raw) && raw > it.existencias
                  return (
                    <tr key={it.productoId} className="border-b border-border/60">
                      <td className="px-2 py-1 font-mono">{it.codigo}</td>
                      <td className="px-2 py-1">{it.nombre}</td>
                      <td className="px-2 py-1 text-right font-mono">{it.existencias.toLocaleString('es-MX')}</td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        <input
                          type="number"
                          min={0}
                          max={it.existencias}
                          data-cant-codigo={it.codigo}
                          value={cant[it.codigo] ?? ''}
                          onChange={(e) => setCantidad(it.codigo, e.target.value)}
                          onBlur={() => {
                            // No recorta en silencio: ajusta al máximo y avisa.
                            if (excede) {
                              setCantidad(it.codigo, String(it.existencias))
                              toast.warning(
                                `Sólo hay ${it.existencias} disponibles de "${it.nombre}" — se ajustó al máximo.`
                              )
                            }
                          }}
                          placeholder="0"
                          title={excede ? `Máximo disponible: ${it.existencias}` : undefined}
                          className={`w-20 border rounded px-1.5 py-1 font-mono text-right ${
                            excede
                              ? 'border-red-500 bg-red-50 text-red-800'
                              : 'border-border'
                          }`}
                        />
                        {n > 0 && (
                          <button
                            type="button"
                            onClick={() => setCantidad(it.codigo, '')}
                            title="Quitar del traspaso"
                            className="ml-1 p-1 rounded text-red-700 hover:bg-red-50 align-middle"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                        {excede && (
                          <div className="text-[10px] text-red-700">máx {it.existencias}</div>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {n > 0 ? `$${money(Math.min(n, it.existencias) * (Number(it.costo) || 0))}` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación + resumen */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span>Mostrar</span>
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="border border-border rounded px-1.5 py-1 bg-background">
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="font-medium text-foreground">
              Seleccionados: {seleccion.lineas} productos ·{' '}
              {seleccion.unidades.toLocaleString('es-MX')} unidades · valor (costo){' '}
              <span className="font-mono">${money(seleccion.valor)}</span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setPage(pageSafe - 1)} disabled={pageSafe <= 1} className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40">‹</button>
              <span className="px-2 whitespace-nowrap">Pág {pageSafe}/{totalPages}</span>
              <button type="button" onClick={() => setPage(pageSafe + 1)} disabled={pageSafe >= totalPages} className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40">›</button>
            </div>
          </div>
        </div>

        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted/20">
          <button type="button" onClick={onClose} disabled={generando} className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm">Cancelar</button>
          <button
            type="button"
            onClick={pedirConfirmacion}
            disabled={
              generando ||
              loading ||
              seleccion.items.length === 0 ||
              (destinoLibre ? !destinoCodigo.trim() || !destinoNombre.trim() : !destinoKey)
            }
            className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
          >
            {generando && <Spinner size={14} />}
            {generando ? 'Generando…' : 'Generar traspaso'}
          </button>
        </footer>

        <BusyOverlay show={generando} text="Generando traspaso…" />
      </div>
    </Modal>

    <SearchModal
      open={searchOpen}
      onClose={() => setSearchOpen(false)}
      onSelect={onProductoBuscado}
      allowZeroStock
      returnFocus={() => setTimeout(() => capCodigoRef.current?.focus(), 100)}
    />

    {open && preview && (() => {
      const byCodigo = new Map(stock.map((s) => [s.codigo, s]))
      const lineas = seleccion.items.map((it) => ({
        codigo: it.codigo,
        nombre: byCodigo.get(it.codigo)?.nombre ?? it.codigo,
        cantidad: it.cantidad
      }))
      const bodegaNombre = bodegas.find((b) => b.id === bodegaId)?.nombre ?? '—'
      const destinoLabel = destinoLibre
        ? `${destinoCodigo.trim()} ${destinoNombre.trim()}`.trim()
        : destinoKey.startsWith('suc:')
          ? (sucursales.find((s) => `suc:${s.id}` === destinoKey)?.nombre ?? 'sucursal')
          : destinoKey.startsWith('bod:')
            ? (bodegas.find((b) => `bod:${b.id}` === destinoKey)?.nombre ?? 'bodega')
            : '—'
      return (
        <ConfirmMovimientoModal
          title="Confirmar traspaso"
          encabezado={
            <span>
              Origen: <strong>{bodegaNombre}</strong> → Destino: <strong>{destinoLabel}</strong>
            </span>
          }
          lineas={lineas}
          confirmLabel="Sí, generar traspaso"
          procesando={generando}
          onConfirm={generar}
          onCancel={() => setPreview(false)}
        />
      )
    })()}
    </>
  )
}
