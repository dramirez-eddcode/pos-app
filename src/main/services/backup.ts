import { BrowserWindow, dialog } from 'electron'
import { copyFileSync, existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { closeDb, resolveDbPath } from '../db/connection'

/**
 * Backup local del POS: copia el archivo SQLite a un destino elegido por el
 * usuario (típicamente una USB). Funciona en cualquier modo (matriz / sucursal)
 * porque persiste la DB completa, no un subset.
 *
 * SQLite + WAL: para garantizar consistencia del backup, hacemos PRAGMA wal_checkpoint
 * antes de copiar, así el WAL se incorpora al .db principal.
 *
 * Restore reemplaza el archivo SQLite actual. La operación es destructiva — el
 * caller debe pedir confirmación explícita al admin. Después del restore se
 * cierra el handle de DB y se recarga la ventana para re-abrir.
 */

import { getSqlite } from '../db/connection'

export interface BackupResult {
  ok: boolean
  path?: string
  bytes?: number
  error?: string
  cancelled?: boolean
}

export interface RestoreResult {
  ok: boolean
  fromPath?: string
  error?: string
  cancelled?: boolean
}

function suggestedFilename(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `farmacias-ms-backup-${yyyy}${mm}${dd}-${hh}${mi}.bak`
}

export async function exportBackup(window: BrowserWindow | null): Promise<BackupResult> {
  try {
    // Checkpoint WAL para incorporar cambios pendientes al archivo principal
    try {
      const sqlite = getSqlite()
      sqlite.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      /* si la DB aún no está abierta, igual procedemos a copiar archivo crudo */
    }

    const srcPath = resolveDbPath()
    if (!existsSync(srcPath)) {
      return { ok: false, error: 'No existe DB local para respaldar' }
    }

    const result = window
      ? await dialog.showSaveDialog(window, {
          title: 'Guardar respaldo en USB',
          defaultPath: suggestedFilename(),
          filters: [
            { name: 'Respaldo POS', extensions: ['bak'] },
            { name: 'Todos', extensions: ['*'] }
          ]
        })
      : await dialog.showSaveDialog({
          title: 'Guardar respaldo en USB',
          defaultPath: suggestedFilename(),
          filters: [{ name: 'Respaldo POS', extensions: ['bak'] }]
        })

    if (result.canceled || !result.filePath) {
      return { ok: false, cancelled: true }
    }

    copyFileSync(srcPath, result.filePath)
    const bytes = statSync(result.filePath).size
    return { ok: true, path: result.filePath, bytes }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function importBackup(
  window: BrowserWindow | null
): Promise<RestoreResult> {
  try {
    const result = window
      ? await dialog.showOpenDialog(window, {
          title: 'Seleccionar respaldo a restaurar',
          properties: ['openFile'],
          filters: [
            { name: 'Respaldo POS', extensions: ['bak', 'db'] },
            { name: 'Todos', extensions: ['*'] }
          ]
        })
      : await dialog.showOpenDialog({
          title: 'Seleccionar respaldo a restaurar',
          properties: ['openFile'],
          filters: [{ name: 'Respaldo POS', extensions: ['bak', 'db'] }]
        })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, cancelled: true }
    }
    const fromPath = result.filePaths[0]!

    // Pre-flight: el archivo debe ser una DB SQLite válida (firma "SQLite format 3\0")
    const fs = await import('node:fs')
    const fd = fs.openSync(fromPath, 'r')
    const hdr = Buffer.alloc(16)
    fs.readSync(fd, hdr, 0, 16, 0)
    fs.closeSync(fd)
    const signature = hdr.toString('utf8', 0, 15)
    if (signature !== 'SQLite format 3') {
      return { ok: false, error: 'El archivo no parece un respaldo válido (firma SQLite no coincide)' }
    }

    const destPath = resolveDbPath()

    // Cerrar handle actual antes de sobreescribir
    closeDb()

    copyFileSync(fromPath, destPath)
    return { ok: true, fromPath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
