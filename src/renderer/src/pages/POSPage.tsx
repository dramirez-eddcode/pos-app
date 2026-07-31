import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Settings as SettingsIcon, Printer, LogOut, Warehouse, X } from 'lucide-react'
import { useSession } from '../stores/session'
import { useSettings } from '../stores/settings'
import { useShortcut } from '../hooks/useShortcut'
import SearchModal from '../components/SearchModal'
import PaymentModal from '../components/PaymentModal'
import SettingsModal from '../components/SettingsModal'
import FunctionsModal from '../components/FunctionsModal'
import CancelVentaModal from '../components/CancelVentaModal'
import CorteModal from '../components/CorteModal'
import ProcesosEspecialesModal from '../components/ProcesosEspecialesModal'
import ImportarDatModal from '../components/ImportarDatModal'
import EntradaModal from '../components/EntradaModal'
import CargaInicialModal from '../components/CargaInicialModal'
import RecibirTraspasoModal from '../components/RecibirTraspasoModal'
import TraspasoModal from '../components/TraspasoModal'
import AjustesModal from '../components/AjustesModal'
import PreciosModal from '../components/PreciosModal'
import SalidasModal from '../components/SalidasModal'
import MovimientosModal from '../components/MovimientosModal'
import ConsultaFolioModal from '../components/ConsultaFolioModal'
import SustanciaInfoModal from '../components/SustanciaInfoModal'
import UsuariosModal from '../components/UsuariosModal'
import SucursalModal from '../components/SucursalModal'
import CatalogoProductosModal from '../components/CatalogoProductosModal'
import ImportarFarmaModal from '../components/ImportarFarmaModal'
import RespaldoModal from '../components/RespaldoModal'
import DedupCodigosModal from '../components/DedupCodigosModal'
import PedidoSurtidoModal, {
  nuevoPedidoDraft,
  type PedidoDraft
} from '../components/PedidoSurtidoModal'
import Logo from '../components/Logo'
import Spinner from '../components/Spinner'
import { calcTotals, makeCartItem, precioConIva, type CartItem } from '../lib/cart'
import { fechaTicket, folio as fmtFolio, horaTicket, money } from '../lib/format'
import { formatRol, isAdminLike, isFullAdmin } from '../lib/roles'
import type { ProductoDto } from '@shared/dto'
import type { MetodoPago } from '@shared/types'
import type { ReceiptData, ReceiptPago } from '@shared/receipt'

const LOGOUT_TOAST_ID = 'logout-confirm'
const EXIT_TOAST_ID = 'exit-confirm'

interface Props {
  /**
   * Sólo en instalaciones MATRIZ con admin completo: regresa al panel de
   * gestión (equipo único que administra la bodega Y vende).
   */
  onVolverMatriz?: () => void
}

