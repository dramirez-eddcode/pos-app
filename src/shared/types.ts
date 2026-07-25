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
  /** Impresora TÉRMICA (ESC/POS): SÓLO tickets de venta, cortes y cancelaciones. */
  printerName: string | null
  /**
   * Impresora de DOCUMENTOS (tamaño carta): hojas de pedidos/prellenados,
   * resumen de surtido y documentos del historial. null = preguntar con el
   * diálogo de Windows en cada impresión.
   */
  docPrinterName: string | null
  /**
   * Imprimir documentos a DOBLE CARA (si la impresora lo soporta) para
   * ahorrar papel. Sólo lo cambian SUPERUSUARIO/ADMINISTRADOR.
   */
  docPrinterDuplex: boolean
  openDrawerOnCash: boolean
  showTimeOnReceipt: boolean
  receiptFooter: string | null
  // Qué líneas del encabezado se imprimen en los tickets (venta, cancelación,
  // corte). Permite ocultar p. ej. la razón social. Default: todo visible.
  ticketMostrarRazonSocial: boolean
  ticketMostrarRfc: boolean
  ticketMostrarSucursal: boolean
  ticketMostrarDireccion: boolean
  // Imprimir la línea "Folio" en el ticket de venta. Default: sí.
  ticketMostrarFolio: boolean
  // Mostrar la tarjeta "Punto de venta" en el panel de matriz (equipo único
  // que gestiona y vende). Ocultarla evita vender desde este equipo.
  // Default: sí. Sólo la cambian SUPERUSUARIO/ADMINISTRADOR.
  matrizMostrarPuntoVenta: boolean
}
