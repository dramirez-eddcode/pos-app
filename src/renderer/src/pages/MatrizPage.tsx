import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Boxes,
  ArrowRightLeft,
  Merge,
  ClipboardList,
  Download,
  History,
  DatabaseBackup,
  LogOut,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  Percent,
  Settings as SettingsIcon,
  ShoppingCart,
  Store,
  Tags,
  Truck,
  Upload,
  Users,
  Warehouse
} from 'lucide-react'
import { useSession } from '../stores/session'
import { useSettings } from '../stores/settings'
import { useShortcut } from '../hooks/useShortcut'
import { fechaTicket, horaTicket } from '../lib/format'
import { formatRol } from '../lib/roles'
import { arrowFieldNav } from '../lib/arrowNav'
import CatalogoProductosModal from '../components/CatalogoProductosModal'
import Logo from '../components/Logo'
import EntradaModal from '../components/EntradaModal'
import CargaInicialModal from '../components/CargaInicialModal'
import StockBodegaModal from '../components/StockBodegaModal'
import TraspasoModal from '../components/TraspasoModal'
import MovimientosModal from '../components/MovimientosModal'
import SalidasModal from '../components/SalidasModal'
import ProveedoresModal from '../components/ProveedoresModal'
import RecibirTraspasoModal from '../components/RecibirTraspasoModal'
import PreciosModal from '../components/PreciosModal'
import SettingsModal from '../components/SettingsModal'
import SucursalesModal from '../components/SucursalesModal'
import UsuariosModal from '../components/UsuariosModal'
import RespaldoModal from '../components/RespaldoModal'
import IvaConfigModal from '../components/IvaConfigModal'
import BodegasModal from '../components/BodegasModal'
import DedupCodigosModal from '../components/DedupCodigosModal'
import PedidosRevisionModal from '../components/PedidosRevisionModal'
import Spinner from '../components/Spinner'

interface Props {
  propietarioNombre: string | null
  matrizId: string | null
  /** Cambia a la vista de punto de venta (equipo único matriz + ventas). */
  onAbrirPos: () => void
}

interface CatalogoStats {
  productos: number
  activos: number
}

const EXIT_TOAST_ID = 'matriz-logout-confirm'

