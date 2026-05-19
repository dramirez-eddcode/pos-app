/**
 * Carga de variables de entorno desde `.env` local. Se llama una sola vez al
 * arranque del main process, antes de crear la ventana o cualquier otra cosa.
 */

import { config as dotenvConfig } from 'dotenv'
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'

export interface AppConfig {
  supabaseUrl: string | null
  supabaseAnonKey: string | null
}

let _cached: AppConfig | null = null

export function loadConfig(): AppConfig {
  if (_cached) return _cached

  // Orden de búsqueda de .env:
  //   1. Env vars ya seteados por el sistema operativo (priority)
  //   2. .env al lado del ejecutable (en producción)
  //   3. .env en la raíz del proyecto (en dev)
  const candidates = [
    is.dev ? join(app.getAppPath(), '.env') : null,
    join(process.cwd(), '.env'),
    join(app.getPath('userData'), '.env')
  ].filter((p): p is string => Boolean(p))

  for (const path of candidates) {
    if (existsSync(path)) {
      dotenvConfig({ path })
      console.log(`[config] Cargado ${path}`)
      break
    }
  }

  _cached = {
    supabaseUrl: process.env['SUPABASE_URL']?.trim() || null,
    supabaseAnonKey: process.env['SUPABASE_ANON_KEY']?.trim() || null
  }

  if (!_cached.supabaseUrl || !_cached.supabaseAnonKey) {
    console.warn(
      '[config] Supabase no configurado (SUPABASE_URL / SUPABASE_ANON_KEY faltan). La sincronización en la nube estará deshabilitada.'
    )
  }

  return _cached
}

export function isSupabaseConfigured(): boolean {
  const cfg = loadConfig()
  return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey)
}
