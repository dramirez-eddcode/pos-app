import { ElectronAPI } from '@electron-toolkit/preload'
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
  CargaInicialInput,
  CargaInicialResult,
  StockBodegaResult,
  CrearTraspasoInput,
  CrearTraspasoResult,
  PickTraspasoResult,
  AplicarTraspasoResult,
  TraspasoHistItem,
  TraspasoHistDetalle,
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
  SessionUser,
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
  UpdateConfigInput,
  UsuarioListItem,
  VentaDetailDto,
  SucursalDto
} from '@shared/dto'
import type { CancelReceiptData, CorteReceiptData, ReceiptData } from '@shared/receipt'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      ping: () => Promise<string>
      reload: () => Promise<void>
      instalacion: {
        get: () => Promise<InstalacionDto>
        bootstrapState: () => Promise<BootstrapStateDto>
        completeWizard: (
          input: CompleteWizardInput
        ) => Promise<{ ok: true; user: SessionUser }>
        pickWizardFarma: () => Promise<PickWizardFarmaResult>
        completeWizardFromFarma: (
          input: CompleteWizardFromFarmaInput
        ) => Promise<CompleteWizardFromFarmaResult>
        reset: (viewerUserId: string, currentPassword: string) => Promise<{ ok: true }>
      }
      backup: {
        export: () => Promise<{
          ok: boolean
          path?: string
          bytes?: number
          error?: string
          cancelled?: boolean
        }>
        import: () => Promise<{
          ok: boolean
          fromPath?: string
          error?: string
          cancelled?: boolean
        }>
      }
      settings: {
        get: () => Promise<AppSettings>
        update: (patch: Partial<AppSettings>) => Promise<AppSettings>
      }
      config: {
        get: () => Promise<ConfigDto>
        update: (viewerUserId: string, patch: UpdateConfigInput) => Promise<ConfigDto>
      }
      auth: {
        login: (loginName: string, password: string) => Promise<LoginResult>
      }
      empresa: {
        get: () => Promise<EmpresaDto | null>
        update: (viewerUserId: string, input: UpdateEmpresaInput) => Promise<EmpresaDto>
      }
      bodegas: {
        list: () => Promise<BodegaDto[]>
        create: (viewerUserId: string, input: CreateBodegaInput) => Promise<{ id: string }>
        update: (viewerUserId: string, input: UpdateBodegaInput) => Promise<{ ok: true }>
        toggleActiva: (
          viewerUserId: string,
          bodegaId: string,
          activa: boolean
        ) => Promise<{ ok: true }>
      }
      sucursales: {
        list: (viewerUserId: string) => Promise<SucursalDto[]>
        create: (
          viewerUserId: string,
          input: CreateSucursalInput
        ) => Promise<{ id: string }>
        update: (viewerUserId: string, input: UpdateSucursalInput) => Promise<{ ok: true }>
        toggleActiva: (
          viewerUserId: string,
          sucursalId: string,
          activa: boolean
        ) => Promise<{ ok: true }>
      }
      sucursalProducto: {
        getCatalogo: (
          viewerUserId: string,
          sucursalId: string
        ) => Promise<CatalogoSucursalItem[]>
        set: (
          viewerUserId: string,
          input: SetSucursalProductoInput
        ) => Promise<{ ok: true }>
        clear: (
          viewerUserId: string,
          sucursalId: string,
          productoId: string
        ) => Promise<{ ok: true }>
      }
      exportSucursal: {
        farma: (
          viewerUserId: string,
          sucursalId: string,
          stockInicial?: ExportFarmaStockLote[]
        ) => Promise<ExportSucursalResult>
      }
      importFarma: {
        pick: () => Promise<PickFarmaResult>
        apply: (
          viewerUserId: string,
          filePath: string,
          force?: boolean
        ) => Promise<ApplyFarmaResult>
      }
      productos: {
        search: (query: ProductoSearchQuery) => Promise<ProductoDto[]>
        byCodigo: (codigo: string) => Promise<ProductoDto | null>
        getLotes: (productoId: string) => Promise<LoteInfo[]>
        getAllActivos: () => Promise<
          Array<{
            id: string
            codigo: string
            nombre: string
            precio: number
            costo: number
            ivaPorcentaje: number
            ivaModo: IvaModo
          }>
        >
        getAllLotesActivos: () => Promise<
          Array<{
            loteId: string
            productoId: string
            codigo: string
            nombre: string
            caducidad: string
            saldo: number
            total: number
          }>
        >
        updateIva: (input: UpdateIvaInput) => Promise<UpdateIvaResult>
        listCatalogo: (viewerUserId: string) => Promise<ProductoCatalogoItem[]>
        create: (viewerUserId: string, input: CreateProductoInput) => Promise<{ id: string }>
        update: (viewerUserId: string, input: UpdateProductoInput) => Promise<{ ok: true }>
        toggleActivo: (
          viewerUserId: string,
          productoId: string,
          activo: boolean
        ) => Promise<{ ok: true }>
        bulkUpsert: (
          viewerUserId: string,
          input: BulkUpsertProductosInput
        ) => Promise<BulkUpsertProductosResult>
      }
      ventas: {
        nextFolio: () => Promise<number>
        create: (input: CreateVentaInput) => Promise<CreateVentaResult>
        byFolio: (folio: number) => Promise<VentaDetailDto | null>
        cancel: (ventaId: string, userId: string, motivo?: string | null) => Promise<CancelVentaResult>
        totalesRecientes: () => Promise<{ antier: number; ayer: number; hoy: number }>
      }
      corte: {
        hoy: () => Promise<CorteHoyDto>
        create: (cajeroId: string, tipo: CorteTipo) => Promise<CreateCorteResult>
      }
      entradas: {
        create: (input: CreateEntradaInput) => Promise<CreateEntradaResult>
      }
      ajustes: {
        create: (input: CreateAjustesInput) => Promise<CreateAjustesResult>
      }
      salidas: {
        create: (input: CreateSalidaInput) => Promise<CreateSalidaResult>
      }
      inventario: {
        cargaInicial: (input: CargaInicialInput) => Promise<CargaInicialResult>
        stockBodega: (bodegaId: string) => Promise<StockBodegaResult>
      }
      traspaso: {
        crear: (viewerUserId: string, input: CrearTraspasoInput) => Promise<CrearTraspasoResult>
        pick: () => Promise<PickTraspasoResult>
        aplicar: (
          viewerUserId: string,
          filePath: string,
          force?: boolean
        ) => Promise<AplicarTraspasoResult>
        list: () => Promise<TraspasoHistItem[]>
        detalle: (folio: string) => Promise<TraspasoHistDetalle | null>
      }
      precios: {
        update: (input: UpdatePreciosInput) => Promise<UpdatePreciosResult>
      }
      usuarios: {
        list: (viewerUserId: string) => Promise<UsuarioListItem[]>
        create: (creatorUserId: string, input: CreateUsuarioInput) => Promise<{ id: string }>
        update: (viewerUserId: string, input: UpdateUsuarioInput) => Promise<void>
        resetPassword: (
          resetterUserId: string,
          targetUserId: string,
          newPassword: string
        ) => Promise<void>
        toggleActivo: (
          viewerUserId: string,
          targetUserId: string,
          activo: boolean
        ) => Promise<void>
      }
      printer: {
        list: () => Promise<string[]>
        printTest: (
          printer: string,
          opts?: { showTime?: boolean; footer?: string | null }
        ) => Promise<PrintResultLike>
        openDrawer: (printer: string) => Promise<PrintResultLike>
        printReceipt: (printer: string, data: ReceiptData) => Promise<PrintResultLike>
        printCancel: (printer: string, data: CancelReceiptData) => Promise<PrintResultLike>
        printCorte: (printer: string, data: CorteReceiptData) => Promise<PrintResultLike>
      }
    }
  }
}
