/**
 * Dispatcher de impresión en Windows: escribe bytes a un archivo temporal y
 * los envía al spooler en modo RAW vía print-raw.ps1 (P/Invoke a winspool.drv).
 *
 * En Linux/macOS esto no funciona (no es el caso actual — todas las sucursales
 * son Windows). Si alguna vez es necesario, habrá que agregar una implementación
 * con `lp` via CUPS.
 */

import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
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
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        ps1,
        '-Printer',
        printerName,
        '-File',
        tempFile
      ],
      { windowsHide: true }
    )

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

/**
 * Lista las impresoras instaladas en Windows vía PowerShell Get-Printer.
 * Devuelve solo el Name de cada una.
 */
export async function listPrinters(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Get-Printer | Select-Object -ExpandProperty Name'
      ],
      { windowsHide: true }
    )
    let out = ''
    let err = ''
    child.stdout.on('data', (c) => (out += c.toString()))
    child.stderr.on('data', (c) => (err += c.toString()))
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Get-Printer exit ${code}: ${err}`))
        return
      }
      resolve(
        out
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      )
    })
  })
}
