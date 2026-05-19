/**
 * DTOs que viajan a través de IPC main ↔ renderer.
 * Son plain JSON-serializable — nada de Dates o clases.
 */

import type { IvaModo, MetodoPago } from './types'

export interface SessionUser {
  id: string
  login: string
  nombre: string
  tipoUsuarioId: number
  rol: string // nombre del rol: ADMINISTRADOR | CAJERO | SUPERVISOR | SUPERUSUARIO
  puedeCancelar: boolean
  sucursal: {
    id: string
    nombreComercial: string
    sucursalNombre: string
    rfc: string | null
    calle: string | null
    colonia: string | null
    ciudad: string | null
  } | null
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
