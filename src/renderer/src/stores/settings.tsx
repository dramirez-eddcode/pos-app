import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { AppSettings } from '@shared/types'

interface SettingsContextValue {
  settings: AppSettings | null
  loaded: boolean
  update: (patch: Partial<AppSettings>) => Promise<void>
  reload: () => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    const s = await window.api.settings.get()
    setSettings(s)
    setLoaded(true)
  }, [])

  useEffect(() => {
    reload().catch((e) => {
      console.error('[settings] reload failed', e)
      setLoaded(true)
    })
  }, [reload])

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await window.api.settings.update(patch)
    setSettings(next)
  }, [])

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, loaded, update, reload }),
    [settings, loaded, update, reload]
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings debe usarse dentro de <SettingsProvider>')
  return ctx
}
