import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ChevronDown, ChevronRight, Clock, FileDown, Search } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import { money } from '../lib/format'
import type { BodegaDto, StockBodegaItem, StockBodegaResult } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
}

const PAGE_SIZES = [10, 20, 50, 100, 200]

function escapeCsv(v: string): string {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
}

export default function StockBodegaModal({ open, onClose }: Props) {
  const [bodegas, setBodegas] = useState<BodegaDto[]>([])
  const [bodegaId, setBodegaId] = useState('')
  const [data, setData] = useState<StockBodegaResult | null>(null)
  const [loading, setLoading] = useState(false)

  const [filtro, setFiltro] = useState('')
  const [soloBajoMinimo, setSoloBajoMinimo] = useState(false)
  const [soloPorVencer, setSoloPorVencer] = useState(false)
  const [expandido, setExpandido] = useState<Set<string>>(new Set())

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

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

  const cargarStock = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
    try {
      const r = await window.api.inventario.stockBodega(id)
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

  // Cargar stock cuando cambia la bodega seleccionada
  useEffect(() => {
    if (open && bodegaId) cargarStock(bodegaId)
  }, [open, bodegaId, cargarStock])

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
          <button
            type="button"
            onClick={exportarHojaConteo}
            disabled={loading || filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50 ml-auto"
          >
            <FileDown className="size-3.5" />
            Exportar hoja de conteo
          </button>
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
        </div>

        {/* Tabla */}
        <div className="border border-border rounded overflow-auto max-h-[55vh]">
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
            <tbody>
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
                pageItems.map((it) => (
                  <Fila
                    key={it.productoId}
                    it={it}
                    expandido={expandido.has(it.productoId)}
                    onToggle={() => toggleExpand(it.productoId)}
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
  expandido,
  onToggle
}: {
  it: StockBodegaItem
  expandido: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr className={`border-b border-border/60 ${!it.activo ? 'opacity-60' : ''}`}>
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
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Lotes (FEFO)</div>
            <div className="flex flex-wrap gap-1.5">
              {it.lotes.map((l, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] ${
                    l.vencido
                      ? 'border-red-300 bg-red-50 text-red-700'
                      : l.porVencer
                        ? 'border-amber-300 bg-amber-50 text-amber-700'
                        : 'border-border bg-background'
                  }`}
                  title={l.vencido ? 'Vencido' : l.porVencer ? 'Por vencer (≤90 días)' : ''}
                >
                  {(l.vencido || l.porVencer) && <Clock className="size-3" />}
                  {l.caducidad} · {l.saldo.toLocaleString('es-MX')}
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function CaducidadBadge({ item }: { item: StockBodegaItem }) {
  if (!item.proximaCaducidad) return <span className="text-muted-foreground">—</span>
  const prox = item.lotes[0]
  const cls = prox?.vencido ? 'text-red-700 font-semibold' : prox?.porVencer ? 'text-amber-700' : ''
  return <span className={cls}>{item.proximaCaducidad}</span>
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
