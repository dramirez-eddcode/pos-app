import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Settings as SettingsIcon } from 'lucide-react'
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
import EntradaModal from '../components/EntradaModal'
import AjustesModal from '../components/AjustesModal'
import PreciosModal from '../components/PreciosModal'
import SalidasModal from '../components/SalidasModal'
import SustanciaInfoModal from '../components/SustanciaInfoModal'
import UsuariosModal from '../components/UsuariosModal'
import SucursalModal from '../components/SucursalModal'
import CatalogoProductosModal from '../components/CatalogoProductosModal'
import ImportarFarmaModal from '../components/ImportarFarmaModal'
import { calcTotals, makeCartItem, precioConIva, type CartItem } from '../lib/cart'
import { fechaTicket, folio as fmtFolio, horaTicket, money } from '../lib/format'
import { formatRol, isAdminLike } from '../lib/roles'
import type { ProductoDto } from '@shared/dto'
import type { MetodoPago } from '@shared/types'
import type { ReceiptData, ReceiptPago } from '@shared/receipt'

const LOGOUT_TOAST_ID = 'logout-confirm'
const EXIT_TOAST_ID = 'exit-confirm'

export default function POSPage() {
  const { user, logout } = useSession()
  const { settings } = useSettings()

  const [folioNum, setFolioNum] = useState<number>(0)
  const [cart, setCart] = useState<CartItem[]>([])
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
  const [salidasOpen, setSalidasOpen] = useState(false)
  const [ajustesOpen, setAjustesOpen] = useState(false)
  const [preciosOpen, setPreciosOpen] = useState(false)
  const [sustanciaOpen, setSustanciaOpen] = useState(false)
  const [usuariosOpen, setUsuariosOpen] = useState(false)
  const [sucursalOpen, setSucursalOpen] = useState(false)
  const [catalogoOpen, setCatalogoOpen] = useState(false)
  const [importarOpen, setImportarOpen] = useState(false)
  const [totalesRec, setTotalesRec] = useState<{
    antier: number
    ayer: number
    hoy: number
  } | null>(null)
  const [charging, setCharging] = useState(false)

  const codeRef = useRef<HTMLInputElement>(null)
  const pendingLogoutRef = useRef<boolean>(false)

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
    salidasOpen ||
    ajustesOpen ||
    preciosOpen ||
    sustanciaOpen ||
    usuariosOpen ||
    sucursalOpen ||
    catalogoOpen ||
    importarOpen
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
    if (confirm('¿Descartar venta en curso?')) {
      setCart([])
      setSelectedIdx(-1)
      setCode('')
      setStatus(null)
    }
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
  const startCobro = useCallback(() => {
    if (cart.length === 0) {
      setStatus({ kind: 'info', msg: 'Agrega productos antes de cobrar' })
      return
    }
    if (!settings?.printerName) {
      toast.warning('Configura la impresora primero', {
        description: 'Ve a Configuración (⚙) para seleccionar la EPSON.',
        action: { label: 'Abrir', onClick: () => setSettingsOpen(true) }
      })
      return
    }
    setPaymentOpen(true)
  }, [cart.length, settings?.printerName])

  // ── Confirmar cobro: crea venta, imprime, abre cajón, reset ──────────────
  const onPaymentConfirm = useCallback(
    async (args: { pagos: { metodo: MetodoPago; monto: number }[]; cambio: number }) => {
      if (!user || !settings?.printerName) return
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

        // 2) Imprimir ticket
        const receipt: ReceiptData = {
          empresa: {
            nombreComercial: user.sucursal?.nombreComercial ?? 'Farmacias MS',
            rfc: user.sucursal?.rfc ?? null,
            sucursalNombre: user.sucursal?.sucursalNombre ?? '—',
            calle: user.sucursal?.calle ?? null,
            colonia: user.sucursal?.colonia ?? null
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

        // 3) Reset POS para la siguiente venta
        setCart([])
        setSelectedIdx(-1)
        setCode('')
        setStatus(null)
        setPaymentOpen(false)
        setFolioNum(createRes.folioLocal + 1)

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
  useShortcut([
    { key: 'F12', handler: requestLogout },
    { key: 'Delete', handler: removeSelected },
    { key: 'Escape', handler: clearSale, allowInInput: true },
    { key: 'F5', handler: () => setSearchOpen(true) },
    { key: 'F7', handler: () => setSustanciaOpen(true) },
    { key: 'F11', handler: () => setFunctionsOpen(true) },
    { key: 'Pause', handler: toggleTotalesRecientes },
    {
      key: 'F10',
      handler: () => {
        if (!isAdmin) {
          toast.error('F10 requiere permisos de administrador', {
            description: 'Pide a un administrador que inicie sesión.'
          })
          return
        }
        setProcesosOpen(true)
      }
    },
    { key: 'End', handler: startCobro },
    { key: ',', ctrl: true, handler: () => setSettingsOpen(true), allowInInput: true },
    {
      key: 'ArrowUp',
      handler: () => {
        if (anyModalOpen) return
        setSelectedIdx((i) => (cart.length === 0 ? -1 : Math.max(0, i - 1)))
      }
    },
    {
      key: 'ArrowDown',
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
            <div className="text-right">
              <div>
                Folio <span className="font-mono">{fmtFolio(folioNum)}</span>
              </div>
              <div className="text-muted-foreground">
                {fechaTicket(now)} {horaTicket(now)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="p-1.5 rounded hover:bg-muted"
              title="Configuración (Ctrl+,)"
              aria-label="Configuración"
            >
              <SettingsIcon className="size-4" />
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

        <aside className="border border-border rounded p-3 flex flex-col gap-3 bg-muted/30 self-start">
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
            Terminar venta (FIN)
          </button>
        </aside>
      </main>

      <footer className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-[1200px] px-4 py-2 flex items-center justify-between text-[11px] font-mono">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
            <span>F5.- BUSCAR</span>
            <span>F7.- INFO MEDICAMENTO</span>
            {isAdmin && <span>F10.- PROCESOS</span>}
            <span>F11.- FUNCIONES</span>
            <span>F12.- SALIR</span>
            <span>FIN.- TERMINAR VENTA</span>
            <span>SUPR.- ELIMINAR</span>
            <span>ESC.- CANCELAR VENTA</span>
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
          addProduct(p)
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
      <FunctionsModal
        open={functionsOpen}
        onClose={() => setFunctionsOpen(false)}
        onCancelaciones={() => setCancelOpen(true)}
        onCorte={() => setCorteOpen(true)}
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
        <div className="fixed bottom-12 right-4 z-20 text-[11px] font-mono text-muted-foreground bg-background/90 backdrop-blur-sm border border-border rounded px-3 py-1.5 shadow-sm select-none">
          <span className="font-semibold text-foreground">MS</span>
          <span className="mx-3">An- {money(totalesRec.antier)}</span>
          <span className="mr-3">A- {money(totalesRec.ayer)}</span>
          <span>H- {money(totalesRec.hoy)}</span>
        </div>
      )}
      <ProcesosEspecialesModal
        open={procesosOpen}
        onClose={() => setProcesosOpen(false)}
        onEntrada={() => setEntradaOpen(true)}
        onSalidas={() => setSalidasOpen(true)}
        onAjustes={() => setAjustesOpen(true)}
        onPrecios={() => setPreciosOpen(true)}
        onUsuarios={() => setUsuariosOpen(true)}
        onSucursal={() => setSucursalOpen(true)}
        onCatalogo={() => setCatalogoOpen(true)}
        onImportar={() => setImportarOpen(true)}
      />
      <EntradaModal
        open={entradaOpen}
        onClose={() => setEntradaOpen(false)}
        userId={user.id}
      />
      <SalidasModal
        open={salidasOpen}
        onClose={() => setSalidasOpen(false)}
        userId={user.id}
        userNombre={user.nombre}
      />
      <AjustesModal
        open={ajustesOpen}
        onClose={() => setAjustesOpen(false)}
        userId={user.id}
      />
      <PreciosModal
        open={preciosOpen}
        onClose={() => setPreciosOpen(false)}
        userId={user.id}
      />
      <SustanciaInfoModal
        open={sustanciaOpen}
        onClose={() => setSustanciaOpen(false)}
      />
      <UsuariosModal open={usuariosOpen} onClose={() => setUsuariosOpen(false)} />
      <SucursalModal open={sucursalOpen} onClose={() => setSucursalOpen(false)} />
      <CatalogoProductosModal open={catalogoOpen} onClose={() => setCatalogoOpen(false)} />
      <ImportarFarmaModal
        open={importarOpen}
        onClose={() => setImportarOpen(false)}
        onApplied={reloadFolio}
      />
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{children}</div>
}
