import { BrowserWindow, dialog } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import { getSqlite } from '../db/connection'
import { cargaInicialInventario } from './cargaInicial'
import type {
  BootstrapStateDto,
  CompleteWizardFromFarmaInput,
  CompleteWizardFromFarmaResult,
  CompleteWizardInput,
  ExistingAdminOption,
  FarmaFile,
  InstalacionDto,
  InstalacionTipo,
  PickWizardFarmaResult,
  SessionUser
} from '@shared/dto'

/**
 * Servicio del primer arranque y modo de instalación.
 *
 * El POS arranca en 1 de 2 modos:
 *   - MATRIZ: gestiona N sucursales, productos globales, precios y exports.
 *     No vende ni hace cortes.
 *   - SUCURSAL: POS clásico para una farmacia. Recibe imports de matriz.
 *
 * Hasta que `instalacion.configuredAt IS NOT NULL`, la app muestra el wizard
 * y bloquea todo lo demás. El wizard:
 *   1. Pide modo
 *   2. Pide nombre del propietario / datos sucursal (según modo)
 *   3. Pide credenciales del primer admin (SUPERUSUARIO)
 *
 * Esta operación es transaccional — si algo falla, no queda estado parcial.
 */

const VALID_TIPOS: readonly InstalacionTipo[] = ['MATRIZ', 'SUCURSAL']

/**
 * Devuelve el estado actual de la primer ejecución: si la instalación ya está
 * configurada, y si la DB ya trae usuarios admin/superusuario de una migración
 * previa (caso dev con farmacias-santajulia.db o sucursal con backup restaurado).
 * El wizard usa esto para mostrar la opción "Usar usuario existente".
 */
export function getBootstrapState(): BootstrapStateDto {
  const sqlite = getSqlite()
  const adminRows = sqlite
    .prepare(
      `SELECT u.id, u.login, u.nombre, t.nombre AS rol
         FROM usuario u
         JOIN tipo_usuario t ON t.id = u.tipo_usuario_id
        WHERE u.activo = 1
          AND t.nombre IN ('ADMINISTRADOR', 'SUPERUSUARIO')
        ORDER BY CASE t.nombre
                   WHEN 'SUPERUSUARIO' THEN 1
                   WHEN 'ADMINISTRADOR' THEN 2
                   ELSE 3 END, u.login`
    )
    .all() as ExistingAdminOption[]

  const total = (sqlite.prepare('SELECT COUNT(*) AS n FROM usuario').get() as { n: number }).n

  return {
    instalacion: getInstalacion(),
    existingAdmins: adminRows,
    totalUsuarios: total
  }
}

export function getInstalacion(): InstalacionDto {
  const sqlite = getSqlite()
  const row = sqlite
    .prepare(
      `SELECT id, tipo,
              sucursal_activa_id AS sucursalActivaId,
              matriz_id          AS matrizId,
              propietario_nombre AS propietarioNombre,
              configured_at      AS configuredAt,
              schema_version     AS schemaVersion
         FROM instalacion
        WHERE id = 1`
    )
    .get() as
    | {
        id: number
        tipo: string | null
        sucursalActivaId: string | null
        matrizId: string | null
        propietarioNombre: string | null
        configuredAt: number | null
        schemaVersion: number
      }
    | undefined

  if (!row || !row.configuredAt) {
    return { configured: false }
  }

  return {
    configured: true,
    tipo: (row.tipo as InstalacionTipo) ?? 'SUCURSAL',
    sucursalActivaId: row.sucursalActivaId,
    matrizId: row.matrizId,
    propietarioNombre: row.propietarioNombre,
    configuredAt: new Date(row.configuredAt).toISOString(),
    schemaVersion: row.schemaVersion ?? 1
  }
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value == null) return null
  const t = String(value).trim()
  return t.length === 0 ? null : t
}

function requireField(label: string, value: string | undefined | null): string {
  const t = (value ?? '').trim()
  if (!t) throw new Error(`Campo requerido: ${label}`)
  return t
}

