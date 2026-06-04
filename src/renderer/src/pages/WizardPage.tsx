import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Building, ShoppingCart, ArrowRight, UserPlus, UserCheck } from 'lucide-react'
import { useSession } from '../stores/session'
import { formatRol } from '../lib/roles'
import type { CompleteWizardInput, ExistingAdminOption, InstalacionTipo } from '@shared/dto'

interface Props {
  onConfigured: () => void
}

type Step = 1 | 2 | 3

interface FormState {
  tipo: InstalacionTipo | null
  propietarioNombre: string
  sucursalCodigo: string
  sucursalNombre: string
  razonSocial: string
  rfc: string
  calle: string
  colonia: string
  ciudad: string
  estado: string
  adminLogin: string
  adminNombre: string
  adminPassword: string
  adminPasswordConfirm: string
}

const EMPTY: FormState = {
  tipo: null,
  propietarioNombre: '',
  sucursalCodigo: '',
  sucursalNombre: '',
  razonSocial: '',
  rfc: '',
  calle: '',
  colonia: '',
  ciudad: '',
  estado: '',
  adminLogin: 'admin',
  adminNombre: 'Administrador',
  adminPassword: '',
  adminPasswordConfirm: ''
}

export default function WizardPage({ onConfigured }: Props) {
  const { login } = useSession()
  const [step, setStep] = useState<Step>(1)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [existingAdmins, setExistingAdmins] = useState<ExistingAdminOption[]>([])
  const [adminMode, setAdminMode] = useState<'existente' | 'nuevo'>('nuevo')
  const [useExistingId, setUseExistingId] = useState<string>('')
  const propietarioRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.instalacion
      .bootstrapState()
      .then((s) => {
        setExistingAdmins(s.existingAdmins)
        if (s.existingAdmins.length > 0) {
          setAdminMode('existente')
          setUseExistingId(s.existingAdmins[0]!.id)
        }
      })
      .catch(() => {
        /* no-op */
      })
  }, [])

  const setField = useMemo(
    () => (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [k]: e.target.value })),
    []
  )

  const pickModo = useCallback((tipo: InstalacionTipo) => {
    setForm((prev) => ({ ...prev, tipo }))
    setStep(2)
    setTimeout(() => propietarioRef.current?.focus(), 60)
  }, [])

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!form.tipo) return

      const usingExisting = adminMode === 'existente' && useExistingId !== ''
      if (!usingExisting && form.adminPassword !== form.adminPasswordConfirm) {
        toast.error('Las contraseñas no coinciden')
        return
      }

      const input: CompleteWizardInput = {
        tipo: form.tipo,
        propietarioNombre: form.propietarioNombre,
        sucursalCodigo: form.tipo === 'SUCURSAL' ? form.sucursalCodigo : undefined,
        sucursalNombre: form.tipo === 'SUCURSAL' ? form.sucursalNombre : undefined,
        razonSocial: form.razonSocial || null,
        rfc: form.rfc || null,
        calle: form.calle || null,
        colonia: form.colonia || null,
        ciudad: form.ciudad || null,
        estado: form.estado || null
      }
      if (usingExisting) {
        input.useExistingUserId = useExistingId
      } else {
        input.adminLogin = form.adminLogin
        input.adminNombre = form.adminNombre
        input.adminPassword = form.adminPassword
      }

      setSaving(true)
      try {
        const res = await window.api.instalacion.completeWizard(input)
        toast.success('Configuración inicial completa')
        login(res.user)
        onConfigured()
      } catch (err) {
        toast.error('No se pudo completar el wizard', {
          description: err instanceof Error ? err.message : String(err)
        })
      } finally {
        setSaving(false)
      }
    },
    [form, login, onConfigured, adminMode, useExistingId]
  )

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-2xl bg-background border border-border rounded-lg shadow-sm">
        <header className="px-6 py-4 border-b border-border">
          <h1 className="text-lg font-semibold">Configuración inicial — Farmacias MS</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Paso {step} de 3{step === 1 ? ' · elige el modo de esta computadora' : ''}
          </p>
        </header>

        {step === 1 && (
          <div className="p-6 space-y-3">
            <ModoCard
              icon={<Building className="size-6 text-blue-600" />}
              titulo="MATRIZ"
              descripcion="Esta computadora gestiona varias sucursales desde bodega. Maneja productos, precios y exporta actualizaciones por USB. No vende ni hace cortes."
              onClick={() => pickModo('MATRIZ')}
            />
            <ModoCard
              icon={<ShoppingCart className="size-6 text-green-700" />}
              titulo="SUCURSAL"
              descripcion="Esta computadora es una farmacia que vende. Recibe actualizaciones desde la matriz por USB y opera el POS día a día."
              onClick={() => pickModo('SUCURSAL')}
            />
          </div>
        )}

        {step === 2 && form.tipo && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!form.propietarioNombre.trim()) {
                toast.error('Falta el nombre del propietario')
                return
              }
              if (form.tipo === 'SUCURSAL') {
                if (!form.sucursalCodigo.trim() || !form.sucursalNombre.trim()) {
                  toast.error('Falta código o nombre de la sucursal')
                  return
                }
              }
              setStep(3)
            }}
            className="p-6 space-y-3 text-sm"
          >
            <div className="rounded border border-border bg-muted/30 px-3 py-2 text-xs">
              Modo seleccionado: <span className="font-semibold">{form.tipo}</span> ·{' '}
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-blue-700 hover:underline"
              >
                cambiar
              </button>
            </div>

            <Field label="Nombre del propietario / dueño *">
              <input
                ref={propietarioRef}
                type="text"
                required
                value={form.propietarioNombre}
                onChange={setField('propietarioNombre')}
                className="w-full border border-border rounded px-2 py-1.5"
                autoComplete="off"
              />
            </Field>

            {form.tipo === 'SUCURSAL' && (
              <>
                <div className="grid grid-cols-[150px_1fr] gap-3">
                  <Field label="Código sucursal *">
                    <input
                      type="text"
                      required
                      value={form.sucursalCodigo}
                      onChange={setField('sucursalCodigo')}
                      placeholder="S01"
                      className="w-full border border-border rounded px-2 py-1.5 font-mono"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Nombre sucursal *">
                    <input
                      type="text"
                      required
                      value={form.sucursalNombre}
                      onChange={setField('sucursalNombre')}
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
                      onChange={setField('razonSocial')}
                      className="w-full border border-border rounded px-2 py-1.5"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="RFC">
                    <input
                      type="text"
                      value={form.rfc}
                      onChange={setField('rfc')}
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
                    onChange={setField('calle')}
                    className="w-full border border-border rounded px-2 py-1.5"
                    autoComplete="off"
                  />
                </Field>

                <div className="grid grid-cols-3 gap-3">
                  <Field label="Colonia">
                    <input
                      type="text"
                      value={form.colonia}
                      onChange={setField('colonia')}
                      className="w-full border border-border rounded px-2 py-1.5"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Ciudad">
                    <input
                      type="text"
                      value={form.ciudad}
                      onChange={setField('ciudad')}
                      className="w-full border border-border rounded px-2 py-1.5"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Estado">
                    <input
                      type="text"
                      value={form.estado}
                      onChange={setField('estado')}
                      className="w-full border border-border rounded px-2 py-1.5"
                      autoComplete="off"
                    />
                  </Field>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Estos datos se imprimen en el ticket. Si los recibes vía import de matriz más
                  adelante, se sobreescriben.
                </p>
              </>
            )}

            {form.tipo === 'MATRIZ' && (
              <p className="text-xs text-muted-foreground">
                En modo MATRIZ no se crea ninguna sucursal todavía. Después del wizard podrás
                darlas de alta desde el panel "Sucursales".
              </p>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
              >
                Atrás
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 text-sm font-semibold"
              >
                Siguiente <ArrowRight className="size-3.5" />
              </button>
            </div>
          </form>
        )}

        {step === 3 && form.tipo && (
          <form onSubmit={submit} className="p-6 space-y-3 text-sm">
            {existingAdmins.length > 0 ? (
              <>
                <p className="text-xs text-muted-foreground">
                  La base de datos ya tiene{' '}
                  <span className="font-semibold">{existingAdmins.length}</span>{' '}
                  usuario(s) administrador. Puedes reutilizar uno o crear otro.
                </p>

                <div className="grid grid-cols-2 gap-2">
                  <ModeTab
                    active={adminMode === 'existente'}
                    icon={<UserCheck className="size-4" />}
                    label="Usar usuario existente"
                    onClick={() => setAdminMode('existente')}
                  />
                  <ModeTab
                    active={adminMode === 'nuevo'}
                    icon={<UserPlus className="size-4" />}
                    label="Crear uno nuevo"
                    onClick={() => setAdminMode('nuevo')}
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Crea el primer usuario administrador (SUPERUSUARIO). Podrás crear más usuarios
                después.
              </p>
            )}

            {adminMode === 'existente' && existingAdmins.length > 0 && (
              <div className="space-y-2 pt-1">
                <Field label="Usuario administrador">
                  <select
                    value={useExistingId}
                    onChange={(e) => setUseExistingId(e.target.value)}
                    className="w-full border border-border rounded px-2 py-1.5 bg-background"
                  >
                    {existingAdmins.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.login} — {u.nombre} ({formatRol(u.rol)})
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="text-[11px] text-muted-foreground">
                  Se conservará su contraseña actual. Después podrás cambiarla desde "Gestión de
                  usuarios".
                </p>
              </div>
            )}

            {adminMode === 'nuevo' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Login *">
                    <input
                      type="text"
                      required
                      value={form.adminLogin}
                      onChange={setField('adminLogin')}
                      pattern="[a-zA-Z0-9._-]+"
                      className="w-full border border-border rounded px-2 py-1.5 font-mono lowercase"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Nombre completo *">
                    <input
                      type="text"
                      required
                      value={form.adminNombre}
                      onChange={setField('adminNombre')}
                      className="w-full border border-border rounded px-2 py-1.5"
                      autoComplete="off"
                    />
                  </Field>
                </div>

                <Field label="Contraseña *">
                  <input
                    type="password"
                    required
                    minLength={3}
                    value={form.adminPassword}
                    onChange={setField('adminPassword')}
                    className="w-full border border-border rounded px-2 py-1.5 font-mono"
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Confirmar contraseña *">
                  <input
                    type="password"
                    required
                    minLength={3}
                    value={form.adminPasswordConfirm}
                    onChange={setField('adminPasswordConfirm')}
                    className="w-full border border-border rounded px-2 py-1.5 font-mono"
                    autoComplete="new-password"
                  />
                </Field>
              </>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={saving}
                className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
              >
                Atrás
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
              >
                {saving ? 'Configurando…' : 'Finalizar y entrar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function ModoCard({
  icon,
  titulo,
  descripcion,
  onClick
}: {
  icon: React.ReactNode
  titulo: string
  descripcion: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 p-4 border border-border rounded hover:bg-muted hover:border-primary focus:bg-muted focus:border-primary focus:ring-2 focus:ring-primary/40 transition-colors"
    >
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1">
        <div className="font-semibold">{titulo}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{descripcion}</div>
      </div>
      <ArrowRight className="size-4 text-muted-foreground mt-1.5" />
    </button>
  )
}

function ModeTab({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 border rounded text-xs font-medium transition-colors ${
        active
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-border hover:bg-muted text-muted-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
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