export default function POSPage({ onVolverMatriz }: Props = {}) {
  const { user, logout } = useSession()
  const { settings } = useSettings()

  const [folioNum, setFolioNum] = useState<number>(0)
  const [cart, setCart] = useState<CartItem[]>([])
  // Resumen de la ÚLTIMA venta cobrada con efectivo: al cerrarse el modal de
  // cobro la cajera perdía de vista cuánto le dieron y cuánto debía regresar.
  // Se queda a la vista hasta que empieza la siguiente venta (primer producto
  // capturado) o hasta que lo cierre a mano.
  const [ultimoCobro, setUltimoCobro] = useState<{
    folio: number
    total: number
    recibido: number
    cambio: number
  } | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number>(-1)
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<{ kind: 'info' | 'error'; msg: string } | null>(null)
  const [now, setNow] = useState<Date>(() => new Date())
  const [searchOpen, setSearchOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [functionsOpen, setFunctionsOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [corteOpen, setCorteOpen] = useState(false)
  const [procesosOpen, setProcesosOpen] = useState(false)
  const [entradaOpen, setEntradaOpen] = useState(false)
  const [cargaInicialOpen, setCargaInicialOpen] = useState(false)
  const [recibirTraspasoOpen, setRecibirTraspasoOpen] = useState(false)
  const [generarTraspasoOpen, setGenerarTraspasoOpen] = useState(false)
  const [salidasOpen, setSalidasOpen] = useState(false)
  const [ajustesOpen, setAjustesOpen] = useState(false)
  const [movimientosOpen, setMovimientosOpen] = useState(false)
  const [consultaFolioOpen, setConsultaFolioOpen] = useState(false)
  const [preciosOpen, setPreciosOpen] = useState(false)
  const [sustanciaOpen, setSustanciaOpen] = useState(false)
  const [usuariosOpen, setUsuariosOpen] = useState(false)
  const [sucursalOpen, setSucursalOpen] = useState(false)
  const [catalogoOpen, setCatalogoOpen] = useState(false)
  const [importarOpen, setImportarOpen] = useState(false)
  const [importarDatOpen, setImportarDatOpen] = useState(false)
  const [dedupOpen, setDedupOpen] = useState(false)
  const [respaldoOpen, setRespaldoOpen] = useState(false)
  // Pedidos de surtido en proceso (borradores minimizables — sólo matriz).
  const [esMatriz, setEsMatriz] = useState(false)
  const [pedidoDrafts, setPedidoDrafts] = useState<PedidoDraft[]>([])
  const [pedidoAbiertoId, setPedidoAbiertoId] = useState<string | null>(null)
  const [totalesRec, setTotalesRec] = useState<{
    antier: number
    ayer: number
    hoy: number
  } | null>(null)
  const [charging, setCharging] = useState(false)

  const codeRef = useRef<HTMLInputElement>(null)
  const pendingLogoutRef = useRef<boolean>(false)

  // ¿Es instalación MATRIZ? Habilita el prellenado de pedidos de surtido (F11).
  useEffect(() => {
    window.api.instalacion
      .get()
      .then((i) => setEsMatriz(i.configured === true && i.tipo === 'MATRIZ'))
      .catch(() => setEsMatriz(false))
  }, [])

  const abrirNuevoPedido = useCallback(() => {
    const d = nuevoPedidoDraft()
    setPedidoDrafts((prev) => [...prev, d])
    setPedidoAbiertoId(d.id)
  }, [])

  const descartarPedidoDraft = useCallback((id: string) => {
    toast.warning('¿Descartar este pedido en proceso?', {
      id: `pedido-descartar-${id}`,
      description: 'Se perderá lo capturado (aún no se había registrado).',
      duration: 8000,
      action: {
        label: 'Sí, descartar',
        onClick: () => setPedidoDrafts((prev) => prev.filter((x) => x.id !== id))
      }
    })
  }, [])

  const totals = useMemo(() => calcTotals(cart), [cart])
  const anyModalOpen =
    searchOpen ||
    paymentOpen ||
    settingsOpen ||
    functionsOpen ||
    cancelOpen ||
    corteOpen ||
    procesosOpen ||
    entradaOpen ||
    cargaInicialOpen ||
    recibirTraspasoOpen ||
    generarTraspasoOpen ||
    salidasOpen ||
    ajustesOpen ||
    movimientosOpen ||
    consultaFolioOpen ||
    preciosOpen ||
    sustanciaOpen ||
    usuariosOpen ||
    sucursalOpen ||
    catalogoOpen ||
    importarOpen ||
    importarDatOpen ||
    dedupOpen ||
    respaldoOpen ||
    pedidoAbiertoId !== null
  const isAdmin = isAdminLike(user)

  // ── Folio + reloj ────────────────────────────────────────────────────────
  const reloadFolio = useCallback(() => {
    window.api.ventas.nextFolio().then(setFolioNum)
  }, [])
  useEffect(reloadFolio, [reloadFolio])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!anyModalOpen) codeRef.current?.focus()
  }, [cart.length, anyModalOpen])

  // ── Carrito ──────────────────────────────────────────────────────────────
  const addProduct = useCallback(
    (prod: ProductoDto, qty = 1): boolean => {
      if (prod.existenciasTotal <= 0) {
        setStatus({ kind: 'error', msg: `"${prod.nombre}" sin existencias` })
        return false
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        setStatus({ kind: 'error', msg: `Cantidad inválida` })
        return false
      }
      const current = cart.find((x) => x.productoId === prod.id)?.cantidad ?? 0
      const newQty = current + qty
      if (newQty > prod.existenciasTotal) {
        const faltan = newQty - prod.existenciasTotal
        setStatus({
          kind: 'error',
          msg:
            current > 0
              ? `"${prod.nombre}" — ya llevas ${current}, faltan ${faltan} (stock ${prod.existenciasTotal})`
              : `"${prod.nombre}" solo tiene ${prod.existenciasTotal} en existencia`
        })
        return false
      }
      setCart((prev) => {
        const idx = prev.findIndex((x) => x.productoId === prod.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = makeCartItem(prod, newQty)
          return next
        }
        return [...prev, makeCartItem(prod, qty)]
      })
      setSelectedIdx((i) => (i < 0 ? 0 : i))
      setStatus(null)
      // Empieza otra venta → el cambio de la anterior ya no aplica.
      setUltimoCobro(null)
      return true
    },
    [cart]
  )

  const addByCode = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return

      // Soporte a multiplicador "<codigo>*<cantidad>". Ejemplos:
      //   16*3      → 3 unidades del código 16
      //   7501...*2 → 2 unidades del EAN
      // Si no hay *, agrega 1 unidad (comportamiento normal).
      let codigo = trimmed
      let qty = 1
      const mult = trimmed.match(/^(.+)\*(\d+)$/)
      if (mult) {
        codigo = mult[1]!.trim()
        qty = parseInt(mult[2]!, 10)
        if (!codigo || !Number.isFinite(qty) || qty <= 0) {
          setStatus({
            kind: 'error',
            msg: 'Formato inválido · usa código*cantidad (ej. 16*3)'
          })
          return
        }
      }

      const prod = await window.api.productos.byCodigo(codigo)
      if (!prod) {
        setStatus({ kind: 'error', msg: `Producto "${codigo}" no encontrado` })
        return
      }
      const added = addProduct(prod, qty)
      if (added) setCode('')
    },
    [addProduct]
  )

  const removeSelected = useCallback(() => {
    setCart((prev) => {
      if (selectedIdx < 0 || selectedIdx >= prev.length) return prev
      const next = prev.filter((_, i) => i !== selectedIdx)
      setSelectedIdx(Math.min(selectedIdx, next.length - 1))
      return next
    })
  }, [selectedIdx])

  const clearSale = useCallback(() => {
    if (anyModalOpen) return // el modal maneja su propio Esc
    if (cart.length === 0) {
      setCode('')
      setStatus(null)
      return
    }
    // OJO: nunca usar confirm()/alert() nativos aquí — en Electron dejan la
    // ventana sin foco de teclado (bug conocido de Chromium) y el POS queda
    // "bloqueado" (no se puede teclear) hasta cambiar de ventana y regresar.
    toast.warning('¿Descartar la venta en curso?', {
      id: 'descartar-venta',
      description: `${cart.length} producto${cart.length === 1 ? '' : 's'} en el carrito.`,
      duration: 8000,
      action: {
        label: 'Sí, descartar',
        onClick: () => {
          setCart([])
          setSelectedIdx(-1)
          setCode('')
          setStatus(null)
          codeRef.current?.focus()
        }
      }
    })
  }, [anyModalOpen, cart.length])

  // ── Logout con confirmación (toast) ──────────────────────────────────────
  const confirmLogout = useCallback(() => {
    pendingLogoutRef.current = false
    toast.dismiss(LOGOUT_TOAST_ID)
    logout()
  }, [logout])

  // ── Atajo Pausa: toggle del indicador MS An- / A- / H- ───────────────────
  const toggleTotalesRecientes = useCallback(async () => {
    if (totalesRec) {
      setTotalesRec(null)
      return
    }
    try {
      const t = await window.api.ventas.totalesRecientes()
      setTotalesRec(t)
    } catch (e) {
      console.error('[totales-recientes] error:', e)
    }
  }, [totalesRec])

  const requestLogout = useCallback(() => {
    if (pendingLogoutRef.current) {
      confirmLogout()
      return
    }
    pendingLogoutRef.current = true
    toast.warning('¿Cerrar sesión?', {
      id: LOGOUT_TOAST_ID,
      description: `Saldrás como ${user?.nombre ?? ''}. Presiona F12 otra vez para confirmar, o ignóralo para continuar.`,
      duration: 6000,
      action: { label: 'Cerrar sesión', onClick: confirmLogout },
      onAutoClose: () => (pendingLogoutRef.current = false),
      onDismiss: () => (pendingLogoutRef.current = false)
    })
  }, [confirmLogout, user?.nombre])

  // ── Abrir modal de cobro (valida que haya algo que cobrar) ───────────────
  // Sin impresora configurada NO se bloquea: la venta se registra normal y
  // simplemente no se imprime ticket (sucursales que operan sin impresora).
  const startCobro = useCallback(() => {
    if (cart.length === 0) {
      setStatus({ kind: 'info', msg: 'Agrega productos antes de cobrar' })
      return
    }
    setPaymentOpen(true)
  }, [cart.length])

  // ── Confirmar cobro: crea venta, imprime (si hay impresora), cajón, reset ─
  const onPaymentConfirm = useCallback(
    async (args: { pagos: { metodo: MetodoPago; monto: number }[]; cambio: number }) => {
      if (!user) return
      setCharging(true)
      try {
        // 1) Persistir venta
        const createRes = await window.api.ventas.create({
          cajeroId: user.id,
          items: cart.map((i) => ({
            productoId: i.productoId,
            codigo: i.codigo,
            nombre: i.nombre,
            cantidad: i.cantidad,
            precioUnitario: i.precioUnitario,
            ivaPorcentaje: i.ivaPorcentaje,
            ivaModo: i.ivaModo,
            importe: i.importe,
            iva: i.iva,
            total: i.total
          })),
          pagos: args.pagos.map((p) => ({ metodo: p.metodo, monto: p.monto })),
          cambio: args.cambio
        })

        // 2) Imprimir ticket — sólo si hay impresora configurada
        if (settings?.printerName) {
          const receipt: ReceiptData = {
            empresa: {
              nombreComercial: user.sucursal?.nombreComercial ?? 'Farmacias MS',
              rfc: user.sucursal?.rfc ?? null,
              sucursalNombre: user.sucursal?.sucursalNombre ?? '—',
              calle: user.sucursal?.calle ?? null,
              colonia: user.sucursal?.colonia ?? null,
              cp: user.sucursal?.cp ?? null
            },
            folio: createRes.folioLocal,
            fecha: createRes.fecha,
            cajero: user.nombre,
            items: cart.map((i) => ({
              nombre: i.nombre,
              cantidad: i.cantidad,
              precio: precioConIva(i),
              total: i.total
            })),
            subtotal: totals.subtotal,
            iva: totals.iva,
            total: totals.total,
            pagos: args.pagos.map<ReceiptPago>((p) => ({ metodo: p.metodo, monto: p.monto })),
            cambio: args.cambio,
            openDrawer:
              (settings.openDrawerOnCash ?? true) &&
              args.pagos.some((p) => p.metodo === 'EFECTIVO'),
            showTime: settings.showTimeOnReceipt ?? false,
            footer: settings.receiptFooter ?? null
          }

          const pr = await window.api.printer.printReceipt(settings.printerName, receipt)
          if (!pr.ok) {
            toast.error('Venta guardada pero falló la impresión', {
              description: (pr.stderr || pr.stdout).trim()
            })
          }
        }

        // 3) Reset POS para la siguiente venta
        setCart([])
        setSelectedIdx(-1)
        setCode('')
        setStatus(null)
        setPaymentOpen(false)
        setFolioNum(createRes.folioLocal + 1)

        // 4) Deja a la vista lo recibido y el cambio de ESTA venta (sólo si
        // entró efectivo). En `pagos` el efectivo va NETO —lo que se queda en
        // la caja—, así que lo que entregó el cliente = neto + cambio.
        const efectivoNeto = args.pagos.find((p) => p.metodo === 'EFECTIVO')?.monto ?? 0
        const recibidoEfectivo = +(efectivoNeto + args.cambio).toFixed(2)
        setUltimoCobro(
          recibidoEfectivo > 0
            ? {
                folio: createRes.folioLocal,
                total: totals.total,
                recibido: recibidoEfectivo,
                cambio: args.cambio
              }
            : null
        )

        toast.success(`Folio ${fmtFolio(createRes.folioLocal)} cobrado · ${money(totals.total)}`)
      } catch (e) {
        toast.error('No se pudo cobrar', { description: e instanceof Error ? e.message : String(e) })
      } finally {
        setCharging(false)
      }
    },
    [cart, settings?.printerName, settings?.openDrawerOnCash, settings?.showTimeOnReceipt, totals, user]
  )

  // ── Atajos de teclado (modo legacy) ──────────────────────────────────────
  // Con un modal abierto, los atajos del POS que abren otros modales o tocan
  // el carrito NO deben dispararse (las teclas de función llegan a window
  // aunque el foco esté en un input del modal): sin el guard, F5 dentro de
  // Entradas/Salidas/Kárdex abría ADEMÁS la búsqueda del punto de venta
  // atrás, duplicando ventanas y robándole el foco al modal.
  useShortcut([
    { key: 'F12', handler: requestLogout },
    {
      key: 'Delete',
      handler: () => {
        if (!anyModalOpen) removeSelected()
      }
    },
    { key: 'Escape', handler: clearSale, allowInInput: true },
    {
      key: 'F5',
      handler: () => {
        if (!anyModalOpen) setSearchOpen(true)
      }
    },
    {
      key: 'F7',
      handler: () => {
        if (!anyModalOpen) setSustanciaOpen(true)
      }
    },
    {
      key: 'F11',
      handler: () => {
        if (!anyModalOpen) setFunctionsOpen(true)
      }
    },
    { key: 'Pause', handler: toggleTotalesRecientes },
    {
      key: 'F10',
      handler: () => {
        if (anyModalOpen) return
        if (!isAdmin) {
          toast.error('F10 requiere permisos de administrador', {
            description: 'Pide a un administrador que inicie sesión.'
          })
          return
        }
        setProcesosOpen(true)
      }
    },
    {
      key: 'End',
      handler: () => {
        if (!anyModalOpen) startCobro()
      }
    },
    { key: ',', ctrl: true, handler: () => setSettingsOpen(true), allowInInput: true },
    {
      key: 'ArrowUp',
      allowInInput: true, // navegar el carrito aunque el foco esté en el input de código
      handler: () => {
        if (anyModalOpen) return
        setSelectedIdx((i) => (cart.length === 0 ? -1 : Math.max(0, i - 1)))
      }
    },
    {
      key: 'ArrowDown',
      allowInInput: true,
      handler: () => {
        if (anyModalOpen) return
        setSelectedIdx((i) => (cart.length === 0 ? -1 : Math.min(cart.length - 1, i + 1)))
      }
    }
  ])

  if (!user) return null

  return (
    <div className="min-h-screen flex flex-col text-sm">
      {/* Barra superior */}
      <header className="border-b border-border bg-muted/30">
        <div className="mx-auto max-w-[1200px] px-4 py-2 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-tight">VENTAS MEDICAMENTOS GRUPO MS</h1>
            <p className="text-xs text-muted-foreground">
              {user.sucursal?.nombreComercial ?? 'Farmacias MS'}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {/* Estatus de impresora — clic abre Configuración */}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="Impresora configurada — clic para cambiar"
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border ${
                settings?.printerName
                  ? 'border-border text-foreground hover:bg-muted'
                  : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              <Printer className="size-3.5" />
              <span className="max-w-[180px] truncate">
                {settings?.printerName ?? 'Sin impresora'}
              </span>
            </button>
            <div className="text-right">
              <div>
                Folio <span className="font-mono">{fmtFolio(folioNum)}</span>
              </div>
              <div className="text-muted-foreground">
                {fechaTicket(now)} {horaTicket(now)}
              </div>
            </div>
            {onVolverMatriz && (
              <button
                type="button"
                onClick={onVolverMatriz}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-border hover:bg-muted"
                title="Volver al panel de gestión de la matriz"
              >
                <Warehouse className="size-3.5" />
                Matriz
              </button>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="p-1.5 rounded hover:bg-muted"
              title="Configuración (Ctrl+,)"
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

      <main className="flex-1 mx-auto max-w-[1200px] w-full px-4 py-3 grid grid-cols-[1fr_260px] gap-4">
        <section className="flex flex-col min-h-0 space-y-3">
          <div className="flex gap-2 items-center">
            <label htmlFor="code" className="text-xs text-muted-foreground uppercase">
              Código
            </label>
            <input
              id="code"
              ref={codeRef}
              type="text"
              className="flex-1 border border-border rounded px-2 py-1.5 font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addByCode(code)
                }
              }}
              placeholder="Escanea o teclea código (o código*cantidad) y Enter · F5 para buscar"
              autoComplete="off"
            />
          </div>

          <div className="flex-1 min-h-0 border border-border rounded overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/40 border-b border-border">
                <tr className="text-left">
                  <th className="px-2 py-1 w-12 text-right">Cant</th>
                  <th className="px-2 py-1">Producto</th>
                  <th className="px-2 py-1 w-24 text-right">Precio</th>
                  <th className="px-2 py-1 w-24 text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {cart.length === 0 && (
                  <tr>
                    <td className="px-2 py-6 text-center text-muted-foreground" colSpan={4}>
                      Sin productos — escanea, teclea un código o presiona F5
                    </td>
                  </tr>
                )}
                {cart.map((it, i) => (
                  <tr
                    key={it.productoId}
                    onClick={() => setSelectedIdx(i)}
                    className={`cursor-pointer border-b border-border/60 ${
                      i === selectedIdx ? 'bg-primary/10' : ''
                    }`}
                  >
                    <td className="px-2 py-1 text-right font-mono">{it.cantidad}</td>
                    <td className="px-2 py-1">
                      <div>{it.nombre}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{it.codigo}</div>
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{money(precioConIva(it))}</td>
                    <td className="px-2 py-1 text-right font-mono">{money(it.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="min-h-[1.75rem] text-xs">
            {status && (
              <div
                className={`px-3 py-1 rounded border ${
                  status.kind === 'error'
                    ? 'border-red-300 bg-red-50 text-red-900'
                    : 'border-border bg-muted'
                }`}
              >
                {status.msg}
              </div>
            )}
          </div>
        </section>

        <div className="flex flex-col gap-[5px] self-start">
          <aside className="border border-border rounded p-3 flex flex-col gap-3 bg-muted/30">
          <div className="space-y-1">
            <Label>ARTÍCULOS</Label>
            <div className="text-right text-xl font-mono">{totals.unitCount}</div>
          </div>
          <div className="space-y-1">
            <Label>IMPORTE</Label>
            <div className="text-right text-lg font-mono">{money(totals.subtotal)}</div>
          </div>
          <div className="space-y-1">
            <Label>IVA</Label>
            <div className="text-right text-lg font-mono">{money(totals.iva)}</div>
          </div>
          <hr className="border-border" />
          <div className="space-y-1">
            <Label>TOTAL</Label>
            <div className="text-right text-3xl font-bold font-mono text-blue-700">
              {money(totals.total)}
            </div>
          </div>
          <button
            className="mt-2 w-full bg-primary text-primary-foreground rounded py-2 font-semibold hover:opacity-90 disabled:opacity-50"
            disabled={cart.length === 0 || charging}
            onClick={startCobro}
          >
            <span className="inline-flex items-center justify-center gap-2">
              {charging ? (
                <>
                  <Spinner size={14} /> Cobrando…
                </>
              ) : (
                'Terminar venta (FIN)'
              )}
            </span>
          </button>
          </aside>

          {/* Última venta en efectivo: recibido y CAMBIO, bien visibles hasta
              que se captura el primer producto de la siguiente venta. */}
          {ultimoCobro && (
            <div className="rounded-lg border-2 border-green-500 bg-green-50 px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide font-semibold text-green-900">
                  Última venta · Folio {fmtFolio(ultimoCobro.folio)}
                </span>
                <button
                  type="button"
                  onClick={() => setUltimoCobro(null)}
                  className="p-0.5 rounded text-green-700 hover:bg-green-100 cursor-pointer"
                  title="Ocultar"
                  aria-label="Ocultar última venta"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-x-3 text-sm font-mono text-green-900">
                <span className="text-green-800/80">Total</span>
                <span className="text-right">{money(ultimoCobro.total)}</span>
                <span className="text-green-800/80">Recibí</span>
                <span className="text-right">{money(ultimoCobro.recibido)}</span>
              </div>
              <div className="mt-1.5 pt-1.5 border-t border-green-300">
                <div className="text-[11px] uppercase tracking-wide font-semibold text-green-900">
                  Cambio
                </div>
                <div className="text-right text-4xl font-bold font-mono text-green-700 leading-tight">
                  {money(ultimoCobro.cambio)}
                </div>
              </div>
            </div>
          )}

          {/* Logo a todo el ancho de la columna, pegado al panel de arriba */}
          <Logo full className="shadow-sm" />
        </div>
      </main>

      {/* Pedidos de surtido en proceso (minimizados) — pestañas para retomarlos */}
      {pedidoDrafts.length > 0 && (
        <div className="border-t border-amber-300 bg-amber-50 px-4 py-1.5 flex items-center gap-2 flex-wrap text-xs">
          <span className="text-amber-900 font-semibold">Pedidos en proceso:</span>
          {pedidoDrafts.map((d) => (
            <span
              key={d.id}
              className="inline-flex items-center gap-1 border border-amber-300 bg-white rounded-full pl-3 pr-1 py-0.5"
            >
              <button
                type="button"
                onClick={() => setPedidoAbiertoId(d.id)}
                className="font-medium text-amber-900 hover:underline cursor-pointer"
                title="Continuar llenando este pedido"
              >
                {d.sucursalNombre || 'Sin destino'} · {d.lineas.length} línea
                {d.lineas.length === 1 ? '' : 's'}
              </button>
              <button
                type="button"
                onClick={() => descartarPedidoDraft(d.id)}
                className="p-0.5 rounded-full text-amber-700 hover:bg-amber-100 cursor-pointer"
                title="Descartar este pedido"
                aria-label="Descartar pedido"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <footer className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-[1200px] px-4 py-2 flex items-center justify-between text-[11px] font-mono">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
            <FooterKey onClick={() => setSearchOpen(true)}>F5.- BUSCAR</FooterKey>
            <FooterKey onClick={() => setSustanciaOpen(true)}>F7.- INFO MEDICAMENTO</FooterKey>
            {isAdmin && <FooterKey onClick={() => setProcesosOpen(true)}>F10.- PROCESOS</FooterKey>}
            <FooterKey onClick={() => setFunctionsOpen(true)}>F11.- FUNCIONES</FooterKey>
            <FooterKey onClick={requestLogout}>F12.- SALIR</FooterKey>
            <FooterKey onClick={startCobro}>FIN.- TERMINAR VENTA</FooterKey>
            <FooterKey onClick={removeSelected}>SUPR.- ELIMINAR</FooterKey>
            <FooterKey onClick={clearSale}>ESC.- CANCELAR VENTA</FooterKey>
          </div>
          <div className="text-right">
            <span className="text-muted-foreground">{formatRol(user.rol)}: </span>
            <span className="font-semibold">{user.nombre}</span>
            <span className="mx-2 text-muted-foreground">·</span>
            <span className="text-muted-foreground">Sucursal: </span>
            <span className="font-semibold">{user.sucursal?.sucursalNombre ?? '—'}</span>
          </div>
        </div>
      </footer>

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(p) => {
          // No agrega de inmediato: coloca el código en el input y deja el cursor
          // al final, para que el cajero pueda escribir "*5" y agregar N, o Enter = 1.
          setCode(p.codigo)
          setTimeout(() => {
            const el = codeRef.current
            if (!el) return
            el.focus()
            const len = el.value.length
            el.setSelectionRange(len, len)
          }, 40)
        }}
      />
      <PaymentModal
        open={paymentOpen}
        onClose={() => !charging && setPaymentOpen(false)}
        onConfirm={onPaymentConfirm}
        total={totals.total}
        folioPreview={folioNum}
        busy={charging}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <PedidoSurtidoModal
        open={pedidoAbiertoId !== null}
        draft={pedidoDrafts.find((d) => d.id === pedidoAbiertoId) ?? null}
        onChange={(d) => setPedidoDrafts((prev) => prev.map((x) => (x.id === d.id ? d : x)))}
        onMinimizar={() => setPedidoAbiertoId(null)}
        onTerminado={(id) => {
          setPedidoDrafts((prev) => prev.filter((x) => x.id !== id))
          setPedidoAbiertoId(null)
        }}
      />
      <FunctionsModal
        open={functionsOpen}
        onClose={() => setFunctionsOpen(false)}
        mostrarPedido={esMatriz}
        onPedido={abrirNuevoPedido}
        onCancelaciones={() => setCancelOpen(true)}
        onCorte={() => setCorteOpen(true)}
        onRespaldo={() => setRespaldoOpen(true)}
        onSalir={() => {
          setFunctionsOpen(false)
          toast.warning('¿Cerrar el sistema?', {
            id: EXIT_TOAST_ID,
            description: 'La aplicación se cerrará y tendrás que volver a iniciar sesión.',
            duration: 8000,
            action: {
              label: 'Sí, cerrar',
              onClick: () => window.close()
            }
          })
        }}
      />
      <CancelVentaModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        currentUserId={user.id}
        onCancelled={() => {
          // Refrescar folio por si acaso, y limpiar estado
          reloadFolio()
        }}
      />
      <CorteModal open={corteOpen} onClose={() => setCorteOpen(false)} />

      {totalesRec && (
        <div className="fixed bottom-12 right-4 z-20 text-[22px] leading-tight font-mono text-muted-foreground bg-background/90 backdrop-blur-sm border border-border rounded px-5 py-3 shadow-sm select-none">
          <span className="font-semibold text-foreground">MS</span>
          <span className="mx-5">An- {money(totalesRec.antier)}</span>
          <span className="mr-5">A- {money(totalesRec.ayer)}</span>
          <span>H- {money(totalesRec.hoy)}</span>
        </div>
      )}
      <ProcesosEspecialesModal
        open={procesosOpen}
        onClose={() => setProcesosOpen(false)}
        rol={user.rol}
        onEntrada={() => setEntradaOpen(true)}
        onCargaInicial={() => setCargaInicialOpen(true)}
        onRecibirTraspaso={() => setRecibirTraspasoOpen(true)}
        onGenerarTraspaso={() => setGenerarTraspasoOpen(true)}
        onSalidas={() => setSalidasOpen(true)}
        onAjustes={() => setAjustesOpen(true)}
        onMovimientos={() => setMovimientosOpen(true)}
        onConsultarFolio={() => setConsultaFolioOpen(true)}
        onPrecios={() => setPreciosOpen(true)}
        onUsuarios={() => setUsuariosOpen(true)}
        onSucursal={() => setSucursalOpen(true)}
        onCatalogo={() => setCatalogoOpen(true)}
        onImportar={() => setImportarOpen(true)}
        onImportarDat={() => setImportarDatOpen(true)}
        onDedupCodigos={() => setDedupOpen(true)}
      />
      <DedupCodigosModal
        open={dedupOpen}
        onClose={() => {
          setDedupOpen(false)
          setProcesosOpen(true)
        }}
      />
      {/* Los modales lanzados desde F10 regresan al menú de Procesos Especiales
          al cerrarse (para encadenar tareas); Esc en el menú sí vuelve al POS. */}
      <EntradaModal
        open={entradaOpen}
        onClose={() => {
          setEntradaOpen(false)
          setProcesosOpen(true)
        }}
        userId={user.id}
      />
      <MovimientosModal
        open={movimientosOpen}
        onClose={() => {
          setMovimientosOpen(false)
          setProcesosOpen(true)
        }}
      />
      <ConsultaFolioModal
        open={consultaFolioOpen}
        onClose={() => {
          setConsultaFolioOpen(false)
          setProcesosOpen(true)
        }}
      />
      <CargaInicialModal
        open={cargaInicialOpen}
        onClose={() => {
          setCargaInicialOpen(false)
          setProcesosOpen(true)
        }}
        userId={user.id}
      />
      <RecibirTraspasoModal
        open={recibirTraspasoOpen}
        onClose={() => {
          setRecibirTraspasoOpen(false)
          setProcesosOpen(true)
        }}
        userId={user.id}
      />
      <TraspasoModal
        open={generarTraspasoOpen}
        onClose={() => {
          setGenerarTraspasoOpen(false)
          setProcesosOpen(true)
        }}
        userId={user.id}
        destinoLibre
      />
      <SalidasModal
        open={salidasOpen}
        onClose={() => {
          setSalidasOpen(false)
          setProcesosOpen(true)
        }}
        userId={user.id}
        userNombre={user.nombre}
      />
      <AjustesModal
        open={ajustesOpen}
        onClose={() => {
          setAjustesOpen(false)
          setProcesosOpen(true)
        }}
        userId={user.id}
      />
      <PreciosModal
        open={preciosOpen}
        onClose={() => {
          setPreciosOpen(false)
          setProcesosOpen(true)
        }}
        userId={user.id}
      />
      <SustanciaInfoModal
        open={sustanciaOpen}
        onClose={() => setSustanciaOpen(false)}
      />
      <UsuariosModal
        open={usuariosOpen}
        onClose={() => {
          setUsuariosOpen(false)
          setProcesosOpen(true)
        }}
      />
      <SucursalModal
        open={sucursalOpen}
        onClose={() => {
          setSucursalOpen(false)
          setProcesosOpen(true)
        }}
      />
      <CatalogoProductosModal
        open={catalogoOpen}
        onClose={() => {
          setCatalogoOpen(false)
          setProcesosOpen(true)
        }}
        permitirReemplazoExistencias
      />
      <ImportarFarmaModal
        open={importarOpen}
        onClose={() => {
          setImportarOpen(false)
          setProcesosOpen(true)
        }}
        onApplied={reloadFolio}
      />
      <ImportarDatModal
        open={importarDatOpen}
        onClose={() => {
          setImportarDatOpen(false)
          setProcesosOpen(true)
        }}
      />
      <RespaldoModal open={respaldoOpen} onClose={() => setRespaldoOpen(false)} />
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{children}</div>
}

// Atajo del pie como botón sutil (también usable con mouse).
function FooterKey({
  onClick,
  children
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:text-foreground hover:underline focus:outline-none focus:text-foreground"
    >
      {children}
    </button>
  )
}
