import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import { toast } from 'sonner'
import { Plus, Power, Pencil, Warehouse } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import { useSession } from '../stores/session'
import type { BodegaDto, CreateBodegaInput, UpdateBodegaInput } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
}

type SubForm = { kind: 'create' } | { kind: 'edit'; target: BodegaDto } | null

export default function BodegasModal({ open, onClose }: Props) {
  const { user } = useSession()
  const [list, setList] = useState<BodegaDto[]>([])
  const [loading, setLoading] = useState(false)
  const [sub, setSub] = useState<SubForm>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setList(await window.api.bodegas.list())
    } catch (e) {
      toast.error('No pude cargar las bodegas', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const onToggleActiva = useCallback(
    async (b: BodegaDto) => {
      if (!user) return
      setBusyId(b.id)
      try {
        await window.api.bodegas.toggleActiva(user.id, b.id, !b.activa)
        toast.success(`${b.nombre} ${!b.activa ? 'activada' : 'desactivada'}`)
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
      <Modal open={open && !sub} title="Bodegas" onClose={onClose} maxWidth="max-w-4xl">
        <div className="p-4 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Almacenes de la matriz. El inventario se separa por bodega; las entradas se registran
              en la bodega que elijas.
            </p>
            <button
              type="button"
              onClick={() => setSub({ kind: 'create' })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 text-sm font-medium shrink-0"
            >
              <Plus className="size-3.5" />
              Nueva bodega
            </button>
          </div>

          <div className="border border-border rounded overflow-auto max-h-[60vh]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-mono w-28">Código</th>
                  <th className="px-2 py-1.5">Nombre</th>
                  <th className="px-2 py-1.5 w-32">Ciudad</th>
                  <th className="px-2 py-1.5 w-24 text-right">Existencias</th>
                  <th className="px-2 py-1.5 w-16 text-center">Activa</th>
                  <th className="px-2 py-1.5 w-40 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading && list.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-muted-foreground italic">
                      <div className="flex justify-center">
                        <Spinner label="Cargando…" />
                      </div>
                    </td>
                  </tr>
                )}
                {!loading && list.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground italic">
                      Sin bodegas.
                    </td>
                  </tr>
                )}
                {list.map((b) => (
                  <tr
                    key={b.id}
                    className={`border-b border-border/60 ${!b.activa ? 'text-muted-foreground' : ''}`}
                  >
                    <td className="px-2 py-1 font-mono">{b.codigo}</td>
                    <td className="px-2 py-1">
                      {b.nombre}
                      {b.esPrincipal && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-900">
                          Principal
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">{b.ciudad ?? '—'}</td>
                    <td className="px-2 py-1 text-right font-mono">{b.existenciasTotal}</td>
                    <td className="px-2 py-1 text-center">
                      {b.activa ? (
                        <span className="text-[11px] text-green-700">Sí</span>
                      ) : (
                        <span className="text-[11px] text-red-700">No</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => setSub({ kind: 'edit', target: b })}
                          className="inline-flex items-center gap-1 px-2 py-1 border border-border rounded hover:bg-muted text-[11px]"
                          title="Editar"
                        >
                          <Pencil className="size-3" />
                          Editar
                        </button>
                        {!b.esPrincipal && (
                          <button
                            type="button"
                            onClick={() => onToggleActiva(b)}
                            disabled={busyId === b.id}
                            className={`inline-flex items-center gap-1 px-2 py-1 border rounded text-[11px] disabled:opacity-50 ${
                              b.activa
                                ? 'border-border hover:bg-red-50 hover:border-red-300 text-red-700'
                                : 'border-border hover:bg-green-50 hover:border-green-300 text-green-700'
                            }`}
                          >
                            {busyId === b.id ? <Spinner size={14} /> : <Power className="size-3" />}
                            {b.activa ? 'Desactivar' : 'Activar'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
        <BodegaSubModal
          mode="create"
          onClose={() => setSub(null)}
          onSaved={async () => {
            setSub(null)
            await load()
          }}
        />
      )}
      {sub?.kind === 'edit' && (
        <BodegaSubModal
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

// ── Sub-modal: crear / editar bodega ──────────────────────────────────────
interface SubProps {
  mode: 'create' | 'edit'
  target?: BodegaDto
  onClose: () => void
  onSaved: () => void
}

interface FormState {
  codigo: string
  nombre: string
  calle: string
  colonia: string
  ciudad: string
  estado: string
}

function BodegaSubModal({ mode, target, onClose, onSaved }: SubProps) {
  const { user } = useSession()
  const [form, setForm] = useState<FormState>(() => ({
    codigo: target?.codigo ?? '',
    nombre: target?.nombre ?? '',
    calle: target?.calle ?? '',
    colonia: target?.colonia ?? '',
    ciudad: target?.ciudad ?? '',
    estado: target?.estado ?? ''
  }))
  const [saving, setSaving] = useState(false)
  const codigoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => codigoRef.current?.focus(), 80)
  }, [])

  const onChange =
    (field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
    }

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!user) return
      setSaving(true)
      try {
        if (mode === 'create') {
          const input: CreateBodegaInput = {
            codigo: form.codigo,
            nombre: form.nombre,
            calle: form.calle || null,
            colonia: form.colonia || null,
            ciudad: form.ciudad || null,
            estado: form.estado || null
          }
          await window.api.bodegas.create(user.id, input)
          toast.success(`Bodega "${form.nombre}" creada`)
        } else if (target) {
          const input: UpdateBodegaInput = {
            id: target.id,
            codigo: form.codigo,
            nombre: form.nombre,
            calle: form.calle || null,
            colonia: form.colonia || null,
            ciudad: form.ciudad || null,
            estado: form.estado || null
          }
          await window.api.bodegas.update(user.id, input)
          toast.success(`Bodega "${form.nombre}" actualizada`)
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
      title={isEdit ? `Editar bodega — ${target?.codigo}` : 'Nueva bodega'}
      onClose={onClose}
      maxWidth="max-w-xl"
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

        <Field label="Calle">
          <input
            type="text"
            className="w-full border border-border rounded px-2 py-1.5"
            value={form.calle}
            onChange={onChange('calle')}
            autoComplete="off"
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Colonia">
            <input
              type="text"
              className="w-full border border-border rounded px-2 py-1.5"
              value={form.colonia}
              onChange={onChange('colonia')}
              autoComplete="off"
            />
          </Field>
          <Field label="Ciudad">
            <input
              type="text"
              className="w-full border border-border rounded px-2 py-1.5"
              value={form.ciudad}
              onChange={onChange('ciudad')}
              autoComplete="off"
            />
          </Field>
          <Field label="Estado">
            <input
              type="text"
              className="w-full border border-border rounded px-2 py-1.5"
              value={form.estado}
              onChange={onChange('estado')}
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
            className="px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold inline-flex items-center gap-1.5"
          >
            {saving ? <Spinner size={14} /> : <Warehouse className="size-3.5" />}
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear bodega'}
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
