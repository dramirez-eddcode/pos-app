import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import {
  Building,
  ShoppingCart,
  ArrowRight,
  UserPlus,
  UserCheck,
  FileDown,
  CheckCircle2,
  DatabaseBackup
} from 'lucide-react'
import { useSession } from '../stores/session'
import { formatRol } from '../lib/roles'
import Spinner from '../components/Spinner'
import PasswordInput from '../components/PasswordInput'
import type {
  CompleteWizardInput,
  ExistingAdminOption,
  InstalacionTipo,
  WizardFarmaPreview
} from '@shared/dto'

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
  // Configurar SUCURSAL desde archivo .farma de la matriz
  const [farmaPreview, setFarmaPreview] = useState<WizardFarmaPreview | null>(null)
  const [farmaPropietario, setFarmaPropietario] = useState('')
  const [pickingFarma, setPickingFarma] = useState(false)
  const [applyingFarma, setApplyingFarma] = useState(false)
  const [restoring, setRestoring] = useState(false)

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

  const restoreFromBackup = useCallback(async () => {
    setRestoring(true)
    try {
      const r = await window.api.backup.import()
      if (r.cancelled) return
      if (!r.ok) {
        toast.error('No se pudo restaurar el respaldo', { description: r.error })
        return
      }
      toast.success('Respaldo restaurado — reiniciando…')
      setTimeout(() => window.api.reload(), 1000)
    } catch (e) {
      toast.error('Falló la restauración', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setRestoring(false)
    }
  }, [])

  const pickFarma = useCallback(async () => {
    setPickingFarma(true)
    try {
      const r = await window.api.instalacion.pickWizardFarma()
      if (r.ok) {
        setFarmaPreview(r.preview)
        setFarmaPropietario(r.preview.matrizPropietario ?? '')
      } else if (!r.cancelled) {
        toast.error('No se pudo leer el archivo', { description: r.error })
      }
    } finally {
      setPickingFarma(false)
    }
  }, [])

  const applyFarma = useCallback(async () => {
    if (!farmaPreview) return
    if (!farmaPropietario.trim()) {
      toast.error('Falta el nombre del propietario')
      return
    }
    if (farmaPreview.usuarios.length === 0) {
      toast.error('El archivo no incluye usuarios admin', {
        description: 'Vuelve a exportarlo desde una matriz actualizada.'
      })
      return
    }
    setApplyingFarma(true)
    try {
      const r = await window.api.instalacion.completeWizardFromFarma({
        filePath: farmaPreview.filePath,
        propietarioNombre: farmaPropietario
      })
      toast.success('Sucursal configurada desde la matriz', {
        description: `${r.productos} productos · ${r.stockLotes} lotes · ${r.usuarios} usuario(s). Inicia sesión con tu usuario de la matriz.`,
        duration: 9000
      })
      onConfigured()
    } catch (err) {
      toast.error('No se pudo configurar la sucursal', {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setApplyingFarma(false)
    }
  }, [farmaPreview, farmaPropietario, onConfigured])

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

            {/* Restaurar desde respaldo (recuperar un equipo) */}
            <div className="pt-2 mt-1 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2">
                ¿Reinstalando un equipo? Restaura su base de datos completa desde un respaldo
                <span className="font-mono"> .bak</span> (usuarios, productos, ventas, todo).
              </p>
              <button
                type="button"
                onClick={restoreFromBackup}
                disabled={restoring}
                className="w-full flex items-center gap-3 p-3 border border-border rounded hover:bg-muted disabled:opacity-50 text-left"
              >
                {restoring ? (
                  <Spinner size={20} />
                ) : (
                  <DatabaseBackup className="size-5 text-amber-600 shrink-0" />
                )}
                <div className="flex-1">
                  <div className="font-medium text-sm">
                    {restoring ? 'Restaurando…' : 'Restaurar desde respaldo'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Reemplaza esta instalación con un archivo de respaldo y reinicia.
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {step === 2 && form.tipo && !farmaPreview && (
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
                <div className="rounded border border-dashed border-teal-300 bg-teal-50/50 px-3 py-2.5 flex items-start justify-between gap-3">
                  <div className="text-xs">
                    <div className="font-semibold text-teal-900">¿Tienes el archivo de la matriz?</div>
                    <p className="text-teal-800/80">
                      Carga el <span className="font-mono">.farma</span> del USB y configura la sucursal
                      automáticamente (datos, catálogo, precios, stock y tu usuario admin).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={pickFarma}
                    disabled={pickingFarma}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-teal-400 bg-white rounded hover:bg-teal-50 text-xs text-teal-900 disabled:opacity-50 shrink-0"
                  >
                    {pickingFarma ? <Spinner size={14} /> : <FileDown className="size-3.5" />}
                    {pickingFarma ? 'Leyendo…' : 'Cargar desde .farma'}
                  </button>
                </div>

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

        {step === 2 && form.tipo === 'SUCURSAL' && farmaPreview && (
          <div className="p-6 space-y-3 text-sm">
            <div className="rounded border border-teal-300 bg-teal-50/50 px-3 py-2 flex items-center gap-2 text-teal-900">
              <CheckCircle2 className="size-4 shrink-0" />
              <span className="text-xs font-medium">Archivo de la matriz leído correctamente.</span>
            </div>

            <div className="rounded border border-border bg-background p-3 text-xs space-y-1">
              <Row k="Sucursal" v={`${farmaPreview.sucursal.codigo} — ${farmaPreview.sucursal.nombre}`} />
              {farmaPreview.sucursal.razonSocial && (
                <Row k="Razón social" v={farmaPreview.sucursal.razonSocial} />
              )}
              <Row k="Productos" v={farmaPreview.productosCount.toLocaleString('es-MX')} />
              <Row
                k="Stock inicial"
                v={
                  farmaPreview.stockLotes > 0
                    ? `${farmaPreview.stockLotes.toLocaleString('es-MX')} lotes`
                    : 'sin stock (catálogo solo)'
                }
              />
              <Row
                k="Usuarios admin"
                v={
                  farmaPreview.usuarios.length > 0
                    ? farmaPreview.usuarios.map((u) => u.login).join(', ')
                    : '⚠ ninguno'
                }
              />
              <Row k="Generado" v={new Date(farmaPreview.generadoEn).toLocaleString('es-MX')} />
            </div>

            <Field label="Nombre del propietario / dueño *">
              <input
                type="text"
                value={farmaPropietario}
                onChange={(e) => setFarmaPropietario(e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5"
                autoComplete="off"
              />
            </Field>

            <p className="text-[11px] text-muted-foreground">
              Al finalizar entrarás en la pantalla de inicio de sesión. Usa el{' '}
              <span className="font-medium">mismo usuario y contraseña de la matriz</span> (puedes
              cambiarlos después en Gestión de usuarios).
            </p>

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setFarmaPreview(null)}
                disabled={applyingFarma}
                className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={applyFarma}
                disabled={applyingFarma || !farmaPropietario.trim() || farmaPreview.usuarios.length === 0}
                className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
              >
                {applyingFarma ? (
                  <>
                    <Spinner size={14} /> Configurando…
                  </>
                ) : (
                  'Configurar sucursal'
                )}
              </button>
            </div>
          </div>
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
                  <PasswordInput
                    required
                    minLength={3}
                    value={form.adminPassword}
                    onChange={setField('adminPassword')}
                    className="w-full border border-border rounded px-2 py-1.5 font-mono"
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Confirmar contraseña *">
                  <PasswordInput
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
                className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
              >
                {saving ? (
                  <>
                    <Spinner size={14} /> Configurando…
                  </>
                ) : (
                  'Finalizar y entrar'
                )}
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
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
