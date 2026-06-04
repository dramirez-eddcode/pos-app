import { ElectronAPI } from '@electron-toolkit/preload'
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
      auth: {
        login: (loginName: string, password: string) => Promise<LoginResult>
      }
      empresa: {
        get: () => Promise<EmpresaDto | null>
        update: (viewerUserId: string, input: UpdateEmpresaInput) => Promise<EmpresaDto>
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
        farma: (viewerUserId: string, sucursalId: string) => Promise<ExportSucursalResult>
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
          opts?: { showTime?: boolean }
        ) => Promise<PrintResultLike>
        openDrawer: (printer: string) => Promise<PrintResultLike>
        printReceipt: (printer: string, data: ReceiptData) => Promise<PrintResultLike>
        printCancel: (printer: string, data: CancelReceiptData) => Promise<PrintResultLike>
        printCorte: (printer: string, data: CorteReceiptData) => Promise<PrintResultLike>
      }
    }
  }
}
