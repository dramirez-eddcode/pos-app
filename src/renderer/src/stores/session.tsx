import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { EmpresaDto, SessionUser } from '@shared/dto'

interface SessionContextValue {
  user: SessionUser | null
  login: (u: SessionUser) => void
  logout: () => void
  updateSucursal: (sucursal: EmpresaDto) => void
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)

  const login = useCallback((u: SessionUser) => setUser(u), [])
  const logout = useCallback(() => setUser(null), [])
  const updateSucursal = useCallback((sucursal: EmpresaDto) => {
    setUser((prev) => (prev ? { ...prev, sucursal } : prev))
  }, [])

  const value = useMemo<SessionContextValue>(
    () => ({ user, login, logout, updateSucursal }),
    [user, login, logout, updateSucursal]
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>')
  return ctx
}
