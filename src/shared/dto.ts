/**
 * DTOs que viajan a través de IPC main ↔ renderer.
 * Son plain JSON-serializable — nada de Dates o clases.
 */

import type { IvaModo, MetodoPago } from './types'

export type InstalacionTipo = 'MATRIZ' | 'SUCURSAL'

// ── Config de negocio (IVA default, etc.) ──────────────────────────────────
export interface ConfigDto {
  ivaPorcentajeDefault: number
}

export interface UpdateConfigInput {
  ivaPorcentajeDefault?: number
}

export type InstalacionDto =
  | { configured: false }
  | {
      configured: true
      tipo: InstalacionTipo
      sucursalActivaId: string | null
      matrizId: string | null
      propietarioNombre: string | null
      configuredAt: string // ISO
      schemaVersion: number
    }

export interface ExistingAdminOption {
  id: string
  login: string
  nombre: string
  rol: string
}

export interface BootstrapStateDto {
  instalacion: InstalacionDto
  existingAdmins: ExistingAdminOption[]
  totalUsuarios: number
}

export interface CompleteWizardInput {
  tipo: InstalacionTipo
  propietarioNombre: string
  // Sólo en SUCURSAL
  sucursalCodigo?: string
  sucursalNombre?: string
  razonSocial?: string | null
  rfc?: string | null
  calle?: string | null
  colonia?: string | null
  ciudad?: string | null
  estado?: string | null
  // Admin: o crea nuevo (adminLogin/Nombre/Password) o usa existente (useExistingUserId)
  useExistingUserId?: string | null
  adminLogin?: string
  adminNombre?: string
  adminPassword?: string
}

export interface SessionUser {
  id: string
  login: string
  nombre: string
  tipoUsuarioId: number
  rol: string // nombre del rol: ADMINISTRADOR | CAJERO | SUPERVISOR | SUPERUSUARIO
  puedeCancelar: boolean
  sucursal: EmpresaDto | null
}

// ── Wizard: configurar SUCURSAL desde un archivo .farma (USB de la matriz) ──
export interface WizardFarmaPreview {
  filePath: string
  generadoEn: string
  matrizPropietario: string | null
  sucursal: {
    id: string
    codigo: string
    nombre: string
    razonSocial: string | null
    rfc: string | null
  }
  productosCount: number
  stockLotes: number
  usuarios: { login: string; nombre: string; rol: string }[]
}

export type PickWizardFarmaResult =
  | { ok: true; preview: WizardFarmaPreview }
  | { ok: false; cancelled?: boolean; error?: string }

export interface CompleteWizardFromFarmaInput {
  filePath: string
  propietarioNombre: string
}

export interface CompleteWizardFromFarmaResult {
  ok: true
  sucursalNombre: string
  productos: number
  stockLotes: number
  usuarios: number
}

