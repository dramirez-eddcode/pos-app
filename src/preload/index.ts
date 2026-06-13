import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppSettings, IvaModo, PrintResultLike } from '@shared/types'
import type {
  CancelVentaResult,
  CatalogoSucursalItem,
  CompleteWizardInput,
  CompleteWizardFromFarmaInput,
  CompleteWizardFromFarmaResult,
  PickWizardFarmaResult,
  CorteHoyDto,
  CorteTipo,
  CortePendienteDia,
  CorteFinalHistItem,
  CorteReimpresionDto,
  CreateAjustesInput,
  CreateAjustesResult,
  CreateCorteResult,
  CreateEntradaInput,
  CreateEntradaResult,
  CreateProductoInput,
  CreateSalidaInput,
  CreateSalidaResult,
  CargaInicialInput,
  CargaInicialResult,
  StockBodegaResult,
  StockBodegaPdfInput,
  CrearTraspasoInput,
  CrearTraspasoResult,
  TraspasoBodegasInput,
  PickTraspasoResult,
  AplicarTraspasoResult,
  MovimientoHistItem,
  MovimientoDetalle,
  PdfMovimientoResult,
  CreateSucursalInput,
  CreateUsuarioInput,
  CreateVentaInput,
  CreateVentaResult,
  ApplyFarmaResult,
  ApplyDatResult,
  PickDatResult,
  BodegaDto,
  BootstrapStateDto,
  BulkUpsertProductosInput,
  BulkUpsertProductosResult,
  ConfigDto,
  CreateBodegaInput,
  UpdateBodegaInput,
  EmpresaDto,
  ExportSucursalResult,
  ExportFarmaStockLote,
  InstalacionDto,
  PickFarmaResult,
  LoginResult,
  LoteInfo,
  ProductoCatalogoItem,
  ProductoDto,
  ProductoSearchQuery,
  ProveedorDto,
  CreateProveedorInput,
  UpdateProveedorInput,
  SetSucursalProductoInput,
  UpdateEmpresaInput,
  UpdateIvaInput,
  UpdateIvaResult,
  UpdatePreciosInput,
  UpdatePreciosResult,
  UpdateProductoInput,
  UpdateSucursalInput,
  UpdateUsuarioInput,
  UpdateConfigInput,
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
    pickWizardFarma: (): Promise<PickWizardFarmaResult> =>
      ipcRenderer.invoke('instalacion:pick-wizard-farma'),
    completeWizardFromFarma: (
      input: CompleteWizardFromFarmaInput
    ): Promise<CompleteWizardFromFarmaResult> =>
      ipcRenderer.invoke('instalacion:complete-wizard-farma', input),
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

  config: {
    get: (): Promise<ConfigDto> => ipcRenderer.invoke('config:get'),
    update: (viewerUserId: string, patch: UpdateConfigInput): Promise<ConfigDto> =>
      ipcRenderer.invoke('config:update', viewerUserId, patch)
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

  bodegas: {
    list: (): Promise<BodegaDto[]> => ipcRenderer.invoke('bodegas:list'),
    create: (viewerUserId: string, input: CreateBodegaInput): Promise<{ id: string }> =>
      ipcRenderer.invoke('bodegas:create', viewerUserId, input),
    update: (viewerUserId: string, input: UpdateBodegaInput): Promise<{ ok: true }> =>
      ipcRenderer.invoke('bodegas:update', viewerUserId, input),
    toggleActiva: (
      viewerUserId: string,
      bodegaId: string,
      activa: boolean
    ): Promise<{ ok: true }> =>
      ipcRenderer.invoke('bodegas:toggle-activa', viewerUserId, bodegaId, activa)
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
    farma: (
      viewerUserId: string,
      sucursalId: string,
      stockInicial?: ExportFarmaStockLote[]
    ): Promise<ExportSucursalResult> =>
      ipcRenderer.invoke('export:sucursal-farma', viewerUserId, sucursalId, stockInicial)
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

  importDat: {
    pick: (): Promise<PickDatResult> => ipcRenderer.invoke('import:pick-dat'),
    apply: (viewerUserId: string, filePath: string): Promise<ApplyDatResult> =>
      ipcRenderer.invoke('import:apply-dat', viewerUserId, filePath)
  },

  productos: {
    search: (query: ProductoSearchQuery): Promise<ProductoDto[]> =>
      ipcRenderer.invoke('productos:search', query),
    byCodigo: (codigo: string): Promise<ProductoDto | null> =>
      ipcRenderer.invoke('productos:by-codigo', codigo),
    getLotes: (productoId: string, bodegaId?: string | null): Promise<LoteInfo[]> =>
      ipcRenderer.invoke('productos:get-lotes', productoId, bodegaId ?? null),
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
      ipcRenderer.invoke('productos:toggle-activo', viewerUserId, productoId, activo),
    bulkUpsert: (
      viewerUserId: string,
      input: BulkUpsertProductosInput
    ): Promise<BulkUpsertProductosResult> =>
      ipcRenderer.invoke('productos:bulk-upsert', viewerUserId, input)
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
      ipcRenderer.invoke('corte:create', cajeroId, tipo),
    pendientesDias: (): Promise<CortePendienteDia[]> =>
      ipcRenderer.invoke('corte:pendientes-dias'),
    createFinalPendiente: (cajeroId: string, fechaYmd: string): Promise<CreateCorteResult> =>
      ipcRenderer.invoke('corte:create-final-pendiente', cajeroId, fechaYmd),
    finales: (viewerUserId: string): Promise<CorteFinalHistItem[]> =>
      ipcRenderer.invoke('corte:finales', viewerUserId),
    reimpresion: (viewerUserId: string, corteId: string): Promise<CorteReimpresionDto> =>
      ipcRenderer.invoke('corte:reimpresion', viewerUserId, corteId)
  },

  entradas: {
    create: (input: CreateEntradaInput): Promise<CreateEntradaResult> =>
      ipcRenderer.invoke('entradas:create', input)
  },

  proveedores: {
    list: (): Promise<ProveedorDto[]> => ipcRenderer.invoke('proveedores:list'),
    create: (viewerUserId: string, input: CreateProveedorInput): Promise<{ id: string }> =>
      ipcRenderer.invoke('proveedores:create', viewerUserId, input),
    update: (viewerUserId: string, input: UpdateProveedorInput): Promise<{ ok: true }> =>
      ipcRenderer.invoke('proveedores:update', viewerUserId, input),
    toggleActivo: (
      viewerUserId: string,
      proveedorId: string,
      activo: boolean
    ): Promise<{ ok: true }> =>
      ipcRenderer.invoke('proveedores:toggle-activo', viewerUserId, proveedorId, activo)
  },

  ajustes: {
    create: (input: CreateAjustesInput): Promise<CreateAjustesResult> =>
      ipcRenderer.invoke('ajustes:create', input)
  },

  salidas: {
    create: (input: CreateSalidaInput): Promise<CreateSalidaResult> =>
      ipcRenderer.invoke('salidas:create', input)
  },

  inventario: {
    cargaInicial: (input: CargaInicialInput): Promise<CargaInicialResult> =>
      ipcRenderer.invoke('inventario:carga-inicial', input),
    stockBodega: (bodegaId: string): Promise<StockBodegaResult> =>
      ipcRenderer.invoke('inventario:stock-bodega', bodegaId),
    stockPdf: (input: StockBodegaPdfInput): Promise<PdfMovimientoResult> =>
      ipcRenderer.invoke('inventario:stock-pdf', input),
    stockImprimir: (input: StockBodegaPdfInput): Promise<PdfMovimientoResult> =>
      ipcRenderer.invoke('inventario:stock-imprimir', input)
  },

  traspaso: {
    crear: (viewerUserId: string, input: CrearTraspasoInput): Promise<CrearTraspasoResult> =>
      ipcRenderer.invoke('traspaso:crear', viewerUserId, input),
    entreBodegas: (
      viewerUserId: string,
      input: TraspasoBodegasInput
    ): Promise<CrearTraspasoResult> =>
      ipcRenderer.invoke('traspaso:entre-bodegas', viewerUserId, input),
    pick: (): Promise<PickTraspasoResult> => ipcRenderer.invoke('traspaso:pick'),
    aplicar: (
      viewerUserId: string,
      filePath: string,
      force?: boolean,
      bodegaDestinoId?: string | null
    ): Promise<AplicarTraspasoResult> =>
      ipcRenderer.invoke('traspaso:aplicar', viewerUserId, filePath, force, bodegaDestinoId ?? null)
  },

  movimientos: {
    list: (): Promise<MovimientoHistItem[]> => ipcRenderer.invoke('movimientos:list'),
    detalle: (folio: string): Promise<MovimientoDetalle | null> =>
      ipcRenderer.invoke('movimientos:detalle', folio),
    pdf: (folio: string): Promise<PdfMovimientoResult> =>
      ipcRenderer.invoke('movimientos:pdf', folio),
    imprimir: (folio: string): Promise<PdfMovimientoResult> =>
      ipcRenderer.invoke('movimientos:imprimir', folio)
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
    printTest: (
      printer: string,
      opts?: {
        showTime?: boolean
        footer?: string | null
        mostrarRazonSocial?: boolean
        mostrarRfc?: boolean
        mostrarSucursal?: boolean
        mostrarDireccion?: boolean
        mostrarFolio?: boolean
      }
    ): Promise<PrintResultLike> => ipcRenderer.invoke('printer:print-test', printer, opts),
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
