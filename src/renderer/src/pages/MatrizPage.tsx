import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Boxes,
  Building,
  LogOut,
  PackagePlus,
  Settings as SettingsIcon,
  Store,
  Tags,
  Upload,
  Users
} from 'lucide-react'
import { useSession } from '../stores/session'
import { fechaTicket, horaTicket } from '../lib/format'
import { formatRol } from '../lib/roles'
import CatalogoProductosModal from '../components/CatalogoProductosModal'
import EntradaModal from '../components/EntradaModal'
import PreciosModal from '../components/PreciosModal'
import SettingsModal from '../components/SettingsModal'
import SucursalesModal from '../components/SucursalesModal'
import UsuariosModal from '../components/UsuariosModal'

interface Props {
  propietarioNombre: string | null
  matrizId: string | null
}

interface CatalogoStats {
  productos: number
  activos: number
}

const EXIT_TOAST_ID = 'matriz-logout-confirm'

export default function MatrizPage({ propietarioNombre, matrizId }: Props) {
  const { user, logout } = useSession()
  const [sucursalesOpen, setSucursalesOpen] = useState(false)
  const [catalogoOpen, setCatalogoOpen] = useState(false)
  const [usuariosOpen, setUsuariosOpen] = useState(false)
  const [entradaOpen, setEntradaOpen] = useState(false)
  const [preciosOpen, setPreciosOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [now, setNow] = useState<Date>(() => new Date())

  const [sucursalesCount, setSucursalesCount] = useState<{ total: number; activas: number } | null>(
    null
  )
  const [catalogoStats, setCatalogoStats] = useState<CatalogoStats | null>(null)
  const [usuariosCount, setUsuariosCount] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    if (!user) return
    try {
      const [sucs, prods, users] = await Promise.all([
        window.api.sucursales.list(user.id).catch(() => []),
        window.api.productos.listCatalogo(user.id).catch(() => []),
        window.api.usuarios.list(user.id).catch(() => [])
      ])
      setSucursalesCount({
        total: sucs.length,
        activas: sucs.filter((s) => s.activa).length
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
    if (!sucursalesOpen && !catalogoOpen && !usuariosOpen && !entradaOpen) {
      refresh()
    }
  }, [sucursalesOpen, catalogoOpen, usuariosOpen, entradaOpen, refresh])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const requestLogout = useCallback(() => {
    toast.warning('¿Cerrar sesión?', {
      id: EXIT_TOAST_ID,
      description: `Saldrás como ${user?.nombre ?? ''}.`,
      duration: 6000,
      action: { label: 'Cerrar sesión', onClick: () => logout() }
    })
  }, [user?.nombre, logout])

  if (!user) return null

  return (
    <div className="min-h-screen flex flex-col text-sm bg-muted/10">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto max-w-[1200px] px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded bg-blue-600 text-white flex items-center justify-center">
              <Building className="size-5" />
            </div>
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
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main: grid de tarjetas ────────────────────────────────────────── */}
      <main className="flex-1 mx-auto max-w-[1200px] w-full px-4 py-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold">Panel de gestión</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Administra sucursales, catálogo y usuarios desde este equipo de bodega. Las
            actualizaciones se envían por USB a cada sucursal.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Sucursales */}
          <DashCard
            icon={<Store className="size-5 text-blue-600" />}
            titulo="Sucursales"
            subtitulo={
              sucursalesCount
                ? `${sucursalesCount.activas} activas · ${sucursalesCount.total} en total`
                : 'Cargando…'
            }
            descripcion="Alta, edición y activación de sucursales del dueño."
            cta="Gestionar"
            onClick={() => setSucursalesOpen(true)}
            accent="blue"
          />

          {/* Catálogo */}
          <DashCard
            icon={<Boxes className="size-5 text-purple-600" />}
            titulo="Catálogo de productos"
            subtitulo={
              catalogoStats
                ? `${catalogoStats.activos} activos · ${catalogoStats.productos} en total`
                : 'Cargando…'
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

          {/* Usuarios */}
          <DashCard
            icon={<Users className="size-5 text-indigo-600" />}
            titulo="Usuarios"
            subtitulo={usuariosCount != null ? `${usuariosCount} registrados` : 'Cargando…'}
            descripcion="Admin matriz + usuarios semilla que viajan en el export USB."
            cta="Gestionar"
            onClick={() => setUsuariosOpen(true)}
            accent="indigo"
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
      <CatalogoProductosModal open={catalogoOpen} onClose={() => setCatalogoOpen(false)} />
      <UsuariosModal open={usuariosOpen} onClose={() => setUsuariosOpen(false)} />
      <EntradaModal open={entradaOpen} onClose={() => setEntradaOpen(false)} userId={user.id} />
      <PreciosModal open={preciosOpen} onClose={() => setPreciosOpen(false)} userId={user.id} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

// ── Tarjeta del dashboard ───────────────────────────────────────────────────
type Accent = 'blue' | 'purple' | 'amber' | 'green' | 'indigo' | 'rose' | 'muted'

const ACCENT_BORDER: Record<Accent, string> = {
  blue: 'hover:border-blue-300',
  purple: 'hover:border-purple-300',
  amber: 'hover:border-amber-300',
  green: 'hover:border-green-300',
  indigo: 'hover:border-indigo-300',
  rose: 'hover:border-rose-300',
  muted: ''
}

const ACCENT_BG: Record<Accent, string> = {
  blue: 'bg-blue-50',
  purple: 'bg-purple-50',
  amber: 'bg-amber-50',
  green: 'bg-green-50',
  indigo: 'bg-indigo-50',
  rose: 'bg-rose-50',
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
  accent
}: {
  icon: ReactNode
  titulo: string
  subtitulo: string
  descripcion: string
  cta: string
  onClick?: () => void
  disabled?: boolean
  accent: Accent
}) {
  return (
    <div
      className={`flex flex-col bg-background border border-border rounded-lg p-4 transition-colors ${
        disabled ? 'opacity-60' : `${ACCENT_BORDER[accent]} hover:shadow-sm`
      }`}
    >
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
