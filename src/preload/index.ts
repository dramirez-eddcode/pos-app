import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppSettings, IvaModo, PrintResultLike } from '@shared/types'
import type {
  CancelVentaResult,
  CorteHoyDto,
  CorteTipo,
  CreateAjustesInput,
  CreateAjustesResult,
  CreateCorteResult,
  CreateEntradaInput,
  CreateEntradaResult,
  CreateSalidaInput,
  CreateSalidaResult,
  CreateUsuarioInput,
  CreateVentaInput,
  CreateVentaResult,
  LoginResult,
  LoteInfo,
  ProductoDto,
  ProductoSearchQuery,
  UpdateIvaInput,
  UpdateIvaResult,
  UpdatePreciosInput,
  UpdatePreciosResult,
  UsuarioListItem,
  VentaDetailDto
} from '@shared/dto'
import type { CancelReceiptData, CorteReceiptData, ReceiptData } from '@shared/receipt'

interface SupabaseTestResult {
  ok: boolean
  latencyMs: number
  error?: string
  sucursalCount?: number
  schemaReady?: boolean
}

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('app:ping'),

  supabase: {
    isConfigured: (): Promise<boolean> => ipcRenderer.invoke('supabase:is-configured'),
    test: (): Promise<SupabaseTestResult> => ipcRenderer.invoke('supabase:test')
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
      ipcRenderer.invoke('productos:update-iva', input)
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
