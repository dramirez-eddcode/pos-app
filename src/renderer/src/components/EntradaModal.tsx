import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Download, Trash2, Upload } from 'lucide-react'
import Papa from 'papaparse'
import Modal from './Modal'
import SearchModal from './SearchModal'
import InfoTooltip from './InfoTooltip'
import Spinner from './Spinner'
import { money } from '../lib/format'
import type { BodegaDto, ProductoDto } from '@shared/dto'

interface EntryRow {
  productoId: string
  codigo: string
  nombre: string
  cantidad: number
  costo: number
  fechaCaducidad?: string | null // YYYY-MM-DD
}

interface Props {
  open: boolean
  onClose: () => void
  userId: string
  onSaved?: () => void
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function defaultCaducidad(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 2)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function EntradaModal({ open, onClose, userId, onSaved }: Props) {
  const [items, setItems] = useState<EntryRow[]>([])
  const [current, setCurrent] = useState<ProductoDto | null>(null)
  const [codigo, setCodigo] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [costo, setCosto] = useState('')
  const [caducidad, setCaducidad] = useState(defaultCaducidad())
  const [saving, setSaving] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const codRef = useRef<HTMLInputElement>(null)
  const cantRef = useRef<HTMLInputElement>(null)
  const costoRef = useRef<HTMLInputElement>(null)
  const cadRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [bodegas, setBodegas] = useState<BodegaDto[]>([])
  const [bodegaId, setBodegaId] = useState<string>('')

  useEffect(() => {
    if (!open) return
    setItems([])
    setCurrent(null)
    setCodigo('')
    setCantidad('')
    setCosto('')
    setCaducidad(defaultCaducidad())
    setTimeout(() => codRef.current?.focus(), 80)
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

  const resetRow = useCallback(() => {
    setCurrent(null)
    setCodigo('')
    setCantidad('')
    setCosto('')
    setCaducidad(defaultCaducidad())
    setTimeout(() => codRef.current?.focus(), 30)
  }, [])

  const setFromProduct = useCallback((p: ProductoDto) => {
    setCurrent(p)
    setCodigo(p.codigo)
    // Pre-llenar costo con el costo actual del producto como referencia
    setCosto(p.precio > 0 && !costo ? '' : costo)
    setTimeout(() => cantRef.current?.focus(), 30)
  }, [costo])

  const lookupByCode = useCallback(async () => {
    const c = codigo.trim()
    if (!c) return
    const p = await window.api.productos.byCodigo(c)
    if (!p) {
      toast.error(`Producto "${c}" no encontrado`)
      return
    }
    setFromProduct(p)
  }, [codigo, setFromProduct])

  const addItem = useCallback(() => {
    if (!current) {
      toast.error('Busca un producto primero (F5 o teclea código + Enter)')
      return
    }
    const q = Math.round(parseFloat(cantidad))
    const c = parseFloat(costo || '0')
    if (!Number.isFinite(q) || q <= 0) {
      toast.error('Cantidad inválida')
      return
    }
    if (!Number.isFinite(c) || c < 0) {
      toast.error('Costo inválido')
      return
    }
    const row: EntryRow = {
      productoId: current.id,
      codigo: current.codigo,
      nombre: current.nombre,
      cantidad: q,
      costo: c,
      fechaCaducidad: caducidad || null
    }
    setItems((prev) => [...prev, row])
    resetRow()
  }, [current, cantidad, costo, caducidad, resetRow])

  const removeItem = useCallback((i: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }, [])

  // ── CSV: descarga plantilla + carga bulk ─────────────────────────────────
  const escapeCsv = (v: string): string => {
    if (v.includes('"') || v.includes(',') || v.includes('\n') || v.includes('\r')) {
      return '"' + v.replace(/"/g, '""') + '"'
    }
    return v
  }

  const downloadCSV = useCallback(async () => {
    try {
      const all = await window.api.productos.getAllActivos()
      const header = 'codigo,nombre,costo_actual,cantidad,costo,caducidad'
      const lines = all.map(
        (p) =>
          `${escapeCsv(p.codigo)},${escapeCsv(p.nombre)},${p.costo.toFixed(2)},,,`
      )
      const content = '﻿' + [header, ...lines].join('\r\n')
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const today = new Date().toISOString().slice(0, 10)
      const a = document.createElement('a')
      a.href = url
      a.download = `entradas-plantilla-farmacias-ms-${today}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(
        `Plantilla descargada con ${all.length.toLocaleString('es-MX')} productos`,
        {
          description:
            'Llena "cantidad" y "costo" (opc. "caducidad") en las filas que vas a recibir.'
        }
      )
    } catch (e) {
      toast.error('No pude descargar la plantilla', {
        description: e instanceof Error ? e.message : String(e)
      })
    }
  }, [])

  const parseCaducidad = (raw: string): string | null => {
    const s = raw.trim()
    if (!s) return null
    // Intenta YYYY-MM-DD directo
    const mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (mIso) {
      const [, y, m, d] = mIso
      const yyyy = y!
      const mm = m!.padStart(2, '0')
      const dd = d!.padStart(2, '0')
      const date = new Date(`${yyyy}-${mm}-${dd}T12:00:00`)
      return isNaN(date.getTime()) ? null : `${yyyy}-${mm}-${dd}`
    }
    // DD/MM/YYYY (formato mexicano común en Excel)
    const mMx = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (mMx) {
      const [, d, m, y] = mMx
      const yyyy = y!
      const mm = m!.padStart(2, '0')
      const dd = d!.padStart(2, '0')
      const date = new Date(`${yyyy}-${mm}-${dd}T12:00:00`)
      return isNaN(date.getTime()) ? null : `${yyyy}-${mm}-${dd}`
    }
    return null
  }

  const onFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setImporting(true)
    try {
      const text = await file.text()
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase()
      })

      const rows = parsed.data.filter((r) => r.codigo && r.codigo.trim())
      if (rows.length === 0) {
        toast.error('El CSV no tiene filas válidas', {
          description:
            'Verifica encabezado: codigo,nombre,costo_actual,cantidad,costo,caducidad'
        })
        return
      }

      const all = await window.api.productos.getAllActivos()
      const byCodigo = new Map(all.map((p) => [p.codigo, p]))

      let added = 0
      const skipped: string[] = []
      const notFound: string[] = []
      const invalid: string[] = []
      const newItems: EntryRow[] = []

      for (const row of rows) {
        const codigo = (row.codigo ?? '').trim()
        const cantidadStr = (row.cantidad ?? '').trim()
        if (!codigo) continue
        if (!cantidadStr) {
          skipped.push(codigo) // sin cantidad, fila de referencia
          continue
        }

        const prod = byCodigo.get(codigo)
        if (!prod) {
          notFound.push(codigo)
          continue
        }

        const q = Math.round(parseFloat(cantidadStr))
        if (!Number.isFinite(q) || q <= 0) {
          invalid.push(`${codigo} (cant=${cantidadStr})`)
          continue
        }

        // Si costo viene vacío, usa el costo actual del producto
        const costoStr = (row.costo ?? '').trim()
        const costo = costoStr ? parseFloat(costoStr) : prod.costo
        if (!Number.isFinite(costo) || costo < 0) {
          invalid.push(`${codigo} (costo=${costoStr})`)
          continue
        }

        const cad = parseCaducidad(row.caducidad ?? '')
        const fecha = cad ?? defaultCaducidad()

        newItems.push({
          productoId: prod.id,
          codigo: prod.codigo,
          nombre: prod.nombre,
          cantidad: q,
          costo: Math.round(costo * 100) / 100,
          fechaCaducidad: fecha
        })
        added++
      }

      setItems((prev) => [...prev, ...newItems])

      const parts: string[] = []
      parts.push(`${added} lote${added === 1 ? '' : 's'} cargado${added === 1 ? '' : 's'}`)
      if (skipped.length > 0) parts.push(`${skipped.length} sin cantidad`)
      if (notFound.length > 0)
        parts.push(
          `${notFound.length} código${notFound.length === 1 ? '' : 's'} no encontrado${notFound.length === 1 ? '' : 's'}`
        )
      if (invalid.length > 0)
        parts.push(
          `${invalid.length} fila${invalid.length === 1 ? '' : 's'} inválida${invalid.length === 1 ? '' : 's'}`
        )

      if (added > 0) toast.success('CSV procesado', { description: parts.join(' · ') })
      else toast.warning('No se cargó ningún lote', { description: parts.join(' · ') })

      if (notFound.length > 0) console.warn('[csv] Códigos no encontrados:', notFound.slice(0, 50))
      if (invalid.length > 0) console.warn('[csv] Filas inválidas:', invalid.slice(0, 50))
    } catch (err) {
      toast.error('Error leyendo CSV', {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setImporting(false)
    }
  }, [])

  const save = useCallback(async () => {
    if (items.length === 0) {
      toast.error('No hay ítems que registrar')
      return
    }
    if (!bodegaId) {
      toast.error('Selecciona una bodega destino')
      return
    }
    setSaving(true)
    try {
      const r = await window.api.entradas.create({
        usuarioId: userId,
        bodegaId,
        items: items.map((i) => ({
          productoId: i.productoId,
          codigo: i.codigo,
          nombre: i.nombre,
          cantidad: i.cantidad,
          costo: i.costo,
          fechaCaducidad: i.fechaCaducidad
            ? new Date(i.fechaCaducidad + 'T12:00:00').toISOString()
            : null
        }))
      })
      toast.success(
        `Entrada registrada: ${r.lotesCreados} lote(s), ${r.unidadesIngresadas} unidades`,
        { description: `Costo total: $${r.totalCosto.toFixed(2)}` }
      )
      onSaved?.()
      onClose()
    } catch (e) {
      toast.error('Falló la entrada', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setSaving(false)
    }
  }, [items, userId, bodegaId, onClose, onSaved])

  // Enter en cada campo avanza al siguiente / agrega
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
      costoRef.current?.focus()
    }
  }
  const onKeyCosto = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      cadRef.current?.focus()
    }
  }
  const onKeyCaducidad = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addItem()
    }
  }

  // Totales
  const totales = items.reduce(
    (acc, it) => ({
      unidades: acc.unidades + it.cantidad,
      importe: acc.importe + it.cantidad * it.costo
    }),
    { unidades: 0, importe: 0 }
  )

  return (
    <>
      <Modal
        open={open && !searchOpen}
        title="Entrada de mercancía"
        onClose={onClose}
        maxWidth="max-w-4xl"
      >
        <div className="p-4 text-sm space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Bodega destino */}
          {bodegas.length > 0 && (
            <section className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap font-medium">
                Bodega destino:
              </label>
              {bodegas.length === 1 ? (
                <span className="text-sm font-medium">{bodegas[0]!.nombre}</span>
              ) : (
                <select
                  className="border border-border rounded px-2 py-1.5 bg-background text-sm"
                  value={bodegaId}
                  onChange={(e) => setBodegaId(e.target.value)}
                >
                  {bodegas.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nombre}
                      {b.esPrincipal ? ' (principal)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </section>
          )}

          {/* Bulk CSV */}
          <section className="border border-dashed border-border rounded p-3 bg-muted/20">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 text-xs">
                <div className="font-semibold mb-0.5">
                  Entrada masiva por CSV — para facturas de proveedor
                </div>
                <p className="text-muted-foreground">
                  Descarga la plantilla con todos los productos. En Excel llena{' '}
                  <span className="font-mono">cantidad</span>,{' '}
                  <span className="font-mono">costo</span> (opc:{' '}
                  <span className="font-mono">caducidad</span>) en las filas que estás
                  recibiendo. Si dejas el costo vacío, se usa el costo actual del producto.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={downloadCSV}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted text-xs"
                >
                  <Download className="size-3.5" />
                  Descargar CSV
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={importing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50 text-xs"
                >
                  {importing ? <Spinner size={14} /> : <Upload className="size-3.5" />}
                  {importing ? 'Procesando…' : 'Cargar CSV'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={onFileSelected}
                />
              </div>
            </div>
          </section>

          {/* Formulario de captura */}
          <section className="border border-border rounded p-3 bg-muted/10 space-y-3">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Código o nombre <span className="font-mono">(Enter busca · F5 abre búsqueda)</span>
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
                {current.sustanciaActiva && (
                  <div className="text-muted-foreground mt-0.5">{current.sustanciaActiva}</div>
                )}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="flex items-center text-xs text-muted-foreground mb-1">
                  Cantidad
                  <InfoTooltip title="Unidades que ingresan al lote" align="start">
                    Usa la misma unidad con la que <strong>vendes</strong> el producto (cajas,
                    piezas, tabletas...).
                    <div className="mt-1.5 pt-1.5 border-t border-primary-foreground/20 italic">
                      Ej: si &quot;ASPIRINA C/10 TAB&quot; se vende por caja y recibiste 50 cajas,
                      captura <strong>50</strong>. Si vendieras por tableta individual,
                      capturarías 500.
                    </div>
                  </InfoTooltip>
                </label>
                <input
                  ref={cantRef}
                  type="number"
                  min={1}
                  step={1}
                  className="w-full border border-border rounded px-2 py-1.5 font-mono text-right"
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  onKeyDown={onKeyCantidad}
                  disabled={!current}
                />
              </div>
              <div>
                <label className="flex items-center text-xs text-muted-foreground mb-1">
                  Costo unitario
                  <InfoTooltip title="Costo por unidad (sin IVA)" align="center">
                    Lo que te cobra el <strong>proveedor</strong> por cada unidad, sin IVA. No
                    es el precio de venta al público.
                    <div className="mt-1.5 pt-1.5 border-t border-primary-foreground/20 italic">
                      Ej: factura de 50 cajas de aspirina a $5,000 antes de IVA → costo unitario
                      = <strong>100.00</strong>.
                    </div>
                  </InfoTooltip>
                </label>
                <input
                  ref={costoRef}
                  type="number"
                  min={0}
                  step={0.01}
                  className="w-full border border-border rounded px-2 py-1.5 font-mono text-right"
                  value={costo}
                  onChange={(e) => setCosto(e.target.value)}
                  onKeyDown={onKeyCosto}
                  disabled={!current}
                />
              </div>
              <div>
                <label className="flex items-center text-xs text-muted-foreground mb-1">
                  Caducidad
                  <InfoTooltip title="Fecha de expiración del lote" align="end">
                    La fecha impresa en el empaque del producto. El sistema despacha primero los
                    lotes que caducan antes (FEFO).
                    <div className="mt-1.5 pt-1.5 border-t border-primary-foreground/20 italic">
                      Para productos sin caducidad relevante (cubrebocas, jeringas, vasos
                      dosificadores…) deja la fecha por default (hoy + 2 años).
                    </div>
                  </InfoTooltip>
                </label>
                <input
                  ref={cadRef}
                  type="date"
                  min={todayISO()}
                  className="w-full border border-border rounded px-2 py-1.5 font-mono"
                  value={caducidad}
                  onChange={(e) => setCaducidad(e.target.value)}
                  onKeyDown={onKeyCaducidad}
                  disabled={!current}
                />
              </div>
            </div>

            <div className="flex justify-between items-center">
              <div className="text-xs text-muted-foreground">
                Tip: Enter en cada campo avanza al siguiente; en caducidad agrega al lote.
              </div>
              <button
                type="button"
                onClick={addItem}
                disabled={!current || !cantidad}
                className="px-4 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-medium"
              >
                Agregar lote
              </button>
            </div>
          </section>

          {/* Tabla de items ya capturados */}
          <section className="border border-border rounded">
            <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide flex justify-between">
              <span>Lotes a registrar</span>
              <span className="text-[10px] normal-case text-muted-foreground">
                {items.length} renglón(es)
              </span>
            </header>
            <div className="overflow-auto max-h-[250px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background border-b border-border">
                  <tr className="text-left">
                    <th className="px-2 py-1 w-12 text-right">Cant</th>
                    <th className="px-2 py-1">Producto</th>
                    <th className="px-2 py-1 w-24 text-right">Costo</th>
                    <th className="px-2 py-1 w-28 text-right">Importe</th>
                    <th className="px-2 py-1 w-28">Caducidad</th>
                    <th className="px-2 py-1 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-2 py-6 text-center text-muted-foreground italic"
                      >
                        Sin lotes — captura un producto arriba
                      </td>
                    </tr>
                  )}
                  {items.map((it, i) => (
                    <tr key={i} className="border-b border-border/60">
                      <td className="px-2 py-1 text-right font-mono">{it.cantidad}</td>
                      <td className="px-2 py-1">
                        <div>{it.nombre}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {it.codigo}
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right font-mono">{money(it.costo)}</td>
                      <td className="px-2 py-1 text-right font-mono">
                        {money(it.cantidad * it.costo)}
                      </td>
                      <td className="px-2 py-1 font-mono text-[11px]">
                        {it.fechaCaducidad ?? '—'}
                      </td>
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
                  ))}
                </tbody>
              </table>
            </div>
            {items.length > 0 && (
              <footer className="px-3 py-2 border-t border-border bg-muted/20 flex justify-end gap-6 text-xs font-mono">
                <div>
                  <span className="text-muted-foreground">Unidades: </span>
                  <span className="font-semibold">{totales.unidades}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Costo total: </span>
                  <span className="font-bold text-blue-700">${money(totales.importe)}</span>
                </div>
              </footer>
            )}
          </section>
        </div>

        <footer className="flex justify-between items-center px-4 py-3 border-t border-border bg-muted/20">
          <div className="text-xs text-muted-foreground">
            Se creará un lote por renglón en <span className="font-mono">caducidad_lote</span> +
            movimiento en el journal.
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
                'Guardar entrada'
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
