import { useCallback, useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { ShieldAlert } from 'lucide-react'
import { SessionProvider, useSession } from './stores/session'
import { SettingsProvider } from './stores/settings'
import { formatRol, isFullAdmin, isSuperusuario } from './lib/roles'
import LoginPage from './pages/LoginPage'
import POSPage from './pages/POSPage'
import MatrizPage from './pages/MatrizPage'
import WizardPage from './pages/WizardPage'
import type { InstalacionDto } from '@shared/dto'

/**
 * Aviso permanente cuando la sesión activa tiene privilegios completos
 * (SUPERUSUARIO en rojo, ADMINISTRADOR en ámbar): marco alrededor de toda la
 * ventana + etiqueta superior, para que no se quede una sesión con permisos
 * abierta por accidente. Es un overlay fijo (no mueve el layout) y no
 * intercepta clics; queda visible incluso con modales abiertos (z-50 > z-40).
 */
function AdminSessionIndicator() {
  const { user } = useSession()
  if (!user || !isFullAdmin(user)) return null
  const esSuper = isSuperusuario(user)
  const frame = esSuper ? 'border-red-600' : 'border-amber-500'
  const pill = esSuper ? 'bg-red-600 text-white' : 'bg-amber-500 text-amber-950'
  return (
    <div className="pointer-events-none fixed inset-0 z-50" aria-hidden>
      <div className={`absolute inset-0 border-4 ${frame}`} />
      <div
        className={`absolute top-0 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-b-md px-3 py-1 text-[11px] font-bold uppercase tracking-wider shadow ${pill}`}
      >
        <ShieldAlert className="size-3.5 animate-pulse" />
        Sesión de {formatRol(user.rol)} — recuerda cerrar sesión
      </div>
    </div>
  )
}

function Router() {
  const { user } = useSession()
  const [instalacion, setInstalacion] = useState<InstalacionDto | null>(null)
  // En MATRIZ, los admins completos pueden alternar entre el panel de gestión
  // y el punto de venta (equipo único: gestionan la bodega Y venden).
  const [vistaPos, setVistaPos] = useState(false)

  // Al cambiar de usuario (login/logout) se regresa a la vista default.
  useEffect(() => {
    setVistaPos(false)
  }, [user?.id])

  const reload = useCallback((): void => {
    window.api.instalacion
      .get()
      .then(setInstalacion)
      .catch(() => setInstalacion({ configured: false }))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  if (instalacion === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    )
  }

  if (!instalacion.configured) {
    return <WizardPage onConfigured={reload} />
  }

  if (!user) return <LoginPage />

  if (instalacion.tipo === 'MATRIZ') {
    // SUPERUSUARIO/ADMINISTRADOR: panel de matriz con acceso al POS.
    // CAJERO/SUPERVISOR en un equipo matriz: directo al punto de venta.
    if (isFullAdmin(user) && !vistaPos) {
      return (
        <MatrizPage
          propietarioNombre={instalacion.propietarioNombre}
          matrizId={instalacion.matrizId}
          onAbrirPos={() => setVistaPos(true)}
        />
      )
    }
    return <POSPage onVolverMatriz={isFullAdmin(user) ? () => setVistaPos(false) : undefined} />
  }

  return <POSPage />
}

export default function App() {
  return (
    <SettingsProvider>
      <SessionProvider>
        <Router />
        <AdminSessionIndicator />
        <Toaster
          position="top-center"
          richColors
          closeButton
          toastOptions={{ duration: 5000 }}
        />
      </SessionProvider>
    </SettingsProvider>
  )
}
