import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import Modal from './Modal'
import Spinner from './Spinner'
import { useSession } from '../stores/session'

interface Props {
  open: boolean
  onClose: () => void
}

interface FormState {
  nombreComercial: string
  razonSocial: string
  rfc: string
  sucursalNombre: string
  calle: string
  colonia: string
  ciudad: string
  estado: string
}

const EMPTY: FormState = {
  nombreComercial: '',
  razonSocial: '',
  rfc: '',
  sucursalNombre: '',
  calle: '',
  colonia: '',
  ciudad: '',
  estado: ''
}

export default function SucursalModal({ open, onClose }: Props) {
  const { user, updateSucursal } = useSession()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const emp = await window.api.empresa.get()
      if (emp) {
        setForm({
          nombreComercial: emp.nombreComercial ?? '',
          razonSocial: emp.razonSocial ?? '',
          rfc: emp.rfc ?? '',
          sucursalNombre: emp.sucursalNombre ?? '',
          calle: emp.calle ?? '',
          colonia: emp.colonia ?? '',
          ciudad: emp.ciudad ?? '',
          estado: emp.estado ?? ''
        })
      } else {
        setForm(EMPTY)
      }
    } catch (e) {
      toast.error('No pude cargar datos de sucursal', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    load()
    setTimeout(() => firstRef.current?.focus(), 80)
  }, [open, load])

  const onChange = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!user) return
      setSaving(true)
      try {
        const updated = await window.api.empresa.update(user.id, {
          nombreComercial: form.nombreComercial,
          razonSocial: form.razonSocial,
          sucursalNombre: form.sucursalNombre,
          rfc: form.rfc || null,
          calle: form.calle || null,
          colonia: form.colonia || null,
          ciudad: form.ciudad || null,
          estado: form.estado || null
        })
        updateSucursal(updated)
        toast.success('Datos de sucursal actualizados', {
          description: 'Los próximos tickets usarán los nuevos datos.'
        })
        onClose()
      } catch (err) {
        toast.error('No se pudo guardar', {
          description: err instanceof Error ? err.message : String(err)
        })
      } finally {
        setSaving(false)
      }
    },
    [user, form, updateSucursal, onClose]
  )

  return (
    <Modal open={open} title="Datos de sucursal" onClose={onClose} maxWidth="max-w-2xl">
      <form onSubmit={submit} className="p-4 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Estos datos se imprimen en el header del ticket, corte y comprobante de cancelación.
        </p>

        {loading ? (
          <div className="py-6 flex justify-center text-muted-foreground italic">
            <Spinner label="Cargando…" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre comercial *">
                <input
                  ref={firstRef}
                  type="text"
                  required
                  className="w-full border border-border rounded px-2 py-1.5"
                  value={form.nombreComercial}
                  onChange={onChange('nombreComercial')}
                  autoComplete="off"
                />
              </Field>
              <Field label="Sucursal *">
                <input
                  type="text"
                  required
                  className="w-full border border-border rounded px-2 py-1.5"
                  value={form.sucursalNombre}
                  onChange={onChange('sucursalNombre')}
                  autoComplete="off"
                />
              </Field>
            </div>

            <div className="grid grid-cols-[1fr_180px] gap-3">
              <Field label="Razón social *">
                <input
                  type="text"
                  required
                  className="w-full border border-border rounded px-2 py-1.5"
                  value={form.razonSocial}
                  onChange={onChange('razonSocial')}
                  autoComplete="off"
                />
              </Field>
              <Field label="RFC">
                <input
                  type="text"
                  className="w-full border border-border rounded px-2 py-1.5 font-mono uppercase"
                  value={form.rfc}
                  onChange={onChange('rfc')}
                  maxLength={13}
                  autoComplete="off"
                />
              </Field>
            </div>

            <Field label="Calle y número">
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
          </>
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
            disabled={saving || loading}
            className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
          >
            {saving ? (
              <>
                <Spinner size={14} /> Guardando…
              </>
            ) : (
              'Guardar cambios'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  )
}
