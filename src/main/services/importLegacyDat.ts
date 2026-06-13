import { BrowserWindow, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { getSqlite } from '../db/connection'
import { requireAdminOrSupervisor } from './permisos'
import type { ApplyDatResult, ImportDatPreview, PickDatResult } from '@shared/dto'

/**
 * Importador del archivo legacy `.dat` que sigue generando el sistema viejo.
 *
 * FORMATO (texto Windows-1252, líneas CRLF):
 *   línea 0           ruta/header (ej. "E:\CENTRAL09-06-26.dat") — se ignora
 *   "PRODUCTOS"       inicio de la sección de productos
 *     <registro>…     un producto por línea, 10 campos separados por «æ» (0xE6)
 *   "FIN"             cierra PRODUCTOS
 *   "OFERTAS" … "FIN" sección de ofertas (no se usa aquí)
 *   "TERMINADO"       marca de fin de archivo
 *
 * CAMPOS de cada registro (índice tras split por «æ»):
 *   0 código de barras   1 'descripción'(→nombre)   2 'sustancia'   3 precio
 *   4..7 (costo/Null, sin uso)   8 IVA (0/15/16, NO se aplica)
 *   9 estatus 'A'|'D'|''  ('D' = baja → producto inactivo)
 *
 * REGLAS DE NEGOCIO (acordadas):
 *   - IVA: NO se toma del .dat. Producto existente conserva su IVA; producto
 *     nuevo se crea EXENTO (0%).
 *   - Upsert SUAVE: al actualizar sólo se tocan nombre, sustancia, precio y
 *     estatus; se preservan costo, stock mín/máx, laboratorio y descripción.
 *   - Estatus 'D' → activo=0; 'A' o vacío → activo=1.
 */

const SEP = 'æ' // «æ» 0xE6 en Windows-1252

interface DatRow {
  codigo: string
  nombre: string
  sustancia: string | null
  precio: number
  activo: 0 | 1
  baja: boolean // estatus 'D'
}

interface ParsedDat {
  total: number // registros leídos en la sección PRODUCTOS
  rows: DatRow[] // registros válidos
  invalidos: string[] // identificador del registro omitido + motivo
}

/** Quita comillas simples envolventes y espacios de un campo del .dat. */
function unquote(raw: string | undefined): string {
  let s = (raw ?? '').trim()
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1)
  return s.trim()
}

function parsePrecio(raw: string | undefined): number {
  const s = (raw ?? '').trim().replace(',', '.')
  const n = parseFloat(s)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN
}

/** Lee el archivo (Windows-1252) y extrae la sección PRODUCTOS ya validada. */
function parseDatFile(filePath: string): ParsedDat {
  const buf = readFileSync(filePath)
  const text = new TextDecoder('windows-1252').decode(buf)
  const lines = text.split(/\r?\n/)

  // Localiza la sección PRODUCTOS … FIN.
  const start = lines.findIndex((l) => l.trim() === 'PRODUCTOS')
  if (start === -1) {
    throw new Error('Archivo .dat sin sección PRODUCTOS (¿no es un export del sistema legacy?)')
  }

  const result: ParsedDat = { total: 0, rows: [], invalidos: [] }

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (trimmed === 'FIN' || trimmed === 'TERMINADO' || trimmed === 'OFERTAS') break
    if (trimmed === '') continue

    result.total++
    const f = line.split(SEP)
    const codigo = unquote(f[0])
    const nombre = unquote(f[1])
    const sustancia = unquote(f[2]) || null
    const precio = parsePrecio(f[3])
    const estatus = unquote(f[9]).toUpperCase()

    if (!codigo) {
      result.invalidos.push(`(renglón ${i + 1}: código vacío)`)
      continue
    }
    if (!nombre) {
      result.invalidos.push(`${codigo}: nombre vacío`)
      continue
    }
    if (!Number.isFinite(precio) || precio < 0) {
      result.invalidos.push(`${codigo}: precio inválido`)
      continue
    }

    const baja = estatus === 'D'
    result.rows.push({ codigo, nombre, sustancia, precio, activo: baja ? 0 : 1, baja })
  }

  return result
}