export default function MatrizPage({ propietarioNombre, matrizId, onAbrirPos }: Props) {
  const { user, logout } = useSession()
  const { settings } = useSettings()
  const menuRef = useRef<HTMLElement>(null)
  const [sucursalesOpen, setSucursalesOpen] = useState(false)
  const [catalogoOpen, setCatalogoOpen] = useState(false)
  const [usuariosOpen, setUsuariosOpen] = useState(false)
  const [entradaOpen, setEntradaOpen] = useState(false)
  const [cargaInicialOpen, setCargaInicialOpen] = useState(false)
  const [stockBodegaOpen, setStockBodegaOpen] = useState(false)
  const [traspasoOpen, setTraspasoOpen] = useState(false)
  const [movimientosOpen, setMovimientosOpen] = useState(false)
  const [salidasOpen, setSalidasOpen] = useState(false)
  const [proveedoresOpen, setProveedoresOpen] = useState(false)
  const [recibirTraspasoOpen, setRecibirTraspasoOpen] = useState(false)
  const [preciosOpen, setPreciosOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [respaldoOpen, setRespaldoOpen] = useState(false)
  const [ivaOpen, setIvaOpen] = useState(false)
  const [bodegasOpen, setBodegasOpen] = useState(false)
  const [dedupOpen, setDedupOpen] = useState(false)
  const [pedidosOpen, setPedidosOpen] = useState(false)
  const [pedidosPendientes, setPedidosPendientes] = useState<number | null>(null)
  const [now, setNow] = useState<Date>(() => new Date())

  const [sucursalesCount, setSucursalesCount] = useState<{ total: number; activas: number } | null>(
    null
  )
  const [bodegasCount, setBodegasCount] = useState<{ total: number; activas: number } | null>(null)
  const [catalogoStats, setCatalogoStats] = useState<CatalogoStats | null>(null)
  const [usuariosCount, setUsuariosCount] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    if (!user) return
    try {
      const [sucs, bods, prods, users, pendPedidos] = await Promise.all([
        window.api.sucursales.list(user.id).catch(() => []),
        window.api.bodegas.list().catch(() => []),
        window.api.productos.listCatalogo(user.id).catch(() => []),
        window.api.usuarios.list(user.id).catch(() => []),
        window.api.pedidos.pendientes(user.id).catch(() => 0)
      ])
      setPedidosPendientes(pendPedidos)
      setSucursalesCount({
        total: sucs.length,
        activas: sucs.filter((s) => s.activa).length
      })
      setBodegasCount({
        total: bods.length,
        activas: bods.filter((b) => b.activa).length
      })
      setCatalogoStats({
        productos: prods.length,
        activos: prods.filter((p) => p.activo).length
      })
      setUsuariosCount(users.length)
    } catch (e) {
      console.error('[matriz refresh]', e)
    }
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Re-refresh cuando se cierran modales (datos cambiaron)
  useEffect(() => {
    if (!sucursalesOpen && !catalogoOpen && !usuariosOpen && !entradaOpen && !bodegasOpen && !salidasOpen) {
      refresh()
    }
  }, [sucursalesOpen, catalogoOpen, usuariosOpen, entradaOpen, bodegasOpen, salidasOpen, refresh])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  // F12 = cerrar sesión, igual que en el POS: el primer F12 pide confirmación
  // y un segundo F12 (o el botón del toast) confirma.
  const pendingLogoutRef = useRef(false)

  const confirmLogout = useCallback(() => {
    pendingLogoutRef.current = false
    toast.dismiss(EXIT_TOAST_ID)
    logout()
  }, [logout])

  const requestLogout = useCallback(() => {
    if (pendingLogoutRef.current) {
      confirmLogout()
      return
    }
    pendingLogoutRef.current = true
    toast.warning('¿Cerrar sesión?', {
      id: EXIT_TOAST_ID,
      description: `Saldrás como ${user?.nombre ?? ''}. Presiona F12 otra vez para confirmar, o ignóralo para continuar.`,
      duration: 6000,
      action: { label: 'Cerrar sesión', onClick: confirmLogout },
      onAutoClose: () => (pendingLogoutRef.current = false),
      onDismiss: () => (pendingLogoutRef.current = false)
    })
  }, [confirmLogout, user?.nombre])

  useShortcut([{ key: 'F12', handler: requestLogout }])

  if (!user) return null

  return (
    <div className="min-h-screen flex flex-col text-sm bg-muted/10">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto max-w-[1200px] px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={40} />
            <div>
              <h1 className="text-base font-semibold tracking-tight flex items-center gap-2">
                Farmacias MS
                <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider bg-blue-100 text-blue-900 rounded">
                  Matriz
                </span>
              </h1>
              <p className="text-xs text-muted-foreground">
                {propietarioNombre ? `Propietario: ${propietarioNombre}` : 'Panel administrativo'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="text-right text-muted-foreground">
              {fechaTicket(now)} {horaTicket(now)}
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="p-1.5 rounded hover:bg-muted"
              title="Configuración"
              aria-label="Configuración"
            >
              <SettingsIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={requestLogout}
              className="p-1.5 rounded hover:bg-muted"
              title="Cerrar sesión (F12)"
              aria-label="Cerrar sesión"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main: grid de tarjetas ────────────────────────────────────────── */}
      <main
        ref={menuRef}
        onKeyDown={(e) => arrowFieldNav(e, menuRef.current)}
        className="flex-1 mx-auto max-w-[1200px] w-full px-4 py-6"
      >
        <div className="mb-5">
          <h2 className="text-lg font-semibold">Panel de gestión</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Administra sucursales, catálogo y usuarios desde este equipo de bodega. Las
            actualizaciones se envían por USB a cada sucursal.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Punto de venta (equipo único: gestión + ventas). Se puede ocultar
              desde Configuración (matrizMostrarPuntoVenta). */}
          {(settings?.matrizMostrarPuntoVenta ?? true) && (
            <DashCard
              icon={<ShoppingCart className="size-5 text-green-700" />}
              titulo="Punto de venta"
              subtitulo="Vender en este equipo"
              descripcion="Abre la pantalla de ventas usando el inventario de esta matriz. Regresas al panel desde el botón de matriz."
              cta="Abrir punto de venta"
              onClick={onAbrirPos}
              accent="green"
            />
          )}

          {/* Sucursales */}
          <DashCard
            icon={<Store className="size-5 text-blue-600" />}
            titulo="Sucursales"
            subtitulo={
              sucursalesCount ? (
                `${sucursalesCount.activas} activas · ${sucursalesCount.total} en total`
              ) : (
                <Spinner label="Cargando…" size={12} />
              )
            }
            descripcion="Alta, edición y activación de sucursales del dueño."
            cta="Gestionar"
            onClick={() => setSucursalesOpen(true)}
            accent="blue"
          />

          {/* Bodegas */}
          <DashCard
            icon={<Warehouse className="size-5 text-cyan-600" />}
            titulo="Bodegas"
            subtitulo={
              bodegasCount ? (
                `${bodegasCount.activas} activas · ${bodegasCount.total} en total`
              ) : (
                <Spinner label="Cargando…" size={12} />
              )
            }
            descripcion="Almacenes de la matriz. El inventario y las entradas se separan por bodega."
            cta="Gestionar"
            onClick={() => setBodegasOpen(true)}
            accent="cyan"
          />

          {/* Catálogo */}
          <DashCard
            icon={<Boxes className="size-5 text-purple-600" />}
            titulo="Catálogo de productos"
            subtitulo={
              catalogoStats ? (
                `${catalogoStats.activos} activos · ${catalogoStats.productos} en total`
              ) : (
                <Spinner label="Cargando…" size={12} />
              )
            }
            descripcion="Productos globales que se sincronizan a todas las sucursales."
            cta="Gestionar"
            onClick={() => setCatalogoOpen(true)}
            accent="purple"
          />

          {/* Precios */}
          <DashCard
            icon={<Tags className="size-5 text-amber-600" />}
            titulo="Precios"
            subtitulo="Histórico con auditoría"
            descripcion="Actualiza precios de uno o varios productos con motivo."
            cta="Actualizar"
            onClick={() => setPreciosOpen(true)}
            accent="amber"
          />

          {/* Impuestos / IVA */}
          <DashCard
            icon={<Percent className="size-5 text-orange-600" />}
            titulo="Impuestos (IVA)"
            subtitulo="Tasa default del negocio"
            descripcion="Configura el IVA sugerido al crear productos. Viaja a las sucursales por USB."
            cta="Configurar"
            onClick={() => setIvaOpen(true)}
            accent="orange"
          />

          {/* Proveedores */}
          <DashCard
            icon={<Truck className="size-5 text-teal-700" />}
            titulo="Proveedores"
            subtitulo="Catálogo para entradas"
            descripcion="Alta y edición de proveedores. Vincúlalos al registrar entradas de mercancía."
            cta="Gestionar"
            onClick={() => setProveedoresOpen(true)}
            accent="teal"
          />

          {/* Entradas */}
          <DashCard
            icon={<PackagePlus className="size-5 text-green-700" />}
            titulo="Entradas de mercancía"
            subtitulo="Lotes con caducidad"
            descripcion="Registra compras / alta de inventario en la bodega central."
            cta="Registrar"
            onClick={() => setEntradaOpen(true)}
            accent="green"
          />

          {/* Salidas de inventario */}
          <DashCard
            icon={<PackageMinus className="size-5 text-red-700" />}
            titulo="Salidas de inventario"
            subtitulo="Caducidad, merma y más"
            descripcion="Retira producto de una bodega con motivo (caducado, dañado, muestra…)."
            cta="Registrar"
            onClick={() => setSalidasOpen(true)}
            accent="rose"
          />

          {/* Carga inicial de inventario (migración / arranque) */}
          <DashCard
            icon={<PackageCheck className="size-5 text-teal-700" />}
            titulo="Carga inicial de inventario"
            subtitulo="Migración / arranque"
            descripcion="Fija existencias desde CSV (idempotente). Ideal para migrar una sucursal."
            cta="Cargar"
            onClick={() => setCargaInicialOpen(true)}
            accent="green"
          />

          {/* Stock por bodega (consulta / inventario) */}
          <DashCard
            icon={<ClipboardList className="size-5 text-cyan-700" />}
            titulo="Stock por bodega"
            subtitulo="Inventario y caducidades"
            descripcion="Consulta existencias, valor y lotes por bodega. Exporta hoja de conteo."
            cta="Consultar"
            onClick={() => setStockBodegaOpen(true)}
            accent="cyan"
          />

          {/* Traspasos: a sucursal (USB) o entre bodegas (interno) */}
          <DashCard
            icon={<ArrowRightLeft className="size-5 text-violet-700" />}
            titulo="Traspasos"
            subtitulo="A sucursal (USB) o entre bodegas"
            descripcion="Descuenta de una bodega y genera el .traspaso para una sucursal, o mueve stock a otra bodega al instante."
            cta="Generar"
            onClick={() => setTraspasoOpen(true)}
            accent="purple"
          />

          {/* Recibir traspaso (de una sucursal) */}
          <DashCard
            icon={<Download className="size-5 text-violet-700" />}
            titulo="Recibir traspaso"
            subtitulo="Devoluciones de sucursal"
            descripcion="Carga un archivo .traspaso enviado por una sucursal y entra a la bodega que elijas."
            cta="Recibir"
            onClick={() => setRecibirTraspasoOpen(true)}
            accent="purple"
          />

          {/* Historial de movimientos */}
          <DashCard
            icon={<History className="size-5 text-violet-700" />}
            titulo="Historial de movimientos"
            subtitulo="Entradas · salidas · traspasos"
            descripcion="Consulta todos los movimientos de inventario, su detalle e imprime en PDF."
            cta="Ver"
            onClick={() => setMovimientosOpen(true)}
            accent="purple"
          />

          {/* Usuarios */}
          <DashCard
            icon={<Users className="size-5 text-indigo-600" />}
            titulo="Usuarios"
            subtitulo={
              usuariosCount != null ? (
                `${usuariosCount} registrados`
              ) : (
                <Spinner label="Cargando…" size={12} />
              )
            }
            descripcion="Admin matriz + usuarios semilla que viajan en el export USB."
            cta="Gestionar"
            onClick={() => setUsuariosOpen(true)}
            accent="indigo"
          />

          {/* Pedidos de surtido prellenados por cajeras — revisión/aprobación */}
          <DashCard
            icon={<ClipboardList className="size-5 text-amber-700" />}
            titulo="Pedidos de sucursales"
            subtitulo={
              pedidosPendientes != null ? (
                pedidosPendientes > 0 ? (
                  `${pedidosPendientes} pendiente${pedidosPendientes === 1 ? '' : 's'} de aprobar`
                ) : (
                  'Sin pendientes'
                )
              ) : (
                <Spinner label="Cargando…" size={12} />
              )
            }
            descripcion="Pedidos que prellenan las cajeras desde el punto de venta. Al aprobar se genera el traspaso y se descuenta el stock."
            cta="Revisar y aprobar"
            onClick={() => setPedidosOpen(true)}
            accent="orange"
            badge={pedidosPendientes ?? 0}
          />

          {/* Corregir códigos duplicados (cero inicial del legacy) */}
          <DashCard
            icon={<Merge className="size-5 text-amber-600" />}
            titulo="Códigos duplicados"
            subtitulo="Fusionar códigos con cero inicial"
            descripcion="Une productos repetidos (con y sin cero inicial): suma existencias al código correcto y unifica el precio."
            cta="Revisar y corregir"
            onClick={() => setDedupOpen(true)}
            accent="orange"
          />

          {/* Exportar a sucursal — abre Sucursales con el botón Exportar por fila */}
          <DashCard
            icon={<Upload className="size-5 text-rose-600" />}
            titulo="Exportar a sucursal"
            subtitulo='Archivo ".farma" listo para USB'
            descripcion="Genera el archivo con productos, precios y datos para enviar a una sucursal."
            cta="Exportar"
            onClick={() => setSucursalesOpen(true)}
            accent="rose"
          />

          {/* Respaldo */}
          <DashCard
            icon={<DatabaseBackup className="size-5 text-teal-600" />}
            titulo="Respaldo"
            subtitulo="Copia completa en USB"
            descripcion="Respalda toda la base de datos o restáurala. Hazlo al cierre del día o para mover el sistema a otra PC."
            cta="Respaldar"
            onClick={() => setRespaldoOpen(true)}
            accent="teal"
          />
        </div>
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-background">
        <div className="mx-auto max-w-[1200px] px-4 py-2 flex items-center justify-between text-[11px]">
          <div className="text-muted-foreground font-mono">
            MODO MATRIZ — esta computadora no realiza ventas{' '}
            {matrizId && <span className="ml-2 opacity-50">· id: {matrizId.slice(0, 8)}</span>}
          </div>
          <div className="text-right font-mono">
            <span className="text-muted-foreground">{formatRol(user.rol)}: </span>
            <span className="font-semibold">{user.nombre}</span>
          </div>
        </div>
      </footer>

      {/* ── Modales ───────────────────────────────────────────────────────── */}
      <SucursalesModal open={sucursalesOpen} onClose={() => setSucursalesOpen(false)} />
      <CatalogoProductosModal
        open={catalogoOpen}
        onClose={() => setCatalogoOpen(false)}
        permitirReemplazoExistencias
      />
      <UsuariosModal open={usuariosOpen} onClose={() => setUsuariosOpen(false)} />
      <EntradaModal open={entradaOpen} onClose={() => setEntradaOpen(false)} userId={user.id} />
      <CargaInicialModal
        open={cargaInicialOpen}
        onClose={() => setCargaInicialOpen(false)}
        userId={user.id}
      />
      <StockBodegaModal open={stockBodegaOpen} onClose={() => setStockBodegaOpen(false)} />
      <DedupCodigosModal open={dedupOpen} onClose={() => setDedupOpen(false)} onDone={refresh} />
      <PedidosRevisionModal
        open={pedidosOpen}
        onClose={() => {
          setPedidosOpen(false)
          refresh()
        }}
        onDone={refresh}
      />
      <TraspasoModal open={traspasoOpen} onClose={() => setTraspasoOpen(false)} userId={user.id} />
      <ProveedoresModal open={proveedoresOpen} onClose={() => setProveedoresOpen(false)} />
      <RecibirTraspasoModal
        open={recibirTraspasoOpen}
        onClose={() => setRecibirTraspasoOpen(false)}
        userId={user.id}
      />
      <MovimientosModal open={movimientosOpen} onClose={() => setMovimientosOpen(false)} />
      <SalidasModal
        open={salidasOpen}
        onClose={() => setSalidasOpen(false)}
        userId={user.id}
        userNombre={user.nombre}
      />
      <PreciosModal open={preciosOpen} onClose={() => setPreciosOpen(false)} userId={user.id} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <RespaldoModal open={respaldoOpen} onClose={() => setRespaldoOpen(false)} />
      <IvaConfigModal open={ivaOpen} onClose={() => setIvaOpen(false)} />
      <BodegasModal open={bodegasOpen} onClose={() => setBodegasOpen(false)} />
    </div>
  )
}