/**
 * Completa el wizard de instalación. Crea:
 *   - fila en `instalacion` con tipo + configuredAt
 *   - en SUCURSAL: 1 fila en `sucursal` + 1 fila en `empresa` (mirror para ticket)
 *   - en MATRIZ: ninguna sucursal aún (admin las creará desde el panel)
 *   - usuario SUPERUSUARIO con login + password indicados
 */
export function completeWizard(input: CompleteWizardInput): {
  ok: true
  user: SessionUser
} {
  if (!VALID_TIPOS.includes(input.tipo)) {
    throw new Error(`Tipo de instalación inválido: ${input.tipo}`)
  }

  const propietario = requireField('Nombre del propietario', input.propietarioNombre)

  const sqlite = getSqlite()
  const existing = getInstalacion()
  if (existing.configured) {
    throw new Error('La instalación ya está configurada')
  }

  // Validación de identidad admin: o se elige un usuario existente, o se crea uno nuevo.
  const useExisting = (input.useExistingUserId ?? '').trim() || null

  let adminLoginFinal: string | null = null
  let adminNombreFinal: string | null = null
  if (useExisting) {
    const existingUser = sqlite
      .prepare(
        `SELECT u.id, u.login, u.nombre, t.nombre AS rol
           FROM usuario u
           JOIN tipo_usuario t ON t.id = u.tipo_usuario_id
          WHERE u.id = ? AND u.activo = 1`
      )
      .get(useExisting) as { id: string; login: string; nombre: string; rol: string } | undefined
    if (!existingUser) throw new Error('Usuario seleccionado no existe o está inactivo')
    if (existingUser.rol !== 'ADMINISTRADOR' && existingUser.rol !== 'SUPERUSUARIO') {
      throw new Error('El usuario elegido debe ser ADMINISTRADOR o SUPERUSUARIO')
    }
    adminLoginFinal = existingUser.login
    adminNombreFinal = existingUser.nombre
  } else {
    adminLoginFinal = requireField('Login del admin', input.adminLogin).toLowerCase()
    if (!/^[a-z0-9._-]+$/i.test(adminLoginFinal)) {
      throw new Error('El login solo puede tener letras, números y . _ -')
    }
    adminNombreFinal = requireField('Nombre del admin', input.adminNombre)
    const pwd = input.adminPassword ?? ''
    if (pwd.length < 3) throw new Error('Password muy corto (mínimo 3 caracteres)')
  }

  const sucursalNombre =
    input.tipo === 'SUCURSAL' ? requireField('Nombre de sucursal', input.sucursalNombre) : null
  const sucursalCodigo =
    input.tipo === 'SUCURSAL' ? requireField('Código sucursal', input.sucursalCodigo) : null

  const run = sqlite.transaction(() => {
    const now = Date.now()
    const matrizId = input.tipo === 'MATRIZ' ? randomUUID() : null
    let sucursalId: string | null = null

    let adminId: string

    if (useExisting) {
      // Reutiliza el usuario existente. No toca su password ni rol.
      adminId = useExisting
    } else {
      // ── crea usuario admin nuevo ────────────────────────────────────────
      const superRol = sqlite
        .prepare(`SELECT id FROM tipo_usuario WHERE nombre = 'SUPERUSUARIO'`)
        .get() as { id: number } | undefined
      if (!superRol) throw new Error('Rol SUPERUSUARIO no encontrado (seed roto)')

      const dupe = sqlite.prepare('SELECT 1 FROM usuario WHERE login = ?').get(adminLoginFinal!)
      if (dupe) {
        throw new Error(
          `El login "${adminLoginFinal}" ya existe. Usa la opción "Usar usuario existente" o elige otro login.`
        )
      }

      adminId = randomUUID()
      sqlite
        .prepare(
          `INSERT INTO usuario
             (id, login, password_hash, nombre, tipo_usuario_id, activo, puede_cancelar, created_at)
           VALUES (?, ?, ?, ?, ?, 1, 1, ?)`
        )
        .run(
          adminId,
          adminLoginFinal!,
          bcrypt.hashSync(input.adminPassword!, 10),
          adminNombreFinal!,
          superRol.id,
          now
        )
    }

    // ── sucursal + empresa (sólo SUCURSAL) ────────────────────────────────
    if (input.tipo === 'SUCURSAL') {
      sucursalId = randomUUID()
      sqlite
        .prepare(
          `INSERT INTO sucursal
             (id, codigo, nombre, razon_social, rfc, calle, colonia, cp, ciudad, estado,
              activa, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(
          sucursalId,
          sucursalCodigo!,
          sucursalNombre!,
          trimOrNull(input.razonSocial),
          trimOrNull(input.rfc),
          trimOrNull(input.calle),
          trimOrNull(input.colonia),
          trimOrNull(input.cp),
          trimOrNull(input.ciudad),
          trimOrNull(input.estado),
          now,
          now
        )

      // empresa (mirror para ticket) — usa los mismos datos
      sqlite
        .prepare(
          `INSERT INTO empresa
             (id, nombre_comercial, razon_social, rfc, calle, colonia, cp, ciudad, estado,
              sucursal_nombre, owner_user_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sucursalId,
          trimOrNull(input.razonSocial) ?? sucursalNombre!,
          trimOrNull(input.razonSocial) ?? sucursalNombre!,
          trimOrNull(input.rfc),
          trimOrNull(input.calle),
          trimOrNull(input.colonia),
          trimOrNull(input.cp),
          trimOrNull(input.ciudad),
          trimOrNull(input.estado),
          sucursalNombre!,
          adminId,
          now
        )
    }

    // ── instalacion ────────────────────────────────────────────────────────
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO instalacion
           (id, tipo, sucursal_activa_id, matriz_id, propietario_nombre,
            configured_at, schema_version)
         VALUES (1, ?, ?, ?, ?, ?, 1)`
      )
      .run(input.tipo, sucursalId, matrizId, propietario, now)

    return { adminId, sucursalId }
  })

  const created = run()

  // Construir SessionUser para login inmediato post-wizard
  const sucursalRow =
    input.tipo === 'SUCURSAL' && created.sucursalId
      ? (sqlite
          .prepare(
            `SELECT id, nombre_comercial AS nombreComercial, razon_social AS razonSocial,
                    rfc, calle, colonia, cp, ciudad, estado, sucursal_nombre AS sucursalNombre
               FROM empresa WHERE id = ?`
          )
          .get(created.sucursalId) as
          | {
              id: string
              nombreComercial: string
              razonSocial: string
              rfc: string | null
              calle: string | null
              colonia: string | null
              cp: string | null
              ciudad: string | null
              estado: string | null
              sucursalNombre: string
            }
          | undefined)
      : undefined

  // Lee el usuario admin (recién creado o existente) para construir SessionUser
  const adminRow = sqlite
    .prepare(
      `SELECT u.id, u.login, u.nombre, u.tipo_usuario_id AS tipoUsuarioId,
              u.puede_cancelar AS puedeCancelar,
              t.nombre AS rol
         FROM usuario u
         JOIN tipo_usuario t ON t.id = u.tipo_usuario_id
        WHERE u.id = ?`
    )
    .get(created.adminId) as
    | {
        id: string
        login: string
        nombre: string
        tipoUsuarioId: number
        puedeCancelar: number
        rol: string
      }
    | undefined
  if (!adminRow) throw new Error('No se pudo recuperar el admin tras configurar instalación')

  const user: SessionUser = {
    id: adminRow.id,
    login: adminRow.login,
    nombre: adminRow.nombre,
    tipoUsuarioId: adminRow.tipoUsuarioId,
    rol: adminRow.rol,
    puedeCancelar: Boolean(adminRow.puedeCancelar),
    sucursal: sucursalRow
      ? {
          id: sucursalRow.id,
          nombreComercial: sucursalRow.nombreComercial,
          razonSocial: sucursalRow.razonSocial,
          rfc: sucursalRow.rfc,
          calle: sucursalRow.calle,
          colonia: sucursalRow.colonia,
          cp: sucursalRow.cp,
          ciudad: sucursalRow.ciudad,
          estado: sucursalRow.estado,
          sucursalNombre: sucursalRow.sucursalNombre
        }
      : null
  }

  return { ok: true, user }
}

// ── Wizard desde archivo .farma (USB de la matriz) ──────────────────────────

/** Lee y valida un .farma (tipo, versión, checksum). Lanza Error si algo falla. */
function leerFarma(filePath: string): FarmaFile {
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
  if (obj?.['tipo'] !== 'MATRIZ_A_SUCURSAL') {
    throw new Error('Tipo de archivo inválido (no es un .farma de matriz)')
  }
  if (obj['version'] !== 1 && obj['version'] !== 2) {
    throw new Error(`Versión de archivo no soportada: ${String(obj['version'])}`)
  }
  if (typeof obj['checksum'] !== 'string' || !obj['payload']) {
    throw new Error('Archivo incompleto (sin checksum o payload)')
  }
  const payload = obj['payload']
  const expected = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  if (expected !== obj['checksum']) {
    throw new Error('Checksum inválido — el archivo está corrupto o fue modificado')
  }
  return obj as unknown as FarmaFile
}

/** Abre diálogo, valida el .farma y devuelve un preview para el wizard. */
export async function pickWizardFarma(
  window: BrowserWindow | null
): Promise<PickWizardFarmaResult> {
  try {
    const opts = {
      title: 'Seleccionar archivo .farma de la matriz',
      properties: ['openFile' as const],
      filters: [
        { name: 'Archivo .farma', extensions: ['farma'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    }
    const res = window ? await dialog.showOpenDialog(window, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return { ok: false, cancelled: true }

    const filePath = res.filePaths[0]!
    const file = leerFarma(filePath)
    const p = file.payload
    return {
      ok: true,
      preview: {
        filePath,
        generadoEn: file.generadoEn,
        matrizPropietario: p.matriz?.propietario ?? null,
        sucursal: {
          id: p.sucursal.id,
          codigo: p.sucursal.codigo,
          nombre: p.sucursal.nombre,
          razonSocial: p.sucursal.razonSocial ?? null,
          rfc: p.sucursal.rfc ?? null
        },
        productosCount: p.productos?.length ?? 0,
        stockLotes: p.stockInicial?.length ?? 0,
        usuarios: (p.usuarios ?? []).map((u) => ({
          login: u.login,
          nombre: u.nombre,
          rol: u.rol
        }))
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Configura una SUCURSAL desde un .farma: crea instalación, sucursal+empresa,
 * catálogo, precios y stock inicial. El archivo solo trae los datos básicos de
 * la sucursal — el primer admin (SUPERUSUARIO) se crea con las credenciales
 * capturadas en el wizard. Compatibilidad: si el archivo es de una versión
 * anterior y trae usuarios (hash de la matriz), se usan esos en su lugar.
 */
export function completeWizardFromFarma(
  input: CompleteWizardFromFarmaInput
): CompleteWizardFromFarmaResult {
  const propietario = requireField('Nombre del propietario', input.propietarioNombre)
  const sqlite = getSqlite()
  if (getInstalacion().configured) throw new Error('La instalación ya está configurada')

  const file = leerFarma(input.filePath)
  const p = file.payload
  const usuarios = p.usuarios ?? []

  // Sin usuarios en el archivo (los .farma actuales): el admin se crea aquí.
  let adminNuevo: { login: string; nombre: string; password: string } | null = null
  if (usuarios.length === 0) {
    const login = requireField('Login del admin', input.adminLogin).toLowerCase()
    if (!/^[a-z0-9._-]+$/i.test(login)) {
      throw new Error('El login solo puede tener letras, números y . _ -')
    }
    const nombre = requireField('Nombre del admin', input.adminNombre)
    const password = input.adminPassword ?? ''
    if (password.length < 3) throw new Error('Password muy corto (mínimo 3 caracteres)')
    adminNuevo = { login, nombre, password }
  }

  const run = sqlite.transaction(() => {
    const now = Date.now()

    // Roles por nombre
    const rolIdByName = new Map<string, number>()
    for (const r of sqlite.prepare('SELECT id, nombre FROM tipo_usuario').all() as Array<{
      id: number
      nombre: string
    }>) {
      rolIdByName.set(r.nombre, r.id)
    }
    const fallbackRol = rolIdByName.get('ADMINISTRADOR') ?? rolIdByName.get('SUPERUSUARIO')
    if (!fallbackRol) throw new Error('Roles base no encontrados (seed roto)')

    // ── Primer admin ──────────────────────────────────────────────────────────
    const insUser = sqlite.prepare(
      `INSERT INTO usuario
         (id, login, password_hash, nombre, tipo_usuario_id, activo, puede_cancelar, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    let ownerId: string | null = null
    let usuariosCreados = 0
    if (adminNuevo) {
      // Caso actual: el archivo no trae usuarios; se crea el SUPERUSUARIO capturado.
      const superRolId = rolIdByName.get('SUPERUSUARIO') ?? fallbackRol
      if (sqlite.prepare('SELECT 1 FROM usuario WHERE login = ?').get(adminNuevo.login)) {
        throw new Error(`El login "${adminNuevo.login}" ya existe en esta base de datos`)
      }
      ownerId = randomUUID()
      insUser.run(
        ownerId,
        adminNuevo.login,
        bcrypt.hashSync(adminNuevo.password, 10),
        adminNuevo.nombre,
        superRolId,
        1,
        now
      )
      usuariosCreados = 1
    } else {
      // Legado: archivos viejos con usuarios admin de la matriz (hash bcrypt).
      for (const u of usuarios) {
        const login = u.login.trim().toLowerCase()
        if (!login) continue
        if (sqlite.prepare('SELECT 1 FROM usuario WHERE login = ?').get(login)) continue
        const id = randomUUID()
        const tipoId = rolIdByName.get(u.rol) ?? fallbackRol
        insUser.run(id, login, u.passwordHash, u.nombre, tipoId, u.puedeCancelar ? 1 : 0, now)
        if (!ownerId) ownerId = id
        usuariosCreados++
      }
      if (!ownerId) throw new Error('No se pudo crear ningún usuario admin del archivo')
    }

    // ── Sucursal + empresa ────────────────────────────────────────────────────
    const sucursalId = randomUUID()
    sqlite
      .prepare(
        `INSERT INTO sucursal
           (id, codigo, nombre, razon_social, rfc, calle, colonia, cp, ciudad, estado,
            activa, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        sucursalId,
        p.sucursal.codigo,
        p.sucursal.nombre,
        p.sucursal.razonSocial ?? null,
        p.sucursal.rfc ?? null,
        p.sucursal.calle ?? null,
        p.sucursal.colonia ?? null,
        p.sucursal.cp ?? null,
        p.sucursal.ciudad ?? null,
        p.sucursal.estado ?? null,
        now,
        now
      )
    sqlite
      .prepare(
        `INSERT INTO empresa
           (id, nombre_comercial, razon_social, rfc, calle, colonia, cp, ciudad, estado,
            sucursal_nombre, owner_user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sucursalId,
        p.sucursal.razonSocial ?? p.sucursal.nombre,
        p.sucursal.razonSocial ?? p.sucursal.nombre,
        p.sucursal.rfc ?? null,
        p.sucursal.calle ?? null,
        p.sucursal.colonia ?? null,
        p.sucursal.cp ?? null,
        p.sucursal.ciudad ?? null,
        p.sucursal.estado ?? null,
        p.sucursal.nombre,
        ownerId,
        now
      )

    // ── Catálogo (DB nueva → solo INSERT) ─────────────────────────────────────
    const insProd = sqlite.prepare(
      `INSERT INTO producto
         (id, codigo, nombre, sustancia_activa, descripcion, laboratorio,
          precio, costo, iva_porcentaje, iva_modo, stock_maximo, stock_minimo,
          activo, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
    let productos = 0
    for (const pr of p.productos ?? []) {
      insProd.run(
        pr.id || randomUUID(),
        pr.codigo,
        pr.nombre,
        pr.sustanciaActiva ?? null,
        pr.descripcion ?? null,
        pr.laboratorio ?? null,
        Number(pr.precio) || 0,
        Number(pr.costo) || 0,
        Number(pr.ivaPorcentaje) || 0,
        pr.ivaModo,
        Number(pr.stockMaximo) || 0,
        Number(pr.stockMinimo) || 0,
        now
      )
      productos++
    }

    // ── Instalación SUCURSAL ──────────────────────────────────────────────────
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO instalacion
           (id, tipo, sucursal_activa_id, matriz_id, propietario_nombre,
            configured_at, schema_version)
         VALUES (1, 'SUCURSAL', ?, ?, ?, ?, 1)`
      )
      .run(sucursalId, p.matriz?.id ?? null, propietario, now)

    // ── Stock inicial (si el archivo lo trae) ────────────────────────────────
    let stockLotes = 0
    let stockNoEncontrados = 0
    if (Array.isArray(p.stockInicial) && p.stockInicial.length > 0) {
      const r = cargaInicialInventario({
        usuarioId: ownerId,
        bodegaId: 'bodega-principal',
        items: p.stockInicial.map((s) => ({
          codigo: s.codigo,
          cantidad: s.cantidad,
          fechaCaducidad: s.caducidad
        }))
      })
      stockLotes = r.lotesCreados + r.lotesActualizados
      stockNoEncontrados = r.noEncontrados.length
      if (r.noEncontrados.length > 0) {
        console.warn(
          '[wizard .farma] Stock inicial con códigos sin producto en el catálogo:',
          r.noEncontrados.slice(0, 100)
        )
      }
    }

    return {
      sucursalNombre: p.sucursal.nombre,
      productos,
      stockLotes,
      stockNoEncontrados,
      usuarios: usuariosCreados
    }
  })

  const r = run()
  return { ok: true, ...r }
}

/**
 * Reset del modo: limpieza completa de los datos de operación e identidad para
 * volver al wizard desde cero (cambiar MATRIZ↔SUCURSAL o reinstalar limpio).
 *
 * Borra: instalación, usuarios, sucursales, empresa, productos, lotes, ventas,
 * cortes, movimientos de caja/stock e histórico de precios.
 * Conserva los catálogos semilla que la app necesita para arrancar: roles
 * (tipo_usuario), config de IVA y bodegas (incl. la principal).
 *
 * No se puede borrar sólo los usuarios conservando ventas: las ventas/cortes
 * referencian al cajero por FOREIGN KEY. Por eso el reset es una limpieza total.
 *
 * Requiere confirmación de password del usuario actual.
 */
export function resetInstalacion(viewerUserId: string, currentPassword: string): { ok: true } {
  const sqlite = getSqlite()

  const row = sqlite
    .prepare(
      `SELECT u.id, u.password_hash AS passwordHash, t.nombre AS rol
         FROM usuario u
         JOIN tipo_usuario t ON t.id = u.tipo_usuario_id
        WHERE u.id = ?`
    )
    .get(viewerUserId) as { id: string; passwordHash: string; rol: string } | undefined
  if (!row) throw new Error('Usuario no encontrado')
  if (row.rol !== 'SUPERUSUARIO' && row.rol !== 'ADMINISTRADOR') {
    throw new Error('Requiere permisos de administrador')
  }
  if (!bcrypt.compareSync(currentPassword, row.passwordHash)) {
    throw new Error('Password actual incorrecta')
  }

  // Orden hijo→padre; además apagamos FKs durante el borrado para no depender
  // del orden ni de columnas agregadas vía ALTER. PRAGMA fuera de la transacción
  // (SQLite ignora foreign_keys dentro de una transacción abierta).
  const tablas = [
    'pago',
    'venta_item',
    'mov_stock',
    'precio_historico',
    'mov_caja',
    'corte',
    'venta',
    'caducidad_lote',
    'sucursal_producto',
    'producto',
    'empresa',
    'sucursal',
    'usuario',
    'instalacion'
  ]
  sqlite.pragma('foreign_keys = OFF')
  try {
    const run = sqlite.transaction(() => {
      for (const t of tablas) sqlite.exec(`DELETE FROM ${t};`)
    })
    run()
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }
  return { ok: true }
}
