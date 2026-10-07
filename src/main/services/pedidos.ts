import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { getSqlite } from '../db/connection'
import { rolDeUsuario, requireAdmin, modoInstalacion } from './permisos'
import { crearTraspaso } from './traspaso'
import { exportPedidoPdf, imprimirPedidoSurtido } from './pdf'
import type {
  CreatePedidoInput,
  CrearTraspasoResult,
  PedidoEstado,
  PedidoLinea,
  PedidoTipo,
  PedidoTraspasoDto,
  PdfMovimientoResult,
  ProveedorBasicoDto,
  SucursalBasicaDto
} from '@shared/dto'

/**
 * Pedidos de surtido a sucursal ("prellenado de traspaso").
 *
 * Flujo (para matrices que también venden — equipo único):
 *   1. La CAJERA arma el pedido desde el POS (F11) con lo que otra farmacia
 *      pide para surtirse; al terminar se registra como PENDIENTE y se
 *      imprimen 2 hojas: la de la sucursal destino y el ORIGINAL del
 *      propietario (copias 0 y 1 de COPIAS_PEDIDO en pdf.ts).
 *   2. El SUPERUSUARIO/ADMINISTRADOR lo revisa en el panel de matriz: puede
 *      editarlo, rechazarlo o aprobarlo.
 *   3. SÓLO al APROBAR se ejecuta el traspaso real (descuento FEFO de la
 *      bodega + archivo .traspaso) y se imprime la 3ª hoja, la de ARCHIVO.
 *      El pedido en sí NUNCA toca inventario antes de eso.
 */

function requireUsuario(userId: string): void {
  const rol = rolDeUsuario(userId)
  if (!rol) throw new Error('Usuario no identificado')
}

function requireMatriz(): void {
  if (modoInstalacion() !== 'MATRIZ') {
    throw new Error('Los pedidos de surtido sólo están disponibles en la matriz')
  }
}

// permitirCero: en pedidos a PROVEEDOR la "cantidad" es la EXISTENCIA del
// momento (foto del stock para que el proveedor vea qué falta) y puede ser 0.
function limpiaItems(items: PedidoLinea[], permitirCero = false): PedidoLinea[] {
  const out: PedidoLinea[] = []
  for (const it of items ?? []) {
    const codigo = String(it.codigo ?? '').trim()
    const nombre = String(it.nombre ?? '').trim()
    const cantidad = Math.round(Number(it.cantidad))
    if (!codigo || !Number.isFinite(cantidad)) continue
    if (permitirCero ? cantidad < 0 : cantidad <= 0) continue
    out.push({ codigo, nombre, cantidad })
  }
  return out
}

interface PedidoRow {
  id: string
  numero: number
  tipo: string | null
  estado: string
  sucursalId: string | null
  sucursalCodigo: string
  sucursalNombre: string
  bodegaId: string | null
  creadoNombre: string | null
  fechaCreado: number
  revisadoNombre: string | null
  fechaRevision: number | null
  traspasoFolio: string | null
  notas: string | null
  itemsJson: string
}

const SELECT_PEDIDO = `
  SELECT id, numero, tipo, estado,
         sucursal_id      AS sucursalId,
         sucursal_codigo  AS sucursalCodigo,
         sucursal_nombre  AS sucursalNombre,
         bodega_id        AS bodegaId,
         creado_nombre    AS creadoNombre,
         fecha_creado     AS fechaCreado,
         revisado_nombre  AS revisadoNombre,
         fecha_revision   AS fechaRevision,
         traspaso_folio   AS traspasoFolio,
         notas,
         items_json       AS itemsJson
    FROM pedido_traspaso`

function nombreBodega(bodegaId: string | null): string | null {
  if (!bodegaId) return null
  const b = getSqlite().prepare('SELECT nombre FROM bodega WHERE id = ?').get(bodegaId) as
    | { nombre: string }
    | undefined
  return b?.nombre ?? null
}

