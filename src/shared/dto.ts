/**
 * DTOs que viajan a través de IPC main ↔ renderer.
 * Son plain JSON-serializable — nada de Dates o clases.
 */

import type { IvaModo, MetodoPago } from './types'
import type { CorteParcialResumen, VentaTarjetaResumen } from './receipt'

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
  cp?: string | null
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
  // Credenciales del primer admin (SUPERUSUARIO). Requeridas cuando el archivo
  // no trae usuarios (los .farma actuales ya no los incluyen).
  adminLogin?: string
  adminNombre?: string
  adminPassword?: string
}

export interface CompleteWizardFromFarmaResult {
  ok: true
  sucursalNombre: string
  productos: number
  stockLotes: number
  stockNoEncontrados: number // renglones de stock cuyo código no está en el catálogo
  usuarios: number
}

export interface EmpresaDto {
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

export interface SucursalDto {
  id: string
  codigo: string
  nombre: string
  razonSocial: string | null
  rfc: string | null
  calle: string | null
  colonia: string | null
  cp: string | null
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
  cp?: string | null
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

// ── Proveedores (catálogo de la matriz, vinculable a entradas) ─────────────
export interface ProveedorDto {
  id: string
  nombre: string
  rfc: string | null
  telefono: string | null
  email: string | null
  contacto: string | null // persona de contacto / agente de ventas
  notas: string | null
  activo: boolean
  createdAt: string // ISO
  updatedAt: string // ISO
}

export interface CreateProveedorInput {
  nombre: string
  rfc?: string | null
  telefono?: string | null
  email?: string | null
  contacto?: string | null
  notas?: string | null
}

export interface UpdateProveedorInput extends CreateProveedorInput {
  id: string
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
    cp: string | null
    ciudad: string | null
    estado: string | null
  }
  productos: ExportFarmaProducto[]
  // Stock inicial opcional (solo se incluye en la PRIMERA exportación de una
  // sucursal que se migra del legacy). Se aplica únicamente en la primera
  // importación de la sucursal (no en actualizaciones posteriores).
  stockInicial?: ExportFarmaStockLote[]
  // LEGADO: archivos generados por versiones anteriores traían los usuarios
  // admin (con hash de contraseña). Ya NO se exportan — el .farma solo lleva
  // los datos básicos de la sucursal + catálogo. El wizard aún los acepta
  // para que esos archivos viejos sigan funcionando.
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
      stockNoEncontrados: number // renglones de stock cuyo código no está en el catálogo
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
  cp?: string | null
  ciudad?: string | null
  estado?: string | null
}

export interface UpdateEmpresaInput {
  nombreComercial: string
  razonSocial: string
  rfc?: string | null
  calle?: string | null
  colonia?: string | null
  cp?: string | null
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
  // Si se indica, existenciasTotal de los resultados = stock de ESA bodega
  // (matriz multi-bodega); si no, es la suma global.
  bodegaId?: string | null
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

// ── Resumen de surtido a sucursales (admin) ────────────────────────────────
// Consolidado de TODOS los traspasos a sucursal de un rango de fechas: cada
// producto UNA sola vez con el total enviado y la existencia que queda. Base
// para armar la lista de faltantes / el pedido a proveedor de la semana.
export interface ResumenSurtidoItem {
  codigo: string
  nombre: string
  enviado: number
  existencia: number
  /** A cuántos destinos distintos se envió este producto en el rango. */
  destinos: number
}

export interface ResumenSurtidoTraspaso {
  numero: number
  fecha: string // ISO
  destino: string
  unidades: number
}

export interface ResumenSurtidoDto {
  desde: string // 'AAAA-MM-DD'
  hasta: string // 'AAAA-MM-DD'
  traspasos: ResumenSurtidoTraspaso[]
  items: ResumenSurtidoItem[]
  totalUnidades: number
}

// ── Actualización del sistema desde USB (admin) ────────────────────────────
export interface ActualizacionPreview {
  filePath: string
  fileName: string
  versionNueva: string
  versionActual: string
  /** 1 = más nueva, 0 = la misma, -1 = más vieja que la instalada. */
  comparacion: 1 | 0 | -1
}

export interface PickActualizacionResult {
  ok: boolean
  cancelled?: boolean
  error?: string
  preview?: ActualizacionPreview
}

export interface AplicarActualizacionResult {
  ok: boolean
  error?: string
  backupPath?: string
}

// ── Pedidos de surtido a sucursal (prellenado por cajeras, aprobado en matriz) ─
export type PedidoEstado = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'

/**
 * SUCURSAL: surtir a otra farmacia (al aprobar genera el traspaso real).
 * PROVEEDOR: lista de faltantes para pedirle al proveedor (al aprobar sólo se
 * marca; la mercancía entra después con una Entrada de mercancía normal).
 */
export type PedidoTipo = 'SUCURSAL' | 'PROVEEDOR'

export interface PedidoLinea {
  codigo: string
  nombre: string
  cantidad: number
}

export interface PedidoTraspasoDto {
  id: string
  numero: number // folio corto para mostrar: P-<numero>
  tipo: PedidoTipo
  estado: PedidoEstado
  sucursalId: string | null
  sucursalCodigo: string
  sucursalNombre: string
  /** Bodega elegida al capturar (pedidos SUCURSAL en matriz multi-bodega). */
  bodegaId: string | null
  bodegaNombre: string | null
  creadoNombre: string | null
  fechaCreado: string // ISO
  revisadoNombre: string | null
  fechaRevision: string | null // ISO
  traspasoFolio: string | null // UUID del traspaso generado al aprobar
  notas: string | null
  items: PedidoLinea[]
}

export interface CreatePedidoInput {
  /** Sucursal del catálogo de la matriz… */
  sucursalId?: string | null
  /** …o destino EXTERNO escrito a mano (clientes fuera del catálogo)… */
  destinoNombre?: string | null
  /** …o PROVEEDOR del catálogo (pedido de compra)… */
  proveedorId?: string | null
  /** …o proveedor escrito a mano. */
  proveedorNombre?: string | null
  /**
   * Bodega que surtirá (pedidos SUCURSAL/externo). Con UNA bodega activa el
   * backend la toma sola; con varias es obligatoria — así el pedido no sale
   * de una bodega equivocada.
   */
  bodegaId?: string | null
  items: PedidoLinea[]
  notas?: string | null
}

/** Proveedor mínimo para el selector del pedido (cualquier rol logueado). */
export interface ProveedorBasicoDto {
  id: string
  nombre: string
}

/** Sucursal mínima para el selector de destino (sin datos sensibles; cualquier rol). */
export interface SucursalBasicaDto {
  id: string
  codigo: string
  nombre: string
}

// ── Fusión de códigos duplicados (cero inicial) ────────────────────────────
// El legacy pierde los ceros iniciales del EAN, generando pares como
// "0780083140588" / "780083140588" del mismo producto. La fusión conserva el
// código CORTO (sin ceros — como lo maneja el negocio; la búsqueda tolera el
// cero al escanear), suma las existencias moviendo los lotes (sin alterar
// cantidades), deja el precio MÁS ALTO y elimina el duplicado.
export interface DedupParItem {
  codigoQueda: string
  codigoElimina: string
  nombre: string
  existenciaQueda: number
  existenciaElimina: number
  precioQueda: number
  precioElimina: number
  /** Precio que quedará tras fusionar (el del producto actualizado más recientemente). */
  precioFinal: number
}

export interface DedupPreviewResult {
  pares: DedupParItem[]
}

export interface DedupApplyResult {
  fusionados: number
  unidadesMovidas: number
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
  // Cambio entregado al cliente y total recibido (pagos + cambio). El pago
  // EFECTIVO en `pagos` va NETO (lo que quedó en caja).
  cambio: number
  recibido: number
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
  // Método de pago de la nota: EFECTIVO/TARJETA/TRANSFERENCIA/OTRO, o
  // 'MIXTO' si combinó varios. null si no tiene pagos registrados.
  metodo: string | null
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

// Listado de ventas de un día arbitrario (SUPERUSUARIO/ADMINISTRADOR: consulta
// con filtro de calendario, sin límite al periodo del corte actual).
export interface VentasDiaDto {
  dia: string // 'AAAA-MM-DD' consultado (día local)
  ventas: CorteFolioRow[]
  foliosVendidos: number
  foliosCancelados: number
  totalVendido: number
  montoCancelado: number
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
  // Proveedor POR RENGLÓN (opcional): una entrada puede mezclar mercancía de
  // varios proveedores.
  proveedorId?: string | null
}

export interface CreateEntradaInput {
  usuarioId: string
  bodegaId: string // bodega destino del inventario
  items: EntradaItemInput[]
  motivo?: string | null
}

export interface CreateEntradaResult {
  movimientoId: string // folio UUID del documento en el historial de movimientos
  numero: number // folio numérico (mostrar como E-<numero>)
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
  // Bodega de la que sale la mercancía. Si se indica, todos los lotes deben
  // pertenecer a ella (en sucursal puede omitirse: sólo hay Bodega Principal).
  bodegaId?: string | null
  items: SalidaItemInput[]
}

export interface CreateSalidaResult {
  movimientoId: string // folio UUID del documento en el historial de movimientos
  numero: number // folio numérico (mostrar como S-<numero>)
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
  loteId: string
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

// ── Reporte imprimible de stock por bodega (PDF / impresión directa) ────────
// El renderer manda lo que se ve en pantalla (filtros aplicados) + el resumen
// global de la bodega; el main arma el documento.
export interface StockBodegaPdfItem {
  codigo: string
  nombre: string
  sustanciaActiva: string | null
  existencias: number
  stockMinimo: number
  bajoMinimo: boolean
  valorCosto: number
  proximaCaducidad: string | null // YYYY-MM-DD
  vencido: boolean // el lote más próximo ya venció
  porVencer: boolean // el lote más próximo vence en ≤90 días
}

export interface StockBodegaPdfInput {
  bodegaNombre: string
  resumen: StockBodegaResumen
  filtroDescripcion: string | null // filtros activos en pantalla (se imprimen)
  items: StockBodegaPdfItem[]
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
  // Destino — exactamente uno de los dos:
  //  - sucursalId: en MATRIZ, del catálogo de sucursales.
  //  - destino: en SUCURSAL el destino es libre (no hay catálogo local);
  //    sirve para mandar a cualquier sucursal o de regreso a la matriz.
  sucursalId?: string
  destino?: { codigo: string; nombre: string }
  items: CrearTraspasoItemInput[]
}

export interface TraspasoFaltante {
  codigo: string
  pedido: number
  disponible: number
}

// Traspaso INTERNO entre bodegas de la misma instalación (sin archivo USB):
// descuenta FEFO de la bodega origen y crea los lotes en la destino, atómico.
export interface TraspasoBodegasInput {
  bodegaOrigenId: string
  bodegaDestinoId: string
  items: CrearTraspasoItemInput[]
}

export interface CrearTraspasoResult {
  ok: boolean
  cancelled?: boolean
  error?: string
  path?: string
  folio?: string // UUID interno
  numero?: number // folio numérico (mostrar como T-<numero>)
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
  // Renglones del traspaso, para revisarlos ANTES de aplicar.
  items: TraspasoLineaFile[]
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
  /** true si el archivo .traspaso se borró del origen (USB) tras aplicarse. */
  archivoEliminado?: boolean
}

// ── Historial unificado de movimientos (entradas / salidas / traspasos) ─────
export type MovimientoTipo = 'ENTRADA' | 'SALIDA' | 'TRASPASO'

export interface MovimientoLinea {
  codigo: string
  nombre: string
  cantidad: number
  costo: number
  caducidad: string | null // YYYY-MM-DD
  motivo?: string | null // motivo por línea (sólo salidas)
  // Proveedor por línea (sólo entradas). En documentos viejos no existe la
  // key (undefined) → el lector usa el proveedor a nivel documento.
  proveedor?: string | null
  // Se resuelve del catálogo al leer el detalle (no se guarda en items_json)
  sustancia?: string | null
}

export interface MovimientoHistItem {
  folio: string // UUID interno (sync por USB / anti-duplicado)
  numero: number // folio numérico consecutivo por tipo (mostrar como E-1/S-1/T-1)
  tipo: MovimientoTipo
  fecha: string // ISO
  bodega: string // bodega del movimiento (destino en ENTRADA, origen en SALIDA/TRASPASO)
  destino: string | null // destino (sólo TRASPASO): sucursal o bodega interna
  destinoTipo: 'SUCURSAL' | 'BODEGA' | null // qué es el destino (sólo TRASPASO)
  usuario: string | null
  proveedor: string | null // sólo ENTRADA (si se vinculó)
  lineas: number
  unidades: number
  valor: number // a costo
}

export interface MovimientoDetalle extends MovimientoHistItem {
  motivo: string | null
  items: MovimientoLinea[]
}

/** Folio corto para mostrar: E-1 (entrada), S-1 (salida), T-1 (traspaso). */
export function folioMovimiento(tipo: MovimientoTipo, numero: number): string {
  const p = tipo === 'ENTRADA' ? 'E' : tipo === 'SALIDA' ? 'S' : 'T'
  return `${p}-${numero}`
}

// ── Kárdex por producto ──────────────────────────────────────────────────
// Renglón del journal `mov_stock` de un producto, con saldo acumulado.
export type KardexTipo = 'ENTRADA' | 'SALIDA' | 'AJUSTE' | 'VENTA' | 'CANCELACION_VENTA'

export interface KardexItem {
  fecha: string // ISO
  tipo: KardexTipo
  cantidad: number // firmada: positivo entra, negativo sale
  saldo: number // existencia del producto DESPUÉS de este movimiento
  motivo: string | null // limpio para mostrar (sin el "por <uuid>" de auditoría)
  referencia: string | null // p. ej. "Venta #123" / "Cancelación venta #123"
  caducidad: string | null // YYYY-MM-DD del lote afectado (null = sin caducidad)
  bodega: string | null
  // Folio (UUID) del documento de movimiento/traspaso al que pertenece este
  // renglón — para saltar a su detalle. null si no hay documento (ventas,
  // ajustes, carga inicial).
  docFolio: string | null
}

// Resultado de exportar un movimiento a PDF (para impresora normal)
export interface PdfMovimientoResult {
  ok: boolean
  cancelled?: boolean
  error?: string
  path?: string
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
  // Desglose de existencias por bodega (solo bodegas con saldo > 0). En matriz
  // permite ver de qué bodega es el stock; en sucursal suele ser una sola.
  existenciasPorBodega: { bodega: string; cantidad: number }[]
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

// ── Importación de archivo legacy (.dat del sistema viejo) ──────────────────
// El .dat (texto Windows-1252, campos separados por «æ») trae catálogo +
// precios. Se importa con un upsert SUAVE: crea nuevos y, en los existentes,
// sólo toca nombre/sustancia/precio/estatus — preserva costo, stock mín/máx,
// laboratorio, descripción e IVA ya configurados en este equipo.

/** Preview que devuelve `pick` para confirmar antes de aplicar. */
export interface ImportDatPreview {
  filePath: string
  fileName: string
  totalRegistros: number // registros leídos de la sección PRODUCTOS
  aCrear: number // códigos que no existen en el catálogo local
  aActualizar: number // códigos que ya existen
  aDesactivar: number // existentes que vienen con estatus 'D' (subconjunto de aActualizar)
  invalidos: number // registros con código/nombre/precio inválido (se omiten)
}

export type PickDatResult =
  | { ok: true; preview: ImportDatPreview }
  | { ok: false; cancelled?: boolean; error?: string }

export interface ApplyDatResult {
  creados: number
  actualizados: number
  desactivados: number // productos puestos en activo=0 por estatus 'D'
  sinCambio: number // existentes idénticos (no se tocaron)
  invalidos: string[] // códigos/renglones omitidos por datos inválidos
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

// Corte FINAL ya registrado (para reimpresión por admin)
export interface CorteFinalHistItem {
  id: string
  fecha: string // ISO
  folioInicio: number
  folioFin: number
  total: number
  cajero: string | null
}

// Datos para reimprimir el ticket de un corte (todo menos empresa, que la pone
// el renderer desde la sesión, igual que al imprimir el corte original)
export interface CorteReimpresionDto {
  fecha: string // ISO
  // Sólo cortes FINAL: inicio del periodo (fecha de la primera venta cubierta).
  fechaInicio?: string // ISO
  tipo: CorteTipo
  cajero: string
  folioInicio: number
  folioFin: number
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
  // Sólo cortes FINAL: parciales / cambios de turno del mismo día.
  parcialesDelDia?: CorteParcialResumen[]
  // Sólo cortes FINAL: notas cobradas con tarjeta (pago puro o mixto).
  ventasTarjeta?: VentaTarjetaResumen[]
}

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
  // Sólo cortes FINAL: inicio del periodo (fecha de la primera venta cubierta).
  fechaInicio?: string // ISO
  tipo: CorteTipo
  totales: CorteTotales
  // Sólo cortes FINAL: parciales / cambios de turno del mismo día (para el ticket).
  parcialesDelDia?: CorteParcialResumen[]
  // Sólo cortes FINAL: notas cobradas con tarjeta (pago puro o mixto).
  ventasTarjeta?: VentaTarjetaResumen[]
}
