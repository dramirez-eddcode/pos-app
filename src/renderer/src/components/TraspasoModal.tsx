import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRightLeft, Search, Upload } from 'lucide-react'
import Papa from 'papaparse'
import Modal from './Modal'
import Spinner from './Spinner'
import BusyOverlay from './BusyOverlay'
import { money } from '../lib/format'
import type { BodegaDto, CrearTraspasoResult, StockBodegaItem, SucursalDto } from '@shared/dto'

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
  // cantidad a traspasar por código
  const [cant, setCant] = useState<Record<string, string>>({})
  const [filtro, setFiltro] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  useEffect(() => {
    if (!open) return
    setStock([])
    setCant({})
    setFiltro('')
    setDestinoCodigo('')
    setDestinoNombre('')
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
      cargarStock(bodegaId)
    }
  }, [open, bodegaId, cargarStock])

  const filtered = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    if (!q) return stock
    return stock.filter(
      (it) => it.codigo.toLowerCase().includes(q) || it.nombre.toLowerCase().includes(q)
    )
  }, [stock, filtro])

  useEffect(() => {
    setPage(1)
  }, [filtro, bodegaId, pageSize])

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
    const items: { codigo: string; cantidad: number }[] = []
    for (const [codigo, val] of Object.entries(cant)) {
      const n = Math.round(Number(val))
      if (!Number.isFinite(n) || n <= 0) continue
      const disp = byCodigo.get(codigo)?.existencias ?? 0
      const cantidad = Math.min(n, disp) // nunca más que lo disponible
      if (cantidad <= 0) continue
      lineas++
      unidades += cantidad
      items.push({ codigo, cantidad })
    }
    return { lineas, unidades, items }
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
      toast.success(
        `${esInterno ? 'Traspaso entre bodegas realizado' : 'Traspaso generado'} · ${r.unidades?.toLocaleString('es-MX')} unidades`,
        {
          description: esInterno
            ? `Folio ${folio?.slice(0, 8)}… · ${r.lineas} líneas · el stock ya está en la bodega destino`
            : `Folio ${folio?.slice(0, 8)}… · ${r.lineas} líneas · guardado en ${r.path}`,
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

  return (
    <Modal
      open={open}
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
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Código destino</label>
                  <input
                    type="text"
                    value={destinoCodigo}
                    onChange={(e) => setDestinoCodigo(e.target.value)}
                    placeholder="S02 / MATRIZ"
                    className="w-full border border-border rounded px-2 py-1.5 font-mono"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Nombre destino</label>
                  <input
                    type="text"
                    value={destinoNombre}
                    onChange={(e) => setDestinoNombre(e.target.value)}
                    placeholder="Sucursal Centro / Bodega Matriz"
                    className="w-full border border-border rounded px-2 py-1.5"
                    autoComplete="off"
                  />
                </div>
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

          {/* Filtro + CSV */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 relative min-w-[220px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input type="text" placeholder="Filtrar por código o nombre…" value={filtro} onChange={(e) => setFiltro(e.target.value)} className="w-full pl-7 pr-2 py-1.5 border border-border rounded" />
            </div>
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
                  <th className="px-2 py-1.5 w-28 text-right">A traspasar</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={4} className="px-2 py-8"><span className="flex items-center justify-center"><Spinner label="Cargando stock…" /></span></td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={4} className="px-2 py-8 text-center text-muted-foreground italic">{stock.length === 0 ? 'Esta bodega no tiene existencias.' : 'Sin coincidencias.'}</td></tr>
                )}
                {!loading && pageItems.map((it) => (
                  <tr key={it.productoId} className="border-b border-border/60">
                    <td className="px-2 py-1 font-mono">{it.codigo}</td>
                    <td className="px-2 py-1">{it.nombre}</td>
                    <td className="px-2 py-1 text-right font-mono">{it.existencias.toLocaleString('es-MX')}</td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        min={0}
                        max={it.existencias}
                        value={cant[it.codigo] ?? ''}
                        onChange={(e) => setCantidad(it.codigo, e.target.value)}
                        placeholder="0"
                        className="w-20 border border-border rounded px-1.5 py-1 font-mono text-right"
                      />
                    </td>
                  </tr>
                ))}
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
              Seleccionados: {seleccion.lineas} productos · {seleccion.unidades.toLocaleString('es-MX')} unidades
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
            onClick={generar}
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
  )
}
