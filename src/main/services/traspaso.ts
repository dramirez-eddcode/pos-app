import { BrowserWindow, dialog } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { getSqlite } from '../db/connection'
import type {
  AplicarTraspasoResult,
  CrearTraspasoInput,
  CrearTraspasoResult,
  MovimientoLinea,
  PickTraspasoResult,
  ResumenSurtidoDto,
  ResumenSurtidoItem,
  TraspasoBodegasInput,
  TraspasoFaltante,
  TraspasoFile,
  TraspasoLineaFile,
  TraspasoPayload
} from '@shared/dto'

/**
 * Traspaso de inventario entre instalaciones, transportado por USB en un
 * archivo `.traspaso` (JSON + checksum). Flujo de dos lados:
 *
 *   ORIGEN  → crearTraspaso(): valida stock, consume FEFO de la bodega origen
 *             (descuenta saldo + journal SALIDA), arma el archivo con líneas a
 *             nivel lote (conserva caducidad) y lo guarda. Todo atómico: el
 *             archivo se escribe DENTRO de la transacción, si falla, no descuenta.
 *             En MATRIZ el destino sale del catálogo de sucursales; en SUCURSAL
 *             el destino es libre (código + nombre) — otra sucursal o la matriz.
 *
 *   DESTINO → pickTraspaso(): valida y previsualiza (incluye anti-duplicado).
 *             aplicarTraspaso(): crea los lotes en la bodega destino (Bodega
 *             Principal por default; en matriz se elige) con journal ENTRADA.
 *             Anti-duplicado por folio: si ya se aplicó, se rechaza.
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

// Recibir traspasos lo puede hacer el SUPERVISOR en CUALQUIER modo de
// instalación (a diferencia de requireAdminOrSupervisor, que lo limita a
// SUCURSAL): también hay bodegas en modo MATRIZ que venden directo y reciben
// mercancía con un supervisor a cargo.
function requireRecibirTraspaso(userId: string): void {
  const rol = rolOf(userId)
  if (!rol) throw new Error('Usuario no identificado')
  if (rol !== 'ADMINISTRADOR' && rol !== 'SUPERUSUARIO' && rol !== 'SUPERVISOR') {
    throw new Error('Requiere permisos de administrador o supervisor')
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

/**
 * Nombre de archivo legible para el .traspaso:
 *   traspaso-21-07-2026-de-Matriz-a-Prueba_001-parte-2.traspaso
 * (día - origen - destino - número de parte). Sólo nombres, sin códigos: el
 * nombre del archivo es cosmético — las validaciones del receptor usan el
 * payload interno (código de sucursal, checksum, folio anti-duplicado). La
 * "parte" evita que el diálogo pida reemplazar un traspaso anterior del día.
 */
function nombreArchivoTraspaso(
  fechaMs: number,
  origen: string,
  sucNombre: string,
  parte: number
): string {
  const d = new Date(fechaMs)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const fecha = `${dd}-${mm}-${d.getFullYear()}`
  const limpia = (s: string): string =>
    s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return `traspaso-${fecha}-de-${limpia(origen)}-a-${limpia(sucNombre)}-parte-${parte}.traspaso`
}

/** Etiqueta del origen para el nombre del archivo: la matriz o la sucursal local. */
function etiquetaOrigenLocal(instal: InstalRow): string {
  if (instal.tipo !== 'SUCURSAL') return 'Matriz'
  if (!instal.sucursalActivaId) return 'Sucursal'
  const s = getSqlite()
    .prepare('SELECT nombre FROM sucursal WHERE id = ?')
    .get(instal.sucursalActivaId) as { nombre: string } | undefined
  return s?.nombre ?? 'Sucursal'
}

/**
 * Número de parte del día para un destino: cuántos traspasos a esa sucursal se
 * han registrado desde las 00:00 locales hasta `hastaMs` (inclusive). Para un
 * traspaso NUEVO pasa `hastaMs = ahora` y suma 1; para reexportar uno viejo
 * pasa su propia fecha y obtienes la parte que le tocó ese día.
 */
function traspasosDelDiaHasta(sucursalCodigo: string, hastaMs: number): number {
  const d = new Date(hastaMs)
  const inicioDia = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const row = getSqlite()
    .prepare(
      `SELECT COUNT(*) AS n FROM traspaso
        WHERE destino_tipo = 'SUCURSAL' AND sucursal_codigo = ? AND fecha >= ? AND fecha <= ?`
    )
    .get(sucursalCodigo, inicioDia, hastaMs) as { n: number }
  return Number(row.n) || 0
}

