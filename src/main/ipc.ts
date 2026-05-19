/**
 * Registro central de todos los IPC handlers del proceso principal.
 * Cada dominio (auth, productos, ventas, printer) expone sus funciones aquí
 * con un prefijo consistente: `<dominio>:<accion>`.
 */

import { ipcMain } from 'electron'
import { login } from './services/auth'
import {
  getAllActivos,
  getAllLotesActivos,
  getByCodigo,
  getLotesByProducto,
  searchProductos,
  updateIvaProductos
} from './services/productos'
import { peekNextFolio } from './services/folio'
import { cancelVenta, createVenta, getTotalesRecientes, getVentaByFolio } from './services/ventas'
import { createCorte, getCorteHoy } from './services/corte'
import { createEntrada } from './services/entradas'
import { createAjustes } from './services/ajustes'
import { createSalida } from './services/salidas'
import { updatePrecios } from './services/precios'
import {
  createUsuario,
  listUsuarios,
  resetPassword,
  toggleActivoUsuario
} from './services/usuarios'
import { testConnection as testSupabase } from './sync/supabase-client'
import { isSupabaseConfigured } from './config'
import {
  getPrinters,
  openCashDrawer,
  printCancellation,
  printCorte,
  printReceipt,
  printTest
} from './printer'
import { getSettings, updateSettings, type AppSettings } from './services/settings'
import type {
  CorteTipo,
  CreateAjustesInput,
  CreateEntradaInput,
  CreateSalidaInput,
  CreateUsuarioInput,
  CreateVentaInput,
  ProductoSearchQuery,
  UpdateIvaInput,
  UpdatePreciosInput
} from '@shared/dto'
import type { CancelReceiptData, CorteReceiptData, ReceiptData } from '@shared/receipt'

export function registerIpcHandlers(): void {
  // ── app ──────────────────────────────────────────────────────────────────
  ipcMain.handle('app:ping', () => 'pong')

  // ── supabase (Fase 3) ────────────────────────────────────────────────────
  ipcMain.handle('supabase:is-configured', () => isSupabaseConfigured())
  ipcMain.handle('supabase:test', async () => testSupabase())

  // ── settings ─────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', async () => getSettings())
  ipcMain.handle('settings:update', async (_e, patch: Partial<AppSettings>) => updateSettings(patch))

  // ── auth ─────────────────────────────────────────────────────────────────
  ipcMain.handle('auth:login', async (_e, loginName: string, password: string) => login(loginName, password))

  // ── productos ────────────────────────────────────────────────────────────
  ipcMain.handle('productos:search', async (_e, query: ProductoSearchQuery) => searchProductos(query))
  ipcMain.handle('productos:by-codigo', async (_e, codigo: string) => getByCodigo(codigo))
  ipcMain.handle('productos:get-lotes', async (_e, productoId: string) => getLotesByProducto(productoId))
  ipcMain.handle('productos:get-all-activos', async () => getAllActivos())
  ipcMain.handle('productos:get-all-lotes-activos', async () => getAllLotesActivos())
  ipcMain.handle('productos:update-iva', async (_e, input: UpdateIvaInput) =>
    updateIvaProductos(input)
  )

  // ── ventas ───────────────────────────────────────────────────────────────
  ipcMain.handle('ventas:next-folio', async () => peekNextFolio())
  ipcMain.handle('ventas:create', async (_e, input: CreateVentaInput) => createVenta(input))
  ipcMain.handle('ventas:by-folio', async (_e, folio: number) => getVentaByFolio(folio))
  ipcMain.handle('ventas:cancel', async (_e, ventaId: string, userId: string, motivo?: string | null) =>
    cancelVenta(ventaId, userId, motivo ?? null)
  )
  ipcMain.handle('ventas:totales-recientes', async () => getTotalesRecientes())

  // ── corte ────────────────────────────────────────────────────────────────
  ipcMain.handle('corte:hoy', async () => getCorteHoy())
  ipcMain.handle('corte:create', async (_e, cajeroId: string, tipo: CorteTipo) =>
    createCorte(cajeroId, tipo)
  )

  // ── entradas ─────────────────────────────────────────────────────────────
  ipcMain.handle('entradas:create', async (_e, input: CreateEntradaInput) => createEntrada(input))

  // ── ajustes de inventario ───────────────────────────────────────────────
  ipcMain.handle('ajustes:create', async (_e, input: CreateAjustesInput) => createAjustes(input))

  // ── salidas de inventario ──────────────────────────────────────────────
  ipcMain.handle('salidas:create', async (_e, input: CreateSalidaInput) => createSalida(input))

  // ── precios de venta ────────────────────────────────────────────────────
  ipcMain.handle('precios:update', async (_e, input: UpdatePreciosInput) => updatePrecios(input))

  // ── gestión de usuarios ─────────────────────────────────────────────────
  ipcMain.handle('usuarios:list', async (_e, viewerUserId: string) => listUsuarios(viewerUserId))
  ipcMain.handle('usuarios:create', async (_e, creatorUserId: string, input: CreateUsuarioInput) =>
    createUsuario(creatorUserId, input)
  )
  ipcMain.handle(
    'usuarios:reset-password',
    async (_e, resetterUserId: string, targetUserId: string, newPassword: string) =>
      resetPassword(resetterUserId, targetUserId, newPassword)
  )
  ipcMain.handle(
    'usuarios:toggle-activo',
    async (_e, viewerUserId: string, targetUserId: string, activo: boolean) =>
      toggleActivoUsuario(viewerUserId, targetUserId, activo)
  )

  // ── printer ──────────────────────────────────────────────────────────────
  ipcMain.handle('printer:list', async () => getPrinters())
  ipcMain.handle('printer:print-test', async (_e, printer: string, opts?: { showTime?: boolean }) =>
    printTest(printer, opts)
  )
  ipcMain.handle('printer:open-drawer', async (_e, printer: string) => openCashDrawer(printer))
  ipcMain.handle('printer:print-receipt', async (_e, printer: string, data: ReceiptData) =>
    printReceipt(printer, data)
  )
  ipcMain.handle('printer:print-cancel', async (_e, printer: string, data: CancelReceiptData) =>
    printCancellation(printer, data)
  )
  ipcMain.handle('printer:print-corte', async (_e, printer: string, data: CorteReceiptData) =>
    printCorte(printer, data)
  )
}
