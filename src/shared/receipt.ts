/**
 * Tipos compartidos main ↔ renderer para construir el ticket de impresión.
 * La implementación (generación de bytes ESC/POS) vive en src/main/printer/.
 */

import type { MetodoPago } from './types'

export interface ReceiptEmpresa {
  nombreComercial: string
  rfc?: string | null
  sucursalNombre: string
  calle?: string | null
  colonia?: string | null
  cp?: string | null
}

export interface ReceiptItem {
  nombre: string
  cantidad: number
  precio: number
  total: number
}

export interface ReceiptPago {
  metodo: MetodoPago
  monto: number
  referencia?: string | null
}

export interface ReceiptData {
  empresa: ReceiptEmpresa
  folio: string | number
  fecha: string // ISO — el main-process lo parsea a Date
  items: ReceiptItem[]
  subtotal: number
  iva: number
  total: number
  pagos: ReceiptPago[]
  cambio: number
  cajero?: string
  openDrawer?: boolean
  showTime?: boolean
  // Imprimir el folio ("Nota de mostrador"). Si es false, se omite. Default: sí.
  showFolio?: boolean
  footer?: string | null
}

export interface CancelReceiptData {
  empresa: ReceiptEmpresa
  folioOriginal: string | number
  fechaOriginal: string // ISO
  fechaCancelacion: string // ISO
  totalCancelado: number
  cajeroOriginal: string
  cajeroCancelador: string
  motivo?: string | null
}

export type CorteReceiptTipo = 'PARCIAL' | 'FINAL' | 'CAMBIO_TURNO'

/** Resumen de un corte parcial / cambio de turno del día (para el ticket del corte final). */
export interface CorteParcialResumen {
  tipo: CorteReceiptTipo
  fecha: string // ISO
  folioInicio: number
  folioFin: number
  total: number
}

export interface CorteReceiptData {
  empresa: ReceiptEmpresa
  fecha: string // ISO
  tipo: CorteReceiptTipo
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
  // Sólo en el corte FINAL: desglose de los cortes parciales / cambios de turno
  // hechos ese mismo día, para que el ticket final muestre parciales + total del día.
  parcialesDelDia?: CorteParcialResumen[]
}
