import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import { toast } from 'sonner'
import { Plus, Power, Pencil, Truck } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import { useSession } from '../stores/session'
import type { CreateProveedorInput, ProveedorDto, UpdateProveedorInput } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
}

type SubForm = { kind: 'create' } | { kind: 'edit'; target: ProveedorDto } | null

export default function ProveedoresModal({ open, onClose }: Props) {
  const { user } = useSession()
  const [list, setList] = useState<ProveedorDto[]>([])
  const [loading, setLoading] = useState(false)
  const [sub, setSub] = useState<SubForm>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setList(await window.api.proveedores.list())
    } catch (e) {
      toast.error('No pude cargar los proveedores', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const onToggleActivo = useCallback(
    async (p: ProveedorDto) => {
      if (!user) return
      setBusyId(p.id)
      try {
        await window.api.proveedores.toggleActivo(user.id, p.id, !p.activo)
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
      <Modal open={open && !sub} title="Proveedores" onClose={onClose} maxWidth="max-w-4xl">
        <div className="p-4 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Catálogo de proveedores de mercancía. Al registrar una entrada puedes indicar de
              quién llegó (opcional) y queda en el historial y su PDF.
            </p>
            <button
              type="button"
              onClick={() => setSub({ kind: 'create' })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 text-sm font-medium shrink-0"
            >
              <Plus className="size-3.5" />
              Nuevo proveedor
            </button>
          </div>

          <div className="border border-border rounded overflow-auto max-h-[60vh]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                <tr className="text-left">
                  <th className="px-2 py-1.5">Nombre</th>
                  <th className="px-2 py-1.5 w-32 font-mono">RFC</th>
                  <th className="px-2 py-1.5 w-32">Teléfono</th>
                  <th className="px-2 py-1.5 w-36">Contacto</th>
                  <th className="px-2 py-1.5 w-16 text-center">Activo</th>
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
                      Sin proveedores — crea el primero con &quot;Nuevo proveedor&quot;.
                    </td>
                  </tr>
                )}
                {list.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-border/60 ${!p.activo ? 'text-muted-foreground' : ''}`}
                  >
                    <td className="px-2 py-1">
                      {p.nombre}
                      {p.email && (
                        <div className="text-[10px] text-muted-foreground">{p.email}</div>
                      )}
                    </td>
                    <td className="px-2 py-1 font-mono">{p.rfc ?? '—'}</td>
                    <td className="px-2 py-1 font-mono">{p.telefono ?? '—'}</td>
                    <td className="px-2 py-1">{p.contacto ?? '—'}</td>
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
                          {busyId === p.id ? <Spinner size={14} /> : <Power className="size-3" />}
                          {p.activo ? 'Desactivar' : 'Activar'}
                        </button>
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
        <ProveedorSubModal
          mode="create"
          onClose={() => setSub(null)}
          onSaved={async () => {
            setSub(null)
            await load()
          }}
        />
      )}
      {sub?.kind === 'edit' && (
        <ProveedorSubModal
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

// ── Sub-modal: crear / editar proveedor ─────────────────────────────────────
// Exportado para reutilizarse (p. ej. alta rápida desde Entrada de mercancía).
// onSaved recibe el id del proveedor cuando se CREA uno nuevo.
interface SubProps {
  mode: 'create' | 'edit'
  target?: ProveedorDto
  onClose: () => void
  onSaved: (nuevoId?: string) => void
}

interface FormState {
  nombre: string
  rfc: string
  telefono: string
  email: string
  contacto: string
  notas: string
}

export function ProveedorSubModal({ mode, target, onClose, onSaved }: SubProps) {
  const { user } = useSession()
  const [form, setForm] = useState<FormState>(() => ({
    nombre: target?.nombre ?? '',
    rfc: target?.rfc ?? '',
    telefono: target?.telefono ?? '',
    email: target?.email ?? '',
    contacto: target?.contacto ?? '',
    notas: target?.notas ?? ''
  }))
  const [saving, setSaving] = useState(false)
  const nombreRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => nombreRef.current?.focus(), 80)
  }, [])

  const onChange =
    (field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
    }

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!user) return
      setSaving(true)
      try {
        if (mode === 'create') {
          const input: CreateProveedorInput = {
            nombre: form.nombre,
            rfc: form.rfc || null,
            telefono: form.telefono || null,
            email: form.email || null,
            contacto: form.contacto || null,
            notas: form.notas || null
          }
          const creado = await window.api.proveedores.create(user.id, input)
          toast.success(`Proveedor "${form.nombre}" creado`)
          onSaved(creado.id)
          return
        } else if (target) {
          const input: UpdateProveedorInput = {
            id: target.id,
            nombre: form.nombre,
            rfc: form.rfc || null,
            telefono: form.telefono || null,
            email: form.email || null,
            contacto: form.contacto || null,
            notas: form.notas || null
          }
          await window.api.proveedores.update(user.id, input)
          toast.success(`Proveedor "${form.nombre}" actualizado`)
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
      title={isEdit ? `Editar proveedor — ${target?.nombre}` : 'Nuevo proveedor'}
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      <form onSubmit={submit} className="p-4 space-y-3 text-sm">
        <Field label="Nombre / razón social *">
          <input
            ref={nombreRef}
            type="text"
            required
            className="w-full border border-border rounded px-2 py-1.5"
            value={form.nombre}
            onChange={onChange('nombre')}
            autoComplete="off"
            placeholder="Ej: Nadro, Marzam, Casa Saba…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="RFC">
            <input
              type="text"
              className="w-full border border-border rounded px-2 py-1.5 font-mono uppercase"
              value={form.rfc}
              onChange={onChange('rfc')}
              autoComplete="off"
              maxLength={13}
            />
          </Field>
          <Field label="Teléfono">
            <input
              type="tel"
              className="w-full border border-border rounded px-2 py-1.5 font-mono"
              value={form.telefono}
              onChange={onChange('telefono')}
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input
              type="email"
              className="w-full border border-border rounded px-2 py-1.5"
              value={form.email}
              onChange={onChange('email')}
              autoComplete="off"
            />
          </Field>
          <Field label="Contacto / agente">
            <input
              type="text"
              className="w-full border border-border rounded px-2 py-1.5"
              value={form.contacto}
              onChange={onChange('contacto')}
              autoComplete="off"
              placeholder="Nombre del vendedor"
            />
          </Field>
        </div>

        <Field label="Notas">
          <textarea
            rows={2}
            maxLength={300}
            className="w-full border border-border rounded px-2 py-1.5 text-xs resize-none"
            value={form.notas}
            onChange={onChange('notas')}
            placeholder="Días de visita, condiciones de crédito…"
          />
        </Field>

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
            {saving ? <Spinner size={14} /> : <Truck className="size-3.5" />}
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear proveedor'}
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
