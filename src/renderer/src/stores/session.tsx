import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { SessionUser } from '@shared/dto'

interface SessionContextValue {
  user: SessionUser | null
  login: (u: SessionUser) => void
  logout: () => void
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)

  const login = useCallback((u: SessionUser) => setUser(u), [])
  const logout = useCallback(() => setUser(null), [])

  const value = useMemo<SessionContextValue>(() => ({ user, login, logout }), [user, login, logout])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>')
  return ctx
}
