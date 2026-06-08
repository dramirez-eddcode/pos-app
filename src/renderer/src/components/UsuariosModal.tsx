import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { toast } from 'sonner'
import { KeyRound, Pencil, Power, Plus, UserCheck, UserX } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import PasswordInput from './PasswordInput'
import { useSession } from '../stores/session'
import { formatRol } from '../lib/roles'
import type { UsuarioListItem } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
}

const ROLE_OPTIONS_SUPER = ['SUPERUSUARIO', 'ADMINISTRADOR', 'SUPERVISOR', 'CAJERO']
const ROLE_OPTIONS_ADMIN = ['CAJERO']

type SubForm =
  | { kind: 'create' }
  | { kind: 'edit'; target: UsuarioListItem }
  | { kind: 'reset'; target: UsuarioListItem }
  | null

export default function UsuariosModal({ open, onClose }: Props) {
  const { user } = useSession()
  const [list, setList] = useState<UsuarioListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [sub, setSub] = useState<SubForm>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const isSuper = user?.rol === 'SUPERUSUARIO'
  const availableRoles = isSuper ? ROLE_OPTIONS_SUPER : ROLE_OPTIONS_ADMIN

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const r = await window.api.usuarios.list(user.id)
      setList(r)
    } catch (e) {
      toast.error('No pude cargar usuarios', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const onToggleActivo = useCallback(
    async (u: UsuarioListItem) => {
      if (!user) return
      if (u.id === user.id) {
        toast.error('No puedes cambiar tu propio estado')
        return
      }
      setBusyId(u.id)
      try {
        await window.api.usuarios.toggleActivo(user.id, u.id, !u.activo)
        toast.success(
          `${u.nombre} ${!u.activo ? 'activado' : 'desactivado'}`,
          { description: `Login: ${u.login}` }
        )
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
        title="Gestión de usuarios"
        onClose={onClose}
        maxWidth="max-w-4xl"
      >
        <div className="p-4 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {isSuper
                ? 'Como superusuario ves y puedes gestionar a todos los usuarios.'
                : 'Como administrador solo puedes ver y gestionar cajeros.'}
            </div>
            <button
              type="button"
              onClick={() => setSub({ kind: 'create' })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 text-sm font-medium"
            >
              <Plus className="size-3.5" />
              {isSuper ? 'Crear usuario' : 'Crear cajero'}
            </button>
          </div>

          <div className="border border-border rounded overflow-auto max-h-[55vh]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-mono">Login</th>
                  <th className="px-2 py-1.5">Nombre</th>
                  <th className="px-2 py-1.5 w-32">Rol</th>
                  <th className="px-2 py-1.5 w-20 text-center">Estado</th>
                  <th className="px-2 py-1.5 w-24 text-center">Cancelar</th>
                  <th className="px-2 py-1.5 w-64 text-right">Acciones</th>
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
                      Sin usuarios
                    </td>
                  </tr>
                )}
                {list.map((u) => {
                  const self = u.id === user?.id
                  return (
                    <tr
                      key={u.id}
                      className={`border-b border-border/60 ${!u.activo ? 'text-muted-foreground' : ''}`}
                    >
                      <td className="px-2 py-1 font-mono">{u.login}</td>
                      <td className="px-2 py-1">
                        {u.nombre}
                        {self && <span className="ml-2 text-[10px] text-blue-700">(tú)</span>}
                      </td>
                      <td className="px-2 py-1 text-xs">{formatRol(u.rol)}</td>
                      <td className="px-2 py-1 text-center">
                        {u.activo ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-green-700">
                            <UserCheck className="size-3" /> activo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-red-700">
                            <UserX className="size-3" /> inactivo
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-center text-[11px]">
                        {u.puedeCancelar ? 'Sí' : '—'}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            onClick={() => setSub({ kind: 'edit', target: u })}
                            className="inline-flex items-center gap-1 px-2 py-1 border border-border rounded hover:bg-muted text-[11px]"
                            title="Editar datos"
                          >
                            <Pencil className="size-3" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => setSub({ kind: 'reset', target: u })}
                            className="inline-flex items-center gap-1 px-2 py-1 border border-border rounded hover:bg-muted text-[11px]"
                            title="Resetear password"
                          >
                            <KeyRound className="size-3" />
                            Password
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleActivo(u)}
                            disabled={self || busyId === u.id}
                            className={`inline-flex items-center gap-1 px-2 py-1 border rounded text-[11px] disabled:opacity-50 ${
                              u.activo
                                ? 'border-border hover:bg-red-50 hover:border-red-300 text-red-700'
                                : 'border-border hover:bg-green-50 hover:border-green-300 text-green-700'
                            }`}
                            title={self ? 'No puedes cambiar tu propio estado' : u.activo ? 'Desactivar' : 'Activar'}
                          >
                            {busyId === u.id ? <Spinner size={14} /> : <Power className="size-3" />}
                            {u.activo ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="flex justify-end items-center px-4 py-3 border-t border-border bg-muted/20">
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
        <CreateUsuarioSubModal
          open
          roles={availableRoles}
          onClose={() => setSub(null)}
          onCreated={async () => {
            setSub(null)
            await load()
          }}
        />
      )}

      {sub?.kind === 'edit' && (
        <EditUsuarioSubModal
          open
          target={sub.target}
          roles={availableRoles}
          onClose={() => setSub(null)}
          onSaved={async () => {
            setSub(null)
            await load()
          }}
        />
      )}

      {sub?.kind === 'reset' && (
        <ResetPasswordSubModal
          open
          target={sub.target}
          onClose={() => setSub(null)}
          onDone={() => setSub(null)}
        />
      )}
    </>
  )
}

// ── Sub-modal: Editar usuario ──────────────────────────────────────────────
function EditUsuarioSubModal({
  open,
  target,
  roles,
  onClose,
  onSaved
}: {
  open: boolean
  target: UsuarioListItem
  roles: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useSession()
  const isSelf = user?.id === target.id
  // Garantiza que el rol actual esté en la lista visible aunque el admin no lo
  // pueda asignar (no podrá cambiarlo a otro, pero sí editar otros campos).
  const rolesVisible = roles.includes(target.rol) ? roles : [target.rol, ...roles]
  const [nombre, setNombre] = useState(target.nombre)
  const [rol, setRol] = useState(target.rol)
  const [puedeCancelar, setPuedeCancelar] = useState(target.puedeCancelar)
  const [saving, setSaving] = useState(false)
  const nombreRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setNombre(target.nombre)
      setRol(target.rol)
      setPuedeCancelar(target.puedeCancelar)
      setTimeout(() => nombreRef.current?.focus(), 80)
    }
  }, [open, target])

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!user) return
      setSaving(true)
      try {
        await window.api.usuarios.update(user.id, {
          id: target.id,
          nombre: nombre.trim(),
          rol,
          puedeCancelar
        })
        toast.success(`Usuario "${target.login}" actualizado`)
        onSaved()
      } catch (err) {
        toast.error('No se pudo actualizar', {
          description: err instanceof Error ? err.message : String(err)
        })
      } finally {
        setSaving(false)
      }
    },
    [user, target, nombre, rol, puedeCancelar, onSaved]
  )

  const canChangeRole = !isSelf

  return (
    <Modal
      open={open}
      title={`Editar — ${target.login}`}
      onClose={onClose}
      maxWidth="max-w-md"
    >
      <form onSubmit={submit} className="p-4 space-y-3 text-sm">
        <div className="text-[11px] text-muted-foreground">
          Login (no editable): <span className="font-mono">{target.login}</span>
        </div>

        <Field label="Nombre completo">
          <input
            ref={nombreRef}
            type="text"
            required
            className="w-full border border-border rounded px-2 py-1.5"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            autoComplete="off"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Rol">
            <select
              value={rol}
              onChange={(e) => setRol(e.target.value)}
              disabled={!canChangeRole || rolesVisible.length === 1}
              className="w-full border border-border rounded px-2 py-1.5 bg-background disabled:bg-muted/30"
              title={!canChangeRole ? 'No puedes cambiar tu propio rol' : undefined}
            >
              {rolesVisible.map((r) => (
                <option key={r} value={r}>
                  {formatRol(r)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Puede cancelar ventas">
            <label className="flex items-center gap-2 py-1.5">
              <input
                type="checkbox"
                checked={puedeCancelar}
                onChange={(e) => setPuedeCancelar(e.target.checked)}
              />
              <span className="text-xs text-muted-foreground">Sí permitir cancelaciones</span>
            </label>
          </Field>
        </div>

        <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
          Para cambiar password usa el botón "Password" en la lista.
        </p>

        <div className="flex justify-end gap-2 pt-2">
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
            ) : (
              'Guardar'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Sub-modal: Crear usuario ───────────────────────────────────────────────
function CreateUsuarioSubModal({
  open,
  roles,
  onClose,
  onCreated
}: {
  open: boolean
  roles: string[]
  onClose: () => void
  onCreated: () => void
}) {
  const { user } = useSession()
  const [login, setLogin] = useState('')
  const [nombre, setNombre] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [rol, setRol] = useState(roles[0] ?? 'CAJERO')
  const [puedeCancelar, setPuedeCancelar] = useState(false)
  const [saving, setSaving] = useState(false)
  const loginRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setLogin('')
      setNombre('')
      setPassword('')
      setPassword2('')
      setRol(roles[0] ?? 'CAJERO')
      setPuedeCancelar(false)
      setTimeout(() => loginRef.current?.focus(), 80)
    }
  }, [open, roles])

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!user) return
      if (password !== password2) {
        toast.error('Las passwords no coinciden')
        return
      }
      setSaving(true)
      try {
        const r = await window.api.usuarios.create(user.id, {
          login: login.trim().toLowerCase(),
          nombre: nombre.trim(),
          password,
          rol,
          puedeCancelar
        })
        toast.success(`Usuario "${login}" creado`, {
          description: `Password: ${password} · Avísale al usuario antes de cerrar esta ventana.`,
          duration: 15000
        })
        console.log('[usuarios:create] id:', r.id)
        onCreated()
      } catch (err) {
        toast.error('No se pudo crear', {
          description: err instanceof Error ? err.message : String(err)
        })
      } finally {
        setSaving(false)
      }
    },
    [user, login, nombre, password, password2, rol, puedeCancelar, onCreated]
  )

  return (
    <Modal open={open} title="Crear usuario" onClose={onClose} maxWidth="max-w-md">
      <form onSubmit={submit} className="p-4 space-y-3 text-sm">
        <Field label="Login (alfanumérico, sin espacios)">
          <input
            ref={loginRef}
            type="text"
            required
            className="w-full border border-border rounded px-2 py-1.5 font-mono lowercase"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            pattern="[a-zA-Z0-9._-]+"
            autoComplete="off"
          />
        </Field>

        <Field label="Nombre completo">
          <input
            type="text"
            required
            className="w-full border border-border rounded px-2 py-1.5"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            autoComplete="off"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Rol">
            <select
              value={rol}
              onChange={(e) => setRol(e.target.value)}
              disabled={roles.length === 1}
              className="w-full border border-border rounded px-2 py-1.5 bg-background"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {formatRol(r)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Puede cancelar ventas">
            <label className="flex items-center gap-2 py-1.5">
              <input
                type="checkbox"
                checked={puedeCancelar}
                onChange={(e) => setPuedeCancelar(e.target.checked)}
              />
              <span className="text-xs text-muted-foreground">Sí permitir cancelaciones</span>
            </label>
          </Field>
        </div>

        <Field label="Password (mínimo 3 caracteres)">
          <PasswordInput
            required
            minLength={3}
            className="w-full border border-border rounded px-2 py-1.5 font-mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>

        <Field label="Confirmar password">
          <PasswordInput
            required
            minLength={3}
            className="w-full border border-border rounded px-2 py-1.5 font-mono"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            autoComplete="new-password"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
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
                <Spinner size={14} /> Creando…
              </>
            ) : (
              'Crear usuario'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Sub-modal: Resetear password ───────────────────────────────────────────
function ResetPasswordSubModal({
  open,
  target,
  onClose,
  onDone
}: {
  open: boolean
  target: UsuarioListItem
  onClose: () => void
  onDone: () => void
}) {
  const { user } = useSession()
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setNewPassword('')
      setConfirm('')
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open])

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!user) return
      if (newPassword !== confirm) {
        toast.error('Las passwords no coinciden')
        return
      }
      setSaving(true)
      try {
        await window.api.usuarios.resetPassword(user.id, target.id, newPassword)
        toast.success(`Password de "${target.login}" actualizada`, {
          description: `Nueva password: ${newPassword} · Avísale antes de cerrar.`,
          duration: 15000
        })
        onDone()
      } catch (err) {
        toast.error('No se pudo resetear', {
          description: err instanceof Error ? err.message : String(err)
        })
      } finally {
        setSaving(false)
      }
    },
    [user, target, newPassword, confirm, onDone]
  )

  const onKeyEnter = (e: ReactKeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      // default form submission
    }
  }

  return (
    <Modal
      open={open}
      title={`Resetear password — ${target.login}`}
      onClose={onClose}
      maxWidth="max-w-sm"
    >
      <form onSubmit={submit} onKeyDown={onKeyEnter} className="p-4 space-y-3 text-sm">
        <div className="text-xs text-muted-foreground">
          Cambiando password de <span className="font-semibold">{target.nombre}</span> (
          {formatRol(target.rol)})
        </div>

        <Field label="Nueva password (mínimo 3 caracteres)">
          <PasswordInput
            ref={inputRef}
            required
            minLength={3}
            className="w-full border border-border rounded px-2 py-1.5 font-mono"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>

        <Field label="Confirmar">
          <PasswordInput
            required
            minLength={3}
            className="w-full border border-border rounded px-2 py-1.5 font-mono"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
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
            ) : (
              'Resetear'
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
