export type MetodoPago = 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'OTRO'

export type MotivoVenta =
  | 'VENTA'
  | 'AJUSTE'
  | 'CADUCIDAD'
  | 'CAMBIO'
  | 'DEVOLUCION'
  | 'TRASPASO'
  | 'MAL_ESTADO'

export type TipoCorte = 'FINAL' | 'PARCIAL' | 'CAMBIO_TURNO'

export type TipoMovCaja = 'ENTRADA' | 'SALIDA'

export type RolUsuario = 'CAJERO' | 'ADMINISTRADOR' | 'SUPERVISOR' | 'SUPERUSUARIO'

export type MotivoAjuste = 'MERMA' | 'CADUCIDAD' | 'FALTANTE' | 'CONTEO' | 'OTRO'

export type MotivoPrecio = 'CAMBIO_LISTA' | 'PROMOCION' | 'CORRECCION' | 'OTRO'

/**
 * Cómo aplica el IVA al precio de venta de un producto:
 *  - 'exento'   → no lleva IVA (tasa 0)
 *  - 'sumar'    → el precio es neto; el IVA se agrega al cobrar
 *  - 'incluido' → el precio ya trae IVA; se desglosa del total
 */
export type IvaModo = 'exento' | 'sumar' | 'incluido'

export type MotivoSalida =
  | 'CADUCIDAD'
  | 'MERMA'
  | 'TRASPASO'
  | 'MUESTRA'
  | 'AJUSTE'
  | 'OTRO'

export interface PrintResultLike {
  ok: boolean
  bytesSent: number
  stdout: string
  stderr: string
  exitCode: number | null
}

export interface AppSettings {
  printerName: string | null
  openDrawerOnCash: boolean
  showTimeOnReceipt: boolean
  receiptFooter: string | null
  // Qué líneas del encabezado se imprimen en los tickets (venta, cancelación,
  // corte). Permite ocultar p. ej. la razón social. Default: todo visible.
  ticketMostrarRazonSocial: boolean
  ticketMostrarRfc: boolean
  ticketMostrarSucursal: boolean
  ticketMostrarDireccion: boolean
  // Imprimir el folio ("Nota de mostrador") en el ticket de venta. Default: sí.
  ticketMostrarFolio: boolean
}
