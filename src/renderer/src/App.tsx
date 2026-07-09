import { useCallback, useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { SessionProvider, useSession } from './stores/session'
import { SettingsProvider } from './stores/settings'
import { isFullAdmin } from './lib/roles'
import LoginPage from './pages/LoginPage'
import POSPage from './pages/POSPage'
import MatrizPage from './pages/MatrizPage'
import WizardPage from './pages/WizardPage'
import type { InstalacionDto } from '@shared/dto'

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
