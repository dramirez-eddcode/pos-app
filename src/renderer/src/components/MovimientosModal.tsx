import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { toast } from 'sonner'
import { ArrowRight, ChevronLeft, FileText, Printer } from 'lucide-react'
import Modal from './Modal'
import SearchModal from './SearchModal'
import Spinner from './Spinner'
import { money } from '../lib/format'
import { folioMovimiento } from '@shared/dto'
import type {
  KardexItem,
  KardexTipo,
  MovimientoDetalle,
  MovimientoHistItem,
  MovimientoTipo,
  ProductoDto
} from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
}

type Filtro = 'TODOS' | MovimientoTipo

const FILTROS: { value: Filtro; label: string }[] = [
  { value: 'TODOS', label: 'Todos' },
  { value: 'ENTRADA', label: 'Entradas' },
  { value: 'SALIDA', label: 'Salidas' },
  { value: 'TRASPASO', label: 'Traspasos' }
]

const TIPO_BADGE: Record<MovimientoTipo, string> = {
  ENTRADA: 'bg-green-100 text-green-900',
  SALIDA: 'bg-red-100 text-red-900',
  TRASPASO: 'bg-violet-100 text-violet-900'
}

const TIPO_LABEL: Record<MovimientoTipo, string> = {
  ENTRADA: 'Entrada',
  SALIDA: 'Salida',
  TRASPASO: 'Traspaso'
}

const KARDEX_BADGE: Record<KardexTipo, string> = {
  ENTRADA: 'bg-green-100 text-green-900',
  SALIDA: 'bg-red-100 text-red-900',
  AJUSTE: 'bg-amber-100 text-amber-900',
  VENTA: 'bg-blue-100 text-blue-900',
  CANCELACION_VENTA: 'bg-violet-100 text-violet-900'
}

const KARDEX_LABEL: Record<KardexTipo, string> = {
  ENTRADA: 'Entrada',
  SALIDA: 'Salida',
  AJUSTE: 'Ajuste',
  VENTA: 'Venta',
  CANCELACION_VENTA: 'Canc. venta'
}

