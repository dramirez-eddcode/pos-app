import { BrowserWindow, dialog } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { getSqlite } from '../db/connection'
import { cargaInicialInventario } from './cargaInicial'
import type {
  ApplyFarmaResult,
  ExportFarmaPayload,
  FarmaFile,
  ImportFarmaPreview,
  PickFarmaResult
} from '@shared/dto'
import type { IvaModo } from '@shared/types'

/**
 * Import del archivo `.farma` generado por una matriz (Fase 3) en una PC en
 * modo SUCURSAL. Flujo de dos pasos:
 *
 *   1. pickFarma()  — abre dialog, lee archivo, valida estructura y checksum,
 *                     devuelve preview sin aplicar nada.
 *   2. applyFarma(filePath) — re-lee + re-valida + aplica en transacción:
 *        a) actualiza/crea sucursal local (id viene del payload — primera
 *           importación adopta ese id; subsecuentes deben coincidir).
 *        b) sincroniza empresa (header del ticket).
 *        c) upsert productos por código (mantiene productos locales que no
 *           estén en el .farma).
 *        d) escribe `instalacion.ultimo_import_en`.
 *
 * Validaciones de seguridad:
 *   - Sólo modo SUCURSAL.
 *   - Sólo ADMINISTRADOR/SUPERUSUARIO.
 *   - Tipo + version del archivo deben matchear.
 *   - Checksum SHA-256 recalculado y comparado (anti-tamper).
 *   - sucursal.id del .farma debe coincidir con el local (excepto primera vez).
 */

const VALID_IVA_MODOS: readonly IvaModo[] = ['exento', 'sumar', 'incluido'] as const

function normalizeIvaModo(raw: unknown): IvaModo {
  return VALID_IVA_MODOS.includes(raw as IvaModo) ? (raw as IvaModo) : 'exento'
}

function rolOf(userId: string): string | null {
  const sqlite = getSqlite()
  const row = sqlite
    .prepare(
      `SELECT t.nombre
         FROM usuario u
         JOIN tipo_usuario t ON t.id = u.tipo_usuario_id
        WHERE u.id = ?`
    )
    .get(userId) as { nombre: string } | undefined
  return row?.nombre ?? null
}

function requireAdmin(viewerUserId: string): void {
  const rol = rolOf(viewerUserId)
  if (!rol) throw new Error('Usuario no identificado')
  if (rol !== 'ADMINISTRADOR' && rol !== 'SUPERUSUARIO') {
    throw new Error('Requiere permisos de administrador')
  }
}

interface InstalacionRow {
  tipo: string
  sucursalActivaId: string | null
  ultimoImportEn: number | null
}

function getInstalacionRow(): InstalacionRow {
  const sqlite = getSqlite()
  const row = sqlite
    .prepare(
      `SELECT tipo,
              sucursal_activa_id AS sucursalActivaId,
              ultimo_import_en   AS ultimoImportEn
         FROM instalacion
        WHERE id = 1`
    )
    .get() as InstalacionRow | undefined
  if (!row) throw new Error('Instalación no configurada')
  return row
}

function requireSucursal(): InstalacionRow {
  const row = getInstalacionRow()
  if (row.tipo !== 'SUCURSAL') {
    throw new Error('El import sólo está disponible en modo SUCURSAL')
  }
  return row
}

/**
 * Parsea + valida un archivo `.farma`. Lanza Error con mensaje legible si algo
 * no checa. Devuelve el objeto completo si todo OK.
 */
function readAndValidateFarma(filePath: string): FarmaFile {
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

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('El archivo está vacío o malformado')
  }
  const obj = parsed as Record<string, unknown>

  if (obj['tipo'] !== 'MATRIZ_A_SUCURSAL') {
    throw new Error(`Tipo de archivo inválido (esperaba MATRIZ_A_SUCURSAL, recibí "${String(obj['tipo'])}")`)
  }
  if (obj['version'] !== 1 && obj['version'] !== 2) {
    throw new Error(`Versión de archivo no soportada: ${String(obj['version'])}. Actualiza el POS.`)
  }
  if (typeof obj['checksum'] !== 'string' || obj['checksum'].length === 0) {
    throw new Error('Archivo sin checksum')
  }
  if (!obj['payload'] || typeof obj['payload'] !== 'object') {
    throw new Error('Archivo sin payload')
  }

  const payload = obj['payload'] as ExportFarmaPayload

  // Re-calcular checksum y comparar
  const expected = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  if (expected !== obj['checksum']) {
    throw new Error(
      'Checksum inválido — el archivo está corrupto o fue modificado después de generarse'
    )
  }

  // Sanity checks del payload
  if (!payload.sucursal || typeof payload.sucursal !== 'object') {
    throw new Error('Payload sin datos de sucursal')
  }
  if (!payload.sucursal.id || !payload.sucursal.codigo || !payload.sucursal.nombre) {
    throw new Error('Datos de sucursal incompletos')
  }
  if (!Array.isArray(payload.productos)) {
    throw new Error('Payload sin lista de productos')
  }

  return obj as unknown as FarmaFile
}

