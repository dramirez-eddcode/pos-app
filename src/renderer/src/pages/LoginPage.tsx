import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSession } from '../stores/session'
import Spinner from '../components/Spinner'
import Logo from '../components/Logo'
import PasswordInput from '../components/PasswordInput'

export default function LoginPage() {
  const { login } = useSession()
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const loginRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loginRef.current?.focus()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      const r = await window.api.auth.login(loginName, password)
      if (r.ok) {
        login(r.user)
      } else {
        setError(r.error)
        setPassword('')
      }
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40">
      <form
        onSubmit={submit}
        className="w-full max-w-sm border border-border bg-background rounded-lg p-6 space-y-4 shadow-sm"
      >
        <header className="text-center space-y-1">
          <div className="flex justify-center mb-2">
            <Logo size={88} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Farmacias MS</h1>
          <p className="text-xs text-muted-foreground">Medicamentos Grupo MS</p>
        </header>

        <div className="space-y-1">
          <label className="block text-sm font-medium" htmlFor="login">
            Usuario
          </label>
          <input
            id="login"
            ref={loginRef}
            type="text"
            autoComplete="username"
            className="w-full border border-border rounded px-2 py-1.5 bg-background"
            value={loginName}
            onChange={(e) => setLoginName(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium" htmlFor="password">
            Contraseña
          </label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            className="w-full border border-border rounded px-2 py-1.5 bg-background"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        {error && (
          <div className="text-sm border border-red-300 bg-red-50 text-red-900 rounded px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="w-full bg-primary text-primary-foreground rounded py-2 font-medium hover:opacity-90 disabled:opacity-50"
          disabled={loading}
        >
          <span className="inline-flex items-center justify-center gap-2">
            {loading ? (
              <>
                <Spinner size={14} /> Validando…
              </>
            ) : (
              'Iniciar sesión'
            )}
          </span>
        </button>

        <p className="text-[11px] text-center text-muted-foreground">
          Presiona <span className="font-mono">Enter</span> para continuar
        </p>
      </form>
    </div>
  )
}
