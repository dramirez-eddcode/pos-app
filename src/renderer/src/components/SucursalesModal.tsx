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
import { Boxes, PackagePlus, Pencil, Plus, Power, Search, Store, Upload } from 'lucide-react'
import Papa from 'papaparse'
import Modal from './Modal'
import Spinner from './Spinner'
import SucursalCatalogoModal from './SucursalCatalogoModal'
import { useSession } from '../stores/session'
import type {
  CreateSucursalInput,
  ExportFarmaStockLote,
  SucursalDto,
  UpdateSucursalInput
} from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
}

type SubForm = { kind: 'create' } | { kind: 'edit'; target: SucursalDto } | null

export default function SucursalesModal({ open, onClose }: Props) {
  const { user } = useSession()
  const [list, setList] = useState<SucursalDto[]>([])
  const [loading, setLoading] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [showInactivas, setShowInactivas] = useState(false)
  const [sub, setSub] = useState<SubForm>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [catalogoFor, setCatalogoFor] = useState<SucursalDto | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  // Export con stock inicial: sucursal pendiente + input de archivo CSV.
  const stockSucursalRef = useRef<SucursalDto | null>(null)
  const stockFileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const r = await window.api.sucursales.list(user.id)
      setList(r)
    } catch (e) {
      toast.error('No pude cargar sucursales', {
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
    return list.filter((s) => {
      if (!showInactivas && !s.activa) return false
      if (!q) return true
      return (
        s.codigo.toLowerCase().includes(q) ||
        s.nombre.toLowerCase().includes(q) ||
        (s.ciudad ?? '').toLowerCase().includes(q)
      )
    })
  }, [list, filtro, showInactivas])

  const onExport = useCallback(
    async (s: SucursalDto) => {
      if (!user) return
      setExportingId(s.id)
      try {
        const r = await window.api.exportSucursal.farma(user.id, s.id)
        if (!r.ok) {
          if (r.cancelled) return
          toast.error('Falló el export', { description: r.error ?? 'Error desconocido' })
          return
        }
        const kb = ((r.bytes ?? 0) / 1024).toFixed(1)
        toast.success(`Exportado a ${s.nombre}`, {
          description: `${r.productosCount} productos · ${kb} KB · ${r.path}`,
          duration: 8000
        })
      } catch (e) {
        toast.error('Falló el export', {
          description: e instanceof Error ? e.message : String(e)
        })
      } finally {
        setExportingId(null)
      }
    },
    [user]
  )

  // Exportar incluyendo stock inicial: pide el CSV de existencias y lo adjunta.
  const onExportConStock = useCallback((s: SucursalDto) => {
    stockSucursalRef.current = s
    stockFileRef.current?.click()
  }, [])

  const onStockFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      const s = stockSucursalRef.current
      stockSucursalRef.current = null
      if (!file || !s || !user) return
      setExportingId(s.id)
      try {
        const text = await file.text()
        const parsed = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h) => h.trim().toLowerCase()
        })
        const items: ExportFarmaStockLote[] = parsed.data
          .filter((r) => (r.codigo ?? '').trim() && (r.cantidad ?? '').trim())
          .map((r) => ({
            codigo: (r.codigo ?? '').trim(),
            cantidad: Math.round(Number((r.cantidad ?? '').trim()) || 0),
            caducidad: (r.caducidad ?? '').trim() || null
          }))
          .filter((it) => it.cantidad > 0)
        if (items.length === 0) {
          toast.error('El CSV no tiene existencias válidas', {
            description: 'Se esperan columnas: codigo, cantidad, caducidad'
          })
          return
        }
        const r = await window.api.exportSucursal.farma(user.id, s.id, items)
        if (!r.ok) {
          if (r.cancelled) return
          toast.error('Falló el export', { description: r.error ?? 'Error desconocido' })
          return
        }
        const kb = ((r.bytes ?? 0) / 1024).toFixed(1)
        toast.success(`Exportado a ${s.nombre} (con stock inicial)`, {
          description: `${r.productosCount} productos · ${r.stockLineas} lotes de stock · ${kb} KB · ${r.path}`,
          duration: 9000
        })
      } catch (err) {
        toast.error('Falló el export con stock', {
          description: err instanceof Error ? err.message : String(err)
        })
      } finally {
        setExportingId(null)
      }
    },
    [user]
  )

  const onToggle = useCallback(
    async (s: SucursalDto) => {
      if (!user) return
      setBusyId(s.id)
      try {
        await window.api.sucursales.toggleActiva(user.id, s.id, !s.activa)
        toast.success(`${s.nombre} ${!s.activa ? 'activada' : 'desactivada'}`)
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
        open={open && !sub && !catalogoFor}
        title="Sucursales"
        onClose={onClose}
        maxWidth="max-w-5xl"
      >
        <div className="p-4 space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filtrar por código, nombre o ciudad…"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                className="w-full pl-7 pr-2 py-1.5 border border-border rounded text-sm"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
              <input
                type="checkbox"
                checked={showInactivas}
                onChange={(e) => setShowInactivas(e.target.checked)}
              />
              Mostrar inactivas
            </label>
            <button
              type="button"
              onClick={() => setSub({ kind: 'create' })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 text-sm font-medium"
            >
              <Plus className="size-3.5" />
              Nueva sucursal
            </button>
          </div>

          <div className="border border-border rounded overflow-auto max-h-[60vh]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-mono w-20">Código</th>
                  <th className="px-2 py-1.5">Nombre</th>
                  <th className="px-2 py-1.5 w-44">Ciudad / Estado</th>
                  <th className="px-2 py-1.5 w-32">RFC</th>
                  <th className="px-2 py-1.5 w-16 text-center">Activa</th>
                  <th className="px-2 py-1.5 w-[22rem] text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-muted-foreground italic">
                      <div className="flex justify-center">
                        <Spinner label="Cargando…" />
                      </div>
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-8 text-center text-muted-foreground">
                      <Store className="size-6 mx-auto text-muted-foreground/60 mb-2" />
                      {list.length === 0
                        ? 'Aún no hay sucursales. Crea la primera con "Nueva sucursal".'
                        : 'Sin coincidencias para el filtro actual.'}
                    </td>
                  </tr>
                )}
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-b border-border/60 ${!s.activa ? 'text-muted-foreground' : ''}`}
                  >
                    <td className="px-2 py-1.5 font-mono font-semibold">{s.codigo}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{s.nombre}</div>
                      {s.razonSocial && (
                        <div className="text-[10px] text-muted-foreground">{s.razonSocial}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-[11px]">
                      {[s.ciudad, s.estado].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[11px]">{s.rfc ?? '—'}</td>
                    <td className="px-2 py-1.5 text-center">
                      {s.activa ? (
                        <span className="text-[11px] text-green-700">Sí</span>
                      ) : (
                        <span className="text-[11px] text-red-700">No</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => setCatalogoFor(s)}
                          disabled={!s.activa}
                          className="inline-flex items-center gap-1 px-2 py-1 border border-border rounded hover:bg-muted text-[11px] disabled:opacity-50"
                          title={s.activa ? 'Ver / editar catálogo de esta sucursal' : 'Activa la sucursal para gestionar catálogo'}
                        >
                          <Boxes className="size-3" />
                          Catálogo
                        </button>
                        <button
                          type="button"
                          onClick={() => onExport(s)}
                          disabled={!s.activa || exportingId === s.id}
                          className="inline-flex items-center gap-1 px-2 py-1 border border-blue-300 rounded hover:bg-blue-50 text-[11px] text-blue-800 disabled:opacity-50"
                          title={s.activa ? 'Exportar .farma para esta sucursal' : 'Activa la sucursal para exportar'}
                        >
                          {exportingId === s.id ? <Spinner size={14} /> : <Upload className="size-3" />}
                          {exportingId === s.id ? 'Exportando…' : 'Exportar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onExportConStock(s)}
                          disabled={!s.activa || exportingId === s.id}
                          className="inline-flex items-center gap-1 px-2 py-1 border border-teal-300 rounded hover:bg-teal-50 text-[11px] text-teal-800 disabled:opacity-50"
                          title={
                            s.activa
                              ? 'Exportar incluyendo stock inicial (adjunta existencias-entradas.csv del legacy)'
                              : 'Activa la sucursal para exportar'
                          }
                        >
                          <PackagePlus className="size-3" />
                          Exportar + stock
                        </button>
                        <button
                          type="button"
                          onClick={() => setSub({ kind: 'edit', target: s })}
                          className="inline-flex items-center gap-1 px-2 py-1 border border-border rounded hover:bg-muted text-[11px]"
                        >
                          <Pencil className="size-3" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggle(s)}
                          disabled={busyId === s.id}
                          className={`inline-flex items-center gap-1 px-2 py-1 border rounded text-[11px] disabled:opacity-50 ${
                            s.activa
                              ? 'border-border hover:bg-red-50 hover:border-red-300 text-red-700'
                              : 'border-border hover:bg-green-50 hover:border-green-300 text-green-700'
                          }`}
                        >
                          {busyId === s.id ? <Spinner size={14} /> : <Power className="size-3" />}
                          {s.activa ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-muted-foreground">
            {filtered.length} de {list.length} sucursales
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

      <input
        ref={stockFileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onStockFileSelected}
      />

      {sub?.kind === 'create' && (
        <SucursalEditorSubModal
          mode="create"
          onClose={() => setSub(null)}
          onSaved={async () => {
            setSub(null)
            await load()
          }}
        />
      )}
      {sub?.kind === 'edit' && (
        <SucursalEditorSubModal
          mode="edit"
          target={sub.target}
          onClose={() => setSub(null)}
          onSaved={async () => {
            setSub(null)
            await load()
          }}
        />
      )}

      <SucursalCatalogoModal
        open={catalogoFor !== null}
        sucursal={catalogoFor}
        onClose={() => setCatalogoFor(null)}
      />
    </>
  )
}

// ── Sub-modal: alta / edición de sucursal ──────────────────────────────────
interface SubProps {
  mode: 'create' | 'edit'
  target?: SucursalDto
  onClose: () => void
  onSaved: () => void
}

interface FormState {
  codigo: string
  nombre: string
  razonSocial: string
  rfc: string
  calle: string
  colonia: string
  ciudad: string
  estado: string
}

function SucursalEditorSubModal({ mode, target, onClose, onSaved }: SubProps) {
  const { user } = useSession()
  const [form, setForm] = useState<FormState>(() =>
    target
      ? {
          codigo: target.codigo,
          nombre: target.nombre,
          razonSocial: target.razonSocial ?? '',
          rfc: target.rfc ?? '',
          calle: target.calle ?? '',
          colonia: target.colonia ?? '',
          ciudad: target.ciudad ?? '',
          estado: target.estado ?? ''
        }
      : {
          codigo: '',
          nombre: '',
          razonSocial: '',
          rfc: '',
          calle: '',
          colonia: '',
          ciudad: '',
          estado: ''
        }
  )
  const [saving, setSaving] = useState(false)
  const codigoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => codigoRef.current?.focus(), 80)
  }, [])

  const onChange =
    (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [k]: e.target.value }))

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!user) return
      setSaving(true)
      try {
        if (mode === 'create') {
          const input: CreateSucursalInput = {
            codigo: form.codigo.trim().toUpperCase(),
            nombre: form.nombre.trim(),
            razonSocial: form.razonSocial || null,
            rfc: form.rfc || null,
            calle: form.calle || null,
            colonia: form.colonia || null,
            ciudad: form.ciudad || null,
            estado: form.estado || null
          }
          await window.api.sucursales.create(user.id, input)
          toast.success(`Sucursal "${input.nombre}" creada`, {
            description: `Código: ${input.codigo}`
          })
        } else if (target) {
          const input: UpdateSucursalInput = {
            id: target.id,
            codigo: form.codigo.trim().toUpperCase(),
            nombre: form.nombre.trim(),
            razonSocial: form.razonSocial || null,
            rfc: form.rfc || null,
            calle: form.calle || null,
            colonia: form.colonia || null,
            ciudad: form.ciudad || null,
            estado: form.estado || null
          }
          await window.api.sucursales.update(user.id, input)
          toast.success(`Sucursal "${input.nombre}" actualizada`)
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
      title={isEdit ? `Editar sucursal — ${target?.codigo}` : 'Nueva sucursal'}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={submit} className="p-4 space-y-3 text-sm">
        <div className="grid grid-cols-[150px_1fr] gap-3">
          <Field label="Código *">
            <input
              ref={codigoRef}
              type="text"
              required
              value={form.codigo}
              onChange={onChange('codigo')}
              placeholder="S01"
              className="w-full border border-border rounded px-2 py-1.5 font-mono uppercase"
              autoComplete="off"
            />
          </Field>
          <Field label="Nombre *">
            <input
              type="text"
              required
              value={form.nombre}
              onChange={onChange('nombre')}
              placeholder="Centro"
              className="w-full border border-border rounded px-2 py-1.5"
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="grid grid-cols-[1fr_180px] gap-3">
          <Field label="Razón social">
            <input
              type="text"
              value={form.razonSocial}
              onChange={onChange('razonSocial')}
              className="w-full border border-border rounded px-2 py-1.5"
              autoComplete="off"
            />
          </Field>
          <Field label="RFC">
            <input
              type="text"
              value={form.rfc}
              onChange={onChange('rfc')}
              maxLength={13}
              className="w-full border border-border rounded px-2 py-1.5 font-mono uppercase"
              autoComplete="off"
            />
          </Field>
        </div>

        <Field label="Calle y número">
          <input
            type="text"
            value={form.calle}
            onChange={onChange('calle')}
            className="w-full border border-border rounded px-2 py-1.5"
            autoComplete="off"
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Colonia">
            <input
              type="text"
              value={form.colonia}
              onChange={onChange('colonia')}
              className="w-full border border-border rounded px-2 py-1.5"
              autoComplete="off"
            />
          </Field>
          <Field label="Ciudad">
            <input
              type="text"
              value={form.ciudad}
              onChange={onChange('ciudad')}
              className="w-full border border-border rounded px-2 py-1.5"
              autoComplete="off"
            />
          </Field>
          <Field label="Estado">
            <input
              type="text"
              value={form.estado}
              onChange={onChange('estado')}
              className="w-full border border-border rounded px-2 py-1.5"
              autoComplete="off"
            />
          </Field>
        </div>

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
            {saving ? (
              <>
                <Spinner size={14} /> Guardando…
              </>
            ) : isEdit ? (
              'Guardar cambios'
            ) : (
              'Crear sucursal'
            )}
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