export interface EmpresaDto {
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

export interface SucursalDto {
  id: string
  codigo: string
  nombre: string
  razonSocial: string | null
  rfc: string | null
  calle: string | null
  colonia: string | null
  ciudad: string | null
  estado: string | null
  activa: boolean
  createdAt: string // ISO
  updatedAt: string // ISO
}

export interface CreateSucursalInput {
  codigo: string
  nombre: string
  razonSocial?: string | null
  rfc?: string | null
  calle?: string | null
  colonia?: string | null
  ciudad?: string | null
  estado?: string | null
}

// ── Bodegas (almacenes lógicos gestionados desde la matriz) ────────────────
export interface BodegaDto {
  id: string
  codigo: string
  nombre: string
  calle: string | null
  colonia: string | null
  ciudad: string | null
  estado: string | null
  esPrincipal: boolean
  activa: boolean
  existenciasTotal: number // suma de saldos de lotes en esta bodega
  createdAt: string // ISO
  updatedAt: string // ISO
}

export interface CreateBodegaInput {
  codigo: string
  nombre: string
  calle?: string | null
  colonia?: string | null
  ciudad?: string | null
  estado?: string | null
}

export interface UpdateBodegaInput {
  id: string
  codigo: string
  nombre: string
  calle?: string | null
  colonia?: string | null
  ciudad?: string | null
  estado?: string | null
}

export interface SucursalProductoOverride {
  precio: number | null
  ivaModo: IvaModo | null
  ivaPorcentaje: number | null
  excluida: boolean
}

export interface CatalogoSucursalItem {
  productoId: string
  codigo: string
  nombre: string
  laboratorio: string | null
  // Valores del catálogo global
  precioGlobal: number
  ivaModoGlobal: IvaModo
  ivaPorcentajeGlobal: number
  // Override (si la sucursal tiene fila propia)
  override: SucursalProductoOverride | null
  // Valores efectivos (override aplicado o global heredado)
  precioEfectivo: number
  ivaModoEfectivo: IvaModo
  ivaPorcentajeEfectivo: number
  // false si excluida en esta sucursal
  aplica: boolean
}

// ── Export `.farma` (matriz → sucursal) ──────────────────────────────────
export interface ExportFarmaProducto {
  id: string
  codigo: string
  nombre: string
  sustanciaActiva: string | null
  descripcion: string | null
  laboratorio: string | null
  precio: number
  costo: number
  ivaModo: IvaModo
  ivaPorcentaje: number
  stockMaximo: number
  stockMinimo: number
}

export interface ExportFarmaPayload {
  matriz: {
    id: string | null
    propietario: string | null
  }
  sucursal: {
    id: string
    codigo: string
    nombre: string
    razonSocial: string | null
    rfc: string | null
    calle: string | null
    colonia: string | null
    ciudad: string | null
    estado: string | null
  }
  productos: ExportFarmaProducto[]
  // Stock inicial opcional (solo se incluye en la PRIMERA exportación de una
  // sucursal que se migra del legacy). Se aplica únicamente en la primera
  // importación de la sucursal (no en actualizaciones posteriores).
  stockInicial?: ExportFarmaStockLote[]
  // Usuarios admin de la matriz, para configurar la sucursal con las mismas
  // credenciales. Solo se usan en el wizard (primera configuración).
  usuarios?: ExportFarmaUsuario[]
}

export interface ExportFarmaStockLote {
  codigo: string
  cantidad: number
  caducidad: string | null // YYYY-MM-DD; null = sin caducidad
}

// Usuario admin que viaja en el .farma para poder configurar la sucursal con
// las mismas credenciales de la matriz. La contraseña va como hash bcrypt.
export interface ExportFarmaUsuario {
  login: string
  nombre: string
  rol: string // ADMINISTRADOR | SUPERUSUARIO
  passwordHash: string
  puedeCancelar: boolean
}

// Archivo completo `.farma` en disco
export interface FarmaFile {
  tipo: 'MATRIZ_A_SUCURSAL'
  version: number
  generadoEn: string
  checksum: string
  payload: ExportFarmaPayload
}

export interface ImportFarmaPreview {
  filePath: string
  tipo: string
  version: number
  generadoEn: string
  checksum: string
  matriz: { id: string | null; propietario: string | null }
  sucursal: {
    id: string
    codigo: string
    nombre: string
    razonSocial: string | null
    rfc: string | null
  }
  productosCount: number
  // ¿Cómo aplica respecto a la sucursal local?
  aplicaA: 'NUEVA' | 'COINCIDE' | 'DISTINTA'
  sucursalLocalActual: { codigo: string; nombre: string } | null
  modoLocal: string
  ultimoImportLocalEn: string | null
}

export type PickFarmaResult =
  | { ok: true; preview: ImportFarmaPreview }
  | { ok: false; cancelled?: boolean; error?: string }

export type ApplyFarmaResult =
  | {
      ok: true
      sucursal: { id: string; codigo: string; nombre: string }
      productosCreados: number
      productosActualizados: number
      stockLotes: number // lotes de stock inicial aplicados (solo primera importación)
      generadoEn: string
      primeraImport: boolean
      sucursalCambiada: boolean
    }
  | {
      ok: false
      requiresForce?: boolean
      error?: string
    }

export type ExportSucursalResult =
  | {
      ok: true
      path: string
      productosCount: number
      stockLineas: number
      bytes: number
      generadoEn: string
      checksum: string
    }
  | {
      ok: false
      cancelled?: boolean
      error?: string
    }

export interface SetSucursalProductoInput {
  sucursalId: string
  productoId: string
  // undefined = no tocar este campo; null = quitar override (usar global)
  precio?: number | null
  ivaModo?: IvaModo | null
  ivaPorcentaje?: number | null
  excluida?: boolean
}

export interface UpdateSucursalInput {
  id: string
  codigo: string
  nombre: string
  razonSocial?: string | null
  rfc?: string | null
  calle?: string | null
  colonia?: string | null
  ciudad?: string | null
  estado?: string | null
}

export interface UpdateEmpresaInput {
  nombreComercial: string
  razonSocial: string
  rfc?: string | null
  calle?: string | null
  colonia?: string | null
  ciudad?: string | null
  estado?: string | null
  sucursalNombre: string
}

export type LoginResult = { ok: true; user: SessionUser } | { ok: false; error: string }

export interface ProductoDto {
  id: string
  codigo: string
  nombre: string
  sustanciaActiva: string | null
  descripcion: string | null
  laboratorio: string | null
  precio: number
  ivaPorcentaje: number
  ivaModo: IvaModo
  existenciasTotal: number // suma de saldos en caducidad_lote
}

export type ProductoSearchMode = 'nombre' | 'sustancia' | 'codigo'

export interface ProductoSearchQuery {
  mode: ProductoSearchMode
  term: string
  limit?: number
}

export interface CartItemDto {
  productoId: string
  codigo: string
  nombre: string
  cantidad: number
  precioUnitario: number
  ivaPorcentaje: number
  ivaModo: IvaModo
  importe: number
  iva: number
  total: number
}

export interface CreateVentaInput {
  cajeroId: string
  items: CartItemDto[]
  pagos: { metodo: MetodoPago; monto: number; referencia?: string | null }[]
  cambio: number
  motivo?: string
}

export interface CreateVentaResult {
  ventaId: string
  folioLocal: number
  fecha: string // ISO
}

export interface VentaItemDetail {
  id: string
  codigo: string
  nombre: string
  cantidad: number
  precioUnitario: number
  importe: number
  iva: number
  total: number
}

export interface VentaPagoDetail {
  metodo: MetodoPago
  monto: number
  referencia: string | null
}

export interface VentaDetailDto {
  id: string
  folioLocal: number
  fecha: string // ISO
  cajero: string
  subtotal: number
  iva: number
  descuento: number
  total: number
  motivo: string
  cancelada: boolean
  canceladaEn: string | null
  items: VentaItemDetail[]
  pagos: VentaPagoDetail[]
}

export interface CancelVentaResult {
  ok: true
  folioLocal: number
  canceladaEn: string // ISO
}

export interface MetodoPagoTotal {
  metodo: MetodoPago
  monto: number
  ventas: number
}

export interface CorteFolioRow {
  id: string
  folioLocal: number
  fecha: string // ISO
  total: number
  cancelada: boolean
}

export interface UltimoCorteInfo {
  id: string
  tipo: 'PARCIAL' | 'FINAL' | 'CAMBIO_TURNO'
  fecha: string // ISO
  folioInicio: number
  folioFin: number
  total: number
  cajero: string | null
}

export interface RangoPendienteCorte {
  folioInicio: number
  folioFin: number
  cantidad: number
}

export interface CorteHoyDto {
  fechaDesde: string // ISO
  fechaHasta: string // ISO
  foliosVendidos: number
  foliosCancelados: number
  ventaDelDia: number
  montoCancelado: number
  subtotalDelDia: number
  ivaDelDia: number
  entradasCaja: number
  salidasCaja: number
  porMetodoPago: MetodoPagoTotal[]
  folios: CorteFolioRow[]
  ultimoCorte: UltimoCorteInfo | null
  pendiente: RangoPendienteCorte | null
}

export interface EntradaItemInput {
  productoId: string
  codigo: string // informativo (para errores y display)
  nombre: string // informativo
  cantidad: number
  costo: number
  fechaCaducidad?: string | null // ISO; si omite, default +2 años
}

export interface CreateEntradaInput {
  usuarioId: string
  bodegaId: string // bodega destino del inventario
  items: EntradaItemInput[]
  motivo?: string | null
}

export interface CreateEntradaResult {
  lotesCreados: number
  unidadesIngresadas: number
  productosActualizados: number
  totalCosto: number
}

export interface LoteInfo {
  id: string
  total: number
  saldo: number
  fechaCaducidad: string // ISO
  fechaEntrada: string // ISO
}

export interface AjusteItemInput {
  loteId: string
  productoNombre: string // informativo
  codigo: string // informativo
  saldoActual: number // informativo (para validación)
  nuevoSaldo: number
  motivo: import('./types').MotivoAjuste
  nota?: string | null
}

export interface CreateAjustesInput {
  cajeroId: string
  items: AjusteItemInput[]
}

export interface CreateAjustesResult {
  ajustesAplicados: number
  deltaTotalUnidades: number // suma neta (positivo ingresos, negativo salidas)
}

export interface SalidaItemInput {
  loteId: string
  productoNombre: string // informativo
  codigo: string // informativo
  saldoActual: number // informativo (para validación)
  cantidad: number // positivo: cuántas unidades salen del lote
  motivo: import('./types').MotivoSalida
  nota?: string | null
}

export interface CreateSalidaInput {
  cajeroId: string
  items: SalidaItemInput[]
}

export interface CreateSalidaResult {
  itemsCreados: number
  unidadesTotales: number
}

// ── Carga inicial de inventario (migración / arranque) ──────────────────────
// Idempotente: por cada (código, caducidad) FIJA el saldo del lote al valor
// indicado (no suma). Re-ejecutar el mismo CSV deja el inventario igual.
export interface CargaInicialItemInput {
  codigo: string
  cantidad: number // saldo objetivo (>= 0)
  fechaCaducidad?: string | null // YYYY-MM-DD; vacío/null = lote sin caducidad
}

export interface CargaInicialInput {
  usuarioId: string
  bodegaId: string // bodega destino del inventario
  items: CargaInicialItemInput[]
  // Si true, los lotes de la bodega que NO vengan en el CSV se ponen en saldo 0
  // (reconciliación total: la bodega queda EXACTAMENTE como el CSV).
  reemplazarBodega?: boolean
}

export interface CargaInicialResult {
  lotesCreados: number
  lotesActualizados: number
  lotesSinCambio: number
  lotesPuestosCero: number
  unidadesTotal: number
  noEncontrados: string[] // códigos sin producto en el catálogo
  invalidos: string[] // filas con cantidad inválida
}

// ── Consulta de stock por bodega (inventario) ───────────────────────────────
export interface StockBodegaLote {
  caducidad: string // YYYY-MM-DD
  saldo: number
  vencido: boolean
  porVencer: boolean // <= 90 días y no vencido
}

export interface StockBodegaItem {
  productoId: string
  codigo: string
  nombre: string
  sustanciaActiva: string | null
  activo: boolean
  costo: number
  precio: number
  stockMinimo: number
  existencias: number
  valorCosto: number // existencias * costo
  bajoMinimo: boolean
  proximaCaducidad: string | null // la más próxima (FEFO)
  lotes: StockBodegaLote[]
}

export interface StockBodegaResumen {
  skusConStock: number
  unidades: number
  valorCosto: number
  lotes: number
  bajoMinimo: number
  porVencer: number // # lotes por vencer (<= 90 días)
  vencidos: number // # lotes ya vencidos
}

export interface StockBodegaResult {
  resumen: StockBodegaResumen
  items: StockBodegaItem[]
}

// ── Traspaso bodega (matriz) → sucursal (USB) ───────────────────────────────
export interface TraspasoLineaFile {
  codigo: string
  nombre: string
  cantidad: number
  costo: number
  caducidad: string // YYYY-MM-DD
}

export interface TraspasoPayload {
  folio: string
  matriz: { id: string | null; propietario: string | null }
  bodegaOrigen: { id: string; codigo: string; nombre: string }
  sucursal: { id: string; codigo: string; nombre: string }
  items: TraspasoLineaFile[]
}

export interface TraspasoFile {
  tipo: 'TRASPASO_BODEGA_SUCURSAL'
  version: number
  generadoEn: string
  checksum: string
  payload: TraspasoPayload
}

export interface CrearTraspasoItemInput {
  codigo: string
  cantidad: number
}

export interface CrearTraspasoInput {
  bodegaOrigenId: string
  sucursalId: string
  items: CrearTraspasoItemInput[]
}

export interface TraspasoFaltante {
  codigo: string
  pedido: number
  disponible: number
}

export interface CrearTraspasoResult {
  ok: boolean
  cancelled?: boolean
  error?: string
  path?: string
  folio?: string
  lineas?: number
  unidades?: number
  faltantes?: TraspasoFaltante[]
}

export interface TraspasoPreview {
  filePath: string
  folio: string
  generadoEn: string
  bodegaOrigen: string
  sucursalNombre: string
  lineas: number
  unidades: number
  yaAplicado: boolean
  sucursalCoincide: boolean
}

export interface PickTraspasoResult {
  ok: boolean
  cancelled?: boolean
  error?: string
  preview?: TraspasoPreview
}

export interface AplicarTraspasoResult {
  ok: boolean
  error?: string
  folio?: string
  lotesCreados?: number
  unidades?: number
  noEncontrados?: string[]
}

// Historial de traspasos (matriz)
export interface TraspasoHistItem {
  folio: string
  fecha: string // ISO
  bodegaOrigen: string
  sucursalNombre: string
  lineas: number
  unidades: number
}

export interface TraspasoHistDetalle extends TraspasoHistItem {
  items: TraspasoLineaFile[]
}

export interface UpdatePrecioItemInput {
  productoId: string
  productoNombre: string // informativo
  codigo: string // informativo
  precioAnterior: number // informativo (para audit display)
  nuevoPrecio: number
  motivo: import('./types').MotivoPrecio
  nota?: string | null
}

export interface UpdatePreciosInput {
  cajeroId: string
  items: UpdatePrecioItemInput[]
}

export interface UpdatePreciosResult {
  actualizados: number
}

export interface UpdateIvaItemInput {
  productoId: string
  productoNombre: string // informativo
  codigo: string // informativo
  ivaModoAnterior: IvaModo // informativo (display)
  ivaPorcentajeAnterior: number // informativo
  nuevoModo: IvaModo
  nuevoPorcentaje: number // 0..100; ignorado si nuevoModo === 'exento'
}

export interface UpdateIvaInput {
  cajeroId: string
  items: UpdateIvaItemInput[]
}

export interface UpdateIvaResult {
  actualizados: number
}

export interface ProductoCatalogoItem {
  id: string
  codigo: string
  nombre: string
  sustanciaActiva: string | null
  descripcion: string | null
  laboratorio: string | null
  precio: number
  costo: number
  ivaPorcentaje: number
  ivaModo: IvaModo
  stockMaximo: number | null
  stockMinimo: number | null
  activo: boolean
  existenciasTotal: number
}

export interface CreateProductoInput {
  codigo: string
  nombre: string
  sustanciaActiva?: string | null
  descripcion?: string | null
  laboratorio?: string | null
  precio: number
  costo?: number
  ivaModo: IvaModo
  ivaPorcentaje: number
  stockMaximo?: number | null
  stockMinimo?: number | null
}

export interface UpdateProductoInput {
  id: string
  codigo: string
  nombre: string
  sustanciaActiva?: string | null
  descripcion?: string | null
  laboratorio?: string | null
  costo?: number
  stockMaximo?: number | null
  stockMinimo?: number | null
}

// ── Carga masiva de catálogo por CSV ───────────────────────────────────────
// Upsert por código: crea si no existe, actualiza datos + precio + IVA si existe.
// Pensado para la carga inicial / mantenimiento masivo del catálogo.
export interface BulkProductoRow {
  codigo: string
  nombre: string
  sustanciaActiva?: string | null
  descripcion?: string | null
  laboratorio?: string | null
  precio: number
  costo?: number | null
  ivaModo: IvaModo
  ivaPorcentaje: number
  stockMinimo?: number | null
  stockMaximo?: number | null
}

export interface BulkUpsertProductosInput {
  items: BulkProductoRow[]
}

export interface BulkUpsertProductosResult {
  creados: number
  actualizados: number
  errores: { fila: number; codigo: string; error: string }[]
}

export interface UsuarioListItem {
  id: string
  login: string
  nombre: string
  rol: string // nombre del tipo_usuario (ADMINISTRADOR, CAJERO, etc.)
  activo: boolean
  puedeCancelar: boolean
  createdAt: string // ISO
}

export interface CreateUsuarioInput {
  login: string
  nombre: string
  password: string
  rol: string // ADMINISTRADOR | CAJERO | SUPERVISOR | SUPERUSUARIO
  puedeCancelar: boolean
}

export interface UpdateUsuarioInput {
  id: string
  nombre: string
  rol: string
  puedeCancelar: boolean
}

export type CorteTipo = 'PARCIAL' | 'FINAL' | 'CAMBIO_TURNO'

export interface CreateCorteInput {
  cajeroId: string
  tipo: CorteTipo
}

export interface CorteTotales {
  foliosVendidos: number
  foliosCancelados: number
  subtotal: number
  iva: number
  total: number
  efectivo: number
  tarjeta: number
  transferencia: number
  otro: number
  entradasCaja: number
  salidasCaja: number
  cancelaciones: number
  efectivoEsperado: number
}

export interface CreateCorteResult {
  corteId: string
  folioInicio: number
  folioFin: number
  fecha: string // ISO
  tipo: CorteTipo
  totales: CorteTotales
}
