/**
 * API pública del módulo printer.
 * Todas las funciones son invocadas desde IPC handlers en src/main/index.ts.
 */

import { Escpos } from './escpos'
import {
  buildReceiptBytes,
  buildTestReceiptBytes,
  buildCancelReceiptBytes,
  buildCorteReceiptBytes,
  type ReceiptData,
  type CancelReceiptData,
  type CorteReceiptData
} from './receipt'
import { listPrinters, sendRawToPrinter, type PrintResult } from './windows'
import { getSettings } from '../services/settings'
import type {
  CancelReceiptData as CancelReceiptDataDto,
  CorteReceiptData as CorteReceiptDataDto,
  ReceiptData as ReceiptDataDto,
  ReceiptEmpresa
} from '@shared/receipt'

export async function getPrinters(): Promise<string[]> {
  return listPrinters()
}

/**
 * Aplica la configuración "qué imprimir en el encabezado del ticket": las
 * líneas desactivadas en Configuración (razón social, RFC, sucursal,
 * dirección) se vacían y el builder las omite. Punto único — aplica a venta,
 * cancelación y corte.
 */
function empresaSegunSettings(e: ReceiptEmpresa): ReceiptEmpresa {
  const s = getSettings()
  return {
    ...e,
    nombreComercial: s.ticketMostrarRazonSocial ? e.nombreComercial : '',
    rfc: s.ticketMostrarRfc ? (e.rfc ?? null) : null,
    sucursalNombre: s.ticketMostrarSucursal ? e.sucursalNombre : '',
    calle: s.ticketMostrarDireccion ? (e.calle ?? null) : null,
    colonia: s.ticketMostrarDireccion ? (e.colonia ?? null) : null,
    cp: s.ticketMostrarDireccion ? (e.cp ?? null) : null
  }
}

export async function printReceipt(printer: string, data: ReceiptDataDto): Promise<PrintResult> {
  const internal: ReceiptData = {
    ...data,
    empresa: empresaSegunSettings(data.empresa),
    fecha: new Date(data.fecha)
  }
  const bytes = buildReceiptBytes(internal)
  return sendRawToPrinter(printer, bytes)
}

export async function printCancellation(
  printer: string,
  data: CancelReceiptDataDto
): Promise<PrintResult> {
  const internal: CancelReceiptData = {
    ...data,
    empresa: empresaSegunSettings(data.empresa),
    fechaOriginal: new Date(data.fechaOriginal),
    fechaCancelacion: new Date(data.fechaCancelacion)
  }
  const bytes = buildCancelReceiptBytes(internal)
  return sendRawToPrinter(printer, bytes)
}

export async function printCorte(
  printer: string,
  data: CorteReceiptDataDto
): Promise<PrintResult> {
  const internal: CorteReceiptData = {
    ...data,
    empresa: empresaSegunSettings(data.empresa),
    fecha: new Date(data.fecha)
  }
  const bytes = buildCorteReceiptBytes(internal)
  return sendRawToPrinter(printer, bytes)
}

export interface PrintTestOpts {
  showTime?: boolean
  footer?: string | null
  // Vista previa del encabezado (valores aún sin guardar del panel de config)
  mostrarRazonSocial?: boolean
  mostrarRfc?: boolean
  mostrarSucursal?: boolean
  mostrarDireccion?: boolean
}

export async function printTest(printer: string, opts?: PrintTestOpts): Promise<PrintResult> {
  const bytes = buildTestReceiptBytes(opts)
  return sendRawToPrinter(printer, bytes)
}

/**
 * Abre el cajón mediante pulso ESC/POS. El cajón debe estar conectado por
 * RJ-11/12 al puerto "DK" de la impresora EPSON TM-T20III (pin 2 por default).
 */
export async function openCashDrawer(printer: string): Promise<PrintResult> {
  const bytes = new Escpos().init().drawerPulse(0, 50, 250).bytes()
  return sendRawToPrinter(printer, bytes)
}

export type { ReceiptData, PrintResult }
