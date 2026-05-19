/**
 * Singleton del cliente Supabase para el main process.
 *
 * Tirón 1 (actual): solo expone el cliente y un test de conexión. Los
 * tirones siguientes agregarán el sync worker, la carga de catálogos, etc.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadConfig } from '../config'

let _client: SupabaseClient | null = null

/**
 * Devuelve el cliente Supabase, creándolo la primera vez. Retorna null si
 * la configuración no tiene URL o key — en ese caso el POS opera 100% local
 * sin intentar sync.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (_client) return _client
  const cfg = loadConfig()
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return null

  _client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      // En el POS (local-first) no queremos que el cliente persista sesión
      // de forma automática; lo haremos nosotros cuando integremos auth.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      headers: {
        'x-client-info': 'farmacias-ms-pos/0.1.0'
      }
    }
  })

  return _client
}

export interface TestConnectionResult {
  ok: boolean
  latencyMs: number
  error?: string
  sucursalCount?: number
  schemaReady?: boolean
}

/**
 * Hace un SELECT simple contra `public.sucursal` para verificar:
 *   - que podemos conectar
 *   - que el schema ya está aplicado
 *   - con qué latencia
 */
export async function testConnection(): Promise<TestConnectionResult> {
  const client = getSupabaseClient()
  if (!client) {
    return {
      ok: false,
      latencyMs: 0,
      error: 'Supabase no configurado (falta SUPABASE_URL o SUPABASE_ANON_KEY en .env)'
    }
  }

  const started = Date.now()
  try {
    const { count, error } = await client
      .from('sucursal')
      .select('id', { count: 'exact', head: true })
    const latencyMs = Date.now() - started

    if (error) {
      if (error.code === '42P01' || /does not exist/i.test(error.message)) {
        return {
          ok: true,
          latencyMs,
          schemaReady: false,
          error:
            'Conexión OK pero el schema no está aplicado. Pega supabase/schema.sql en el SQL Editor.'
        }
      }
      return { ok: false, latencyMs, error: `${error.code ?? ''} ${error.message}` }
    }

    return { ok: true, latencyMs, schemaReady: true, sucursalCount: count ?? 0 }
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}
