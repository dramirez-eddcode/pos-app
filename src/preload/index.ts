import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppSettings, IvaModo, PrintResultLike } from '@shared/types'
import type {
  CancelVentaResult,
  CatalogoSucursalItem,
  CompleteWizardInput,
  CorteHoyDto,
  CorteTipo,
  CreateAjustesInput,
  CreateAjustesResult,
  CreateCorteResult,
  CreateEntradaInput,
  CreateEntradaResult,
  CreateProductoInput,
  CreateSalidaInput,
  CreateSalidaResult,
  CreateSucursalInput,
  CreateUsuarioInput,
  CreateVentaInput,
  CreateVentaResult,
  ApplyFarmaResult,
  BootstrapStateDto,
  EmpresaDto,
  ExportSucursalResult,
  InstalacionDto,
  PickFarmaResult,
  LoginResult,
  LoteInfo,
  ProductoCatalogoItem,
  ProductoDto,
  ProductoSearchQuery,
  SetSucursalProductoInput,
  UpdateEmpresaInput,
  UpdateIvaInput,
  UpdateIvaResult,
  UpdatePreciosInput,
  UpdatePreciosResult,
  UpdateProductoInput,
  UpdateSucursalInput,
  UpdateUsuarioInput,
  UsuarioListItem,
  VentaDetailDto
} from '@shared/dto'
import type { SucursalDto } from '@shared/dto'
import type { CancelReceiptData, CorteReceiptData, ReceiptData } from '@shared/receipt'