// ── Tarjeta del dashboard ───────────────────────────────────────────────────
type Accent =
  | 'blue'
  | 'purple'
  | 'amber'
  | 'green'
  | 'indigo'
  | 'rose'
  | 'teal'
  | 'orange'
  | 'cyan'
  | 'muted'

const ACCENT_BORDER: Record<Accent, string> = {
  blue: 'hover:border-blue-300',
  purple: 'hover:border-purple-300',
  amber: 'hover:border-amber-300',
  green: 'hover:border-green-300',
  indigo: 'hover:border-indigo-300',
  rose: 'hover:border-rose-300',
  teal: 'hover:border-teal-300',
  orange: 'hover:border-orange-300',
  cyan: 'hover:border-cyan-300',
  muted: ''
}

const ACCENT_BG: Record<Accent, string> = {
  blue: 'bg-blue-50',
  purple: 'bg-purple-50',
  amber: 'bg-amber-50',
  green: 'bg-green-50',
  indigo: 'bg-indigo-50',
  rose: 'bg-rose-50',
  teal: 'bg-teal-50',
  orange: 'bg-orange-50',
  cyan: 'bg-cyan-50',
  muted: 'bg-muted'
}

function DashCard({
  icon,
  titulo,
  subtitulo,
  descripcion,
  cta,
  onClick,
  disabled,
  accent,
  badge
}: {
  icon: ReactNode
  titulo: string
  subtitulo: ReactNode
  descripcion: string
  cta: string
  onClick?: () => void
  disabled?: boolean
  accent: Accent
  /** Contador tipo notificación (esquina superior derecha). Oculto si es 0/undefined. */
  badge?: number
}) {
  return (
    <div
      className={`relative flex flex-col bg-background border border-border rounded-lg p-4 transition-colors ${
        disabled ? 'opacity-60' : `${ACCENT_BORDER[accent]} hover:shadow-sm`
      }`}
    >
      {badge != null && badge > 0 && (
        <span
          className="absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center shadow"
          title={`${badge} pendiente${badge === 1 ? '' : 's'}`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      <div className="flex items-start gap-3 mb-3">
        <div className={`shrink-0 size-10 rounded ${ACCENT_BG[accent]} flex items-center justify-center`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold leading-tight">{titulo}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{subtitulo}</div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground flex-1 mb-3">{descripcion}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full px-3 py-1.5 border border-border rounded text-xs font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {cta}
      </button>
    </div>
  )
}
