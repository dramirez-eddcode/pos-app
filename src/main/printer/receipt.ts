/**
 * Renderer de tickets de venta.
 * Replica el layout del ticket legacy (foto de referencia — sucursal TORRES LANDA 02).
 */

import { Escpos, COLS_DEFAULT, itemLine, labelValue, padRight } from './escpos'
import { montoEnLetras } from './numero-a-letras'
import type { MetodoPago } from '@shared/types'
import type {
  CancelReceiptData as CancelReceiptDataDto,
  CorteReceiptData as CorteReceiptDataDto,
  ReceiptData as ReceiptDataDto,
  ReceiptEmpresa,
  ReceiptItem,
  ReceiptPago
} from '@shared/receipt'
export type { ReceiptEmpresa, ReceiptItem, ReceiptPago }

// ReceiptData local: recibe fecha como Date (construida a partir del DTO ISO).
export interface ReceiptData extends Omit<ReceiptDataDto, 'fecha'> {
  fecha: Date
}

export interface CancelReceiptData
  extends Omit<CancelReceiptDataDto, 'fechaOriginal' | 'fechaCancelacion'> {
  fechaOriginal: Date
  fechaCancelacion: Date
}

export interface CorteReceiptData extends Omit<CorteReceiptDataDto, 'fecha'> {
  fecha: Date
}