export default function MovimientosModal({ open, onClose }: Props) {
  const [list, setList] = useState<MovimientoHistItem[]>([])
  const [loading, setLoading] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('TODOS')
  const [detalle, setDetalle] = useState<MovimientoDetalle | null>(null)
  const [loadingDet, setLoadingDet] = useState(false)
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)
  const [printBusy, setPrintBusy] = useState<string | null>(null)

  // ── Kárdex por producto ────────────────────────────────────────────────
  const [vista, setVista] = useState<'documentos' | 'kardex'>('documentos')
  const [kCodigo, setKCodigo] = useState('')
  const [kProducto, setKProducto] = useState<ProductoDto | null>(null)
  const [kItems, setKItems] = useState<KardexItem[]>([])
  const [kLoading, setKLoading] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const kCodRef = useRef<HTMLInputElement>(null)

  const busy = pdfBusy !== null || printBusy !== null

  useEffect(() => {
    if (!open) {
      setDetalle(null)
      setFiltro('TODOS')
      setVista('documentos')
      setKCodigo('')
      setKProducto(null)
      setKItems([])
      return
    }
    setLoading(true)
    window.api.movimientos
      .list()
      .then(setList)
      .catch((e) => toast.error('No se pudo cargar el historial', { description: String(e) }))
      .finally(() => setLoading(false))
  }, [open])

  const cargarKardex = useCallback(async (p: ProductoDto) => {
    setKProducto(p)
    setKCodigo(p.codigo)
    setKLoading(true)
    try {
      const items = await window.api.movimientos.kardex(p.id)
      // Más reciente primero: el saldo del primer renglón = existencia actual.
      setKItems([...items].reverse())
    } catch (e) {
      toast.error('No se pudieron cargar los movimientos del producto', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setKLoading(false)
    }
  }, [])

  const buscarKardexPorCodigo = useCallback(async () => {
    const c = kCodigo.trim()
    if (!c) return
    const p = await window.api.productos.byCodigo(c)
    if (!p) {
      toast.error(`Producto "${c}" no encontrado`)
      return
    }
    await cargarKardex(p)
  }, [kCodigo, cargarKardex])

  const onKeyKardex = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      buscarKardexPorCodigo()
    } else if (e.key === 'F5') {
      e.preventDefault()
      setSearchOpen(true)
    }
  }

  const filtered = useMemo(
    () => (filtro === 'TODOS' ? list : list.filter((m) => m.tipo === filtro)),
    [list, filtro]
  )

  const counts = useMemo(() => {
    const c: Record<Filtro, number> = { TODOS: list.length, ENTRADA: 0, SALIDA: 0, TRASPASO: 0 }
    for (const m of list) c[m.tipo]++
    return c
  }, [list])

  const verDetalle = useCallback(async (folio: string) => {
    setLoadingDet(true)
    try {
      const d = await window.api.movimientos.detalle(folio)
      if (!d) {
        toast.error('No se encontró el detalle del movimiento')
        return
      }
      setDetalle(d)
    } finally {
      setLoadingDet(false)
    }
  }, [])

  const exportarPdf = useCallback(async (folio: string) => {
    setPdfBusy(folio)
    try {
      const r = await window.api.movimientos.pdf(folio)
      if (r.cancelled) return
      if (!r.ok) {
        toast.error('No se pudo generar el PDF', { description: r.error })
        return
      }
      toast.success('PDF generado — se abrió para imprimir', { description: r.path })
    } catch (e) {
      toast.error('No se pudo generar el PDF', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setPdfBusy(null)
    }
  }, [])

  const imprimir = useCallback(async (folio: string) => {
    setPrintBusy(folio)
    try {
      const r = await window.api.movimientos.imprimir(folio)
      if (r.cancelled) return
      if (!r.ok) {
        toast.error('No se pudo imprimir', { description: r.error })
        return
      }
      toast.success('Documento enviado a la impresora')
    } catch (e) {
      toast.error('No se pudo imprimir', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setPrintBusy(null)
    }
  }, [])

  const esSalida = detalle?.tipo === 'SALIDA'
  const esEntrada = detalle?.tipo === 'ENTRADA'
  // Proveedor por línea (entradas); documentos viejos solo lo tienen a nivel
  // documento → fallback.
  const provDeLinea = (l: { proveedor?: string | null }): string =>
    l.proveedor === undefined ? (detalle?.proveedor ?? '—') : (l.proveedor ?? '—')

  return (
    <>
    <Modal
      open={open && !searchOpen}
      title={detalle ? `Detalle de ${TIPO_LABEL[detalle.tipo].toLowerCase()}` : 'Historial de movimientos'}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      <div className="relative">
        <div className="p-4 text-sm">
          {/* ── Pestañas: documentos / kárdex ───────────────────────────── */}
          {!detalle && (
            <div className="mb-3 inline-flex border border-border rounded overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setVista('documentos')}
                className={`px-3 py-1.5 ${
                  vista === 'documentos'
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'bg-background hover:bg-muted'
                }`}
              >
                Movimientos (documentos)
              </button>
              <button
                type="button"
                onClick={() => setVista('kardex')}
                className={`px-3 py-1.5 border-l border-border ${
                  vista === 'kardex'
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'bg-background hover:bg-muted'
                }`}
              >
                Movimientos de producto
              </button>
            </div>
          )}

          {/* ── Vista lista ──────────────────────────────────────────────── */}
          {!detalle && vista === 'documentos' && (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                {FILTROS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFiltro(f.value)}
                    className={`px-3 py-1 rounded-full border text-xs ${
                      filtro === f.value
                        ? 'bg-primary text-primary-foreground border-primary font-semibold'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    {f.label}
                    <span className="ml-1 opacity-70 font-mono">{counts[f.value]}</span>
                  </button>
                ))}
              </div>

              <div className="border border-border rounded overflow-auto max-h-[58vh]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                    <tr className="text-left">
                      <th className="px-2 py-1.5 w-36">Fecha</th>
                      <th className="px-2 py-1.5 w-20">Tipo</th>
                      <th className="px-2 py-1.5">Movimiento</th>
                      <th className="px-2 py-1.5 w-16 text-right">Líneas</th>
                      <th className="px-2 py-1.5 w-20 text-right">Unidades</th>
                      <th className="px-2 py-1.5 w-24 text-right">Valor</th>
                      <th className="px-2 py-1.5 w-48 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan={7} className="px-2 py-8">
                          <span className="flex items-center justify-center">
                            <Spinner label="Cargando…" />
                          </span>
                        </td>
                      </tr>
                    )}
                    {!loading && filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-2 py-8 text-center text-muted-foreground italic">
                          {list.length === 0
                            ? 'Aún no hay movimientos registrados.'
                            : 'Sin movimientos de este tipo.'}
                        </td>
                      </tr>
                    )}
                    {!loading &&
                      filtered.map((m) => (
                        <tr key={m.folio} className="border-b border-border/60">
                          <td className="px-2 py-1 font-mono">
                            {new Date(m.fecha).toLocaleString('es-MX')}
                          </td>
                          <td className="px-2 py-1">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${TIPO_BADGE[m.tipo]}`}
                            >
                              {TIPO_LABEL[m.tipo]}
                            </span>
                          </td>
                          <td className="px-2 py-1">
                            {m.bodega}
                            {m.destino && (
                              <>
                                {' '}
                                <ArrowRight className="inline size-3 text-muted-foreground" />{' '}
                                <span className="font-medium">{m.destino}</span>
                              </>
                            )}
                            <div className="text-[10px] text-muted-foreground font-mono">
                              folio {folioMovimiento(m.tipo, m.numero)}
                              {m.usuario ? ` · ${m.usuario}` : ''}
                              {m.proveedor ? ` · Prov: ${m.proveedor}` : ''}
                            </div>
                          </td>
                          <td className="px-2 py-1 text-right font-mono">{m.lineas}</td>
                          <td className="px-2 py-1 text-right font-mono font-semibold">
                            {m.unidades.toLocaleString('es-MX')}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">${money(m.valor)}</td>
                          <td className="px-2 py-1 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => verDetalle(m.folio)}
                              className="px-2 py-1 border border-border rounded hover:bg-muted text-[11px]"
                            >
                              Ver
                            </button>
                            <button
                              type="button"
                              onClick={() => exportarPdf(m.folio)}
                              disabled={busy}
                              title="Generar PDF para impresora normal"
                              className="ml-1 px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-50 text-[11px] inline-flex items-center gap-1"
                            >
                              {pdfBusy === m.folio ? (
                                <Spinner size={11} />
                              ) : (
                                <FileText className="size-3" />
                              )}
                              PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => imprimir(m.folio)}
                              disabled={busy}
                              title="Mandar directo a la impresora"
                              className="ml-1 px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-50 text-[11px] inline-flex items-center gap-1"
                            >
                              {printBusy === m.folio ? (
                                <Spinner size={11} />
                              ) : (
                                <Printer className="size-3" />
                              )}
                              Imprimir
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Vista kárdex por producto ───────────────────────────────── */}
          {!detalle && vista === 'kardex' && (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    Código o nombre{' '}
                    <span className="font-mono">(Enter busca · F5 abre búsqueda)</span>
                  </label>
                  <input
                    ref={kCodRef}
                    type="text"
                    className="w-full border border-border rounded px-2 py-1.5 font-mono"
                    value={kCodigo}
                    onChange={(e) => setKCodigo(e.target.value)}
                    onKeyDown={onKeyKardex}
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

              {kProducto && (
                <div className="text-xs bg-background border border-border rounded px-3 py-2">
                  <span className="text-muted-foreground">Producto: </span>
                  <span className="font-semibold">{kProducto.nombre}</span>
                  <span className="text-muted-foreground ml-2 font-mono">{kProducto.codigo}</span>
                  <span className="text-muted-foreground ml-3">
                    Existencia actual:{' '}
                    <span className="font-mono font-semibold">{kProducto.existenciasTotal}</span>
                  </span>
                </div>
              )}

              <div className="border border-border rounded overflow-auto max-h-[52vh]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                    <tr className="text-left">
                      <th className="px-2 py-1.5 w-36">Fecha</th>
                      <th className="px-2 py-1.5 w-24">Tipo</th>
                      <th className="px-2 py-1.5">Referencia / motivo</th>
                      <th className="px-2 py-1.5 w-20 text-right">Cantidad</th>
                      <th className="px-2 py-1.5 w-20 text-right">Saldo</th>
                      <th className="px-2 py-1.5 w-28 text-center">Cad. lote</th>
                      <th className="px-2 py-1.5 w-32">Bodega</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kLoading && (
                      <tr>
                        <td colSpan={7} className="px-2 py-8">
                          <span className="flex items-center justify-center">
                            <Spinner label="Cargando movimientos…" />
                          </span>
                        </td>
                      </tr>
                    )}
                    {!kLoading && !kProducto && (
                      <tr>
                        <td colSpan={7} className="px-2 py-8 text-center text-muted-foreground italic">
                          Busca un producto para ver todos sus movimientos.
                        </td>
                      </tr>
                    )}
                    {!kLoading && kProducto && kItems.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-2 py-8 text-center text-muted-foreground italic">
                          Este producto no tiene movimientos registrados.
                        </td>
                      </tr>
                    )}
                    {!kLoading &&
                      kItems.map((k, i) => (
                        <tr
                          key={i}
                          onClick={() => {
                            if (k.docFolio) verDetalle(k.docFolio)
                          }}
                          title={
                            k.docFolio
                              ? 'Clic para ver el documento completo (qué más se movió)'
                              : undefined
                          }
                          className={`border-b border-border/60 ${
                            k.docFolio ? 'cursor-pointer hover:bg-muted/50' : ''
                          }`}
                        >
                          <td className="px-2 py-1 font-mono">
                            {new Date(k.fecha).toLocaleString('es-MX')}
                          </td>
                          <td className="px-2 py-1">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${KARDEX_BADGE[k.tipo]}`}
                            >
                              {KARDEX_LABEL[k.tipo]}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-[11px]">
                            {k.referencia ?? k.motivo ?? '—'}
                          </td>
                          <td
                            className={`px-2 py-1 text-right font-mono font-semibold ${
                              k.cantidad < 0 ? 'text-red-700' : 'text-green-700'
                            }`}
                          >
                            {k.cantidad > 0 ? `+${k.cantidad}` : k.cantidad}
                          </td>
                          <td className="px-2 py-1 text-right font-mono font-semibold">
                            {k.saldo}
                          </td>
                          <td className="px-2 py-1 text-center font-mono">
                            {k.caducidad ?? '—'}
                          </td>
                          <td className="px-2 py-1 text-[11px]">{k.bodega ?? '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {kProducto && kItems.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {kItems.length.toLocaleString('es-MX')} movimiento
                  {kItems.length === 1 ? '' : 's'} · el más reciente primero — el saldo del
                  primer renglón es la existencia actual del producto. Clic en una entrada o
                  salida abre su documento completo.
                </p>
              )}
            </div>
          )}

          {/* ── Vista detalle ────────────────────────────────────────────── */}
          {detalle && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setDetalle(null)}
                  className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                >
                  <ChevronLeft className="size-3.5" />{' '}
                  {vista === 'kardex' ? 'Volver a movimientos de producto' : 'Volver al historial'}
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => exportarPdf(detalle.folio)}
                    disabled={busy}
                    title="Guardar PDF y abrirlo en el visor"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50 text-xs font-medium"
                  >
                    {pdfBusy === detalle.folio ? <Spinner size={13} /> : <FileText className="size-3.5" />}
                    Guardar PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => imprimir(detalle.folio)}
                    disabled={busy}
                    title="Mandar directo a la impresora"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-xs font-semibold"
                  >
                    {printBusy === detalle.folio ? <Spinner size={13} /> : <Printer className="size-3.5" />}
                    Imprimir
                  </button>
                </div>
              </div>

              <div className="rounded border border-border bg-muted/20 p-3 text-xs grid grid-cols-2 gap-x-6 gap-y-1">
                <div>
                  <span className="text-muted-foreground">Tipo: </span>
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${TIPO_BADGE[detalle.tipo]}`}
                  >
                    {TIPO_LABEL[detalle.tipo]}
                  </span>
                </div>
                <div><span className="text-muted-foreground">Folio: </span><span className="font-mono">{folioMovimiento(detalle.tipo, detalle.numero)}</span></div>
                <div><span className="text-muted-foreground">Fecha: </span>{new Date(detalle.fecha).toLocaleString('es-MX')}</div>
                <div>
                  <span className="text-muted-foreground">
                    {detalle.tipo === 'ENTRADA' ? 'Bodega destino: ' : 'Bodega origen: '}
                  </span>
                  {detalle.bodega}
                </div>
                {detalle.destino && (
                  <div>
                    <span className="text-muted-foreground">
                      {detalle.destinoTipo === 'BODEGA' ? 'Bodega destino: ' : 'Sucursal destino: '}
                    </span>
                    <span className="font-medium">{detalle.destino}</span>
                  </div>
                )}
                {detalle.proveedor && (
                  <div><span className="text-muted-foreground">Proveedor: </span><span className="font-medium">{detalle.proveedor}</span></div>
                )}
                {detalle.usuario && (
                  <div><span className="text-muted-foreground">Registró: </span>{detalle.usuario}</div>
                )}
                {detalle.motivo && (
                  <div className="col-span-2"><span className="text-muted-foreground">Motivo: </span>{detalle.motivo}</div>
                )}
                <div><span className="text-muted-foreground">Líneas: </span>{detalle.lineas}</div>
                <div>
                  <span className="text-muted-foreground">Unidades: </span>
                  <span className="font-semibold">{detalle.unidades.toLocaleString('es-MX')}</span>
                  <span className="text-muted-foreground ml-3">Valor (costo): </span>
                  <span className="font-semibold font-mono">${money(detalle.valor)}</span>
                </div>
              </div>

              <div className="border border-border rounded overflow-auto max-h-[45vh]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                    <tr className="text-left">
                      <th className="px-2 py-1.5 w-32 font-mono">Código</th>
                      <th className="px-2 py-1.5">Producto</th>
                      {esEntrada && <th className="px-2 py-1.5 w-36">Proveedor</th>}
                      {esSalida && <th className="px-2 py-1.5 w-36">Motivo</th>}
                      <th className="px-2 py-1.5 w-20 text-right">Cantidad</th>
                      <th className="px-2 py-1.5 w-24 text-right">Costo</th>
                      <th className="px-2 py-1.5 w-24 text-right">Importe</th>
                      <th className="px-2 py-1.5 w-28 text-center">Caducidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.items.map((l, i) => (
                      <tr key={i} className="border-b border-border/60">
                        <td className="px-2 py-1 font-mono">{l.codigo}</td>
                        <td className="px-2 py-1">
                          {l.nombre}
                          {l.sustancia && (
                            <div className="text-[10px] text-muted-foreground">{l.sustancia}</div>
                          )}
                        </td>
                        {esEntrada && (
                          <td className="px-2 py-1 text-[11px]">{provDeLinea(l)}</td>
                        )}
                        {esSalida && (
                          <td className="px-2 py-1 text-[11px]">{l.motivo ?? '—'}</td>
                        )}
                        <td className="px-2 py-1 text-right font-mono">{l.cantidad}</td>
                        <td className="px-2 py-1 text-right font-mono">${money(l.costo)}</td>
                        <td className="px-2 py-1 text-right font-mono">
                          ${money(l.cantidad * l.costo)}
                        </td>
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

    <SearchModal
      open={searchOpen}
      onClose={() => setSearchOpen(false)}
      onSelect={(p) => cargarKardex(p)}
      allowZeroStock
      returnFocus={() => setTimeout(() => kCodRef.current?.focus(), 100)}
    />
    </>
  )
}
