import { BrowserWindow, dialog } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { getSqlite } from '../db/connection'
import type {
  AplicarTraspasoResult,
  CrearTraspasoInput,
  CrearTraspasoResult,
  PickTraspasoResult,
  TraspasoFaltante,
  TraspasoFile,
  TraspasoHistDetalle,
  TraspasoHistItem,
  TraspasoLineaFile,
  TraspasoPayload
} from '@shared/dto'

/**
 * Traspaso de inventario de una BODEGA (matriz) a una SUCURSAL, transportado por
 * USB en un archivo `.traspaso` (JSON + checksum). Flujo de dos lados:
 *
 *   MATRIZ  → crearTraspaso(): valida stock, consume FEFO de la bodega origen
 *             (descuenta saldo + journal SALIDA), arma el archivo con líneas a
 *             nivel lote (conserva caducidad) y lo guarda. Todo atómico: el
 *             archivo se escribe DENTRO de la transacción, si falla, no descuenta.
 *
 *   SUCURSAL → pickTraspaso(): valida y previsualiza (incluye anti-duplicado).
 *              aplicarTraspaso(): crea los lotes en la Bodega Principal local
 *              (journal ENTRADA con el folio). Anti-duplicado por folio: si ya
 *              se aplicó (existe un mov_stock con ese folio), se rechaza.
 */

const BODEGA_PRINCIPAL = 'bodega-principal'

// ── Helpers de rol / modo ────────────────────────────────────────────────────
function rolOf(userId: string): string | null {
  const row = getSqlite()
    .prepare(
      `SELECT t.nombre FROM usuario u JOIN tipo_usuario t ON t.id = u.tipo_usuario_id WHERE u.id = ?`
    )
    .get(userId) as { nombre: string } | undefined
  return row?.nombre ?? null
}

function requireAdmin(userId: string): void {
  const rol = rolOf(userId)
  if (!rol) throw new Error('Usuario no identificado')
  if (rol !== 'ADMINISTRADOR' && rol !== 'SUPERUSUARIO') {
    throw new Error('Requiere permisos de administrador')
  }
}

interface InstalRow {
  tipo: string
  sucursalActivaId: string | null
  matrizId: string | null
  propietarioNombre: string | null
}

function getInstalacion(): InstalRow {
  const row = getSqlite()
    .prepare(
      `SELECT tipo,
              sucursal_activa_id AS sucursalActivaId,
              matriz_id          AS matrizId,
              propietario_nombre AS propietarioNombre
         FROM instalacion WHERE id = 1`
    )
    .get() as InstalRow | undefined
  if (!row) throw new Error('Instalación no configurada')
  return row
}

function toYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function caducidadToMs(ymd: string): number {
  const m = (ymd ?? '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return Date.UTC(2099, 11, 31)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

// ── MATRIZ: crear traspaso ───────────────────────────────────────────────────
export async function crearTraspaso(
  viewerUserId: string,
  input: CrearTraspasoInput,
  window: BrowserWindow | null
): Promise<CrearTraspasoResult> {
  try {
    requireAdmin(viewerUserId)
    const instal = getInstalacion()
    if (instal.tipo !== 'MATRIZ') throw new Error('El traspaso solo se genera desde la MATRIZ')

    const sqlite = getSqlite()
    const items = (input.items ?? []).filter((i) => i.codigo && Math.round(Number(i.cantidad)) > 0)
    if (items.length === 0) throw new Error('Sin productos para traspasar')

    const bodega = sqlite
      .prepare('SELECT id, codigo, nombre, activa FROM bodega WHERE id = ?')
      .get(input.bodegaOrigenId) as
      | { id: string; codigo: string; nombre: string; activa: number }
      | undefined
    if (!bodega) throw new Error('Bodega origen no encontrada')
    if (!bodega.activa) throw new Error('La bodega origen está desactivada')

    const sucursal = sqlite
      .prepare('SELECT id, codigo, nombre, activa FROM sucursal WHERE id = ?')
      .get(input.sucursalId) as
      | { id: string; codigo: string; nombre: string; activa: number }
      | undefined
    if (!sucursal) throw new Error('Sucursal destino no encontrada')
    if (!sucursal.activa) throw new Error('La sucursal destino está desactivada')

    const selProd = sqlite.prepare('SELECT id, nombre, costo FROM producto WHERE codigo = ?')
    const dispProd = sqlite.prepare(
      'SELECT COALESCE(SUM(saldo),0) AS disp FROM caducidad_lote WHERE producto_id = ? AND bodega_id = ?'
    )

    // ── Fase 1: validar disponibilidad (solo lectura) ──────────────────────────
    const faltantes: TraspasoFaltante[] = []
    const prodByCodigo = new Map<string, { id: string; nombre: string; costo: number }>()
    for (const it of items) {
      const codigo = String(it.codigo).trim()
      const pedido = Math.round(Number(it.cantidad))
      const prod = selProd.get(codigo) as { id: string; nombre: string; costo: number } | undefined
      if (!prod) {
        faltantes.push({ codigo, pedido, disponible: 0 })
        continue
      }
      prodByCodigo.set(codigo, prod)
      const { disp } = dispProd.get(prod.id, bodega.id) as { disp: number }
      if (Number(disp) < pedido) faltantes.push({ codigo, pedido, disponible: Number(disp) })
    }
    if (faltantes.length > 0) return { ok: false, faltantes }

    // ── Diálogo de guardado (antes de tocar la BD) ─────────────────────────────
    const stamp = toYmd(Date.now()).replace(/-/g, '')
    const base = `${sucursal.codigo}-${sucursal.nombre}`.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const opts = {
      title: `Generar traspaso a "${sucursal.nombre}"`,
      defaultPath: `traspaso-${base}-${stamp}.traspaso`,
      filters: [
        { name: 'Archivo .traspaso', extensions: ['traspaso'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    }
    const dlg = window ? await dialog.showSaveDialog(window, opts) : await dialog.showSaveDialog(opts)
    if (dlg.canceled || !dlg.filePath) return { ok: false, cancelled: true }
    const filePath = dlg.filePath

    const folio = randomUUID()
    const motivo = `TRASPASO ${folio} → ${sucursal.nombre}`

    // ── Fase 2: consumir FEFO + escribir archivo, todo atómico ─────────────────
    const selLotes = sqlite.prepare(
      `SELECT id, saldo, fecha_caducidad AS fechaCaducidad
         FROM caducidad_lote
        WHERE producto_id = ? AND bodega_id = ? AND saldo > 0
        ORDER BY fecha_caducidad ASC, fecha_entrada ASC`
    )
    const updSaldo = sqlite.prepare('UPDATE caducidad_lote SET saldo = ? WHERE id = ?')
    const insMov = sqlite.prepare(
      `INSERT INTO mov_stock (id, lote_id, venta_item_id, tipo, cantidad, fecha, motivo)
       VALUES (?, ?, NULL, 'SALIDA', ?, ?, ?)`
    )

    const lineas: TraspasoLineaFile[] = []
    let unidades = 0

    const run = sqlite.transaction(() => {
      const now = Date.now()
      for (const it of items) {
        const codigo = String(it.codigo).trim()
        const prod = prodByCodigo.get(codigo)!
        let remaining = Math.round(Number(it.cantidad))
        const lotes = selLotes.all(prod.id, bodega.id) as Array<{
          id: string
          saldo: number
          fechaCaducidad: number
        }>
        for (const lote of lotes) {
          if (remaining <= 0) break
          const take = Math.min(lote.saldo, remaining)
          updSaldo.run(lote.saldo - take, lote.id)
          insMov.run(randomUUID(), lote.id, -take, now, motivo)
          lineas.push({
            codigo,
            nombre: prod.nombre,
            cantidad: take,
            costo: Number(prod.costo) || 0,
            caducidad: toYmd(Number(lote.fechaCaducidad))
          })
          remaining -= take
          unidades += take
        }
        if (remaining > 0) {
          // El stock cambió entre fase 1 y 2 (concurrencia). Aborta todo.
          throw new Error(`Stock insuficiente para ${codigo} (cambió durante el traspaso)`)
        }
      }

      const payload: TraspasoPayload = {
        folio,
        matriz: { id: instal.matrizId, propietario: instal.propietarioNombre },
        bodegaOrigen: { id: bodega.id, codigo: bodega.codigo, nombre: bodega.nombre },
        sucursal: { id: sucursal.id, codigo: sucursal.codigo, nombre: sucursal.nombre },
        items: lineas
      }
      const checksum = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
      const fileObject: TraspasoFile = {
        tipo: 'TRASPASO_BODEGA_SUCURSAL',
        version: 1,
        generadoEn: new Date(now).toISOString(),
        checksum,
        payload
      }
      // Historial (se respalda con el SQLite): encabezado + líneas como JSON.
      sqlite
        .prepare(
          `INSERT INTO traspaso
             (folio, fecha, usuario_id, bodega_origen_id, bodega_origen_nombre,
              sucursal_id, sucursal_codigo, sucursal_nombre, lineas, unidades, items_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          folio,
          now,
          viewerUserId,
          bodega.id,
          bodega.nombre,
          sucursal.id,
          sucursal.codigo,
          sucursal.nombre,
          lineas.length,
          unidades,
          JSON.stringify(lineas)
        )

      // Si esto truena, la transacción revierte el descuento de la bodega.
      writeFileSync(filePath, JSON.stringify(fileObject, null, 2), 'utf8')
    })

    run()

    return { ok: true, path: filePath, folio, lineas: lineas.length, unidades }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Historial de traspasos (matriz) ──────────────────────────────────────────
interface TraspasoRow {
  folio: string
  fecha: number
  bodegaOrigen: string | null
  sucursalNombre: string | null
  lineas: number
  unidades: number
  itemsJson?: string
}

export function listTraspasos(): TraspasoHistItem[] {
  const rows = getSqlite()
    .prepare(
      `SELECT folio, fecha,
              bodega_origen_nombre AS bodegaOrigen,
              sucursal_nombre      AS sucursalNombre,
              lineas, unidades
         FROM traspaso
        ORDER BY fecha DESC`
    )
    .all() as TraspasoRow[]
  return rows.map((r) => ({
    folio: r.folio,
    fecha: new Date(r.fecha).toISOString(),
    bodegaOrigen: r.bodegaOrigen ?? '—',
    sucursalNombre: r.sucursalNombre ?? '—',
    lineas: Number(r.lineas) || 0,
    unidades: Number(r.unidades) || 0
  }))
}

export function getTraspasoDetalle(folio: string): TraspasoHistDetalle | null {
  const r = getSqlite()
    .prepare(
      `SELECT folio, fecha,
              bodega_origen_nombre AS bodegaOrigen,
              sucursal_nombre      AS sucursalNombre,
              lineas, unidades,
              items_json           AS itemsJson
         FROM traspaso WHERE folio = ?`
    )
    .get(folio) as TraspasoRow | undefined
  if (!r) return null
  let items: TraspasoLineaFile[] = []
  try {
    items = JSON.parse(r.itemsJson ?? '[]')
  } catch {
    items = []
  }
  return {
    folio: r.folio,
    fecha: new Date(r.fecha).toISOString(),
    bodegaOrigen: r.bodegaOrigen ?? '—',
    sucursalNombre: r.sucursalNombre ?? '—',
    lineas: Number(r.lineas) || 0,
    unidades: Number(r.unidades) || 0,
    items
  }
}

// ── Lectura/validación de un archivo .traspaso ───────────────────────────────
function leerYValidar(filePath: string): TraspasoFile {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (e) {
    throw new Error(`No se pudo leer el archivo: ${e instanceof Error ? e.message : String(e)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('El archivo no es un JSON válido')
  }
  const obj = parsed as Record<string, unknown>
  if (obj?.['tipo'] !== 'TRASPASO_BODEGA_SUCURSAL') {
    throw new Error('Tipo de archivo inválido (no es un .traspaso)')
  }
  if (typeof obj['checksum'] !== 'string' || !obj['payload']) {
    throw new Error('Archivo incompleto (sin checksum o payload)')
  }
  const payload = obj['payload'] as TraspasoPayload
  const expected = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  if (expected !== obj['checksum']) {
    throw new Error('Checksum inválido — el archivo está corrupto o fue modificado')
  }
  if (!payload.folio || !payload.sucursal?.id || !Array.isArray(payload.items)) {
    throw new Error('Payload de traspaso incompleto')
  }
  return obj as unknown as TraspasoFile
}

function yaAplicado(folio: string): boolean {
  const row = getSqlite()
    .prepare(`SELECT 1 FROM mov_stock WHERE motivo LIKE ? LIMIT 1`)
    .get(`TRASPASO ${folio}%`)
  return Boolean(row)
}

/**
 * ¿El traspaso corresponde a esta sucursal? Coincide si:
 *  - aún no hay sucursal activa, o
 *  - el id (UUID) coincide, o
 *  - el código de la sucursal coincide (caso típico tras respaldo/restauración o
 *    instalaciones creadas por separado, donde el UUID difiere pero es la misma).
 */
function sucursalCoincide(sucursalActivaId: string | null, payloadSuc: { id: string; codigo: string }): boolean {
  if (!sucursalActivaId) return true
  if (sucursalActivaId === payloadSuc.id) return true
  const row = getSqlite()
    .prepare('SELECT codigo FROM sucursal WHERE id = ?')
    .get(sucursalActivaId) as { codigo: string } | undefined
  return !!row && !!payloadSuc.codigo && row.codigo === payloadSuc.codigo
}

// ── SUCURSAL: previsualizar traspaso ─────────────────────────────────────────
export async function pickTraspaso(window: BrowserWindow | null): Promise<PickTraspasoResult> {
  try {
    const instal = getInstalacion()
    if (instal.tipo !== 'SUCURSAL') {
      throw new Error('Recibir traspaso solo está disponible en modo SUCURSAL')
    }
    const opts = {
      title: 'Seleccionar archivo .traspaso',
      properties: ['openFile' as const],
      filters: [
        { name: 'Archivo .traspaso', extensions: ['traspaso'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    }
    const res = window ? await dialog.showOpenDialog(window, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return { ok: false, cancelled: true }

    const filePath = res.filePaths[0]!
    const file = leerYValidar(filePath)
    const p = file.payload
    const unidades = p.items.reduce((a, l) => a + (Number(l.cantidad) || 0), 0)

    return {
      ok: true,
      preview: {
        filePath,
        folio: p.folio,
        generadoEn: file.generadoEn,
        bodegaOrigen: p.bodegaOrigen?.nombre ?? '—',
        sucursalNombre: p.sucursal?.nombre ?? '—',
        lineas: p.items.length,
        unidades,
        yaAplicado: yaAplicado(p.folio),
        sucursalCoincide: sucursalCoincide(instal.sucursalActivaId, p.sucursal)
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── SUCURSAL: aplicar traspaso (entrada a Bodega Principal) ───────────────────
export function aplicarTraspaso(
  viewerUserId: string,
  filePath: string,
  force = false
): AplicarTraspasoResult {
  try {
    requireAdmin(viewerUserId)
    const instal = getInstalacion()
    if (instal.tipo !== 'SUCURSAL') {
      throw new Error('Recibir traspaso solo está disponible en modo SUCURSAL')
    }

    const file = leerYValidar(filePath)
    const p = file.payload

    if (!force && !sucursalCoincide(instal.sucursalActivaId, p.sucursal)) {
      throw new Error('Este traspaso es para otra sucursal. Verifica el USB correcto.')
    }
    if (yaAplicado(p.folio)) {
      throw new Error(`Este traspaso ya fue aplicado anteriormente (folio ${p.folio.slice(0, 8)}…)`)
    }

    const sqlite = getSqlite()
    const selProd = sqlite.prepare('SELECT id FROM producto WHERE codigo = ?')
    const insLote = sqlite.prepare(
      `INSERT INTO caducidad_lote (id, producto_id, bodega_id, total, saldo, fecha_caducidad, fecha_entrada)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const insMov = sqlite.prepare(
      `INSERT INTO mov_stock (id, lote_id, venta_item_id, tipo, cantidad, fecha, motivo)
       VALUES (?, ?, NULL, 'ENTRADA', ?, ?, ?)`
    )
    const motivo = `TRASPASO ${p.folio} desde ${p.bodegaOrigen?.nombre ?? 'bodega'}`

    const noEncontrados: string[] = []
    let lotesCreados = 0
    let unidades = 0

    const run = sqlite.transaction(() => {
      const now = Date.now()
      for (const l of p.items) {
        const cantidad = Math.round(Number(l.cantidad))
        if (!Number.isFinite(cantidad) || cantidad <= 0) continue
        const prod = selProd.get(String(l.codigo).trim()) as { id: string } | undefined
        if (!prod) {
          noEncontrados.push(String(l.codigo))
          continue
        }
        const loteId = randomUUID()
        insLote.run(loteId, prod.id, BODEGA_PRINCIPAL, cantidad, cantidad, caducidadToMs(l.caducidad), now)
        insMov.run(randomUUID(), loteId, cantidad, now, motivo)
        lotesCreados++
        unidades += cantidad
      }
    })

    run()

    return {
      ok: true,
      folio: p.folio,
      lotesCreados,
      unidades,
      noEncontrados: [...new Set(noEncontrados)]
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
