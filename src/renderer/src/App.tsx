import { useCallback, useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { SessionProvider, useSession } from './stores/session'
import { SettingsProvider } from './stores/settings'
import LoginPage from './pages/LoginPage'
import POSPage from './pages/POSPage'
import MatrizPage from './pages/MatrizPage'
import WizardPage from './pages/WizardPage'
import type { InstalacionDto } from '@shared/dto'

function Router() {
  const { user } = useSession()
  const [instalacion, setInstalacion] = useState<InstalacionDto | null>(null)

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
    return (
      <MatrizPage
        propietarioNombre={instalacion.propietarioNombre}
        matrizId={instalacion.matrizId}
      />
    )
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