/**
 * Abre el diálogo, parsea el .dat y devuelve un preview con los conteos para
 * que el admin confirme antes de aplicar. No modifica nada.
 */
export async function pickDat(window: BrowserWindow | null): Promise<PickDatResult> {
  try {
    const opts = {
      title: 'Seleccionar archivo de actualización legacy (.dat)',
      properties: ['openFile' as const],
      filters: [
        { name: 'Archivo de actualización (.dat)', extensions: ['dat'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    }
    const res = window ? await dialog.showOpenDialog(window, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return { ok: false, cancelled: true }

    const filePath = res.filePaths[0]!
    const parsed = parseDatFile(filePath)

    const sqlite = getSqlite()
    const sel = sqlite.prepare('SELECT 1 FROM producto WHERE codigo = ?')
    let aCrear = 0
    let aActualizar = 0
    let aDesactivar = 0
    for (const r of parsed.rows) {
      const existe = sel.get(r.codigo)
      if (existe) {
        aActualizar++
        if (r.baja) aDesactivar++
      } else {
        aCrear++
      }
    }

    const preview: ImportDatPreview = {
      filePath,
      fileName: basename(filePath),
      totalRegistros: parsed.total,
      aCrear,
      aActualizar,
      aDesactivar,
      invalidos: parsed.invalidos.length
    }
    return { ok: true, preview }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Aplica un .dat previamente seleccionado (re-lee y re-parsea el filePath).
 * Upsert suave en una sola transacción.
 */
export function applyDat(viewerUserId: string, filePath: string): ApplyDatResult {
  requireAdminOrSupervisor(viewerUserId)
  if (!filePath) throw new Error('Ruta de archivo vacía')

  const parsed = parseDatFile(filePath)
  const sqlite = getSqlite()

  const sel = sqlite.prepare(
    'SELECT id, nombre, sustancia_activa AS sustancia, precio, activo FROM producto WHERE codigo = ?'
  )
  // UPDATE suave: NO toca costo, stock_*, laboratorio, descripcion ni IVA.
  const upd = sqlite.prepare(
    `UPDATE producto
        SET nombre = ?, sustancia_activa = ?, precio = ?, activo = ?, updated_at = ?
      WHERE id = ?`
  )
  // INSERT de producto nuevo: IVA exento por default; costo/stock en 0.
  const ins = sqlite.prepare(
    `INSERT INTO producto
       (id, codigo, nombre, sustancia_activa, descripcion, laboratorio,
        precio, costo, iva_porcentaje, iva_modo, stock_maximo, stock_minimo,
        activo, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 0, 0, 'exento', 0, 0, ?, ?)`
  )

  const result: ApplyDatResult = {
    creados: 0,
    actualizados: 0,
    desactivados: 0,
    sinCambio: 0,
    invalidos: parsed.invalidos
  }

  const run = sqlite.transaction(() => {
    const now = Date.now()
    for (const r of parsed.rows) {
      const existente = sel.get(r.codigo) as
        | { id: string; nombre: string; sustancia: string | null; precio: number; activo: number }
        | undefined

      if (existente) {
        const igual =
          existente.nombre === r.nombre &&
          (existente.sustancia ?? null) === r.sustancia &&
          existente.precio === r.precio &&
          existente.activo === r.activo
        if (igual) {
          result.sinCambio++
          continue
        }
        upd.run(r.nombre, r.sustancia, r.precio, r.activo, now, existente.id)
        result.actualizados++
        if (r.baja && existente.activo === 1) result.desactivados++
      } else {
        ins.run(randomUUID(), r.codigo, r.nombre, r.sustancia, r.precio, r.activo, now)
        result.creados++
        if (r.baja) result.desactivados++
      }
    }
  })

  run()
  return result
}
