import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getSqlite } from '../db/connection'
import type {
  BootstrapStateDto,
  CompleteWizardInput,
  ExistingAdminOption,
  InstalacionDto,
  InstalacionTipo,
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
             (id, codigo, nombre, razon_social, rfc, calle, colonia, ciudad, estado,
              activa, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(
          sucursalId,
          sucursalCodigo!,
          sucursalNombre!,
          trimOrNull(input.razonSocial),
          trimOrNull(input.rfc),
          trimOrNull(input.calle),
          trimOrNull(input.colonia),
          trimOrNull(input.ciudad),
          trimOrNull(input.estado),
          now,
          now
        )

      // empresa (mirror para ticket) — usa los mismos datos
      sqlite
        .prepare(
          `INSERT INTO empresa
             (id, nombre_comercial, razon_social, rfc, calle, colonia, ciudad, estado,
              sucursal_nombre, owner_user_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sucursalId,
          trimOrNull(input.razonSocial) ?? sucursalNombre!,
          trimOrNull(input.razonSocial) ?? sucursalNombre!,
          trimOrNull(input.rfc),
          trimOrNull(input.calle),
          trimOrNull(input.colonia),
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
                    rfc, calle, colonia, ciudad, estado, sucursal_nombre AS sucursalNombre
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
          ciudad: sucursalRow.ciudad,
          estado: sucursalRow.estado,
          sucursalNombre: sucursalRow.sucursalNombre
        }
      : null
  }

  return { ok: true, user }
}

/**
 * Reset completo del modo: borra instalacion + sucursal + empresa + usuarios.
 * NO toca productos, ventas, cortes — sólo la capa de identidad/configuración.
 * Requiere confirmación de password del usuario actual (lo valida el caller).
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

  const run = sqlite.transaction(() => {
    sqlite.exec(`
      DELETE FROM instalacion;
      DELETE FROM sucursal;
      DELETE FROM empresa;
      DELETE FROM usuario;
    `)
  })
  run()
  return { ok: true }
}