interface BackupResultStub {
  ok: boolean
  path?: string
  bytes?: number
  error?: string
  cancelled?: boolean
}
interface RestoreResultStub {
  ok: boolean
  fromPath?: string
  error?: string
  cancelled?: boolean
}

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('app:ping'),
  reload: (): Promise<void> => ipcRenderer.invoke('app:reload'),

  instalacion: {
    get: (): Promise<InstalacionDto> => ipcRenderer.invoke('instalacion:get'),
    bootstrapState: (): Promise<BootstrapStateDto> =>
      ipcRenderer.invoke('instalacion:bootstrap-state'),
    completeWizard: (
      input: CompleteWizardInput
    ): Promise<{ ok: true; user: import('@shared/dto').SessionUser }> =>
      ipcRenderer.invoke('instalacion:complete-wizard', input),
    reset: (viewerUserId: string, currentPassword: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke('instalacion:reset', viewerUserId, currentPassword)
  },

  backup: {
    export: (): Promise<BackupResultStub> => ipcRenderer.invoke('backup:export'),
    import: (): Promise<RestoreResultStub> => ipcRenderer.invoke('backup:import')
  },

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:update', patch)
  },

  auth: {
    login: (loginName: string, password: string): Promise<LoginResult> =>
      ipcRenderer.invoke('auth:login', loginName, password)
  },

  empresa: {
    get: (): Promise<EmpresaDto | null> => ipcRenderer.invoke('empresa:get'),
    update: (viewerUserId: string, input: UpdateEmpresaInput): Promise<EmpresaDto> =>
      ipcRenderer.invoke('empresa:update', viewerUserId, input)
  },

  sucursales: {
    list: (viewerUserId: string): Promise<SucursalDto[]> =>
      ipcRenderer.invoke('sucursales:list', viewerUserId),
    create: (viewerUserId: string, input: CreateSucursalInput): Promise<{ id: string }> =>
      ipcRenderer.invoke('sucursales:create', viewerUserId, input),
    update: (viewerUserId: string, input: UpdateSucursalInput): Promise<{ ok: true }> =>
      ipcRenderer.invoke('sucursales:update', viewerUserId, input),
    toggleActiva: (
      viewerUserId: string,
      sucursalId: string,
      activa: boolean
    ): Promise<{ ok: true }> =>
      ipcRenderer.invoke('sucursales:toggle-activa', viewerUserId, sucursalId, activa)
  },

  sucursalProducto: {
    getCatalogo: (
      viewerUserId: string,
      sucursalId: string
    ): Promise<CatalogoSucursalItem[]> =>
      ipcRenderer.invoke('sucursal-producto:get-catalogo', viewerUserId, sucursalId),
    set: (viewerUserId: string, input: SetSucursalProductoInput): Promise<{ ok: true }> =>
      ipcRenderer.invoke('sucursal-producto:set', viewerUserId, input),
    clear: (
      viewerUserId: string,
      sucursalId: string,
      productoId: string
    ): Promise<{ ok: true }> =>
      ipcRenderer.invoke('sucursal-producto:clear', viewerUserId, sucursalId, productoId)
  },

  exportSucursal: {
    farma: (viewerUserId: string, sucursalId: string): Promise<ExportSucursalResult> =>
      ipcRenderer.invoke('export:sucursal-farma', viewerUserId, sucursalId)
  },

  importFarma: {
    pick: (): Promise<PickFarmaResult> => ipcRenderer.invoke('import:pick-farma'),
    apply: (
      viewerUserId: string,
      filePath: string,
      force?: boolean
    ): Promise<ApplyFarmaResult> =>
      ipcRenderer.invoke('import:apply-farma', viewerUserId, filePath, Boolean(force))
  },

  productos: {
    search: (query: ProductoSearchQuery): Promise<ProductoDto[]> =>
      ipcRenderer.invoke('productos:search', query),
    byCodigo: (codigo: string): Promise<ProductoDto | null> =>
      ipcRenderer.invoke('productos:by-codigo', codigo),
    getLotes: (productoId: string): Promise<LoteInfo[]> =>
      ipcRenderer.invoke('productos:get-lotes', productoId),
    getAllActivos: (): Promise<
      Array<{
        id: string
        codigo: string
        nombre: string
        precio: number
        costo: number
        ivaPorcentaje: number
        ivaModo: IvaModo
      }>
    > => ipcRenderer.invoke('productos:get-all-activos'),
    getAllLotesActivos: (): Promise<
      Array<{
        loteId: string
        productoId: string
        codigo: string
        nombre: string
        caducidad: string
        saldo: number
        total: number
      }>
    > => ipcRenderer.invoke('productos:get-all-lotes-activos'),
    updateIva: (input: UpdateIvaInput): Promise<UpdateIvaResult> =>
      ipcRenderer.invoke('productos:update-iva', input),
    listCatalogo: (viewerUserId: string): Promise<ProductoCatalogoItem[]> =>
      ipcRenderer.invoke('productos:list-catalogo', viewerUserId),
    create: (viewerUserId: string, input: CreateProductoInput): Promise<{ id: string }> =>
      ipcRenderer.invoke('productos:create', viewerUserId, input),
    update: (viewerUserId: string, input: UpdateProductoInput): Promise<{ ok: true }> =>
      ipcRenderer.invoke('productos:update', viewerUserId, input),
    toggleActivo: (
      viewerUserId: string,
      productoId: string,
      activo: boolean
    ): Promise<{ ok: true }> =>
      ipcRenderer.invoke('productos:toggle-activo', viewerUserId, productoId, activo)
  },

  ventas: {
    nextFolio: (): Promise<number> => ipcRenderer.invoke('ventas:next-folio'),
    create: (input: CreateVentaInput): Promise<CreateVentaResult> =>
      ipcRenderer.invoke('ventas:create', input),
    byFolio: (folio: number): Promise<VentaDetailDto | null> =>
      ipcRenderer.invoke('ventas:by-folio', folio),
    cancel: (ventaId: string, userId: string, motivo?: string | null): Promise<CancelVentaResult> =>
      ipcRenderer.invoke('ventas:cancel', ventaId, userId, motivo ?? null),
    totalesRecientes: (): Promise<{ antier: number; ayer: number; hoy: number }> =>
      ipcRenderer.invoke('ventas:totales-recientes')
  },

  corte: {
    hoy: (): Promise<CorteHoyDto> => ipcRenderer.invoke('corte:hoy'),
    create: (cajeroId: string, tipo: CorteTipo): Promise<CreateCorteResult> =>
      ipcRenderer.invoke('corte:create', cajeroId, tipo)
  },

  entradas: {
    create: (input: CreateEntradaInput): Promise<CreateEntradaResult> =>
      ipcRenderer.invoke('entradas:create', input)
  },

  ajustes: {
    create: (input: CreateAjustesInput): Promise<CreateAjustesResult> =>
      ipcRenderer.invoke('ajustes:create', input)
  },

  salidas: {
    create: (input: CreateSalidaInput): Promise<CreateSalidaResult> =>
      ipcRenderer.invoke('salidas:create', input)
  },

  precios: {
    update: (input: UpdatePreciosInput): Promise<UpdatePreciosResult> =>
      ipcRenderer.invoke('precios:update', input)
  },

  usuarios: {
    list: (viewerUserId: string): Promise<UsuarioListItem[]> =>
      ipcRenderer.invoke('usuarios:list', viewerUserId),
    create: (creatorUserId: string, input: CreateUsuarioInput): Promise<{ id: string }> =>
      ipcRenderer.invoke('usuarios:create', creatorUserId, input),
    update: (viewerUserId: string, input: UpdateUsuarioInput): Promise<void> =>
      ipcRenderer.invoke('usuarios:update', viewerUserId, input),
    resetPassword: (
      resetterUserId: string,
      targetUserId: string,
      newPassword: string
    ): Promise<void> =>
      ipcRenderer.invoke('usuarios:reset-password', resetterUserId, targetUserId, newPassword),
    toggleActivo: (
      viewerUserId: string,
      targetUserId: string,
      activo: boolean
    ): Promise<void> =>
      ipcRenderer.invoke('usuarios:toggle-activo', viewerUserId, targetUserId, activo)
  },

  printer: {
    list: (): Promise<string[]> => ipcRenderer.invoke('printer:list'),
    printTest: (printer: string, opts?: { showTime?: boolean }): Promise<PrintResultLike> =>
      ipcRenderer.invoke('printer:print-test', printer, opts),
    openDrawer: (printer: string): Promise<PrintResultLike> =>
      ipcRenderer.invoke('printer:open-drawer', printer),
    printReceipt: (printer: string, data: ReceiptData): Promise<PrintResultLike> =>
      ipcRenderer.invoke('printer:print-receipt', printer, data),
    printCancel: (printer: string, data: CancelReceiptData): Promise<PrintResultLike> =>
      ipcRenderer.invoke('printer:print-cancel', printer, data),
    printCorte: (printer: string, data: CorteReceiptData): Promise<PrintResultLike> =>
      ipcRenderer.invoke('printer:print-corte', printer, data)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (sandbox off scenario)
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
