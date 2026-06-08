import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import { toast } from 'sonner'
import { Plus, Power, Pencil, Search, Download, Upload, FileDown } from 'lucide-react'
import Papa from 'papaparse'
import Modal from './Modal'
import Spinner from './Spinner'
import { useSession } from '../stores/session'
import { money } from '../lib/format'
import { calcFromBase } from '@shared/iva'
import type {
  BulkProductoRow,
  CreateProductoInput,
  ProductoCatalogoItem,
  UpdateProductoInput
} from '@shared/dto'
import type { IvaModo } from '@shared/types'

interface Props {
  open: boolean
  onClose: () => void
}

type SubForm =
  | { kind: 'create' }
  | { kind: 'edit'; target: ProductoCatalogoItem }
  | null

type IvaFilter = 'todos' | IvaModo

export default function CatalogoProductosModal({ open, onClose }: Props) {
  const { user } = useSession()
  const [list, setList] = useState<ProductoCatalogoItem[]>([])
  const [loading, setLoading] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [showInactivos, setShowInactivos] = useState(false)
  const [ivaFilter, setIvaFilter] = useState<IvaFilter>('todos')
  const [sub, setSub] = useState<SubForm>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const r = await window.api.productos.listCatalogo(user.id)
      setList(r)
    } catch (e) {
      toast.error('No pude cargar el catálogo', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const filtered = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    return list.filter((p) => {
      if (!showInactivos && !p.activo) return false
      if (ivaFilter !== 'todos' && p.ivaModo !== ivaFilter) return false
      if (!q) return true
      return (
        p.codigo.toLowerCase().includes(q) ||
        p.nombre.toLowerCase().includes(q) ||
        (p.sustanciaActiva ?? '').toLowerCase().includes(q) ||
        (p.laboratorio ?? '').toLowerCase().includes(q)
      )
    })
  }, [list, filtro, showInactivos, ivaFilter])

  const ivaStats = useMemo(() => {
    const stats = { exento: 0, sumar: 0, incluido: 0 }
    for (const p of list) {
      if (p.activo) stats[p.ivaModo]++
    }
    return stats
  }, [list])

  // ── Paginación ──────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageSafe = Math.min(page, totalPages)
  const pageItems = useMemo(
    () => filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize),
    [filtered, pageSafe, pageSize]
  )

  // Vuelve a la primera página cuando cambian filtros o el tamaño de página.
  useEffect(() => {
    setPage(1)
  }, [filtro, showInactivos, ivaFilter, pageSize])

  const onToggleActivo = useCallback(
    async (p: ProductoCatalogoItem) => {
      if (!user) return
      setBusyId(p.id)
      try {
        await window.api.productos.toggleActivo(user.id, p.id, !p.activo)
        toast.success(`${p.nombre} ${!p.activo ? 'activado' : 'desactivado'}`)
        await load()
      } catch (e) {
        toast.error('Falló la operación', {
          description: e instanceof Error ? e.message : String(e)
        })
      } finally {
        setBusyId(null)
      }
    },
    [user, load]
  )

  // ── CSV: plantilla / exportar / importar masivo ──────────────────────────
  const downloadPlantilla = useCallback(() => {
    const ejemplo =
      '7501234567890,EJEMPLO PARACETAMOL 500MG C/10,Paracetamol,,Genérico,25.50,15.00,incluido,16,5,50'
    const content = '﻿' + [CSV_HEADER, ejemplo].join('\r\n')
    downloadCsvFile(content, `catalogo-plantilla-farmacias-ms-${todayStr()}.csv`)
    toast.success('Plantilla descargada', {
      description: 'Una fila por producto. iva_modo: exento, sumar o incluido. Borra la fila de ejemplo.'
    })
  }, [])

  const exportarCSV = useCallback(() => {
    if (list.length === 0) {
      toast.warning('No hay productos para exportar')
      return
    }
    const lines = list.map((p) =>
      [
        p.codigo,
        p.nombre,
        p.sustanciaActiva ?? '',
        p.descripcion ?? '',
        p.laboratorio ?? '',
        p.precio.toFixed(2),
        p.costo.toFixed(2),
        p.ivaModo,
        String(p.ivaPorcentaje),
        String(p.stockMinimo ?? 0),
        String(p.stockMaximo ?? 0)
      ]
        .map((v) => escapeCsv(String(v)))
        .join(',')
    )
    const content = '﻿' + [CSV_HEADER, ...lines].join('\r\n')
    downloadCsvFile(content, `catalogo-farmacias-ms-${todayStr()}.csv`)
    toast.success(`Exportados ${list.length.toLocaleString('es-MX')} productos`)
  }, [list])

  const onFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || !user) return
      setImporting(true)
      try {
        const text = await file.text()
        const parsed = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h) => h.trim().toLowerCase()
        })
        const rows = parsed.data.filter((r) => (r.codigo ?? '').trim())
        if (rows.length === 0) {
          toast.error('El CSV no tiene filas válidas', { description: `Encabezado: ${CSV_HEADER}` })
          return
        }
        const items: BulkProductoRow[] = rows.map((r) => ({
          codigo: (r.codigo ?? '').trim(),
          nombre: (r.nombre ?? '').trim(),
          sustanciaActiva: (r.sustancia ?? '').trim() || null,
          descripcion: (r.descripcion ?? '').trim() || null,
          laboratorio: (r.laboratorio ?? '').trim() || null,
          precio: parseNum(r.precio),
          costo: parseNum(r.costo),
          ivaModo: csvIvaModo(r.iva_modo),
          ivaPorcentaje: Math.round(parseNum(r.iva_porcentaje)),
          stockMinimo: Math.round(parseNum(r.stock_minimo)),
          stockMaximo: Math.round(parseNum(r.stock_maximo))
        }))
        const res = await window.api.productos.bulkUpsert(user.id, { items })
        const parts = [`${res.creados} creados`, `${res.actualizados} actualizados`]
        if (res.errores.length) parts.push(`${res.errores.length} con error`)
        if (res.errores.length > 0) {
          console.warn('[catalogo csv] filas con error:', res.errores.slice(0, 100))
          toast.warning('Importación con observaciones', {
            description: `${parts.join(' · ')}. Revisa la consola para el detalle.`
          })
        } else {
          toast.success('Catálogo importado', { description: parts.join(' · ') })
        }
        await load()
      } catch (err) {
        toast.error('Error leyendo CSV', {
          description: err instanceof Error ? err.message : String(err)
        })
      } finally {
        setImporting(false)
      }
    },
    [user, load]
  )

  return (
    <>
      <Modal
        open={open && !sub}
        title="Catálogo de productos"
        onClose={onClose}
        maxWidth="max-w-6xl"
      >
        <div className="p-4 space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filtrar por código, nombre, sustancia o laboratorio…"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                className="w-full pl-7 pr-2 py-1.5 border border-border rounded text-sm"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
              <input
                type="checkbox"
                checked={showInactivos}
                onChange={(e) => setShowInactivos(e.target.checked)}
              />
              Mostrar inactivos
            </label>
            <button
              type="button"
              onClick={() => setSub({ kind: 'create' })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 text-sm font-medium"
            >
              <Plus className="size-3.5" />
              Nuevo producto
            </button>
          </div>

          {/* Chips filtro IVA */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground mr-1">IVA:</span>
            <IvaChip
              label={`Todos · ${list.filter((p) => p.activo).length}`}
              active={ivaFilter === 'todos'}
              onClick={() => setIvaFilter('todos')}
            />
            <IvaChip
              label={`Exento · ${ivaStats.exento}`}
              active={ivaFilter === 'exento'}
              onClick={() => setIvaFilter('exento')}
              tone="gray"
            />
            <IvaChip
              label={`Sumar · ${ivaStats.sumar}`}
              active={ivaFilter === 'sumar'}
              onClick={() => setIvaFilter('sumar')}
              tone="amber"
            />
            <IvaChip
              label={`Incluido · ${ivaStats.incluido}`}
              active={ivaFilter === 'incluido'}
              onClick={() => setIvaFilter('incluido')}
              tone="blue"
            />
          </div>

          {/* Barra CSV: plantilla / exportar / importar masivo */}
          <div className="flex items-center gap-2 text-xs border border-dashed border-border rounded px-3 py-2 bg-muted/20">
            <span className="text-muted-foreground mr-1 font-medium">Carga masiva (CSV):</span>
            <button
              type="button"
              onClick={downloadPlantilla}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-border rounded hover:bg-muted"
            >
              <Download className="size-3.5" />
              Plantilla
            </button>
            <button
              type="button"
              onClick={exportarCSV}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-border rounded hover:bg-muted"
            >
              <FileDown className="size-3.5" />
              Exportar ({list.length})
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-border rounded hover:bg-muted disabled:opacity-50"
            >
              {importing ? <Spinner size={14} /> : <Upload className="size-3.5" />}
              {importing ? 'Importando…' : 'Importar'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onFileSelected}
            />
            <span className="text-[10px] text-muted-foreground ml-auto">
              Importar crea o actualiza por código (incluye precio e IVA).
            </span>
          </div>

          <div className="border border-border rounded overflow-auto max-h-[60vh]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-mono w-32">Código</th>
                  <th className="px-2 py-1.5">Nombre</th>
                  <th className="px-2 py-1.5 w-32">Laboratorio</th>
                  <th className="px-2 py-1.5 w-24 text-right">Precio</th>
                  <th className="px-2 py-1.5 w-28 text-center">IVA</th>
                  <th className="px-2 py-1.5 w-20 text-right">Stock</th>
                  <th className="px-2 py-1.5 w-16 text-center">Activo</th>
                  <th className="px-2 py-1.5 w-44 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-2 py-6 text-muted-foreground">
                      <span className="flex items-center justify-center">
                        <Spinner label="Cargando…" />
                      </span>
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-2 py-6 text-center text-muted-foreground italic">
                      {list.length === 0
                        ? 'Sin productos. Crea el primero.'
                        : 'Sin coincidencias para el filtro actual.'}
                    </td>
                  </tr>
                )}
                {pageItems.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-border/60 ${!p.activo ? 'text-muted-foreground' : ''}`}
                  >
                    <td className="px-2 py-1 font-mono">{p.codigo}</td>
                    <td className="px-2 py-1">
                      <div>{p.nombre}</div>
                      {p.sustanciaActiva && (
                        <div className="text-[10px] text-muted-foreground">{p.sustanciaActiva}</div>
                      )}
                    </td>
                    <td className="px-2 py-1 text-xs">{p.laboratorio ?? '—'}</td>
                    <td className="px-2 py-1 text-right font-mono">{money(p.precio)}</td>
                    <td className="px-2 py-1 text-center">
                      <IvaBadge modo={p.ivaModo} porcentaje={p.ivaPorcentaje} />
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{p.existenciasTotal}</td>
                    <td className="px-2 py-1 text-center">
                      {p.activo ? (
                        <span className="text-[11px] text-green-700">Sí</span>
                      ) : (
                        <span className="text-[11px] text-red-700">No</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => setSub({ kind: 'edit', target: p })}
                          className="inline-flex items-center gap-1 px-2 py-1 border border-border rounded hover:bg-muted text-[11px]"
                          title="Editar"
                        >
                          <Pencil className="size-3" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleActivo(p)}
                          disabled={busyId === p.id}
                          className={`inline-flex items-center gap-1 px-2 py-1 border rounded text-[11px] disabled:opacity-50 ${
                            p.activo
                              ? 'border-border hover:bg-red-50 hover:border-red-300 text-red-700'
                              : 'border-border hover:bg-green-50 hover:border-green-300 text-green-700'
                          }`}
                        >
                          {busyId === p.id ? <Spinner size={12} /> : <Power className="size-3" />}
                          {p.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span>Mostrar</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="border border-border rounded px-1.5 py-1 bg-background"
              >
                {[10, 20, 50, 100, 200].map((n) => (
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
              {filtered.length !== list.length && ` (filtrados de ${list.length})`}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(1)}
                disabled={pageSafe <= 1}
                className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40"
                title="Primera página"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => setPage(pageSafe - 1)}
                disabled={pageSafe <= 1}
                className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40"
              >
                ‹ Anterior
              </button>
              <span className="px-2 whitespace-nowrap">
                Página {pageSafe} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(pageSafe + 1)}
                disabled={pageSafe >= totalPages}
                className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40"
              >
                Siguiente ›
              </button>
              <button
                type="button"
                onClick={() => setPage(totalPages)}
                disabled={pageSafe >= totalPages}
                className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40"
                title="Última página"
              >
                »
              </button>
            </div>
          </div>
        </div>

        <footer className="flex justify-end px-4 py-3 border-t border-border bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
          >
            Cerrar
          </button>
        </footer>
      </Modal>

      {sub?.kind === 'create' && (
        <CreateOrEditProductoSubModal
          mode="create"
          onClose={() => setSub(null)}
          onSaved={async () => {
            setSub(null)
            await load()
          }}
        />
      )}

      {sub?.kind === 'edit' && (
        <CreateOrEditProductoSubModal
          mode="edit"
          target={sub.target}
          onClose={() => setSub(null)}
          onSaved={async () => {
            setSub(null)
            await load()
          }}
        />
      )}
    </>
  )
}

// ── Sub-modal: Crear o editar ─────────────────────────────────────────────
interface SubProps {
  mode: 'create' | 'edit'
  target?: ProductoCatalogoItem
  onClose: () => void
  onSaved: () => void
}

interface FormState {
  codigo: string
  nombre: string
  sustanciaActiva: string
  descripcion: string
  laboratorio: string
  precio: string
  costo: string
  ivaModo: IvaModo
  ivaPorcentaje: string
  stockMaximo: string
  stockMinimo: string
}

const EMPTY_FORM: FormState = {
  codigo: '',
  nombre: '',
  sustanciaActiva: '',
  descripcion: '',
  laboratorio: '',
  precio: '',
  costo: '',
  ivaModo: 'exento',
  ivaPorcentaje: '0',
  stockMaximo: '0',
  stockMinimo: '0'
}

function CreateOrEditProductoSubModal({ mode, target, onClose, onSaved }: SubProps) {
  const { user } = useSession()
  const [form, setForm] = useState<FormState>(() =>
    target
      ? {
          codigo: target.codigo,
          nombre: target.nombre,
          sustanciaActiva: target.sustanciaActiva ?? '',
          descripcion: target.descripcion ?? '',
          laboratorio: target.laboratorio ?? '',
          precio: String(target.precio),
          costo: String(target.costo),
          ivaModo: target.ivaModo,
          ivaPorcentaje: String(target.ivaPorcentaje),
          stockMaximo: String(target.stockMaximo ?? 0),
          stockMinimo: String(target.stockMinimo ?? 0)
        }
      : EMPTY_FORM
  )
  const [saving, setSaving] = useState(false)
  const [ivaDefault, setIvaDefault] = useState(16)
  const codigoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => codigoRef.current?.focus(), 80)
    window.api.config
      .get()
      .then((c) => setIvaDefault(c.ivaPorcentajeDefault))
      .catch(() => {})
  }, [])

  const onChange =
    (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
    }

  // Al elegir un modo con IVA, pre-llena la tasa con el default del negocio si
  // el campo está vacío o en 0 (para no teclear 16 cada vez).
  const onIvaModoChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const modo = e.target.value as IvaModo
    setForm((prev) => ({
      ...prev,
      ivaModo: modo,
      ivaPorcentaje:
        modo !== 'exento' && (prev.ivaPorcentaje === '' || prev.ivaPorcentaje === '0')
          ? String(ivaDefault)
          : prev.ivaPorcentaje
    }))
  }

  // Vista previa del precio según el modo de IVA (misma lógica que el POS).
  const precioNum = Number(form.precio)
  const previewPct = form.ivaModo === 'exento' ? 0 : Number(form.ivaPorcentaje || '0')
  const previewOk = form.precio.trim() !== '' && Number.isFinite(precioNum) && precioNum >= 0
  const desglose = previewOk ? calcFromBase(precioNum, previewPct, form.ivaModo) : null

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!user) return
      const precio = Number(form.precio)
      const costo = form.costo === '' ? 0 : Number(form.costo)
      const ivaPorcentaje = form.ivaModo === 'exento' ? 0 : Number(form.ivaPorcentaje || '0')
      const stockMaximo = form.stockMaximo === '' ? 0 : Math.trunc(Number(form.stockMaximo))
      const stockMinimo = form.stockMinimo === '' ? 0 : Math.trunc(Number(form.stockMinimo))

      if (mode === 'create' && (!Number.isFinite(precio) || precio < 0)) {
        toast.error('Precio inválido')
        return
      }
      // El IVA es editable también al editar, así que validamos en ambos modos.
      if (form.ivaModo !== 'exento' && (ivaPorcentaje < 0 || ivaPorcentaje > 100)) {
        toast.error('Porcentaje de IVA inválido (0–100)')
        return
      }

      setSaving(true)
      try {
        if (mode === 'create') {
          const input: CreateProductoInput = {
            codigo: form.codigo,
            nombre: form.nombre,
            sustanciaActiva: form.sustanciaActiva || null,
            descripcion: form.descripcion || null,
            laboratorio: form.laboratorio || null,
            precio,
            costo,
            ivaModo: form.ivaModo,
            ivaPorcentaje,
            stockMaximo,
            stockMinimo
          }
          await window.api.productos.create(user.id, input)
          toast.success(`Producto "${form.nombre}" creado`)
        } else if (target) {
          const input: UpdateProductoInput = {
            id: target.id,
            codigo: form.codigo,
            nombre: form.nombre,
            sustanciaActiva: form.sustanciaActiva || null,
            descripcion: form.descripcion || null,
            laboratorio: form.laboratorio || null,
            costo,
            stockMaximo,
            stockMinimo
          }
          await window.api.productos.update(user.id, input)
          // El IVA no viaja en update() (catálogo básico); si cambió, se aplica
          // con su propio servicio (queda como cambio de configuración fiscal).
          if (form.ivaModo !== target.ivaModo || ivaPorcentaje !== target.ivaPorcentaje) {
            await window.api.productos.updateIva({
              cajeroId: user.id,
              items: [
                {
                  productoId: target.id,
                  productoNombre: form.nombre || target.nombre,
                  codigo: form.codigo || target.codigo,
                  ivaModoAnterior: target.ivaModo,
                  ivaPorcentajeAnterior: target.ivaPorcentaje,
                  nuevoModo: form.ivaModo,
                  nuevoPorcentaje: ivaPorcentaje
                }
              ]
            })
          }
          toast.success(`Producto "${form.nombre}" actualizado`)
        }
        onSaved()
      } catch (err) {
        toast.error('No se pudo guardar', {
          description: err instanceof Error ? err.message : String(err)
        })
      } finally {
        setSaving(false)
      }
    },
    [user, form, mode, target, onSaved]
  )

  const isEdit = mode === 'edit'

  return (
    <Modal
      open
      title={isEdit ? `Editar producto — ${target?.codigo}` : 'Nuevo producto'}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={submit} className="p-4 space-y-3 text-sm">
        <div className="grid grid-cols-[160px_1fr] gap-3">
          <Field label="Código *">
            <input
              ref={codigoRef}
              type="text"
              required
              className="w-full border border-border rounded px-2 py-1.5 font-mono"
              value={form.codigo}
              onChange={onChange('codigo')}
              autoComplete="off"
            />
          </Field>
          <Field label="Nombre *">
            <input
              type="text"
              required
              className="w-full border border-border rounded px-2 py-1.5"
              value={form.nombre}
              onChange={onChange('nombre')}
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Sustancia activa">
            <input
              type="text"
              className="w-full border border-border rounded px-2 py-1.5"
              value={form.sustanciaActiva}
              onChange={onChange('sustanciaActiva')}
              autoComplete="off"
            />
          </Field>
          <Field label="Laboratorio">
            <input
              type="text"
              className="w-full border border-border rounded px-2 py-1.5"
              value={form.laboratorio}
              onChange={onChange('laboratorio')}
              autoComplete="off"
            />
          </Field>
        </div>

        <Field label="Descripción / notas">
          <textarea
            rows={2}
            className="w-full border border-border rounded px-2 py-1.5 text-sm"
            value={form.descripcion}
            onChange={onChange('descripcion')}
          />
        </Field>

        <div className="grid grid-cols-4 gap-3">
          <Field label={isEdit ? 'Precio (sólo lectura)' : 'Precio venta *'}>
            <input
              type="number"
              step="0.01"
              min="0"
              required={!isEdit}
              disabled={isEdit}
              className="w-full border border-border rounded px-2 py-1.5 font-mono disabled:bg-muted/30"
              value={form.precio}
              onChange={onChange('precio')}
              autoComplete="off"
            />
          </Field>
          <Field label="Costo">
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full border border-border rounded px-2 py-1.5 font-mono"
              value={form.costo}
              onChange={onChange('costo')}
              autoComplete="off"
            />
          </Field>
          <Field label="IVA modo">
            <select
              className="w-full border border-border rounded px-2 py-1.5 bg-background disabled:bg-muted/30"
              value={form.ivaModo}
              onChange={onIvaModoChange}
            >
              <option value="exento">Exento</option>
              <option value="sumar">Sumar al cobrar</option>
              <option value="incluido">Incluido en precio</option>
            </select>
          </Field>
          <Field label="% IVA">
            <input
              type="number"
              min="0"
              max="100"
              disabled={form.ivaModo === 'exento'}
              className="w-full border border-border rounded px-2 py-1.5 font-mono disabled:bg-muted/30"
              value={form.ivaPorcentaje}
              onChange={onChange('ivaPorcentaje')}
              autoComplete="off"
            />
          </Field>
        </div>

        {/* Vista previa del precio de venta según el modo de IVA */}
        {desglose && (
          <div className="rounded border border-border bg-muted/30 px-3 py-2 space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Vista previa del precio
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono text-sm">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">Importe (neto)</div>
                <div>{money(desglose.importe)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">IVA</div>
                <div>{money(desglose.iva)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">Precio de venta</div>
                <div className="font-semibold text-blue-700">{money(desglose.total)}</div>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground">{ivaModoHint(form.ivaModo)}</div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Stock mínimo (aviso)">
            <input
              type="number"
              min="0"
              className="w-full border border-border rounded px-2 py-1.5 font-mono"
              value={form.stockMinimo}
              onChange={onChange('stockMinimo')}
              autoComplete="off"
            />
          </Field>
          <Field label="Stock máximo (sugerido)">
            <input
              type="number"
              min="0"
              className="w-full border border-border rounded px-2 py-1.5 font-mono"
              value={form.stockMaximo}
              onChange={onChange('stockMaximo')}
              autoComplete="off"
            />
          </Field>
        </div>

        {isEdit && (
          <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
            El precio se cambia en el módulo de Precios (registra historial / auditoría). El IVA
            sí puede editarse aquí.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
          >
            {saving && <Spinner size={14} />}
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ivaModoHint(modo: IvaModo): string {
  if (modo === 'exento') return 'Exento: el precio no lleva IVA.'
  if (modo === 'sumar') return 'Sumar: el precio capturado es neto; el cliente paga precio + IVA.'
  return 'Incluido: el precio capturado ya trae IVA; se desglosa del total.'
}

// ── Helpers CSV ────────────────────────────────────────────────────────────
const CSV_HEADER =
  'codigo,nombre,sustancia,descripcion,laboratorio,precio,costo,iva_modo,iva_porcentaje,stock_minimo,stock_maximo'

function escapeCsv(v: string): string {
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
}

function parseNum(raw: string | undefined): number {
  const s = (raw ?? '').trim()
  if (!s) return 0
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function csvIvaModo(raw: string | undefined): IvaModo {
  const v = (raw ?? '').trim().toLowerCase()
  return v === 'sumar' || v === 'incluido' ? v : 'exento'
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function downloadCsvFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  )
}

// ── Chip de filtro IVA ────────────────────────────────────────────────────
type Tone = 'default' | 'gray' | 'amber' | 'blue'

function IvaChip({
  label,
  active,
  onClick,
  tone = 'default'
}: {
  label: string
  active: boolean
  onClick: () => void
  tone?: Tone
}) {
  const activeCls: Record<Tone, string> = {
    default: 'bg-primary text-primary-foreground border-primary',
    gray: 'bg-gray-200 text-gray-900 border-gray-400',
    amber: 'bg-amber-100 text-amber-900 border-amber-400',
    blue: 'bg-blue-100 text-blue-900 border-blue-400'
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium transition-colors ${
        active ? activeCls[tone] : 'border-border hover:bg-muted text-muted-foreground'
      }`}
    >
      {label}
    </button>
  )
}

// ── Badge IVA en fila (compacto, descriptivo) ────────────────────────────
export function IvaBadge({
  modo,
  porcentaje
}: {
  modo: IvaModo
  porcentaje: number
}) {
  if (modo === 'exento') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-gray-100 text-gray-700 border border-gray-200">
        Exento
      </span>
    )
  }
  if (modo === 'sumar') {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-50 text-amber-800 border border-amber-200"
        title="Precio neto · se suma IVA al cobrar"
      >
        +{porcentaje}%
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-blue-50 text-blue-800 border border-blue-200"
      title="IVA ya incluido en el precio"
    >
      inc {porcentaje}%
    </span>
  )
}