function rowToDto(r: PedidoRow): PedidoTraspasoDto {
  const permitirCero = (r.tipo || 'SUCURSAL') === 'PROVEEDOR'
  let items: PedidoLinea[] = []
  try {
    items = limpiaItems(JSON.parse(r.itemsJson ?? '[]') as PedidoLinea[], permitirCero)
  } catch {
    items = []
  }
  return {
    id: r.id,
    numero: r.numero,
    tipo: (r.tipo as PedidoTipo) || 'SUCURSAL',
    estado: r.estado as PedidoEstado,
    sucursalId: r.sucursalId,
    sucursalCodigo: r.sucursalCodigo,
    sucursalNombre: r.sucursalNombre,
    bodegaId: r.bodegaId,
    bodegaNombre: nombreBodega(r.bodegaId),
    creadoNombre: r.creadoNombre,
    fechaCreado: new Date(r.fechaCreado).toISOString(),
    revisadoNombre: r.revisadoNombre,
    fechaRevision: r.fechaRevision ? new Date(r.fechaRevision).toISOString() : null,
    traspasoFolio: r.traspasoFolio,
    notas: r.notas,
    items
  }
}

function getPedidoRow(id: string): PedidoRow {
  const r = getSqlite()
    .prepare(`${SELECT_PEDIDO} WHERE id = ?`)
    .get(id) as PedidoRow | undefined
  if (!r) throw new Error('Pedido no encontrado')
  return r
}

/**
 * Sucursales activas con datos mínimos (id/código/nombre) para el selector de
 * destino del pedido. Disponible para CUALQUIER rol logueado (el catálogo
 * completo sigue siendo de admins).
 */
export function listSucursalesBasico(viewerUserId: string): SucursalBasicaDto[] {
  requireUsuario(viewerUserId)
  requireMatriz()
  return getSqlite()
    .prepare('SELECT id, codigo, nombre FROM sucursal WHERE activa = 1 ORDER BY nombre')
    .all() as SucursalBasicaDto[]
}

/** Proveedores activos con datos mínimos (pedido de compra; cualquier rol). */
export function listProveedoresBasico(viewerUserId: string): ProveedorBasicoDto[] {
  requireUsuario(viewerUserId)
  requireMatriz()
  return getSqlite()
    .prepare('SELECT id, nombre FROM proveedor WHERE activo = 1 ORDER BY nombre')
    .all() as ProveedorBasicoDto[]
}

