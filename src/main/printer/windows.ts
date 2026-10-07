/**
 * Dispatcher de impresión en Windows: escribe bytes a un archivo temporal y
 * los envía al spooler en modo RAW vía print-raw.ps1 (P/Invoke a winspool.drv).
 *
 * En Linux/macOS esto no funciona (no es el caso actual — todas las sucursales
 * son Windows). Si alguna vez es necesario, habrá que agregar una implementación
 * con `lp` via CUPS.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

function resolvePs1Path(): string {
  // En dev, el .ps1 vive en <repo>/resources/scripts/print-raw.ps1
  // En prod (empaquetado), electron-builder copia `resources/` al root del app.
  if (is.dev) {
    return join(app.getAppPath(), 'resources', 'scripts', 'print-raw.ps1')
  }
  return join(process.resourcesPath, 'scripts', 'print-raw.ps1')
}

/**
 * Ruta ABSOLUTA de Windows PowerShell 5.1: no depende del PATH ni de que
 * "powershell" apunte a otra cosa en el equipo. Si no existiera, cae al nombre
 * y deja que Windows lo resuelva.
 */
function powershellExe(): string {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const exe = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(exe) ? exe : 'powershell.exe'
}

/**
 * Entorno LIMPIO para Windows PowerShell. Si la app se lanza desde una consola
 * de PowerShell 7 (pwsh) —o el equipo trae una PSModulePath personalizada—,
 * el proceso hereda una PSModulePath con los módulos de pwsh 7 por delante;
 * Windows PowerShell 5.1 encuentra ahí su Microsoft.PowerShell.Utility, no lo
 * puede cargar y cmdlets básicos como Select-Object, Add-Type o Write-Host
 * dejan de existir ("no se reconoce como nombre de un cmdlet"): se cae tanto
 * el listado de impresoras como la impresión RAW de tickets. Sin la variable,
 * powershell.exe arma sus rutas por defecto y todo vuelve a cargar.
 */
function envSinPSModulePath(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toUpperCase() === 'PSMODULEPATH') continue
    env[k] = v
  }
  return env
}

function spawnPowerShell(args: string[]): ChildProcessWithoutNullStreams {
  return spawn(
    powershellExe(),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
    { windowsHide: true, env: envSinPSModulePath() }
  )
}

export interface PrintResult {
  ok: boolean
  bytesSent: number
  stdout: string
  stderr: string
  exitCode: number | null
}

export async function sendRawToPrinter(
  printerName: string,
  data: Uint8Array
): Promise<PrintResult> {
  if (process.platform !== 'win32') {
    throw new Error(`sendRawToPrinter sólo soporta Windows; plataforma: ${process.platform}`)
  }

  const tempDir = join(tmpdir(), 'farmacias-ms-pos')
  mkdirSync(tempDir, { recursive: true })
  const tempFile = join(tempDir, `raw-${randomUUID()}.bin`)
  writeFileSync(tempFile, Buffer.from(data))

  const ps1 = resolvePs1Path()

  return new Promise((resolve) => {
    const child = spawnPowerShell(['-File', ps1, '-Printer', printerName, '-File', tempFile])

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout += c.toString()))
    child.stderr.on('data', (c) => (stderr += c.toString()))
    child.on('close', (code) => {
      try {
        rmSync(tempFile, { force: true })
      } catch {
        /* no-op */
      }
      resolve({
        ok: code === 0,
        bytesSent: data.byteLength,
        stdout,
        stderr,
        exitCode: code
      })
    })
    child.on('error', (err) => {
      resolve({
        ok: false,
        bytesSent: 0,
        stdout: '',
        stderr: `spawn error: ${err.message}`,
        exitCode: null
      })
    })
  })
}

// Estrategias para listar impresoras, en orden. A PROPÓSITO sin Select-Object
// ni otros cmdlets de Microsoft.PowerShell.Utility (ver envSinPSModulePath):
// (Get-Printer).Name sólo depende de PrintManagement, que es un módulo de
// Windows y no existe en pwsh 7, así que nunca se "pisa". La salida va en
// UTF-8 para que los nombres con acentos/ñ lleguen íntegros a Node.
const COMANDOS_LISTAR = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; (Get-Printer).Name',
  // Respaldo si PrintManagement no está disponible: la clase WMI existe en
  // cualquier Windows.
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; (Get-CimInstance -ClassName Win32_Printer).Name'
]

function ejecutarListado(
  cmd: string
): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawnPowerShell(['-Command', cmd])
    let out = ''
    let err = ''
    child.stdout.on('data', (c) => (out += c.toString()))
    child.stderr.on('data', (c) => (err += c.toString()))
    child.on('close', (code) => resolve({ code, out, err }))
    child.on('error', (e) => resolve({ code: null, out: '', err: `spawn error: ${e.message}` }))
  })
}

/**
 * Lista las impresoras instaladas en Windows (sólo el nombre de cada una).
 * Prueba Get-Printer y, si falla, la clase WMI Win32_Printer.
 */
export async function listPrinters(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  let ultimoError = ''
  for (const cmd of COMANDOS_LISTAR) {
    const r = await ejecutarListado(cmd)
    if (r.code === 0) {
      return r.out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    }
    ultimoError = r.err || r.out || `exit ${r.code}`
  }
  // Mensaje corto para el toast (el stderr de PowerShell trae párrafos).
  const detalle = ultimoError
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
  throw new Error(
    `No se pudieron enumerar las impresoras de Windows${detalle ? `: ${detalle}` : ''}`
  )
}