export async function pickFarma(window: BrowserWindow | null): Promise<PickFarmaResult> {
  try {
    const result = window
      ? await dialog.showOpenDialog(window, {
          title: 'Seleccionar archivo .farma',
          properties: ['openFile'],
          filters: [
            { name: 'Archivo .farma', extensions: ['farma'] },
            { name: 'JSON', extensions: ['json'] },
            { name: 'Todos', extensions: ['*'] }
          ]
        })
      : await dialog.showOpenDialog({
          title: 'Seleccionar archivo .farma',
          properties: ['openFile'],
          filters: [{ name: 'Archivo .farma', extensions: ['farma'] }]
        })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, cancelled: true }
    }

    const filePath = result.filePaths[0]!
    const file = readAndValidateFarma(filePath)

    // Verifica que aplique a esta sucursal
    const local = getInstalacionRow()
    let aplicaA: 'NUEVA' | 'COINCIDE' | 'DISTINTA' = 'NUEVA'
    let sucursalLocalActual: { codigo: string; nombre: string } | null = null
    if (local.sucursalActivaId) {
      if (local.sucursalActivaId === file.payload.sucursal.id) {
        aplicaA = 'COINCIDE'
      } else {
        aplicaA = 'DISTINTA'
        // Obtén nombre actual para mensaje claro
        const cur = getSqlite()
          .prepare('SELECT codigo, nombre FROM sucursal WHERE id = ?')
          .get(local.sucursalActivaId) as { codigo: string; nombre: string } | undefined
        if (cur) sucursalLocalActual = cur
      }
    }

    const preview: ImportFarmaPreview = {
      filePath,
      tipo: file.tipo,
      version: file.version,
      generadoEn: file.generadoEn,
      checksum: file.checksum,
      matriz: {
        id: file.payload.matriz.id ?? null,
        propietario: file.payload.matriz.propietario ?? null
      },
      sucursal: {
        id: file.payload.sucursal.id,
        codigo: file.payload.sucursal.codigo,
        nombre: file.payload.sucursal.nombre,
        razonSocial: file.payload.sucursal.razonSocial ?? null,
        rfc: file.payload.sucursal.rfc ?? null
      },
      productosCount: file.payload.productos.length,
      aplicaA,
      sucursalLocalActual,
      modoLocal: local.tipo,
      ultimoImportLocalEn:
        local.ultimoImportEn != null ? new Date(local.ultimoImportEn).toISOString() : null
    }

    return { ok: true, preview }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Aplica un `.farma` previamente seleccionado. Recibe el `filePath` (re-lee y
 * re-valida) y `force` para permitir importar a una sucursal distinta (caso
 * borde: cambio de id de sucursal en matriz).
 */
