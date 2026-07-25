import { BrowserWindow, app, dialog } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { getSqlite } from '../db/connection'
import { requireAdmin } from './permisos'
import type {
  ActualizacionPreview,
  AplicarActualizacionResult,
  PickActualizacionResult
} from '@shared/dto'

/**
 * Actualización del sistema desde USB (sólo SUPERUSUARIO/ADMINISTRADOR).
 *
 * Flujo: el dueño genera el instalador (`farmacias-ms-pos-x.y.z-setup.exe`),
 * lo lleva en USB, y desde Configuración el admin lo selecciona. La app hace
 * un RESPALDO AUTOMÁTICO de la base (a userData/backups), lanza el instalador
 * y se cierra para que pueda reemplazar los archivos.
 *
 * NO hace falta desinstalar ni restaurar respaldo: el instalador NSIS instala
 * encima y la base de datos vive en la carpeta de datos del usuario (fuera de
 * la instalación), así que se conserva; `ensureSchema()` la migra al arrancar
 * la versión nueva. El respaldo automático es sólo un cinturón de seguridad.
 */

// Sólo se acepta el instalador oficial por nombre (evita lanzar cualquier exe).
const RE_SETUP = /^farmacias-ms-pos-(\d+\.\d+\.\d+)-setup\.exe$/i

function cmpVersion(a: string, b: string): 1 | 0 | -1 {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d > 0) return 1
    if (d < 0) return -1
  }
  return 0
}

export async function pickActualizacion(
  viewerUserId: string,
  window: BrowserWindow | null
): Promise<PickActualizacionResult> {
  try {
    requireAdmin(viewerUserId)
    const opts = {
      title: 'Seleccionar instalador de la nueva versión (USB)',
      properties: ['openFile' as const],
      filters: [
        { name: 'Instalador Farmacias MS POS', extensions: ['exe'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    }
    const res = window ? await dialog.showOpenDialog(window, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return { ok: false, cancelled: true }

    const filePath = res.filePaths[0]!
    const fileName = basename(filePath)
    const m = RE_SETUP.exec(fileName)
    if (!m) {
      return {
        ok: false,
        error:
          'El archivo no parece el instalador oficial (se espera "farmacias-ms-pos-x.y.z-setup.exe")'
      }
    }
    const versionNueva = m[1]!
    const versionActual = app.getVersion()
    const preview: ActualizacionPreview = {
      filePath,
      fileName,
      versionNueva,
      versionActual,
      comparacion: cmpVersion(versionNueva, versionActual)
    }
    return { ok: true, preview }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function aplicarActualizacion(
  viewerUserId: string,
  filePath: string
): Promise<AplicarActualizacionResult> {
  try {
    requireAdmin(viewerUserId)
    if (!existsSync(filePath)) {
      return { ok: false, error: 'El instalador ya no está disponible (¿se retiró la USB?)' }
    }
    if (!RE_SETUP.test(basename(filePath))) {
      return { ok: false, error: 'Instalador no válido' }
    }

    // Respaldo automático de seguridad (snapshot consistente, incluye WAL).
    let backupPath: string | undefined
    try {
      const dir = join(app.getPath('userData'), 'backups')
      mkdirSync(dir, { recursive: true })
      const d = new Date()
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
        d.getDate()
      ).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
      backupPath = join(dir, `pre-actualizacion-v${app.getVersion()}-${stamp}.bak`)
      await getSqlite().backup(backupPath)
    } catch (e) {
      // Sin respaldo NO se actualiza: es el cinturón de seguridad del flujo.
      return {
        ok: false,
        error: `No se pudo crear el respaldo automático: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    // Lanzar el instalador desprendido de este proceso y cerrar la app para
    // que pueda reemplazar los archivos. La DB queda intacta en userData.
    const child = spawn(filePath, [], { detached: true, stdio: 'ignore' })
    child.unref()
    setTimeout(() => app.quit(), 800)

    return { ok: true, backupPath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
