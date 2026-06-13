/**
 * Settings de la instancia local (por PC, no por sucursal).
 * Se guardan como JSON en `app.getPath('userData')/settings.json` para que
 * sobrevivan a re-instalaciones de la DB sin afectar la configuración del
 * hardware.
 */

import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface AppSettings {
  printerName: string | null
  openDrawerOnCash: boolean
  showTimeOnReceipt: boolean
  receiptFooter: string | null
  // Qué líneas del encabezado se imprimen en los tickets (venta, cancelación,
  // corte). Permite ocultar p. ej. la razón social. Default: todo visible.
  ticketMostrarRazonSocial: boolean
  ticketMostrarRfc: boolean
  ticketMostrarSucursal: boolean
  ticketMostrarDireccion: boolean
  // Imprimir el folio ("Nota de mostrador") en el ticket de venta. Default: sí.
  ticketMostrarFolio: boolean
}

const DEFAULTS: AppSettings = {
  printerName: null,
  openDrawerOnCash: true,
  showTimeOnReceipt: false,
  receiptFooter: null,
  ticketMostrarRazonSocial: true,
  ticketMostrarRfc: true,
  ticketMostrarSucursal: true,
  ticketMostrarDireccion: true,
  ticketMostrarFolio: true
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): AppSettings {
  const p = settingsPath()
  if (!existsSync(p)) return { ...DEFAULTS }
  try {
    const raw = readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...parsed }
  } catch (e) {
    console.error('[settings] parse error, usando defaults:', e)
    return { ...DEFAULTS }
  }
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const next = { ...current, ...patch }
  const p = settingsPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(next, null, 2), 'utf8')
  return next
}
