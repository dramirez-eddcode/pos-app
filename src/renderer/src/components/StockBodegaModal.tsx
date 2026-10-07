import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FileDown,
  FileText,
  Pencil,
  Printer,
  Search,
  SlidersHorizontal,
  X
} from 'lucide-react'
import Modal from './Modal'
import RedistribuirLotesModal from './RedistribuirLotesModal'
import Spinner from './Spinner'
import { useSession } from '../stores/session'
import { money } from '../lib/format'
import type {
  BodegaDto,
  StockBodegaItem,
  StockBodegaPdfInput,
  StockBodegaResult
} from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
}

const PAGE_SIZES = [10, 20, 50, 100, 200]

function escapeCsv(v: string): string {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
}

export default function StockBodegaModal({ open, onClose }: Props) {
  const { user } = useSession()
  const [bodegas, setBodegas] = useState<BodegaDto[]>([])
  const [bodegaId, setBodegaId] = useState('')
  const [data, setData] = useState<StockBodegaResult | null>(null)
  const [loading, setLoading] = useState(false)

  const [filtro, setFiltro] = useState('')
  const [soloBajoMinimo, setSoloBajoMinimo] = useState(false)
  const [soloPorVencer, setSoloPorVencer] = useState(false)
  const [incluirCero, setIncluirCero] = useState(false)
  // Al imprimir/PDF: sub-fila con el detalle de lotes bajo cada producto (el
  // dueño anota sobre las hojas). Activado por defecto; se puede quitar si se
  // quiere el reporte corto (usa bastantes menos páginas).
  const [incluirLotes, setIncluirLotes] = useState(true)
  const [expandido, setExpandido] = useState<Set<string>>(new Set())

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [printBusy, setPrintBusy] = useState(false)
  // Renglón sombreado (↑/↓ recorren la página y saltan de página en los
  // extremos; Enter expande/colapsa los lotes del producto sombreado).
  const [selRow, setSelRow] = useState(-1)
  const stockTbodyRef = useRef<HTMLTableSectionElement>(null)

  // Cargar bodegas al abrir
  useEffect(() => {
    if (!open) return
    setData(null)
    setFiltro('')
    setSoloBajoMinimo(false)
    setSoloPorVencer(false)
    setExpandido(new Set())
    window.api.bodegas
      .list()
      .then((bs) => {
        const activas = bs.filter((b) => b.activa)
        setBodegas(activas)
        const principal = activas.find((b) => b.esPrincipal) ?? activas[0]
        setBodegaId(principal?.id ?? '')
      })
      .catch(() => {})
  }, [open])

  const cargarStock = useCallback(async (id: string, conCero: boolean) => {
    if (!id) return
    setLoading(true)
    try {
      const r = await window.api.inventario.stockBodega(id, conCero)
      setData(r)
    } catch (e) {
      toast.error('No se pudo cargar el stock', {
        description: e instanceof Error ? e.message : String(e)
      })
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Cargar stock cuando cambia la bodega o el toggle de "incluir 0"
  useEffect(() => {
    if (open && bodegaId) cargarStock(bodegaId, incluirCero)
  }, [open, bodegaId, incluirCero, cargarStock])

  const items = data?.items ?? []

  const filtered = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    return items.filter((it) => {
      if (soloBajoMinimo && !it.bajoMinimo) return false
      if (soloPorVencer && !it.lotes.some((l) => l.vencido || l.porVencer)) return false
      if (!q) return true
      return (
        it.codigo.toLowerCase().includes(q) ||
        it.nombre.toLowerCase().includes(q) ||
        (it.sustanciaActiva ?? '').toLowerCase().includes(q)
      )
    })
  }, [items, filtro, soloBajoMinimo, soloPorVencer])

  useEffect(() => {
    setPage(1)
  }, [filtro, soloBajoMinimo, soloPorVencer, bodegaId, pageSize])

  // El sombreado se resetea al cambiar de página o de filtros.
  useEffect(() => {
    setSelRow(-1)
  }, [page, filtro, soloBajoMinimo, soloPorVencer, bodegaId, pageSize, incluirCero])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageSafe = Math.min(page, totalPages)
  const pageItems = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize)

  const toggleExpand = (id: string): void => {
    setExpandido((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ↑/↓ con la tabla enfocada recorren los productos (saltan de página en los
  // extremos) y Enter expande/colapsa los lotes del sombreado. Los inputs
  // (filtro, checkboxes, fecha de caducidad inline) conservan sus teclas.
  const onKeyStock = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const tgt = e.target as HTMLElement | null
    if (
      tgt instanceof HTMLInputElement ||
      tgt instanceof HTMLSelectElement ||
      tgt instanceof HTMLTextAreaElement
    ) {
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (pageItems.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'ArrowDown') {
        if (selRow >= pageItems.length - 1) {
          if (pageSafe < totalPages) {
            setPage(pageSafe + 1)
            setTimeout(() => setSelRow(0), 0) // tras el reset por cambio de página
          }
          return
        }
        setSelRow((i) => Math.min(pageItems.length - 1, i + 1))
      } else {
        if (selRow === 0 && pageSafe > 1) {
          setPage(pageSafe - 1)
          setTimeout(() => setSelRow(pageSize - 1), 0)
          return
        }
        setSelRow((i) => Math.max(0, i - 1))
      }
    } else if (e.key === 'Enter') {
      if (tgt?.tagName === 'BUTTON') return
      const it = pageItems[selRow]
      if (!it) return
      e.preventDefault()
      e.stopPropagation()
      toggleExpand(it.productoId)
    }
  }

  // Mantiene visible la fila sombreada (la expansión de lotes inserta <tr>
  // extra, por eso se ubica por data-fila y no por índice del tbody).
  useEffect(() => {
    if (selRow < 0) return
    const tbody = stockTbodyRef.current
    const row = tbody?.querySelector(`tr[data-fila="${selRow}"]`) as HTMLElement | null
    const cont = tbody?.closest('.overflow-auto') as HTMLElement | null
    if (!row || !cont) return
    const headerH = cont.querySelector('thead')?.getBoundingClientRect().height ?? 0
    if (row.offsetTop - headerH < cont.scrollTop) {
      cont.scrollTop = Math.max(0, row.offsetTop - headerH)
    } else if (row.offsetTop + row.offsetHeight > cont.scrollTop + cont.clientHeight) {
      cont.scrollTop = row.offsetTop + row.offsetHeight - cont.clientHeight
    }
  }, [selRow])

  const exportarHojaConteo = useCallback(() => {
    if (filtered.length === 0) {
      toast.warning('No hay productos para exportar')
      return
    }
    const bodega = bodegas.find((b) => b.id === bodegaId)
    const header = 'codigo,nombre,sustancia,existencias_sistema,conteo_fisico,diferencia'
    const lines = filtered.map((it) =>
      [
        escapeCsv(it.codigo),
        escapeCsv(it.nombre),
        escapeCsv(it.sustanciaActiva ?? ''),
        String(it.existencias),
        '',
        ''
      ].join(',')
    )
    const content = '﻿' + [header, ...lines].join('\r\n')
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const today = new Date().toISOString().slice(0, 10)
    const a = document.createElement('a')
    a.href = url
    a.download = `inventario-${(bodega?.nombre ?? 'bodega').replace(/\s+/g, '-')}-${today}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(`Hoja de conteo exportada (${filtered.length.toLocaleString('es-MX')} productos)`)
  }, [filtered, bodegas, bodegaId])

  const resumen = data?.resumen

  // Arma el reporte imprimible con LO QUE SE VE (filtros aplicados) + resumen
  // global de la bodega.
  const buildPdfInput = useCallback((): StockBodegaPdfInput | null => {
    if (!data) return null
    const bodega = bodegas.find((b) => b.id === bodegaId)
    const filtros: string[] = []
    if (filtro.trim()) filtros.push(`texto "${filtro.trim()}"`)
    if (soloBajoMinimo) filtros.push('solo bajo mínimo')
    if (soloPorVencer) filtros.push('solo por vencer / vencidos')
    return {
      bodegaNombre: bodega?.nombre ?? 'Bodega',
      resumen: data.resumen,
      filtroDescripcion: filtros.length > 0 ? filtros.join(' · ') : null,
      incluirLotes,
      items: filtered.map((it) => ({
        codigo: it.codigo,
        nombre: it.nombre,
        sustanciaActiva: it.sustanciaActiva,
        existencias: it.existencias,
        stockMinimo: it.stockMinimo,
        bajoMinimo: it.bajoMinimo,
        valorCosto: it.valorCosto,
        proximaCaducidad: it.proximaCaducidad,
        vencido: it.lotes[0]?.vencido ?? false,
        porVencer: it.lotes[0]?.porVencer ?? false,
        lotes: incluirLotes
          ? it.lotes.map((l) => ({
              caducidad: l.caducidad,
              saldo: l.saldo,
              vencido: l.vencido,
              porVencer: l.porVencer
            }))
          : undefined
      }))
    }
  }, [data, bodegas, bodegaId, filtro, soloBajoMinimo, soloPorVencer, filtered, incluirLotes])

  const exportarPdf = useCallback(async () => {
    const input = buildPdfInput()
    if (!input || input.items.length === 0) {
      toast.warning('No hay productos para el reporte')
      return
    }
    setPdfBusy(true)
    try {
      const r = await window.api.inventario.stockPdf(input)
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
      setPdfBusy(false)
    }
  }, [buildPdfInput])

  const imprimir = useCallback(async () => {
    const input = buildPdfInput()
    if (!input || input.items.length === 0) {
      toast.warning('No hay productos para el reporte')
      return
    }
    setPrintBusy(true)
    try {
      const r = await window.api.inventario.stockImprimir(input)
      if (r.cancelled) return
      if (!r.ok) {
        toast.error('No se pudo imprimir', { description: r.error })
        return
      }
      toast.success('Reporte enviado a la impresora')
    } catch (e) {
      toast.error('No se pudo imprimir', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setPrintBusy(false)
    }
  }, [buildPdfInput])

  return (
    <Modal open={open} title="Stock por bodega" onClose={onClose} maxWidth="max-w-6xl">
      <div className="p-4 space-y-3 text-sm">
        {/* Barra: bodega + exportar */}
        <div className="flex items-end gap-2 flex-wrap">
          <div className="min-w-[220px]">
            <label className="block text-xs text-muted-foreground mb-1">Bodega</label>
            <select
              value={bodegaId}
              onChange={(e) => setBodegaId(e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 bg-background"
            >
              {bodegas.length === 0 && <option value="">(sin bodegas)</option>}
              {bodegas.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nombre}
                  {b.esPrincipal ? ' (principal)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={exportarHojaConteo}
              disabled={loading || filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50"
            >
              <FileDown className="size-3.5" />
              Exportar hoja de conteo
            </button>
            <button
              type="button"
              onClick={exportarPdf}
              disabled={loading || pdfBusy || printBusy || filtered.length === 0}
              title="Guardar PDF del listado tal como se ve (con filtros) y abrirlo para imprimir"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50"
            >
              {pdfBusy ? <Spinner size={14} /> : <FileText className="size-3.5" />}
              Guardar PDF
            </button>
            <button
              type="button"
              onClick={imprimir}
              disabled={loading || pdfBusy || printBusy || filtered.length === 0}
              title="Mandar el listado directo a la impresora"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 font-medium"
            >
              {printBusy ? <Spinner size={14} /> : <Printer className="size-3.5" />}
              Imprimir
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <Kpi label="SKUs con stock" value={resumen ? resumen.skusConStock.toLocaleString('es-MX') : '—'} />
          <Kpi label="Unidades" value={resumen ? resumen.unidades.toLocaleString('es-MX') : '—'} />
          <Kpi label="Valor (costo)" value={resumen ? `$${money(resumen.valorCosto)}` : '—'} />
          <Kpi label="Lotes" value={resumen ? resumen.lotes.toLocaleString('es-MX') : '—'} />
          <Kpi
            label="Bajo mínimo"
            value={resumen ? resumen.bajoMinimo.toLocaleString('es-MX') : '—'}
            tone={resumen && resumen.bajoMinimo > 0 ? 'amber' : undefined}
          />
          <Kpi
            label="Por vencer / vencidos"
            value={resumen ? `${resumen.porVencer} / ${resumen.vencidos}` : '—'}
            tone={resumen && (resumen.porVencer > 0 || resumen.vencidos > 0) ? 'red' : undefined}
          />
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 relative min-w-[220px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filtrar por código, nombre o sustancia…"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              className="w-full pl-7 pr-2 py-1.5 border border-border rounded"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            <input type="checkbox" checked={soloBajoMinimo} onChange={(e) => setSoloBajoMinimo(e.target.checked)} />
            Solo bajo mínimo
          </label>
          <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            <input type="checkbox" checked={soloPorVencer} onChange={(e) => setSoloPorVencer(e.target.checked)} />
            Solo por vencer / vencidos
          </label>
          <label
            className="flex items-center gap-1.5 text-xs whitespace-nowrap"
            title="Muestra también los productos del catálogo que tienen existencia 0 en esta bodega"
          >
            <input type="checkbox" checked={incluirCero} onChange={(e) => setIncluirCero(e.target.checked)} />
            Incluir existencia 0
          </label>
          <label
            className="flex items-center gap-1.5 text-xs whitespace-nowrap"
            title="Al imprimir o guardar PDF, agrega debajo de cada producto sus lotes (caducidad y cantidad). Usa más hojas."
          >
            <input
              type="checkbox"
              checked={incluirLotes}
              onChange={(e) => setIncluirLotes(e.target.checked)}
            />
            Detalle de lotes en impresión
          </label>
        </div>

        {/* Tabla */}
        <div
          tabIndex={0}
          onKeyDown={onKeyStock}
          className="border border-border rounded overflow-auto max-h-[55vh] focus:outline-none focus:ring-1 focus:ring-primary/40"
          title="↑/↓ recorren los productos · Enter muestra/oculta sus lotes"
        >
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
              <tr className="text-left">
                <th className="px-2 py-1.5 w-8"></th>
                <th className="px-2 py-1.5 font-mono w-32">Código</th>
                <th className="px-2 py-1.5">Nombre</th>
                <th className="px-2 py-1.5 w-24 text-right">Existencias</th>
                <th className="px-2 py-1.5 w-20 text-right">Mínimo</th>
                <th className="px-2 py-1.5 w-28 text-right">Valor costo</th>
                <th className="px-2 py-1.5 w-28 text-center">Próx. caducidad</th>
              </tr>
            </thead>
            <tbody ref={stockTbodyRef}>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-2 py-8 text-muted-foreground">
                    <span className="flex items-center justify-center">
                      <Spinner label="Cargando stock…" />
                    </span>
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-8 text-center text-muted-foreground italic">
                    {items.length === 0 ? 'Esta bodega no tiene existencias.' : 'Sin coincidencias.'}
                  </td>
                </tr>
              )}
              {!loading &&
                pageItems.map((it, i) => (
                  <Fila
                    key={it.productoId}
                    it={it}
                    idx={i}
                    seleccionada={i === selRow}
                    onSelect={() => setSelRow(i)}
                    bodegaId={bodegaId}
                    expandido={expandido.has(it.productoId)}
                    onToggle={() => toggleExpand(it.productoId)}
                    userId={user?.id ?? ''}
                    onSaved={() => cargarStock(bodegaId, incluirCero)}
                  />
                ))}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span>Mostrar</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="border border-border rounded px-1.5 py-1 bg-background"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>por página</span>
          </div>
          <div>
            {filtered.length === 0
              ? '0 productos'
              : `Mostrando ${(pageSafe - 1) * pageSize + 1}–${Math.min(
                  pageSafe * pageSize,
                  filtered.length
                )} de ${filtered.length}`}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPage(1)} disabled={pageSafe <= 1} className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40">«</button>
            <button type="button" onClick={() => setPage(pageSafe - 1)} disabled={pageSafe <= 1} className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40">‹</button>
            <span className="px-2 whitespace-nowrap">Página {pageSafe} de {totalPages}</span>
            <button type="button" onClick={() => setPage(pageSafe + 1)} disabled={pageSafe >= totalPages} className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40">›</button>
            <button type="button" onClick={() => setPage(totalPages)} disabled={pageSafe >= totalPages} className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40">»</button>
          </div>
        </div>
      </div>

      <footer className="flex justify-end px-4 py-2 border-t border-border bg-muted/20">
        <button type="button" onClick={onClose} className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm">
          Cerrar
        </button>
      </footer>
    </Modal>
  )
}

function Fila({
  it,
  idx,
  seleccionada,
  onSelect,
  bodegaId,
  expandido,
  onToggle,
  userId,
  onSaved
}: {
  it: StockBodegaItem
  idx: number
  seleccionada: boolean
  onSelect: () => void
  bodegaId: string
  expandido: boolean
  onToggle: () => void
  userId: string
  onSaved: () => void
}) {
  const [editLoteId, setEditLoteId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingLote, setSavingLote] = useState(false)
  const [ajustarOpen, setAjustarOpen] = useState(false)

  const guardarCaducidad = async () => {
    if (!editLoteId) return
    if (!editValue) {
      toast.error('Captura una fecha de caducidad')
      return
    }
    setSavingLote(true)
    try {
      await window.api.inventario.updateLoteCaducidad(userId, editLoteId, editValue)
      toast.success('Caducidad actualizada')
      setEditLoteId(null)
      onSaved()
    } catch (e) {
      toast.error('No se pudo actualizar la caducidad', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setSavingLote(false)
    }
  }

  return (
    <>
      <tr
        data-fila={idx}
        onClick={(e) => {
          onSelect()
          ;(e.currentTarget.closest('[tabindex]') as HTMLElement | null)?.focus()
        }}
        className={`border-b border-border/60 cursor-pointer ${
          seleccionada ? 'bg-primary/10' : 'hover:bg-muted/40'
        } ${!it.activo ? 'opacity-60' : ''}`}
      >
        <td className="px-2 py-1 text-center">
          <button type="button" onClick={onToggle} className="text-muted-foreground hover:text-foreground" title="Ver lotes">
            {expandido ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </td>
        <td className="px-2 py-1 font-mono">{it.codigo}</td>
        <td className="px-2 py-1">
          <div className="flex items-center gap-1.5">
            <span>{it.nombre}</span>
            {!it.activo && <span className="text-[9px] uppercase text-muted-foreground border border-border rounded px-1">inactivo</span>}
            {it.bajoMinimo && (
              <span className="inline-flex items-center gap-0.5 text-[9px] uppercase text-amber-700" title="Bajo el mínimo">
                <AlertTriangle className="size-3" /> bajo mín
              </span>
            )}
          </div>
          {it.sustanciaActiva && <div className="text-[10px] text-muted-foreground">{it.sustanciaActiva}</div>}
        </td>
        <td className="px-2 py-1 text-right font-mono font-semibold">{it.existencias.toLocaleString('es-MX')}</td>
        <td className="px-2 py-1 text-right font-mono text-muted-foreground">{it.stockMinimo || '—'}</td>
        <td className="px-2 py-1 text-right font-mono">${money(it.valorCosto)}</td>
        <td className="px-2 py-1 text-center font-mono">
          <CaducidadBadge item={it} />
        </td>
      </tr>
      {expandido && (
        <tr className="bg-muted/20 border-b border-border/60">
          <td></td>
          <td colSpan={6} className="px-2 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase text-muted-foreground">Lotes (FEFO)</span>
              {userId && it.existencias > 0 && (
                <button
                  type="button"
                  onClick={() => setAjustarOpen(true)}
                  className="inline-flex items-center gap-1 text-[10px] uppercase border border-border rounded px-1.5 py-0.5 cursor-pointer hover:bg-muted"
                  title="Repartir las existencias entre lotes (crear, eliminar o mover cantidades) sin cambiar el total"
                >
                  <SlidersHorizontal className="size-3" /> Ajustar lotes
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {it.lotes.map((l) => {
                const editing = editLoteId === l.loteId
                return (
                  <span
                    key={l.loteId}
                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] ${
                      editing
                        ? 'border-primary bg-background'
                        : l.vencido
                          ? 'border-red-300 bg-red-50 text-red-700'
                          : l.porVencer
                            ? 'border-amber-300 bg-amber-50 text-amber-700'
                            : 'border-border bg-background'
                    }`}
                    title={
                      editing ? '' : l.vencido ? 'Vencido' : l.porVencer ? 'Por vencer (≤90 días)' : ''
                    }
                  >
                    {editing ? (
                      <>
                        <input
                          type="date"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          disabled={savingLote}
                          autoFocus
                          className="border border-border rounded px-1 py-0 text-[11px] font-mono"
                        />
                        <span className="text-muted-foreground">
                          · {l.saldo.toLocaleString('es-MX')}
                        </span>
                        <button
                          type="button"
                          onClick={guardarCaducidad}
                          disabled={savingLote}
                          title="Guardar"
                          className="text-green-600 hover:text-green-700 disabled:opacity-50"
                        >
                          {savingLote ? <Spinner size={12} /> : <Check className="size-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditLoteId(null)}
                          disabled={savingLote}
                          title="Cancelar"
                          className="text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          <X className="size-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        {(l.vencido || l.porVencer) && <Clock className="size-3" />}
                        {fechaDMA(l.caducidad)} · {l.saldo.toLocaleString('es-MX')}
                        {userId && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditLoteId(l.loteId)
                              setEditValue(l.caducidad)
                            }}
                            title="Editar fecha de caducidad"
                            className="ml-0.5 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="size-3" />
                          </button>
                        )}
                      </>
                    )}
                  </span>
                )
              })}
            </div>
            <RedistribuirLotesModal
              open={ajustarOpen}
              onClose={() => setAjustarOpen(false)}
              userId={userId}
              bodegaId={bodegaId}
              item={it}
              onSaved={() => {
                setAjustarOpen(false)
                onSaved()
              }}
            />
          </td>
        </tr>
      )}
    </>
  )
}

// 'YYYY-MM-DD' → 'DD-MM-YYYY': las fechas de caducidad SIEMPRE se muestran
// día-mes-año, igual que el editor de fecha (que usa el orden del locale).
function fechaDMA(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ymd
}

function CaducidadBadge({ item }: { item: StockBodegaItem }) {
  if (!item.proximaCaducidad) return <span className="text-muted-foreground">—</span>
  const prox = item.lotes[0]
  const cls = prox?.vencido ? 'text-red-700 font-semibold' : prox?.porVencer ? 'text-amber-700' : ''
  return <span className={cls}>{fechaDMA(item.proximaCaducidad)}</span>
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'amber' | 'red' }) {
  const toneCls = tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : 'text-foreground'
  return (
    <div className="rounded border border-border bg-muted/10 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold font-mono ${toneCls}`}>{value}</div>
    </div>
  )
}
