import { BrowserWindow, dialog } from 'electron'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { getSqlite } from '../db/connection'
import type {
  ExportFarmaPayload,
  ExportFarmaStockLote,
  ExportFarmaUsuario,
  ExportSucursalResult
} from '@shared/dto'
import type { IvaModo } from '@shared/types'

/**
 * Exporta los datos que necesita una sucursal en un archivo `.farma` (JSON
 * plano + checksum). Pensado para llevar por USB de la PC matriz a la PC de
 * la sucursal y aplicarse vía "Importar" (Fase 4).
 *
 * Contenido del archivo:
 *   {
 *     tipo: 'MATRIZ_A_SUCURSAL',
 *     version: 1,
 *     generadoEn: ISO,
 *     checksum: SHA256(JSON.stringify(payload)),
 *     payload: {
 *       matriz: { id, propietario },
 *       sucursal: { id, codigo, nombre, razonSocial, rfc, dirección… },
 *       productos: [ … con overrides aplicados, excluidos omitidos … ]
 *     }
 *   }
 *
 * Sólo en modo MATRIZ. Sólo admins.
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

function requireMatriz(): { matrizId: string | null; propietario: string | null } {
  const sqlite = getSqlite()
  const row = sqlite
    .prepare(
      `SELECT tipo,
              matriz_id          AS matrizId,
              propietario_nombre AS propietarioNombre
         FROM instalacion
        WHERE id = 1`
    )
    .get() as
    | { tipo: string; matrizId: string | null; propietarioNombre: string | null }
    | undefined
  if (!row || row.tipo !== 'MATRIZ') {
    throw new Error('La exportación sólo está disponible en modo MATRIZ')
  }
  return { matrizId: row.matrizId, propietario: row.propietarioNombre }
}

function sanitizeFilename(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

function buildPayload(
  sucursalId: string,
  stockInicial?: ExportFarmaStockLote[]
): ExportFarmaPayload {
  const sqlite = getSqlite()

  const matrizMeta = requireMatriz()

  const sucursalRow = sqlite
    .prepare(
      `SELECT id, codigo, nombre,
              razon_social AS razonSocial,
              rfc, calle, colonia, ciudad, estado,
              activa,
              created_at   AS createdAt,
              updated_at   AS updatedAt
         FROM sucursal
        WHERE id = ?`
    )
    .get(sucursalId) as
    | {
        id: string
        codigo: string
        nombre: string
        razonSocial: string | null
        rfc: string | null
        calle: string | null
        colonia: string | null
        ciudad: string | null
        estado: string | null
        activa: number
        createdAt: number
        updatedAt: number
      }
    | undefined
  if (!sucursalRow) throw new Error('Sucursal no encontrada')
  if (!sucursalRow.activa) {
    throw new Error('La sucursal está desactivada — actívala antes de exportar')
  }

  // Productos efectivos: aplica overrides; omite excluidos; sólo activos del global.
  const rows = sqlite
    .prepare(
      `SELECT p.id, p.codigo, p.nombre,
              p.sustancia_activa AS sustanciaActiva,
              p.descripcion, p.laboratorio,
              p.precio           AS precioGlobal,
              p.costo,
              p.iva_porcentaje   AS ivaPorcentajeGlobal,
              p.iva_modo         AS ivaModoGlobal,
              p.stock_maximo     AS stockMaximo,
              p.stock_minimo     AS stockMinimo,
              sp.precio_override AS precioOverride,
              sp.iva_modo_override AS ivaModoOverride,
              sp.iva_porcentaje_override AS ivaPorcentajeOverride,
              sp.excluida AS excluida
         FROM producto p
    LEFT JOIN sucursal_producto sp
           ON sp.producto_id = p.id AND sp.sucursal_id = ?
        WHERE p.activo = 1
          AND (sp.excluida IS NULL OR sp.excluida = 0)
        ORDER BY p.nombre`
    )
    .all(sucursalId) as Array<{
    id: string
    codigo: string
    nombre: string
    sustanciaActiva: string | null
    descripcion: string | null
    laboratorio: string | null
    precioGlobal: number
    costo: number
    ivaPorcentajeGlobal: number
    ivaModoGlobal: string | null
    stockMaximo: number | null
    stockMinimo: number | null
    precioOverride: number | null
    ivaModoOverride: string | null
    ivaPorcentajeOverride: number | null
    excluida: number | null
  }>

  const productos = rows.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    sustanciaActiva: r.sustanciaActiva ?? null,
    descripcion: r.descripcion ?? null,
    laboratorio: r.laboratorio ?? null,
    precio: r.precioOverride != null ? Number(r.precioOverride) : Number(r.precioGlobal) || 0,
    costo: Number(r.costo) || 0,
    ivaModo:
      r.ivaModoOverride != null
        ? normalizeIvaModo(r.ivaModoOverride)
        : normalizeIvaModo(r.ivaModoGlobal),
    ivaPorcentaje:
      r.ivaPorcentajeOverride != null
        ? Number(r.ivaPorcentajeOverride)
        : Number(r.ivaPorcentajeGlobal) || 0,
    stockMaximo: r.stockMaximo == null ? 0 : Number(r.stockMaximo),
    stockMinimo: r.stockMinimo == null ? 0 : Number(r.stockMinimo)
  }))

  // Usuarios admin (ADMINISTRADOR/SUPERUSUARIO activos): viajan para configurar
  // la sucursal con las mismas credenciales. Password va como hash bcrypt.
  const usuarios = sqlite
    .prepare(
      `SELECT u.login, u.nombre, u.password_hash AS passwordHash,
              u.puede_cancelar AS puedeCancelar, t.nombre AS rol
         FROM usuario u
         JOIN tipo_usuario t ON t.id = u.tipo_usuario_id
        WHERE u.activo = 1 AND t.nombre IN ('ADMINISTRADOR', 'SUPERUSUARIO')
        ORDER BY u.login`
    )
    .all() as Array<{
    login: string
    nombre: string
    passwordHash: string
    puedeCancelar: number
    rol: string
  }>

  const usuariosFarma: ExportFarmaUsuario[] = usuarios.map((u) => ({
    login: u.login,
    nombre: u.nombre,
    rol: u.rol,
    passwordHash: u.passwordHash,
    puedeCancelar: Boolean(u.puedeCancelar)
  }))

  return {
    matriz: {
      id: matrizMeta.matrizId,
      propietario: matrizMeta.propietario
    },
    sucursal: {
      id: sucursalRow.id,
      codigo: sucursalRow.codigo,
      nombre: sucursalRow.nombre,
      razonSocial: sucursalRow.razonSocial,
      rfc: sucursalRow.rfc,
      calle: sucursalRow.calle,
      colonia: sucursalRow.colonia,
      ciudad: sucursalRow.ciudad,
      estado: sucursalRow.estado
    },
    productos,
    ...(stockInicial && stockInicial.length > 0 ? { stockInicial } : {}),
    ...(usuariosFarma.length > 0 ? { usuarios: usuariosFarma } : {})
  }
}

export async function exportarSucursalAFarma(
  viewerUserId: string,
  sucursalId: string,
  window: BrowserWindow | null,
  stockInicial?: ExportFarmaStockLote[]
): Promise<ExportSucursalResult> {
  requireAdmin(viewerUserId)
  requireMatriz()

  try {
    const payload = buildPayload(sucursalId, stockInicial)

    // Hash sobre JSON serializado del payload — los lectores que validen
    // deben re-serializar el payload con las mismas keys/orden (lo controlamos
    // construyendo objetos en orden consistente).
    const payloadText = JSON.stringify(payload)
    const checksum = createHash('sha256').update(payloadText).digest('hex')

    // v2 cuando trae stock inicial (la sucursal sabrá aplicarlo); v1 si no.
    const fileObject = {
      tipo: 'MATRIZ_A_SUCURSAL' as const,
      version: payload.stockInicial && payload.stockInicial.length > 0 ? 2 : 1,
      generadoEn: new Date().toISOString(),
      checksum,
      payload
    }

    // Nombre sugerido: farmacias-{codigo}-{nombre}-{YYYYMMDD-HHMM}.farma
    const d = new Date()
    const stamp = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('') +
      '-' +
      [String(d.getHours()).padStart(2, '0'), String(d.getMinutes()).padStart(2, '0')].join('')

    const baseName = sanitizeFilename(`${payload.sucursal.codigo}-${payload.sucursal.nombre}`)
    const defaultPath = `farmacias-${baseName}-${stamp}.farma`

    const opts = {
      title: `Exportar a sucursal "${payload.sucursal.nombre}"`,
      defaultPath,
      filters: [
        { name: 'Archivo .farma', extensions: ['farma'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    }
    const dlg = window ? await dialog.showSaveDialog(window, opts) : await dialog.showSaveDialog(opts)

    if (dlg.canceled || !dlg.filePath) {
      return { ok: false, cancelled: true }
    }

    const json = JSON.stringify(fileObject, null, 2)
    writeFileSync(dlg.filePath, json, 'utf8')

    return {
      ok: true,
      path: dlg.filePath,
      productosCount: payload.productos.length,
      stockLineas: payload.stockInicial?.length ?? 0,
      bytes: Buffer.byteLength(json, 'utf8'),
      generadoEn: fileObject.generadoEn,
      checksum
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