const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function formatFecha(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = MESES_ES[d.getMonth()]
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd}/${mm}/${yy}`
}

function formatMoney(n: number): string {
  return n.toFixed(2)
}

function formatFolio(n: string | number): string {
  const s = String(n)
  // "684,653" — separador de miles con coma al estilo legacy
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function tituloPorPagos(pagos: ReceiptPago[]): string {
  if (pagos.length === 0) return 'Venta de Contado'
  if (pagos.length === 1) {
    switch (pagos[0]!.metodo) {
      case 'EFECTIVO':
        return 'Venta en Efectivo'
      case 'TARJETA':
        return 'Venta con Tarjeta'
      case 'TRANSFERENCIA':
        return 'Venta por Transferencia'
      default:
        return 'Venta'
    }
  }
  return 'Venta con Pago Mixto'
}

function metodoLabel(m: MetodoPago): string {
  switch (m) {
    case 'EFECTIVO':
      return 'EFECTIVO'
    case 'TARJETA':
      return 'TARJETA'
    case 'TRANSFERENCIA':
      return 'TRANSFER.'
    default:
      return 'OTRO'
  }
}

export function buildReceiptBytes(data: ReceiptData): Uint8Array {
  const p = new Escpos().init()

  // ── Header (centrado) ─────────────────────────────────────────────────────
  p.align('center')
  p.bold(true).line(data.empresa.nombreComercial.trim())
  if (data.empresa.rfc) p.line(data.empresa.rfc.trim())
  p.line(`Sucursal: ${data.empresa.sucursalNombre.trim()}`)
  p.bold(false)
  if (data.empresa.calle) p.line(data.empresa.calle.trim())
  if (data.empresa.colonia || data.empresa.cp) {
    const cp = data.empresa.cp ? ` C.P. ${data.empresa.cp}` : ''
    p.line(`${(data.empresa.colonia ?? '').trim()}${cp}`)
  }
  p.feed(1)

  // ── Folio + fecha (izquierda, con ": " alineado como en legacy) ───────────
  p.align('left')
  p.line(`Nota de mostrador : ${formatFolio(data.folio)}`)
  p.line(`Fecha de Venta    : ${formatFecha(data.fecha)}`)
  if (data.showTime) p.line(`Hora de Venta     : ${formatHora(data.fecha)}`)
  if (data.cajero) p.line(`Cajero            : ${data.cajero}`)
  p.feed(1)

  // ── Título según tipo de pago ─────────────────────────────────────────────
  p.align('center').line(tituloPorPagos(data.pagos))
  p.feed(1)

  // ── Tabla de items ────────────────────────────────────────────────────────
  p.align('left')
  p.separator()
  p.line(itemLine('Producto', 'Cant.', 'Precio', 'Total'))
  p.separator()
  for (const it of data.items) {
    p.line(
      itemLine(
        it.nombre,
        String(it.cantidad),
        formatMoney(it.precio),
        formatMoney(it.total)
      )
    )
  }
  // Mini-separador bajo la columna Total
  const underlineTotal = padRight('', COLS_DEFAULT - 8) + '--------'
  p.line(underlineTotal)

  // ── Totales (alineados a la derecha) ──────────────────────────────────────
  p.line(labelValue('IMPORTE', formatMoney(data.subtotal)))
  p.line(labelValue('IVA', formatMoney(data.iva)))
  p.feed(1)
  p.bold(true).line(labelValue('TOTAL', formatMoney(data.total))).bold(false)

  // ── Pagos ─────────────────────────────────────────────────────────────────
  if (data.pagos.length === 1 && data.pagos[0]!.metodo === 'EFECTIVO') {
    // Caso legacy clásico: EFECTIVO + CAMBIO
    p.line(labelValue('EFECTIVO', formatMoney(data.pagos[0]!.monto)))
    p.line(labelValue('CAMBIO', formatMoney(data.cambio)))
  } else {
    for (const pago of data.pagos) {
      const label = pago.referencia ? `${metodoLabel(pago.metodo)} ${pago.referencia}` : metodoLabel(pago.metodo)
      p.line(labelValue(label, formatMoney(pago.monto)))
    }
    if (data.cambio > 0) p.line(labelValue('CAMBIO', formatMoney(data.cambio)))
  }

  // ── Monto en letras + footer (mensaje custom o default) ──────────────────
  p.feed(1)
  p.line(montoEnLetras(data.total))
  p.feed(2)
  p.align('center').bold(true)
  const footerLines = (data.footer ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (footerLines.length > 0) {
    for (const ln of footerLines) p.line(ln)
  } else {
    p.line('¡ GRACIAS POR SU COMPRA !')
  }
  p.bold(false)
  p.feed(3)

  // ── Corte y (opcional) cajón ──────────────────────────────────────────────
  p.cut(true)
  if (data.openDrawer) p.drawerPulse(0, 50, 250)

  return p.bytes()
}

/**
 * Ticket de cancelación de venta. Layout minimal con bandera "CANCELADA"
 * prominente, datos del folio original + quién canceló + reintegro de stock.
 */
export function buildCancelReceiptBytes(data: CancelReceiptData): Uint8Array {
  const p = new Escpos().init()

  // Header de la sucursal (centrado)
  p.align('center')
  p.bold(true).line(data.empresa.nombreComercial.trim())
  if (data.empresa.rfc) p.line(data.empresa.rfc.trim())
  p.line(`Sucursal: ${data.empresa.sucursalNombre.trim()}`)
  p.bold(false)
  if (data.empresa.calle) p.line(data.empresa.calle.trim())
  if (data.empresa.colonia) p.line(data.empresa.colonia.trim())
  p.feed(1)

  // Bandera grande
  p.bold(true)
  p.line('*** CANCELACION DE VENTA ***')
  p.bold(false)
  p.feed(1)

  // Datos de la cancelación (izquierda)
  p.align('left')
  p.line(`Folio cancelado   : ${data.folioOriginal}`)
  p.line(`Fecha venta       : ${formatFecha(data.fechaOriginal)} ${formatHora(data.fechaOriginal)}`)
  p.line(`Fecha cancelacion : ${formatFecha(data.fechaCancelacion)} ${formatHora(data.fechaCancelacion)}`)
  p.line(`Cajero original   : ${data.cajeroOriginal}`)
  p.line(`Autorizo cancel.  : ${data.cajeroCancelador}`)
  if (data.motivo) p.line(`Motivo            : ${data.motivo}`)
  p.feed(1)

  // Total reintegrado
  p.bold(true).line(labelValue('TOTAL CANCELADO', data.totalCancelado.toFixed(2))).bold(false)
  p.feed(1)

  p.align('center')
  p.line('Los productos se reintegraron')
  p.line('al inventario.')
  p.feed(2)
  p.bold(true).line('CANCELACION REGISTRADA').bold(false)
  p.feed(3)

  p.cut(true)
  return p.bytes()
}

function formatHora(d: Date): string {
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'p.m.' : 'a.m.'
  h = h % 12 || 12
  return `${String(h).padStart(2, '0')}:${m} ${ampm}`
}

/**
 * Ticket de corte de caja (Z-tape). Imprime los totales de un rango de folios
 * (cerrado por un corte parcial, final, o cambio de turno), con desglose por
 * método de pago, movimientos de caja, y efectivo esperado físico.
 */
const TIPO_TITULO: Record<CorteReceiptData['tipo'], string> = {
  PARCIAL: 'CORTE PARCIAL',
  FINAL: 'CORTE FINAL',
  CAMBIO_TURNO: 'CAMBIO DE TURNO'
}

export function buildCorteReceiptBytes(data: CorteReceiptData): Uint8Array {
  const p = new Escpos().init()

  // Header sucursal
  p.align('center')
  p.bold(true).line(data.empresa.nombreComercial.trim())
  if (data.empresa.rfc) p.line(data.empresa.rfc.trim())
  p.line(`Sucursal: ${data.empresa.sucursalNombre.trim()}`)
  p.bold(false)
  p.feed(1)

  // Tipo de corte
  p.bold(true).line(`*** ${TIPO_TITULO[data.tipo]} ***`).bold(false)
  p.feed(1)

  // Datos generales
  p.align('left')
  p.line(`Fecha        : ${formatFecha(data.fecha)} ${formatHora(data.fecha)}`)
  p.line(`Cajero       : ${data.cajero}`)
  p.line(`Folios       : ${data.folioInicio} - ${data.folioFin}`)
  p.line(`Notas vend.  : ${data.foliosVendidos}`)
  p.line(`Canceladas   : ${data.foliosCancelados}`)
  p.feed(1)

  // Ventas por método
  p.align('center').line('--- VENTAS POR METODO ---')
  p.align('left')
  p.line(labelValue('Efectivo', data.efectivo.toFixed(2)))
  p.line(labelValue('Tarjeta', data.tarjeta.toFixed(2)))
  p.line(labelValue('Transferencia', data.transferencia.toFixed(2)))
  if (data.otro > 0) p.line(labelValue('Otros', data.otro.toFixed(2)))
  p.line(padRight('', COLS_DEFAULT - 10) + '----------')
  p.bold(true).line(labelValue('TOTAL VENDIDO', data.total.toFixed(2))).bold(false)
  p.feed(1)

  // Movimientos de caja
  p.align('center').line('--- MOVIMIENTOS DE CAJA ---')
  p.align('left')
  p.line(labelValue('Entradas caja', data.entradasCaja.toFixed(2)))
  p.line(labelValue('Salidas caja', data.salidasCaja.toFixed(2)))
  p.line(labelValue('Cancelaciones', data.cancelaciones.toFixed(2)))
  p.feed(1)

  // Desglose fiscal
  p.align('center').line('--- TOTALES DEL PERIODO ---')
  p.align('left')
  p.line(labelValue('Subtotal', data.subtotal.toFixed(2)))
  p.line(labelValue('IVA', data.iva.toFixed(2)))
  p.bold(true).line(labelValue('Total', data.total.toFixed(2))).bold(false)
  p.feed(1)

  // Efectivo esperado
  p.align('center').line('--- EFECTIVO ESPERADO ---')
  p.align('left')
  p.line(labelValue('Ventas en efectivo', data.efectivo.toFixed(2)))
  p.line(labelValue('+ Entradas caja', data.entradasCaja.toFixed(2)))
  p.line(labelValue('- Salidas caja', data.salidasCaja.toFixed(2)))
  p.line(padRight('', COLS_DEFAULT - 10) + '----------')
  p.bold(true).line(labelValue('EFECTIVO EN CAJA', data.efectivoEsperado.toFixed(2))).bold(false)
  p.feed(2)

  // Firma
  p.align('left').line('Firma del cajero:')
  p.feed(2)
  p.line('_'.repeat(Math.min(32, COLS_DEFAULT - 4)))
  p.feed(2)

  p.align('center').bold(true).line('FIN DEL CORTE').bold(false)
  p.feed(3)
  p.cut(true)

  return p.bytes()
}

/**
 * Ticket de prueba — se usa desde el panel de configuración para verificar
 * que la EPSON está bien cableada antes de operar.
 */
export function buildTestReceiptBytes(opts?: { showTime?: boolean }): Uint8Array {
  const now = new Date()
  return buildReceiptBytes({
    showTime: opts?.showTime ?? false,
    empresa: {
      nombreComercial: 'FARMACIAS MS - TICKET DE PRUEBA',
      rfc: '----',
      sucursalNombre: 'PRUEBAS',
      calle: 'Prueba de impresión',
      colonia: 'Desarrollo',
      cp: '00000'
    },
    folio: 1,
    fecha: now as unknown as Date, // cumple ReceiptData (fecha: Date)
    cajero: 'sistema',
    items: [
      { nombre: 'Producto demo 1', cantidad: 1, precio: 12.5, total: 12.5 },
      { nombre: 'Producto demo 2 - acentos áéíóú ñ', cantidad: 2, precio: 7.25, total: 14.5 }
    ],
    subtotal: 23.28,
    iva: 3.72,
    total: 27.0,
    pagos: [{ metodo: 'EFECTIVO', monto: 50 }],
    cambio: 23.0,
    openDrawer: false
  })
}
