import { ElectronAPI } from '@electron-toolkit/preload'
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

export interface SupabaseTestResult {
  ok: boolean
  latencyMs: number
  error?: string
  sucursalCount?: number
  schemaReady?: boolean
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      ping: () => Promise<string>
      supabase: {
        isConfigured: () => Promise<boolean>
        test: () => Promise<SupabaseTestResult>
      }
      settings: {
        get: () => Promise<AppSettings>
        update: (patch: Partial<AppSettings>) => Promise<AppSettings>
      }
      auth: {
        login: (loginName: string, password: string) => Promise<LoginResult>
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
