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
import { Plus, Power, Pencil, Search } from 'lucide-react'
import Modal from './Modal'
import { useSession } from '../stores/session'
import { money } from '../lib/format'
import type {
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
                    <td colSpan={8} className="px-2 py-6 text-center text-muted-foreground italic">
                      Cargando…
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
                {filtered.map((p) => (
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
                          <Power className="size-3" />
                          {p.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-muted-foreground">
            {filtered.length} de {list.length} productos · Para cambiar precio o IVA usa los módulos
            específicos (deja auditoría).
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
  const codigoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => codigoRef.current?.focus(), 80)
  }, [])

  const onChange =
    (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
    }

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
      if (mode === 'create' && form.ivaModo !== 'exento' && (ivaPorcentaje < 0 || ivaPorcentaje > 100)) {
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
          <Field label={isEdit ? 'IVA modo (sólo lectura)' : 'IVA modo'}>
            <select
              disabled={isEdit}
              className="w-full border border-border rounded px-2 py-1.5 bg-background disabled:bg-muted/30"
              value={form.ivaModo}
              onChange={onChange('ivaModo')}
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
              disabled={isEdit || form.ivaModo === 'exento'}
              className="w-full border border-border rounded px-2 py-1.5 font-mono disabled:bg-muted/30"
              value={form.ivaPorcentaje}
              onChange={onChange('ivaPorcentaje')}
              autoComplete="off"
            />
          </Field>
        </div>

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
            Para cambiar precio o IVA usa los módulos específicos (registran historial / auditoría).
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
            className="px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
          >
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </div>
      </form>
    </Modal>
  )
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
