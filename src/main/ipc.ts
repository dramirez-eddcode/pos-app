/**
 * Registro central de todos los IPC handlers del proceso principal.
 * Cada dominio (auth, productos, ventas, printer) expone sus funciones aquí
 * con un prefijo consistente: `<dominio>:<accion>`.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { login } from './services/auth'
import {
  completeWizard,
  getBootstrapState,
  getInstalacion,
  resetInstalacion
} from './services/instalacion'
import { exportBackup, importBackup } from './services/backup'
import {
  createSucursal,
  listSucursales,
  toggleActivaSucursal,
  updateSucursal
} from './services/sucursales'
import {
  createBodega,
  listBodegas,
  toggleActivaBodega,
  updateBodega
} from './services/bodegas'
import {
  clearSucursalProductoOverride,
  getCatalogoSucursal,
  setSucursalProductoOverride
} from './services/sucursalProducto'
import { exportarSucursalAFarma } from './services/exportSucursal'
import { applyFarma, pickFarma } from './services/importSucursal'
import {
  bulkUpsertProductos,
  createProducto,
  getAllActivos,
  getAllLotesActivos,
  getByCodigo,
  getLotesByProducto,
  listCatalogo,
  searchProductos,
  toggleActivoProducto,
  updateIvaProductos,
  updateProductoBasico
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
  toggleActivoUsuario,
  updateUsuario
} from './services/usuarios'
import { getEmpresa, updateEmpresa } from './services/empresa'
import {
  getPrinters,
  openCashDrawer,
  printCancellation,
  printCorte,
  printReceipt,
  printTest
} from './printer'
import { getSettings, updateSettings, type AppSettings } from './services/settings'
import { getConfig, updateConfig } from './services/config'
import type {
  BulkUpsertProductosInput,
  CompleteWizardInput,
  CorteTipo,
  CreateAjustesInput,
  CreateBodegaInput,
  UpdateBodegaInput,
  CreateEntradaInput,
  CreateProductoInput,
  CreateSalidaInput,
  CreateSucursalInput,
  CreateUsuarioInput,
  CreateVentaInput,
  ProductoSearchQuery,
  SetSucursalProductoInput,
  UpdateEmpresaInput,
  UpdateIvaInput,
  UpdatePreciosInput,
  UpdateProductoInput,
  UpdateSucursalInput,
  UpdateUsuarioInput,
  UpdateConfigInput
} from '@shared/dto'
import type { CancelReceiptData, CorteReceiptData, ReceiptData } from '@shared/receipt'

export function registerIpcHandlers(): void {
  // ── app ──────────────────────────────────────────────────────────────────
  ipcMain.handle('app:ping', () => 'pong')

  // ── instalación (wizard primer arranque + reset) ────────────────────────
  ipcMain.handle('instalacion:get', () => getInstalacion())
  ipcMain.handle('instalacion:bootstrap-state', () => getBootstrapState())
  ipcMain.handle('instalacion:complete-wizard', async (_e, input: CompleteWizardInput) =>
    completeWizard(input)
  )
  ipcMain.handle('instalacion:reset', async (_e, viewerUserId: string, currentPassword: string) =>
    resetInstalacion(viewerUserId, currentPassword)
  )

  // ── backup / restore ────────────────────────────────────────────────────
  ipcMain.handle('backup:export', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return exportBackup(win)
  })
  ipcMain.handle('backup:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return importBackup(win)
  })
  ipcMain.handle('app:reload', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    win?.reload()
  })

  // ── settings ─────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', async () => getSettings())
  ipcMain.handle('settings:update', async (_e, patch: Partial<AppSettings>) => updateSettings(patch))

  // ── config de negocio (IVA default, etc.) ────────────────────────────────
  ipcMain.handle('config:get', async () => getConfig())
  ipcMain.handle('config:update', async (_e, viewerUserId: string, patch: UpdateConfigInput) =>
    updateConfig(viewerUserId, patch)
  )

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
  ipcMain.handle('productos:list-catalogo', async (_e, viewerUserId: string) =>
    listCatalogo(viewerUserId)
  )
  ipcMain.handle('productos:create', async (_e, viewerUserId: string, input: CreateProductoInput) =>
    createProducto(viewerUserId, input)
  )
  ipcMain.handle('productos:update', async (_e, viewerUserId: string, input: UpdateProductoInput) =>
    updateProductoBasico(viewerUserId, input)
  )
  ipcMain.handle(
    'productos:toggle-activo',
    async (_e, viewerUserId: string, productoId: string, activo: boolean) =>
      toggleActivoProducto(viewerUserId, productoId, activo)
  )
  ipcMain.handle(
    'productos:bulk-upsert',
    async (_e, viewerUserId: string, input: BulkUpsertProductosInput) =>
      bulkUpsertProductos(viewerUserId, input)
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

  // ── sucursales (modo MATRIZ) ────────────────────────────────────────────
  ipcMain.handle('sucursales:list', async (_e, viewerUserId: string) =>
    listSucursales(viewerUserId)
  )
  ipcMain.handle('sucursales:create', async (_e, viewerUserId: string, input: CreateSucursalInput) =>
    createSucursal(viewerUserId, input)
  )
  ipcMain.handle('sucursales:update', async (_e, viewerUserId: string, input: UpdateSucursalInput) =>
    updateSucursal(viewerUserId, input)
  )
  ipcMain.handle(
    'sucursales:toggle-activa',
    async (_e, viewerUserId: string, sucursalId: string, activa: boolean) =>
      toggleActivaSucursal(viewerUserId, sucursalId, activa)
  )

  // ── bodegas (modo MATRIZ) ────────────────────────────────────────────────
  ipcMain.handle('bodegas:list', async () => listBodegas())
  ipcMain.handle('bodegas:create', async (_e, viewerUserId: string, input: CreateBodegaInput) =>
    createBodega(viewerUserId, input)
  )
  ipcMain.handle('bodegas:update', async (_e, viewerUserId: string, input: UpdateBodegaInput) =>
    updateBodega(viewerUserId, input)
  )
  ipcMain.handle(
    'bodegas:toggle-activa',
    async (_e, viewerUserId: string, bodegaId: string, activa: boolean) =>
      toggleActivaBodega(viewerUserId, bodegaId, activa)
  )

  // ── overrides por sucursal (catálogo diferenciado) ─────────────────────
  ipcMain.handle(
    'sucursal-producto:get-catalogo',
    async (_e, viewerUserId: string, sucursalId: string) =>
      getCatalogoSucursal(viewerUserId, sucursalId)
  )
  ipcMain.handle(
    'sucursal-producto:set',
    async (_e, viewerUserId: string, input: SetSucursalProductoInput) =>
      setSucursalProductoOverride(viewerUserId, input)
  )
  ipcMain.handle(
    'sucursal-producto:clear',
    async (_e, viewerUserId: string, sucursalId: string, productoId: string) =>
      clearSucursalProductoOverride(viewerUserId, sucursalId, productoId)
  )

  // ── export .farma matriz → sucursal ─────────────────────────────────────
  ipcMain.handle(
    'export:sucursal-farma',
    async (e, viewerUserId: string, sucursalId: string) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      return exportarSucursalAFarma(viewerUserId, sucursalId, win)
    }
  )

  // ── import .farma en modo SUCURSAL ──────────────────────────────────────
  ipcMain.handle('import:pick-farma', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return pickFarma(win)
  })
  ipcMain.handle(
    'import:apply-farma',
    async (_e, viewerUserId: string, filePath: string, force?: boolean) =>
      applyFarma(viewerUserId, filePath, { force: Boolean(force) })
  )

  // ── empresa / sucursal ──────────────────────────────────────────────────
  ipcMain.handle('empresa:get', async () => getEmpresa())
  ipcMain.handle('empresa:update', async (_e, viewerUserId: string, input: UpdateEmpresaInput) =>
    updateEmpresa(viewerUserId, input)
  )

  // ── gestión de usuarios ─────────────────────────────────────────────────
  ipcMain.handle('usuarios:list', async (_e, viewerUserId: string) => listUsuarios(viewerUserId))
  ipcMain.handle('usuarios:create', async (_e, creatorUserId: string, input: CreateUsuarioInput) =>
    createUsuario(creatorUserId, input)
  )
  ipcMain.handle('usuarios:update', async (_e, viewerUserId: string, input: UpdateUsuarioInput) =>
    updateUsuario(viewerUserId, input)
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