function caducidadToMs(ymd: string): number {
  const m = (ymd ?? '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return Date.UTC(2099, 11, 31)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

// ── ORIGEN: crear traspaso (matriz o sucursal) ───────────────────────────────
export async function crearTraspaso(
  viewerUserId: string,
  input: CrearTraspasoInput,
  window: BrowserWindow | null
): Promise<CrearTraspasoResult> {
  try {
    requireAdmin(viewerUserId)
    const instal = getInstalacion()

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

    // Destino: del catálogo (matriz) o libre (sucursal — código/nombre tecleados).
    let sucursal: { id: string; codigo: string; nombre: string }
    if (input.sucursalId) {
      const s = sqlite
        .prepare('SELECT id, codigo, nombre, activa FROM sucursal WHERE id = ?')
        .get(input.sucursalId) as
        | { id: string; codigo: string; nombre: string; activa: number }
        | undefined
      if (!s) throw new Error('Sucursal destino no encontrada')
      if (!s.activa) throw new Error('La sucursal destino está desactivada')
      sucursal = { id: s.id, codigo: s.codigo, nombre: s.nombre }
    } else if (input.destino) {
      const codigo = (input.destino.codigo ?? '').trim()
      const nombre = (input.destino.nombre ?? '').trim()
      if (!codigo) throw new Error('Código del destino requerido')
      if (!nombre) throw new Error('Nombre del destino requerido')
      // id vacío: el receptor valida por código (sucursalCoincide) o aplica
      // libremente si es la matriz.
      sucursal = { id: '', codigo, nombre }
    } else {
      throw new Error('Destino del traspaso requerido')
    }

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
    // Parte del día: traspasos previos de HOY a este destino + 1. Así el
    // segundo traspaso del día no pide reemplazar el archivo del primero.
    const ahora = Date.now()
    const parte = traspasosDelDiaHasta(sucursal.codigo, ahora) + 1
    const opts = {
      title: `Generar traspaso a "${sucursal.nombre}" (parte ${parte} de hoy)`,
      defaultPath: nombreArchivoTraspaso(ahora, etiquetaOrigenLocal(instal), sucursal.nombre, parte),
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
      const numeroTraspaso = (
        sqlite.prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM traspaso').get() as {
          n: number
        }
      ).n
      sqlite
        .prepare(
          `INSERT INTO traspaso
             (folio, numero, fecha, usuario_id, bodega_origen_id, bodega_origen_nombre,
              sucursal_id, sucursal_codigo, sucursal_nombre, destino_tipo,
              lineas, unidades, items_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCURSAL', ?, ?, ?)`
        )
        .run(
          folio,
          numeroTraspaso,
          now,
          viewerUserId,
          bodega.id,
          bodega.nombre,
          sucursal.id || null,
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

    const numero = (
      sqlite.prepare('SELECT numero FROM traspaso WHERE folio = ?').get(folio) as {
        numero: number
      }
    ).numero
    return { ok: true, path: filePath, folio, numero, lineas: lineas.length, unidades }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Vuelve a generar el archivo `.traspaso` de un traspaso YA registrado (por si
 * el original se perdió antes de llegar a la sucursal). NO toca inventario: el
 * stock ya se descontó al crearlo; sólo reconstruye el archivo desde el
 * historial (tabla `traspaso`, con las líneas y caducidades tal como salieron).
 * Conserva el MISMO folio UUID, así el anti-duplicado del receptor sigue
 * funcionando: si la sucursal ya lo aplicó, rechazará la copia.
 */
export async function reexportarTraspaso(
  viewerUserId: string,
  folio: string,
  window: BrowserWindow | null
): Promise<CrearTraspasoResult> {
  try {
    requireAdmin(viewerUserId)
    const instal = getInstalacion()
    const sqlite = getSqlite()

    const t = sqlite
      .prepare(
        `SELECT folio, numero, fecha,
                bodega_origen_id     AS bodegaOrigenId,
                bodega_origen_nombre AS bodegaOrigenNombre,
                sucursal_id          AS sucursalId,
                sucursal_codigo      AS sucursalCodigo,
                sucursal_nombre      AS sucursalNombre,
                destino_tipo         AS destinoTipo,
                unidades,
                items_json           AS itemsJson
           FROM traspaso WHERE folio = ?`
      )
      .get(folio) as
      | {
          folio: string
          numero: number
          fecha: number
          bodegaOrigenId: string
          bodegaOrigenNombre: string
          sucursalId: string | null
          sucursalCodigo: string
          sucursalNombre: string
          destinoTipo: string
          unidades: number
          itemsJson: string | null
        }
      | undefined
    if (!t) throw new Error('Traspaso no encontrado')
    if (t.destinoTipo !== 'SUCURSAL') {
      throw new Error('Este traspaso fue interno entre bodegas: no usa archivo .traspaso')
    }
    const items = JSON.parse(t.itemsJson ?? '[]') as TraspasoLineaFile[]
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('El traspaso no tiene líneas guardadas en el historial')
    }

    const bodega = sqlite
      .prepare('SELECT codigo FROM bodega WHERE id = ?')
      .get(t.bodegaOrigenId) as { codigo: string } | undefined

    // Misma nomenclatura que al generarlo: la parte que le tocó ese día.
    const parte = Math.max(1, traspasosDelDiaHasta(t.sucursalCodigo, t.fecha))
    const opts = {
      title: `Volver a generar traspaso T-${t.numero} a "${t.sucursalNombre}"`,
      defaultPath: nombreArchivoTraspaso(
        t.fecha,
        etiquetaOrigenLocal(instal),
        t.sucursalNombre,
        parte
      ),
      filters: [
        { name: 'Archivo .traspaso', extensions: ['traspaso'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    }
    const dlg = window ? await dialog.showSaveDialog(window, opts) : await dialog.showSaveDialog(opts)
    if (dlg.canceled || !dlg.filePath) return { ok: false, cancelled: true }

    const payload: TraspasoPayload = {
      folio: t.folio,
      matriz: { id: instal.matrizId, propietario: instal.propietarioNombre },
      bodegaOrigen: {
        id: t.bodegaOrigenId,
        codigo: bodega?.codigo ?? '',
        nombre: t.bodegaOrigenNombre
      },
      sucursal: { id: t.sucursalId ?? '', codigo: t.sucursalCodigo, nombre: t.sucursalNombre },
      items
    }
    const checksum = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    const fileObject: TraspasoFile = {
      tipo: 'TRASPASO_BODEGA_SUCURSAL',
      version: 1,
      generadoEn: new Date(t.fecha).toISOString(),
      checksum,
      payload
    }
    writeFileSync(dlg.filePath, JSON.stringify(fileObject, null, 2), 'utf8')

    return {
      ok: true,
      path: dlg.filePath,
      folio: t.folio,
      numero: t.numero,
      lineas: items.length,
      unidades: t.unidades
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Resumen de surtido: consolida TODOS los traspasos a SUCURSAL de un rango de
 * fechas en una lista de productos SIN repetir — total enviado + existencia
 * actual. Es la base para la lista de faltantes / pedido a proveedor semanal.
 * La agrupación tolera ceros iniciales (traspasos viejos pueden traer el
 * código largo y el catálogo ya usa el corto).
 */
export function resumenSurtido(
  viewerUserId: string,
  desdeYmd: string,
  hastaYmd: string
): ResumenSurtidoDto {
  requireAdmin(viewerUserId)
  const sqlite = getSqlite()

  const parse = (ymd: string, fin: boolean): number => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
    if (!m) throw new Error('Fecha inválida (se espera AAAA-MM-DD)')
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return fin ? d.getTime() + 24 * 60 * 60 * 1000 - 1 : d.getTime()
  }
  const desdeMs = parse(desdeYmd, false)
  const hastaMs = parse(hastaYmd, true)
  if (hastaMs < desdeMs) throw new Error('El rango de fechas está invertido')

  const rows = sqlite
    .prepare(
      `SELECT numero, fecha, sucursal_nombre AS destino, unidades, items_json AS itemsJson
         FROM traspaso
        WHERE destino_tipo = 'SUCURSAL' AND fecha >= ? AND fecha <= ?
        ORDER BY fecha ASC`
    )
    .all(desdeMs, hastaMs) as Array<{
    numero: number
    fecha: number
    destino: string
    unidades: number
    itemsJson: string | null
  }>

  const selProdExacto = sqlite.prepare(
    'SELECT id, codigo, nombre FROM producto WHERE codigo = ?'
  )
  const selProdSinCeros = sqlite.prepare(
    `SELECT id, codigo, nombre FROM producto
      WHERE codigo NOT GLOB '*[^0-9]*' AND LTRIM(codigo, '0') = ? LIMIT 2`
  )
  const selExistencia = sqlite.prepare(
    'SELECT COALESCE(SUM(saldo), 0) AS s FROM caducidad_lote WHERE producto_id = ?'
  )

  interface Acc {
    codigo: string
    nombre: string
    enviado: number
    productoId: string | null
    destinos: Set<string>
  }
  const acc = new Map<string, Acc>()
  let totalUnidades = 0

  for (const t of rows) {
    let lineas: TraspasoLineaFile[] = []
    try {
      lineas = JSON.parse(t.itemsJson ?? '[]') as TraspasoLineaFile[]
    } catch {
      lineas = []
    }
    for (const l of lineas) {
      const codigoRaw = String(l.codigo ?? '').trim()
      const cantidad = Math.round(Number(l.cantidad)) || 0
      if (!codigoRaw || cantidad <= 0) continue
      const key = /^\d+$/.test(codigoRaw) ? codigoRaw.replace(/^0+/, '') || codigoRaw : codigoRaw

      let a = acc.get(key)
      if (!a) {
        // Resolver el producto ACTUAL del catálogo (exacto o sin ceros).
        let prod = selProdExacto.get(codigoRaw) as
          | { id: string; codigo: string; nombre: string }
          | undefined
        if (!prod && /^\d+$/.test(codigoRaw)) {
          const cands = selProdSinCeros.all(key) as Array<{
            id: string
            codigo: string
            nombre: string
          }>
          if (cands.length === 1) prod = cands[0]
        }
        a = {
          codigo: prod?.codigo ?? codigoRaw,
          nombre: prod?.nombre ?? l.nombre ?? codigoRaw,
          enviado: 0,
          productoId: prod?.id ?? null,
          destinos: new Set<string>()
        }
        acc.set(key, a)
      }
      a.enviado += cantidad
      a.destinos.add(t.destino)
      totalUnidades += cantidad
    }
  }

  const items: ResumenSurtidoItem[] = [...acc.values()]
    .map((a) => ({
      codigo: a.codigo,
      nombre: a.nombre,
      enviado: a.enviado,
      existencia: a.productoId
        ? Number((selExistencia.get(a.productoId) as { s: number }).s) || 0
        : 0,
      destinos: a.destinos.size
    }))
    .sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'))

  return {
    desde: desdeYmd,
    hasta: hastaYmd,
    traspasos: rows.map((t) => ({
      numero: t.numero,
      fecha: new Date(t.fecha).toISOString(),
      destino: t.destino,
      unidades: Number(t.unidades) || 0
    })),
    items,
    totalUnidades
  }
}

// ── Traspaso INTERNO entre bodegas (mismo equipo, sin archivo) ───────────────
/**
 * Mueve stock de una bodega a otra de la MISMA instalación en una sola
 * transacción: consume FEFO de la origen (journal SALIDA) y crea lotes
 * equivalentes en la destino conservando caducidades (journal ENTRADA).
 * No genera archivo ni necesita anti-duplicado: es atómico y local.
 */
export function traspasoEntreBodegas(
  viewerUserId: string,
  input: TraspasoBodegasInput
): CrearTraspasoResult {
  try {
    requireAdmin(viewerUserId)

    const sqlite = getSqlite()
    const items = (input.items ?? []).filter((i) => i.codigo && Math.round(Number(i.cantidad)) > 0)
    if (items.length === 0) throw new Error('Sin productos para traspasar')
    if (input.bodegaOrigenId === input.bodegaDestinoId) {
      throw new Error('La bodega destino debe ser distinta a la origen')
    }

    const selBodega = sqlite.prepare('SELECT id, codigo, nombre, activa FROM bodega WHERE id = ?')
    const origen = selBodega.get(input.bodegaOrigenId) as
      | { id: string; codigo: string; nombre: string; activa: number }
      | undefined
    if (!origen) throw new Error('Bodega origen no encontrada')
    if (!origen.activa) throw new Error('La bodega origen está desactivada')
    const destino = selBodega.get(input.bodegaDestinoId) as
      | { id: string; codigo: string; nombre: string; activa: number }
      | undefined
    if (!destino) throw new Error('Bodega destino no encontrada')
    if (!destino.activa) throw new Error('La bodega destino está desactivada')

    const selProd = sqlite.prepare('SELECT id, nombre, costo FROM producto WHERE codigo = ?')
    const dispProd = sqlite.prepare(
      'SELECT COALESCE(SUM(saldo),0) AS disp FROM caducidad_lote WHERE producto_id = ? AND bodega_id = ?'
    )

    // ── Fase 1: validar disponibilidad (solo lectura) ────────────────────────
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
      const { disp } = dispProd.get(prod.id, origen.id) as { disp: number }
      if (Number(disp) < pedido) faltantes.push({ codigo, pedido, disponible: Number(disp) })
    }
    if (faltantes.length > 0) return { ok: false, faltantes }

    const folio = randomUUID()

    // ── Fase 2: consumir FEFO en origen + crear lotes en destino, atómico ───
    const selLotes = sqlite.prepare(
      `SELECT id, saldo, fecha_caducidad AS fechaCaducidad
         FROM caducidad_lote
        WHERE producto_id = ? AND bodega_id = ? AND saldo > 0
        ORDER BY fecha_caducidad ASC, fecha_entrada ASC`
    )
    const updSaldo = sqlite.prepare('UPDATE caducidad_lote SET saldo = ? WHERE id = ?')
    const insLote = sqlite.prepare(
      `INSERT INTO caducidad_lote (id, producto_id, bodega_id, total, saldo, fecha_caducidad, fecha_entrada)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const insMov = sqlite.prepare(
      `INSERT INTO mov_stock (id, lote_id, venta_item_id, tipo, cantidad, fecha, motivo)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`
    )
    const motivoSalida = `TRASPASO ${folio} → bodega ${destino.nombre}`
    const motivoEntrada = `TRASPASO ${folio} desde ${origen.nombre}`

    const lineas: TraspasoLineaFile[] = []
    let unidades = 0

    const run = sqlite.transaction(() => {
      const now = Date.now()
      for (const it of items) {
        const codigo = String(it.codigo).trim()
        const prod = prodByCodigo.get(codigo)!
        let remaining = Math.round(Number(it.cantidad))
        const lotes = selLotes.all(prod.id, origen.id) as Array<{
          id: string
          saldo: number
          fechaCaducidad: number
        }>
        for (const lote of lotes) {
          if (remaining <= 0) break
          const take = Math.min(lote.saldo, remaining)
          updSaldo.run(lote.saldo - take, lote.id)
          insMov.run(randomUUID(), lote.id, 'SALIDA', -take, now, motivoSalida)

          // Lote equivalente en la bodega destino (conserva caducidad).
          const nuevoLoteId = randomUUID()
          insLote.run(nuevoLoteId, prod.id, destino.id, take, take, lote.fechaCaducidad, now)
          insMov.run(randomUUID(), nuevoLoteId, 'ENTRADA', take, now, motivoEntrada)

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

      // Historial: mismo registro que un traspaso a sucursal, con destino BODEGA.
      const numeroTraspaso = (
        sqlite.prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM traspaso').get() as {
          n: number
        }
      ).n
      sqlite
        .prepare(
          `INSERT INTO traspaso
             (folio, numero, fecha, usuario_id, bodega_origen_id, bodega_origen_nombre,
              sucursal_id, sucursal_codigo, sucursal_nombre, destino_tipo,
              lineas, unidades, items_json)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'BODEGA', ?, ?, ?)`
        )
        .run(
          folio,
          numeroTraspaso,
          now,
          viewerUserId,
          origen.id,
          origen.nombre,
          destino.codigo,
          destino.nombre,
          lineas.length,
          unidades,
          JSON.stringify(lineas)
        )
    })

    run()

    const numero = (
      sqlite.prepare('SELECT numero FROM traspaso WHERE folio = ?').get(folio) as {
        numero: number
      }
    ).numero
    return { ok: true, folio, numero, lineas: lineas.length, unidades }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// El historial de traspasos se consulta junto con entradas y salidas en
// services/movimientos.ts (historial unificado de movimientos).

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
  // El id puede venir vacío (destino libre tecleado en la sucursal de origen);
  // el código siempre viaja y es lo que valida el receptor.
  if (!payload.folio || !payload.sucursal?.codigo || !Array.isArray(payload.items)) {
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

// ── DESTINO: previsualizar traspaso (sucursal o matriz) ──────────────────────
export async function pickTraspaso(window: BrowserWindow | null): Promise<PickTraspasoResult> {
  try {
    const instal = getInstalacion()
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
        sucursalCoincide: sucursalCoincide(instal.sucursalActivaId, p.sucursal),
        items: p.items
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── DESTINO: aplicar traspaso (entrada a la bodega destino) ──────────────────
export function aplicarTraspaso(
  viewerUserId: string,
  filePath: string,
  force = false,
  bodegaDestinoId?: string | null
): AplicarTraspasoResult {
  try {
    requireRecibirTraspaso(viewerUserId)
    const instal = getInstalacion()

    const file = leerYValidar(filePath)
    const p = file.payload

    // En sucursal valida que el traspaso sea para ella (por id o código); en
    // matriz no hay sucursal activa → se puede recibir cualquiera.
    if (!force && !sucursalCoincide(instal.sucursalActivaId, p.sucursal)) {
      throw new Error('Este traspaso es para otra sucursal. Verifica el USB correcto.')
    }
    if (yaAplicado(p.folio)) {
      throw new Error(`Este traspaso ya fue aplicado anteriormente (folio ${p.folio.slice(0, 8)}…)`)
    }

    const sqlite = getSqlite()
    const bodegaId = bodegaDestinoId || BODEGA_PRINCIPAL
    const bodega = sqlite
      .prepare('SELECT id, nombre, activa FROM bodega WHERE id = ?')
      .get(bodegaId) as { id: string; nombre: string; activa: number } | undefined
    if (!bodega) throw new Error('Bodega destino no encontrada')
    if (!bodega.activa) throw new Error('La bodega destino está desactivada')

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
      const lineasDoc: MovimientoLinea[] = []
      let valorDoc = 0
      for (const l of p.items) {
        const cantidad = Math.round(Number(l.cantidad))
        if (!Number.isFinite(cantidad) || cantidad <= 0) continue
        const prod = selProd.get(String(l.codigo).trim()) as { id: string } | undefined
        if (!prod) {
          noEncontrados.push(String(l.codigo))
          continue
        }
        const loteId = randomUUID()
        insLote.run(loteId, prod.id, bodega.id, cantidad, cantidad, caducidadToMs(l.caducidad), now)
        insMov.run(randomUUID(), loteId, cantidad, now, motivo)
        lotesCreados++
        unidades += cantidad

        const costo = Number(l.costo) || 0
        lineasDoc.push({
          codigo: String(l.codigo).trim(),
          nombre: l.nombre,
          cantidad,
          costo,
          caducidad: l.caducidad || null,
          proveedor: null
        })
        valorDoc += cantidad * costo
      }

      // Documento ENTRADA en el historial de movimientos: sin esto, los
      // traspasos RECIBIDOS no aparecerían en el reporte de la sucursal
      // (la tabla `traspaso` sólo guarda los generados localmente).
      if (lotesCreados > 0) {
        const usuario = sqlite
          .prepare('SELECT nombre FROM usuario WHERE id = ?')
          .get(viewerUserId) as { nombre: string } | undefined
        const numero = (
          sqlite
            .prepare(
              "SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM movimiento WHERE tipo = 'ENTRADA'"
            )
            .get() as { n: number }
        ).n
        sqlite
          .prepare(
            `INSERT INTO movimiento
               (folio, numero, tipo, fecha, usuario_id, usuario_nombre, bodega_id, bodega_nombre,
                proveedor_id, proveedor_nombre, motivo, lineas, unidades, valor, items_json)
             VALUES (?, ?, 'ENTRADA', ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`
          )
          .run(
            randomUUID(),
            numero,
            now,
            viewerUserId,
            usuario?.nombre ?? null,
            bodega.id,
            bodega.nombre,
            `Traspaso recibido de ${p.bodegaOrigen?.nombre ?? 'matriz'} (${p.folio.slice(0, 8)}…)`,
            lineasDoc.length,
            unidades,
            +valorDoc.toFixed(2),
            JSON.stringify(lineasDoc)
          )
      }
    })

    run()

    // Aplicado con éxito → borrar el archivo del origen (normalmente el USB):
    // evita re-aplicarlo por error y deja la memoria limpia. Best-effort: si
    // el USB está protegido o ya no está conectado, el traspaso queda aplicado
    // igual (el anti-duplicado por folio protege de todos modos).
    let archivoEliminado = false
    try {
      unlinkSync(filePath)
      archivoEliminado = true
    } catch {
      /* sin permisos o USB retirado — no es error */
    }

    return {
      ok: true,
      folio: p.folio,
      lotesCreados,
      unidades,
      noEncontrados: [...new Set(noEncontrados)],
      archivoEliminado
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
