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
import type {
  CancelReceiptData as CancelReceiptDataDto,
  CorteReceiptData as CorteReceiptDataDto,
  ReceiptData as ReceiptDataDto
} from '@shared/receipt'

export async function getPrinters(): Promise<string[]> {
  return listPrinters()
}

export async function printReceipt(printer: string, data: ReceiptDataDto): Promise<PrintResult> {
  const internal: ReceiptData = { ...data, fecha: new Date(data.fecha) }
  const bytes = buildReceiptBytes(internal)
  return sendRawToPrinter(printer, bytes)
}

export async function printCancellation(
  printer: string,
  data: CancelReceiptDataDto
): Promise<PrintResult> {
  const internal: CancelReceiptData = {
    ...data,
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
  const internal: CorteReceiptData = { ...data, fecha: new Date(data.fecha) }
  const bytes = buildCorteReceiptBytes(internal)
  return sendRawToPrinter(printer, bytes)
}

export async function printTest(
  printer: string,
  opts?: { showTime?: boolean; footer?: string | null }
): Promise<PrintResult> {
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