export function applyFarma(
  viewerUserId: string,
  filePath: string,
  options: { force?: boolean } = {}
): ApplyFarmaResult {
  requireAdmin(viewerUserId)
  const local = requireSucursal()

  let file: FarmaFile
  try {
    file = readAndValidateFarma(filePath)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const payload = file.payload

  // Coincidencia de sucursal
  if (local.sucursalActivaId && local.sucursalActivaId !== payload.sucursal.id && !options.force) {
    return {
      ok: false,
      requiresForce: true,
      error:
        'Este archivo es de una sucursal distinta a la configurada en esta computadora. ' +
        'Verifica que sea el USB correcto antes de continuar.'
    }
  }

  const sqlite = getSqlite()
  const isFirstImport = !local.sucursalActivaId
  const isSucursalSwitch = Boolean(
    local.sucursalActivaId && local.sucursalActivaId !== payload.sucursal.id
  )

  const run = sqlite.transaction(() => {
    const now = Date.now()
    let productosCreados = 0
    let productosActualizados = 0

    // ── 1. Sucursal local (1 fila) ─────────────────────────────────────────
    if (isFirstImport || isSucursalSwitch) {
      // Reemplaza completamente la fila local con la del payload
      sqlite.prepare('DELETE FROM sucursal').run()
    }
    sqlite
      .prepare(
        `INSERT INTO sucursal
           (id, codigo, nombre, razon_social, rfc, calle, colonia, ciudad, estado,
            activa, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           codigo = excluded.codigo,
           nombre = excluded.nombre,
           razon_social = excluded.razon_social,
           rfc = excluded.rfc,
           calle = excluded.calle,
           colonia = excluded.colonia,
           ciudad = excluded.ciudad,
           estado = excluded.estado,
           updated_at = excluded.updated_at`
      )
      .run(
        payload.sucursal.id,
        payload.sucursal.codigo,
        payload.sucursal.nombre,
        payload.sucursal.razonSocial ?? null,
        payload.sucursal.rfc ?? null,
        payload.sucursal.calle ?? null,
        payload.sucursal.colonia ?? null,
        payload.sucursal.ciudad ?? null,
        payload.sucursal.estado ?? null,
        now,
        now
      )

    // ── 2. Empresa (header del ticket) — mirror de sucursal ────────────────
    sqlite.prepare('DELETE FROM empresa').run()
    sqlite
      .prepare(
        `INSERT INTO empresa
           (id, nombre_comercial, razon_social, rfc, calle, colonia, ciudad, estado,
            sucursal_nombre, owner_user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        payload.sucursal.id,
        payload.sucursal.razonSocial ?? payload.sucursal.nombre,
        payload.sucursal.razonSocial ?? payload.sucursal.nombre,
        payload.sucursal.rfc ?? null,
        payload.sucursal.calle ?? null,
        payload.sucursal.colonia ?? null,
        payload.sucursal.ciudad ?? null,
        payload.sucursal.estado ?? null,
        payload.sucursal.nombre,
        now
      )

    // ── 3. Instalación: registra sucursal activa + último import ───────────
    sqlite
      .prepare(
        `UPDATE instalacion
            SET sucursal_activa_id = ?,
                ultimo_import_en = ?
          WHERE id = 1`
      )
      .run(payload.sucursal.id, now)

    // ── 4. Productos: upsert por código ───────────────────────────────────
    const selByCodigo = sqlite.prepare('SELECT id FROM producto WHERE codigo = ?')
    const insProd = sqlite.prepare(
      `INSERT INTO producto
         (id, codigo, nombre, sustancia_activa, descripcion, laboratorio,
          precio, costo, iva_porcentaje, iva_modo,
          stock_maximo, stock_minimo, activo, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
    const updProd = sqlite.prepare(
      `UPDATE producto SET
         nombre = ?,
         sustancia_activa = ?,
         descripcion = ?,
         laboratorio = ?,
         precio = ?,
         costo = ?,
         iva_porcentaje = ?,
         iva_modo = ?,
         stock_maximo = ?,
         stock_minimo = ?,
         activo = 1,
         updated_at = ?
       WHERE id = ?`
    )

    for (const p of payload.productos) {
      const existente = selByCodigo.get(p.codigo) as { id: string } | undefined
      const ivaModo = normalizeIvaModo(p.ivaModo)
      const precio = Number.isFinite(p.precio) ? Number(p.precio) : 0
      const costo = Number.isFinite(p.costo) ? Number(p.costo) : 0
      const ivaPorcentaje =
        ivaModo === 'exento' ? 0 : Math.max(0, Math.min(100, Math.round(Number(p.ivaPorcentaje) || 0)))
      const stockMaximo = Number.isFinite(p.stockMaximo) ? Math.trunc(Number(p.stockMaximo)) : 0
      const stockMinimo = Number.isFinite(p.stockMinimo) ? Math.trunc(Number(p.stockMinimo)) : 0

      if (existente) {
        updProd.run(
          p.nombre,
          p.sustanciaActiva ?? null,
          p.descripcion ?? null,
          p.laboratorio ?? null,
          precio,
          costo,
          ivaPorcentaje,
          ivaModo,
          stockMaximo,
          stockMinimo,
          now,
          existente.id
        )
        productosActualizados++
      } else {
        // Usa el id del payload si está disponible para mantener coherencia
        // con matriz; si choca con otro local (poco probable), regenera.
        const id =
          p.id && !(sqlite.prepare('SELECT 1 FROM producto WHERE id = ?').get(p.id) as unknown)
            ? p.id
            : randomUUID()
        insProd.run(
          id,
          p.codigo,
          p.nombre,
          p.sustanciaActiva ?? null,
          p.descripcion ?? null,
          p.laboratorio ?? null,
          precio,
          costo,
          ivaPorcentaje,
          ivaModo,
          stockMaximo,
          stockMinimo,
          now
        )
        productosCreados++
      }
    }

    // ── 5. Stock inicial (solo en la PRIMERA importación de la sucursal) ────
    // Viene en archivos v2 generados al migrar desde el legacy. En reimports
    // posteriores (actualizaciones de catálogo/precio) NO se vuelve a aplicar,
    // para no pisar el stock ya operado.
    let stockLotes = 0
    if (isFirstImport && Array.isArray(payload.stockInicial) && payload.stockInicial.length > 0) {
      const r = cargaInicialInventario({
        usuarioId: viewerUserId,
        bodegaId: 'bodega-principal',
        items: payload.stockInicial.map((s) => ({
          codigo: s.codigo,
          cantidad: s.cantidad,
          fechaCaducidad: s.caducidad
        }))
      })
      stockLotes = r.lotesCreados + r.lotesActualizados
    }

    return { productosCreados, productosActualizados, stockLotes }
  })

  const stats = run()
  return {
    ok: true,
    sucursal: {
      id: payload.sucursal.id,
      codigo: payload.sucursal.codigo,
      nombre: payload.sucursal.nombre
    },
    productosCreados: stats.productosCreados,
    productosActualizados: stats.productosActualizados,
    stockLotes: stats.stockLotes,
    generadoEn: file.generadoEn,
    sucursalCambiada: isSucursalSwitch,
    primeraImport: isFirstImport
  }
}