/** Crea un pedido PENDIENTE (cualquier rol logueado; típicamente la cajera). */
export function createPedido(viewerUserId: string, input: CreatePedidoInput): PedidoTraspasoDto {
  requireUsuario(viewerUserId)
  requireMatriz()
  const sqlite = getSqlite()

  // Destino, en orden de prioridad:
  //  - sucursal del catálogo / destino EXTERNO escrito → tipo SUCURSAL
  //  - proveedor del catálogo / proveedor escrito      → tipo PROVEEDOR
  let tipo: PedidoTipo = 'SUCURSAL'
  let sucId: string | null = null
  let provId: string | null = null
  let sucCodigo = 'EXT'
  let sucNombre = ''
  if (input.sucursalId) {
    const suc = sqlite
      .prepare('SELECT id, codigo, nombre, activa FROM sucursal WHERE id = ?')
      .get(input.sucursalId) as
      | { id: string; codigo: string; nombre: string; activa: number }
      | undefined
    if (!suc) throw new Error('Sucursal destino no encontrada')
    if (!suc.activa) throw new Error('La sucursal destino está desactivada')
    sucId = suc.id
    sucCodigo = suc.codigo
    sucNombre = suc.nombre
  } else if (input.proveedorId) {
    const prov = sqlite
      .prepare('SELECT id, nombre, activo FROM proveedor WHERE id = ?')
      .get(input.proveedorId) as { id: string; nombre: string; activo: number } | undefined
    if (!prov) throw new Error('Proveedor no encontrado')
    if (!prov.activo) throw new Error('El proveedor está desactivado')
    tipo = 'PROVEEDOR'
    provId = prov.id
    sucCodigo = 'PROV'
    sucNombre = prov.nombre
  } else if (input.proveedorNombre !== undefined && input.proveedorNombre !== null) {
    tipo = 'PROVEEDOR'
    sucCodigo = 'PROV'
    sucNombre = String(input.proveedorNombre).trim()
    if (!sucNombre) throw new Error('Escribe el nombre del proveedor')
  } else {
    sucNombre = String(input.destinoNombre ?? '').trim()
    if (!sucNombre) throw new Error('Escribe el nombre del destino externo')
  }

  const items = limpiaItems(input.items, tipo === 'PROVEEDOR')
  if (items.length === 0) throw new Error('El pedido no tiene productos')

  // Bodega que surtirá (sólo pedidos que salen del stock, no proveedor). Con
  // UNA bodega activa se toma sola; con varias es obligatoria para que el
  // surtido no salga de una bodega equivocada.
  let bodegaId: string | null = null
  if (tipo !== 'PROVEEDOR') {
    const activas = sqlite
      .prepare('SELECT id, nombre FROM bodega WHERE activa = 1 ORDER BY nombre')
      .all() as { id: string; nombre: string }[]
    if (input.bodegaId) {
      const b = activas.find((x) => x.id === input.bodegaId)
      if (!b) throw new Error('La bodega elegida no existe o está desactivada')
      bodegaId = b.id
    } else if (activas.length === 1) {
      bodegaId = activas[0]!.id
    } else if (activas.length > 1) {
      throw new Error('Selecciona la bodega que surtirá el pedido')
    }
  }

  const usuario = sqlite
    .prepare('SELECT nombre FROM usuario WHERE id = ?')
    .get(viewerUserId) as { nombre: string } | undefined

  const id = randomUUID()
  const now = Date.now()
  const numero = (
    sqlite.prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM pedido_traspaso').get() as {
      n: number
    }
  ).n

  sqlite
    .prepare(
      `INSERT INTO pedido_traspaso
         (id, numero, tipo, estado, sucursal_id, proveedor_id, sucursal_codigo,
          sucursal_nombre, bodega_id, creado_por, creado_nombre, fecha_creado, notas, items_json)
       VALUES (?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      numero,
      tipo,
      sucId,
      provId,
      sucCodigo,
      sucNombre,
      bodegaId,
      viewerUserId,
      usuario?.nombre ?? null,
      now,
      (input.notas ?? '').trim() || null,
      JSON.stringify(items)
    )

  return rowToDto(getPedidoRow(id))
}

/**
 * Existencia de un producto en UNA bodega (suma de saldos de sus lotes ahí).
 * Para el prellenado F11 con varias bodegas: la cajera valida contra el stock
 * de la bodega que va a surtir, no contra el global.
 */
export function existenciaEnBodega(
  viewerUserId: string,
  codigo: string,
  bodegaId: string
): number {
  requireUsuario(viewerUserId)
  const r = getSqlite()
    .prepare(
      `SELECT COALESCE(SUM(cl.saldo), 0) AS n
         FROM caducidad_lote cl
         JOIN producto p ON p.id = cl.producto_id
        WHERE p.codigo = ? AND cl.bodega_id = ?`
    )
    .get(String(codigo ?? '').trim(), bodegaId) as { n: number }
  return Number(r.n) || 0
}

/**
 * Existencia GLOBAL (todas las bodegas) por código: la misma "foto" que toma
 * la cajera al agregar un producto a la lista de faltantes. Los códigos que
 * no existen en el catálogo no aparecen en el resultado.
 */
function existenciasGlobales(codigos: string[]): Map<string, number> {
  const out = new Map<string, number>()
  if (codigos.length === 0) return out
  const stmt = getSqlite().prepare(
    `SELECT COALESCE((SELECT SUM(cl.saldo) FROM caducidad_lote cl WHERE cl.producto_id = p.id), 0) AS n
       FROM producto p
      WHERE p.codigo = ?`
  )
  for (const c of new Set(codigos)) {
    const r = stmt.get(c) as { n: number } | undefined
    if (r) out.set(c, Number(r.n) || 0)
  }
  return out
}

/**
 * Existencias actuales de varios códigos (cualquier rol logueado). La UI lo
 * usa para avisar qué renglones de una lista a proveedor quedaron con la
 * existencia desactualizada (ventas/traspasos después de capturarlos) y
 * ponerlos al día con el botón "Actualizar existencias".
 */
export function existenciasActuales(
  viewerUserId: string,
  codigos: string[]
): Record<string, number> {
  requireUsuario(viewerUserId)
  requireMatriz()
  const out: Record<string, number> = {}
  for (const [c, n] of existenciasGlobales(codigos)) out[c] = n
  return out
}

/**
 * Pone al día la "foto" de existencias de una lista a proveedor PENDIENTE con
 * el stock real de ahora (traspasos y ventas posteriores a la captura ya
 * descontados). Se llama al CERRAR (cajera) y al APROBAR (admin) — justo antes
 * de imprimir — para que la hoja del proveedor refleje la realidad y no la
 * existencia del día en que se capturó cada renglón. Devuelve cuántos
 * renglones cambiaron.
 */
function refrescarExistenciasProveedor(pedidoId: string): number {
  const r = getPedidoRow(pedidoId)
  if ((r.tipo || 'SUCURSAL') !== 'PROVEEDOR' || r.estado !== 'PENDIENTE') return 0
  const items = rowToDto(r).items
  const actuales = existenciasGlobales(items.map((l) => l.codigo))
  let cambios = 0
  const nuevos = items.map((l) => {
    const n = actuales.get(l.codigo)
    if (n === undefined || n === l.cantidad) return l
    cambios++
    return { ...l, cantidad: n }
  })
  if (cambios > 0) {
    getSqlite()
      .prepare('UPDATE pedido_traspaso SET items_json = ? WHERE id = ?')
      .run(JSON.stringify(nuevos), pedidoId)
  }
  return cambios
}

/** Pedidos pendientes + los últimos resueltos (sólo admin, para revisión). */
export function listPedidos(viewerUserId: string): PedidoTraspasoDto[] {
  requireAdmin(viewerUserId)
  const rows = getSqlite()
    .prepare(
      `${SELECT_PEDIDO}
        WHERE estado = 'PENDIENTE'
           OR id IN (SELECT id FROM pedido_traspaso WHERE estado <> 'PENDIENTE'
                      ORDER BY fecha_creado DESC LIMIT 30)
        ORDER BY CASE estado WHEN 'PENDIENTE' THEN 0 ELSE 1 END, fecha_creado DESC`
    )
    .all() as PedidoRow[]
  return rows.map(rowToDto)
}

/** Cuántos pedidos esperan revisión (para el contador de la tarjeta en matriz). */
export function countPedidosPendientes(viewerUserId: string): number {
  requireAdmin(viewerUserId)
  const r = getSqlite()
    .prepare(`SELECT COUNT(*) AS n FROM pedido_traspaso WHERE estado = 'PENDIENTE'`)
    .get() as { n: number }
  return Number(r.n) || 0
}

/**
 * Listas de faltantes a proveedor ABIERTAS (PENDIENTE). Cualquier rol: las
 * cajeras las reabren desde el POS para seguirles agregando faltantes hasta
 * que un admin las autorice o rechace (eso las cierra).
 */
export function listListasProveedor(viewerUserId: string): PedidoTraspasoDto[] {
  requireUsuario(viewerUserId)
  requireMatriz()
  const rows = getSqlite()
    .prepare(
      `${SELECT_PEDIDO}
        WHERE estado = 'PENDIENTE' AND tipo = 'PROVEEDOR'
        ORDER BY fecha_creado ASC`
    )
    .all() as PedidoRow[]
  return rows.map(rowToDto)
}

/**
 * Guarda/sobrescribe una lista de faltantes abierta (cualquier rol; sólo
 * pedidos a PROVEEDOR en estado PENDIENTE). Las cajeras pueden agregarle o
 * quitarle productos cuantas veces quieran hasta que la CIERREN (ellas
 * mismas, con cerrarListaProveedor) o un admin la autorice.
 */
export function guardarListaProveedor(
  viewerUserId: string,
  pedidoId: string,
  items: PedidoLinea[],
  notas?: string | null
): PedidoTraspasoDto {
  requireUsuario(viewerUserId)
  requireMatriz()
  const r = getPedidoRow(pedidoId)
  if ((r.tipo || 'SUCURSAL') !== 'PROVEEDOR') {
    throw new Error('Sólo las listas de faltantes a proveedor se pueden seguir editando')
  }
  if (r.estado !== 'PENDIENTE') {
    throw new Error('Esta lista ya fue revisada (aprobada o rechazada) — está cerrada')
  }
  const limpio = limpiaItems(items, true)
  if (limpio.length === 0) throw new Error('La lista no tiene productos')
  getSqlite()
    .prepare('UPDATE pedido_traspaso SET items_json = ?, notas = ? WHERE id = ?')
    .run(
      JSON.stringify(limpio),
      (notas ?? r.notas ?? '').toString().trim() || null,
      pedidoId
    )
  return rowToDto(getPedidoRow(pedidoId))
}

/**
 * CIERRA una lista de faltantes a proveedor (cualquier rol logueado — la
 * cajera la cierra cuando está lista, sin esperar al admin). Queda APROBADO
 * con quién la cerró y cuándo; después ya no se puede editar y el renderer
 * manda a imprimir la hoja (imprimirPedido la permite una vez cerrada). La
 * mercancía entra después con una Entrada normal, igual que al aprobar.
 */
export function cerrarListaProveedor(viewerUserId: string, pedidoId: string): PedidoTraspasoDto {
  requireUsuario(viewerUserId)
  requireMatriz()
  const r = getPedidoRow(pedidoId)
  if ((r.tipo || 'SUCURSAL') !== 'PROVEEDOR') {
    throw new Error('Sólo las listas de faltantes a proveedor se cierran desde aquí')
  }
  if (r.estado !== 'PENDIENTE') throw new Error('Esta lista ya está cerrada')
  // La hoja se imprime enseguida: existencias al stock real de este momento.
  refrescarExistenciasProveedor(pedidoId)
  const usuario = getSqlite()
    .prepare('SELECT nombre FROM usuario WHERE id = ?')
    .get(viewerUserId) as { nombre: string } | undefined
  getSqlite()
    .prepare(
      `UPDATE pedido_traspaso
          SET estado = 'APROBADO', revisado_por = ?, revisado_nombre = ?, fecha_revision = ?
        WHERE id = ?`
    )
    .run(viewerUserId, usuario?.nombre ?? null, Date.now(), pedidoId)
  return rowToDto(getPedidoRow(pedidoId))
}

/** Edita las líneas de un pedido PENDIENTE (sólo admin, durante la revisión). */
export function updatePedidoItems(
  viewerUserId: string,
  pedidoId: string,
  items: PedidoLinea[]
): PedidoTraspasoDto {
  requireAdmin(viewerUserId)
  const r = getPedidoRow(pedidoId)
  if (r.estado !== 'PENDIENTE') throw new Error('Sólo se pueden editar pedidos pendientes')
  const limpio = limpiaItems(items, (r.tipo || 'SUCURSAL') === 'PROVEEDOR')
  if (limpio.length === 0) {
    throw new Error('El pedido quedaría sin productos — mejor recházalo')
  }
  getSqlite()
    .prepare('UPDATE pedido_traspaso SET items_json = ? WHERE id = ?')
    .run(JSON.stringify(limpio), pedidoId)
  return rowToDto(getPedidoRow(pedidoId))
}

/** Rechaza un pedido PENDIENTE (no toca inventario). */
export function rechazarPedido(viewerUserId: string, pedidoId: string): PedidoTraspasoDto {
  requireAdmin(viewerUserId)
  const r = getPedidoRow(pedidoId)
  if (r.estado !== 'PENDIENTE') throw new Error('El pedido ya fue revisado')
  const usuario = getSqlite()
    .prepare('SELECT nombre FROM usuario WHERE id = ?')
    .get(viewerUserId) as { nombre: string } | undefined
  getSqlite()
    .prepare(
      `UPDATE pedido_traspaso
          SET estado = 'RECHAZADO', revisado_por = ?, revisado_nombre = ?, fecha_revision = ?
        WHERE id = ?`
    )
    .run(viewerUserId, usuario?.nombre ?? null, Date.now(), pedidoId)
  return rowToDto(getPedidoRow(pedidoId))
}

/**
 * Aprueba un pedido: ejecuta el traspaso REAL (descuento FEFO de la bodega
 * elegida + archivo .traspaso vía diálogo de guardado). Éste es el ÚNICO punto
 * donde el pedido toca inventario. Si el traspaso falla, se cancela el diálogo
 * o hay faltantes, el pedido sigue PENDIENTE.
 */
export async function aprobarPedido(
  viewerUserId: string,
  pedidoId: string,
  bodegaOrigenId: string,
  window: BrowserWindow | null
): Promise<CrearTraspasoResult> {
  requireAdmin(viewerUserId)
  const r = getPedidoRow(pedidoId)
  if (r.estado !== 'PENDIENTE') return { ok: false, error: 'El pedido ya fue revisado' }
  const dto = rowToDto(r)
  if (dto.items.length === 0) return { ok: false, error: 'El pedido no tiene productos' }

  // Pedido a PROVEEDOR: no hay traspaso ni descuento — sólo se marca aprobado
  // (la mercancía entrará después con una Entrada de mercancía normal).
  if (dto.tipo === 'PROVEEDOR') {
    // La hoja se imprime enseguida: existencias al stock real de este momento
    // (los traspasos/ventas hechos después de capturar la lista ya descontados).
    refrescarExistenciasProveedor(pedidoId)
    const usuarioProv = getSqlite()
      .prepare('SELECT nombre FROM usuario WHERE id = ?')
      .get(viewerUserId) as { nombre: string } | undefined
    getSqlite()
      .prepare(
        `UPDATE pedido_traspaso
            SET estado = 'APROBADO', revisado_por = ?, revisado_nombre = ?, fecha_revision = ?
          WHERE id = ?`
      )
      .run(viewerUserId, usuarioProv?.nombre ?? null, Date.now(), pedidoId)
    return { ok: true }
  }

  // Destino del catálogo → por id; destino EXTERNO → libre (código + nombre),
  // igual que los traspasos generados desde una sucursal.
  const res = await crearTraspaso(
    viewerUserId,
    {
      bodegaOrigenId,
      ...(r.sucursalId
        ? { sucursalId: r.sucursalId }
        : { destino: { codigo: r.sucursalCodigo || 'EXT', nombre: r.sucursalNombre } }),
      items: dto.items.map((it) => ({ codigo: it.codigo, cantidad: it.cantidad }))
    },
    window
  )
  if (!res.ok) return res

  const usuario = getSqlite()
    .prepare('SELECT nombre FROM usuario WHERE id = ?')
    .get(viewerUserId) as { nombre: string } | undefined
  getSqlite()
    .prepare(
      `UPDATE pedido_traspaso
          SET estado = 'APROBADO', revisado_por = ?, revisado_nombre = ?,
              fecha_revision = ?, traspaso_folio = ?
        WHERE id = ?`
    )
    .run(viewerUserId, usuario?.nombre ?? null, Date.now(), res.folio ?? null, pedidoId)
  return res
}

/**
 * Imprime UNA copia del pedido (índice en COPIAS_PEDIDO de pdf.ts). SUCURSAL:
 * 0 = sucursal destino y 1 = ORIGINAL del propietario (ambas al capturar),
 * 2 = ARCHIVO (al aprobarse). PROVEEDOR: hoja única (sin índice) y SÓLO
 * después de que un admin lo apruebe.
 */
export async function imprimirPedido(
  viewerUserId: string,
  pedidoId: string,
  copia?: number | null
): Promise<PdfMovimientoResult> {
  requireUsuario(viewerUserId)
  const dto = rowToDto(getPedidoRow(pedidoId))
  if (dto.tipo === 'PROVEEDOR' && dto.estado === 'PENDIENTE') {
    return {
      ok: false,
      error: 'El pedido a proveedor se imprime hasta que lo apruebe el administrador'
    }
  }
  return imprimirPedidoSurtido(
    {
      numero: dto.numero,
      tipo: dto.tipo,
      fecha: dto.fechaCreado,
      sucursalCodigo: dto.sucursalCodigo,
      sucursalNombre: dto.sucursalNombre,
      bodegaNombre: dto.bodegaNombre,
      creadoNombre: dto.creadoNombre,
      notas: dto.notas,
      items: dto.items
    },
    copia ?? undefined
  )
}

/**
 * Guarda el pedido como PDF (USB / envío digital). Misma regla que la
 * impresión: el pedido a PROVEEDOR sólo después de aprobarse.
 */
export async function pdfPedido(
  viewerUserId: string,
  pedidoId: string,
  window: BrowserWindow | null
): Promise<PdfMovimientoResult> {
  requireUsuario(viewerUserId)
  const dto = rowToDto(getPedidoRow(pedidoId))
  if (dto.tipo === 'PROVEEDOR' && dto.estado === 'PENDIENTE') {
    return {
      ok: false,
      error: 'El pedido a proveedor se genera hasta que lo apruebe el administrador'
    }
  }
  return exportPedidoPdf(
    {
      numero: dto.numero,
      tipo: dto.tipo,
      fecha: dto.fechaCreado,
      sucursalCodigo: dto.sucursalCodigo,
      sucursalNombre: dto.sucursalNombre,
      bodegaNombre: dto.bodegaNombre,
      creadoNombre: dto.creadoNombre,
      notas: dto.notas,
      items: dto.items
    },
    window
  )
}
