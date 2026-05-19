import { Toaster } from 'sonner'
import { SessionProvider, useSession } from './stores/session'
import { SettingsProvider } from './stores/settings'
import LoginPage from './pages/LoginPage'
import POSPage from './pages/POSPage'

function Router() {
  const { user } = useSession()
  return user ? <POSPage /> : <LoginPage />
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
