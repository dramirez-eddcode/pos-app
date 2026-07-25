import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CalendarDays, Eye, Printer, X } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import BusyOverlay from './BusyOverlay'
import InfoTooltip from './InfoTooltip'
import VentasDiaModal from './VentasDiaModal'
import { folio as fmtFolio, money } from '../lib/format'
import { useSession } from '../stores/session'
import { useSettings } from '../stores/settings'
import type {
  CorteFinalHistItem,
  CorteHoyDto,
  CorteReimpresionDto,
  CorteTipo,
  CreateCorteResult,
  MetodoPagoTotal,
  VentaDetailDto
} from '@shared/dto'
import type { ReceiptData } from '@shared/receipt'

interface Props {
  open: boolean
  onClose: () => void
}

const METODO_LABEL: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transferencia',
  OTRO: 'Otro'
}

// Etiqueta corta + color del método de pago por folio (MIXTO = combinó varios)
const PAGO_LABEL: Record<string, string> = {
  EFECTIVO: 'Efec.',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transf.',
  OTRO: 'Otro',
  MIXTO: 'Mixto'
}

const PAGO_BADGE: Record<string, string> = {
  EFECTIVO: 'bg-green-100 text-green-900',
  TARJETA: 'bg-blue-100 text-blue-900',
  TRANSFERENCIA: 'bg-violet-100 text-violet-900',
  OTRO: 'bg-muted text-muted-foreground',
  MIXTO: 'bg-amber-100 text-amber-900'
}

const TIPO_LABEL: Record<CorteTipo, string> = {
  PARCIAL: 'Corte parcial',
  FINAL: 'Corte final',
  CAMBIO_TURNO: 'Cambio de turno'
}

/** Día local 'AAAA-MM-DD' de una fecha ISO (para los filtros desde/hasta). */
function ymdLocal(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

const CORTE_TIPO_LABEL: Record<CorteTipo, string> = {
  PARCIAL: 'Parcial',
  FINAL: 'Final',
  CAMBIO_TURNO: 'Cambio de turno'
}


export default function CorteModal({ open, onClose }: Props) {
  const { user } = useSession()
  const { settings } = useSettings()

  const [data, setData] = useState<CorteHoyDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [idx, setIdx] = useState(-1)
  const [detail, setDetail] = useState<VentaDetailDto | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [cerrando, setCerrando] = useState<CorteTipo | null>(null)
  const [finales, setFinales] = useState<CorteFinalHistItem[]>([])
  const [reimprimiendo, setReimprimiendo] = useState<string | null>(null)
  // Filtro desde/hasta de la lista de cortes finales ('' = sin filtro).
  const [finalesDesde, setFinalesDesde] = useState('')
  const [finalesHasta, setFinalesHasta] = useState('')
  // Progreso de "imprimir todos" (null = no está corriendo).
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  // Corte final abierto "en pantalla" (mismos datos que su ticket, sin imprimir)
  const [verCorte, setVerCorte] = useState<{
    item: CorteFinalHistItem
    d: CorteReimpresionDto
  } | null>(null)
  const [cargandoVer, setCargandoVer] = useState<string | null>(null)
  // Consulta histórica de ventas por día (calendario) — sólo admin.
  const [ventasDiaOpen, setVentasDiaOpen] = useState(false)
  // Reimpresión del ticket de la venta seleccionada — sólo admin.
  const [reimpVentaBusy, setReimpVentaBusy] = useState(false)
  // Corte parcial mostrado en pantalla (sin imprimir): el usuario lo cierra cuando quiere.
  const [corteEnPantalla, setCorteEnPantalla] = useState<CreateCorteResult | null>(null)
  const [imprimiendoPantalla, setImprimiendoPantalla] = useState(false)
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  const esAdmin = user?.rol === 'ADMINISTRADOR' || user?.rol === 'SUPERUSUARIO'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await window.api.corte.hoy()
      setData(r)
      // Reset selección si la lista cambia
      setDetail(null)
      setIdx(r.folios.length > 0 ? 0 : -1)
      if (user && esAdmin) {
        // 200 (tope del backend) para que el filtro desde/hasta alcance
        // cortes viejos, no sólo los últimos 30.
        setFinales(await window.api.corte.finales(user.id, 200).catch(() => []))
      }
    } catch (e) {
      toast.error('No pude cargar el corte', { description: String(e) })
    } finally {
      setLoading(false)
    }
  }, [user, esAdmin])

  useEffect(() => {
    if (open) {
      load()
    } else {
      // Al cerrar, limpiar el filtro de reimpresión para la próxima vez.
      setFinalesDesde('')
      setFinalesHasta('')
    }
  }, [open, load])

  // Imprime el ticket de un corte recién creado (best-effort)
  const imprimirTicketCorte = useCallback(
    async (r: CreateCorteResult) => {
      if (!user) return
      if (settings?.printerName && user.sucursal) {
        const pr = await window.api.printer.printCorte(settings.printerName, {
          empresa: {
            nombreComercial: user.sucursal.nombreComercial,
            rfc: user.sucursal.rfc ?? null,
            sucursalNombre: user.sucursal.sucursalNombre,
            calle: user.sucursal.calle ?? null,
            colonia: user.sucursal.colonia ?? null,
            cp: user.sucursal.cp ?? null
          },
          fecha: r.fecha,
          fechaInicio: r.fechaInicio,
          tipo: r.tipo,
          cajero: user.nombre,
          folioInicio: r.folioInicio,
          folioFin: r.folioFin,
          foliosVendidos: r.totales.foliosVendidos,
          foliosCancelados: r.totales.foliosCancelados,
          subtotal: r.totales.subtotal,
          iva: r.totales.iva,
          total: r.totales.total,
          efectivo: r.totales.efectivo,
          tarjeta: r.totales.tarjeta,
          transferencia: r.totales.transferencia,
          otro: r.totales.otro,
          entradasCaja: r.totales.entradasCaja,
          salidasCaja: r.totales.salidasCaja,
          cancelaciones: r.totales.cancelaciones,
          efectivoEsperado: r.totales.efectivoEsperado,
          parcialesDelDia: r.parcialesDelDia,
          ventasTarjeta: r.ventasTarjeta
        })
        if (!pr.ok) {
          toast.warning('Corte registrado pero falló la impresión', {
            description: (pr.stderr || pr.stdout).trim()
          })
        }
      } else if (!settings?.printerName) {
        toast.warning('Corte registrado (sin ticket)', {
          description: 'No hay impresora configurada. El corte está en la DB.'
        })
      }
    },
    [user, settings?.printerName]
  )

  const cerrarCorte = useCallback(
    async (tipo: CorteTipo) => {
      if (!user) return
      if (cerrando) return
      setCerrando(tipo)
      try {
        const r = await window.api.corte.create(user.id, tipo)
        // Corte parcial: NO se imprime de una; se muestra en pantalla para que
        // lo lean (p.ej. por teléfono) y decidan imprimirlo o sólo cerrarlo.
        // El corte final SÍ se imprime siempre.
        if (tipo === 'PARCIAL') {
          setCorteEnPantalla(r)
        } else {
          await imprimirTicketCorte(r)
        }
        toast.success(
          `${TIPO_LABEL[tipo]} registrado · folios ${r.folioInicio}–${r.folioFin}`,
          { description: `Total: $${money(r.totales.total)} · Efectivo en caja: $${money(r.totales.efectivoEsperado)}` }
        )
        // Refrescar la vista del modal tras el corte (el rango previo ya cerró)
        await load()
      } catch (e) {
        toast.error(`No se pudo registrar el ${TIPO_LABEL[tipo].toLowerCase()}`, {
          description: e instanceof Error ? e.message : String(e)
        })
      } finally {
        setCerrando(null)
      }
    },
    [user, cerrando, imprimirTicketCorte, load]
  )

  // Imprimir el corte parcial que está en pantalla y cerrarlo.
  const imprimirCorteEnPantalla = useCallback(async () => {
    if (!corteEnPantalla) return
    setImprimiendoPantalla(true)
    try {
      await imprimirTicketCorte(corteEnPantalla)
    } finally {
      setImprimiendoPantalla(false)
      setCorteEnPantalla(null)
    }
  }, [corteEnPantalla, imprimirTicketCorte])

  // Cortes finales visibles según el filtro desde/hasta (día local).
  const finalesFiltrados = useMemo(() => {
    if (!finalesDesde && !finalesHasta) return finales
    return finales.filter((c) => {
      const d = ymdLocal(c.fecha)
      if (finalesDesde && d < finalesDesde) return false
      if (finalesHasta && d > finalesHasta) return false
      return true
    })
  }, [finales, finalesDesde, finalesHasta])

  // Reimprime el ticket de la venta mostrada en el detalle (mismo formato que
  // el original, con recibido/cambio guardados). NO abre el cajón.
  const reimprimirTicketVenta = useCallback(async () => {
    if (!detail || !user) return
    if (!settings?.printerName) {
      toast.error('No hay impresora configurada', {
        description: 'Configúrala en Ajustes para poder reimprimir el ticket.'
      })
      return
    }
    setReimpVentaBusy(true)
    try {
      const receipt: ReceiptData = {
        empresa: {
          nombreComercial: user.sucursal?.nombreComercial ?? 'Farmacias MS',
          rfc: user.sucursal?.rfc ?? null,
          sucursalNombre: user.sucursal?.sucursalNombre ?? '—',
          calle: user.sucursal?.calle ?? null,
          colonia: user.sucursal?.colonia ?? null,
          cp: user.sucursal?.cp ?? null
        },
        folio: detail.folioLocal,
        fecha: detail.fecha,
        cajero: detail.cajero,
        items: detail.items.map((it) => ({
          nombre: it.nombre,
          cantidad: it.cantidad,
          precio: it.cantidad > 0 ? +(it.total / it.cantidad).toFixed(2) : it.precioUnitario,
          total: it.total
        })),
        subtotal: detail.subtotal,
        iva: detail.iva,
        total: detail.total,
        pagos: detail.pagos.map((p) => ({ metodo: p.metodo, monto: p.monto })),
        cambio: detail.cambio,
        openDrawer: false,
        showTime: settings.showTimeOnReceipt ?? false,
        footer: settings.receiptFooter ?? null
      }
      const pr = await window.api.printer.printReceipt(settings.printerName, receipt)
      if (pr.ok) {
        toast.success(`Ticket del folio ${fmtFolio(detail.folioLocal)} reimpreso`)
      } else {
        toast.error('Falló la impresión', { description: (pr.stderr || pr.stdout).trim() })
      }
    } catch (e) {
      toast.error('No se pudo reimprimir el ticket', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setReimpVentaBusy(false)
    }
  }, [detail, user, settings?.printerName, settings?.showTimeOnReceipt, settings?.receiptFooter])

  // Ver en pantalla lo que imprimió (o imprimiría) un corte final registrado.
  const verCorteFinal = useCallback(
    async (c: CorteFinalHistItem) => {
      if (!user) return
      setCargandoVer(c.id)
      try {
        const d = await window.api.corte.reimpresion(user.id, c.id)
        setVerCorte({ item: c, d })
      } catch (e) {
        toast.error('No se pudo cargar el corte', {
          description: e instanceof Error ? e.message : String(e)
        })
      } finally {
        setCargandoVer(null)
      }
    },
    [user]
  )

  // ── Reimpresión de cortes finales (sólo admin/superusuario) ─────────────
  const reimprimirCorte = useCallback(
    async (c: CorteFinalHistItem) => {
      if (!user) return
      if (!settings?.printerName) {
        toast.error('No hay impresora configurada', {
          description: 'Configúrala en Ajustes para poder reimprimir el corte.'
        })
        return
      }
      if (!user.sucursal) {
        toast.error('Sin datos de la sucursal para el encabezado del ticket')
        return
      }
      setReimprimiendo(c.id)
      try {
        const d = await window.api.corte.reimpresion(user.id, c.id)
        const pr = await window.api.printer.printCorte(settings.printerName, {
          empresa: {
            nombreComercial: user.sucursal.nombreComercial,
            rfc: user.sucursal.rfc ?? null,
            sucursalNombre: user.sucursal.sucursalNombre,
            calle: user.sucursal.calle ?? null,
            colonia: user.sucursal.colonia ?? null,
            cp: user.sucursal.cp ?? null
          },
          ...d
        })
        if (!pr.ok) {
          toast.error('Falló la impresión', { description: (pr.stderr || pr.stdout).trim() })
        } else {
          toast.success(
            `Corte final del ${new Date(d.fecha).toLocaleDateString('es-MX')} reimpreso`
          )
        }
      } catch (e) {
        toast.error('No se pudo reimprimir el corte', {
          description: e instanceof Error ? e.message : String(e)
        })
      } finally {
        setReimprimiendo(null)
      }
    },
    [user, settings?.printerName]
  )

  // Imprime en secuencia TODOS los cortes visibles con el filtro desde/hasta
  // (del más viejo al más nuevo, para que salgan en orden cronológico).
  const imprimirTodosFiltrados = useCallback(async () => {
    if (!user) return
    if (!settings?.printerName) {
      toast.error('No hay impresora configurada', {
        description: 'Configúrala en Ajustes para poder reimprimir los cortes.'
      })
      return
    }
    if (!user.sucursal) {
      toast.error('Sin datos de la sucursal para el encabezado del ticket')
      return
    }
    const lista = [...finalesFiltrados].sort((a, b) => a.fecha.localeCompare(b.fecha))
    if (lista.length === 0) return
    setBatchProgress({ done: 0, total: lista.length })
    let ok = 0
    let fallas = 0
    for (const c of lista) {
      try {
        const d = await window.api.corte.reimpresion(user.id, c.id)
        const pr = await window.api.printer.printCorte(settings.printerName, {
          empresa: {
            nombreComercial: user.sucursal.nombreComercial,
            rfc: user.sucursal.rfc ?? null,
            sucursalNombre: user.sucursal.sucursalNombre,
            calle: user.sucursal.calle ?? null,
            colonia: user.sucursal.colonia ?? null,
            cp: user.sucursal.cp ?? null
          },
          ...d
        })
        if (pr.ok) ok++
        else fallas++
      } catch {
        fallas++
      }
      setBatchProgress((p) => (p ? { ...p, done: p.done + 1 } : p))
    }
    setBatchProgress(null)
    if (fallas === 0) {
      toast.success(`${ok} corte${ok === 1 ? '' : 's'} reimpreso${ok === 1 ? '' : 's'}`)
    } else {
      toast.warning('Reimpresión terminada con errores', {
        description: `${ok} impresos correctamente, ${fallas} fallaron.`
      })
    }
  }, [user, settings?.printerName, finalesFiltrados])

  const confirmarImprimirTodos = useCallback(() => {
    const n = finalesFiltrados.length
    toast.warning(`¿Imprimir los ${n} cortes de la lista?`, {
      id: 'reimp-todos-confirm',
      description: 'Se imprimirá un ticket por cada corte final, del más viejo al más nuevo.',
      duration: 8000,
      action: { label: 'Sí, imprimir todos', onClick: () => imprimirTodosFiltrados() }
    })
  }, [finalesFiltrados.length, imprimirTodosFiltrados])

  const confirmarCorte = useCallback(
    (tipo: CorteTipo) => {
      const esFinal = tipo === 'FINAL'
      toast.warning(`¿Confirmar ${TIPO_LABEL[tipo].toLowerCase()}?`, {
        id: `corte-confirm-${tipo}`,
        description:
          esFinal
            ? 'Cierra TODO el periodo desde el último corte final (incluyendo lo ya cubierto por parciales o cambios de turno) y la pantalla arranca en ceros. Se imprimirá el ticket de corte.'
            : tipo === 'PARCIAL'
              ? 'Cierra el rango de folios actual y abre uno nuevo. Verás el corte en pantalla; desde ahí podrás imprimirlo o sólo cerrarlo.'
              : 'Cierra el rango de folios actual y abre uno nuevo.',
        // El corte final NO se auto-cierra: hay que confirmar o cancelar a propósito.
        duration: esFinal ? Infinity : 8000,
        action: {
          label: esFinal ? 'Sí, hacer corte final' : 'Sí, cerrar',
          onClick: () => cerrarCorte(tipo)
        },
        ...(esFinal
          ? { cancel: { label: 'Cancelar', onClick: () => {} } }
          : {})
      })
    },
    [cerrarCorte]
  )

  const showDetail = useCallback(
    async (folioLocal: number, scroll = true) => {
      setLoadingDetail(true)
      try {
        const d = await window.api.ventas.byFolio(folioLocal)
        setDetail(d)
        if (scroll) {
          setTimeout(() => {
            detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          }, 50)
        }
      } catch (e) {
        toast.error('No pude cargar la venta', { description: String(e) })
      } finally {
        setLoadingDetail(false)
      }
    },
    []
  )

  // Detalle instantáneo: al navegar los folios con ↑/↓ (o clic) el detalle se
  // carga solo — sin Enter. Debounce corto para no disparar una consulta por
  // cada repetición de la flecha; sin auto-scroll (el panel vive justo debajo
  // de la lista y el detalle previo queda visible mientras llega el nuevo).
  useEffect(() => {
    if (!open) return
    const folios = data?.folios ?? []
    if (idx < 0 || idx >= folios.length) {
      setDetail(null)
      return
    }
    const folio = folios[idx]!.folioLocal
    const t = setTimeout(() => {
      showDetail(folio, false)
    }, 120)
    return () => clearTimeout(t)
  }, [open, idx, data, showDetail])

  // Navegación por teclado dentro del modal (capture phase → le gana al resto).
  // Se apaga mientras el modal de ventas por día está encima.
  useEffect(() => {
    if (!open || ventasDiaOpen) return
    const handler = (e: KeyboardEvent): void => {
      // Sólo si el foco no está en un input editable
      const tgt = e.target as HTMLElement | null
      const inEditable =
        tgt instanceof HTMLInputElement ||
        tgt instanceof HTMLTextAreaElement ||
        tgt?.isContentEditable === true

      if (e.key === 'ArrowDown' && !inEditable) {
        e.preventDefault()
        e.stopPropagation()
        setIdx((i) => {
          const folios = data?.folios ?? []
          if (folios.length === 0) return -1
          return Math.min(folios.length - 1, i + 1)
        })
      } else if (e.key === 'ArrowUp' && !inEditable) {
        e.preventDefault()
        e.stopPropagation()
        setIdx((i) => {
          const folios = data?.folios ?? []
          if (folios.length === 0) return -1
          return Math.max(0, i - 1)
        })
      } else if (e.key === 'Enter' && !inEditable) {
        const folios = data?.folios ?? []
        if (idx >= 0 && idx < folios.length) {
          e.preventDefault()
          e.stopPropagation()
          showDetail(folios[idx]!.folioLocal)
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        e.stopPropagation()
        load()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, ventasDiaOpen, data, idx, load, showDetail])

  // Auto-scroll de la fila seleccionada. Cálculo manual en lugar de
  // scrollIntoView: el thead es sticky y tapaba la fila al navegar hacia
  // arriba — el primer folio quedaba oculto tras el encabezado hasta mover
  // el scroll a mano.
  useEffect(() => {
    const tbody = tableBodyRef.current
    if (!tbody || idx < 0) return
    const row = tbody.children[idx] as HTMLElement | undefined
    const cont = tbody.closest('.overflow-auto') as HTMLElement | null
    if (!row || !cont) return
    const headerH = cont.querySelector('thead')?.getBoundingClientRect().height ?? 0
    const rowTop = row.offsetTop
    const rowBottom = rowTop + row.offsetHeight
    if (rowTop - headerH < cont.scrollTop) {
      // La fila quedaría debajo del encabezado sticky: súbela justo bajo él.
      cont.scrollTop = Math.max(0, rowTop - headerH)
    } else if (rowBottom > cont.scrollTop + cont.clientHeight) {
      cont.scrollTop = rowBottom - cont.clientHeight
    }
  }, [idx])

  const fechaCabecera = data ? new Date(data.fechaHasta) : new Date()
  const inicioTxt = data ? new Date(data.fechaDesde).toLocaleString('es-MX') : ''
  const finTxt = data ? new Date(data.fechaHasta).toLocaleString('es-MX') : ''

  return (
    <>
    <Modal
      open={open}
      title={`Corte en pantalla — ${fechaCabecera.toLocaleDateString('es-MX')}`}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      <div className="relative p-4 text-sm max-h-[75vh] overflow-y-auto">
        <BusyOverlay
          show={cerrando !== null}
          text={`Registrando ${TIPO_LABEL[cerrando ?? 'PARCIAL'].toLowerCase()}…`}
        />
        {loading && !data && (
          <div className="flex justify-center py-8">
            <Spinner label="Cargando…" />
          </div>
        )}

        {data && (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">
              Desde: {inicioTxt} — Hasta: {finTxt}
            </div>

            <div className="grid grid-cols-[1fr_1fr] gap-4">
              {/* Cifras de control */}
              <section className="border border-border rounded">
                <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide">
                  Cifras de control
                </header>
                <div className="p-3 space-y-1.5 font-mono text-xs">
                  <Row label="No. de folios vendidos" value={String(data.foliosVendidos)} />
                  <Row label="Notas canceladas" value={String(data.foliosCancelados)} />
                  <hr className="border-border my-1.5" />
                  <Row label="Venta del periodo" value={money(data.ventaDelDia)} bold />
                  <Row
                    label="Monto cancelado"
                    value={money(data.montoCancelado)}
                    textClass={data.montoCancelado > 0 ? 'text-red-700' : ''}
                  />
                  <Row label="Entradas de caja" value={money(data.entradasCaja)} />
                  <Row label="Salidas de caja" value={money(data.salidasCaja)} />
                  <hr className="border-border my-1.5" />
                  {(() => {
                    const cobrado = (m: string): number =>
                      data.porMetodoPago.find((p) => p.metodo === m)?.monto ?? 0
                    const transferencia = cobrado('TRANSFERENCIA')
                    const otro = cobrado('OTRO')
                    const totalCobrado = data.porMetodoPago.reduce((s, p) => s + p.monto, 0)
                    return (
                      <>
                        <Row label="Cobrado en efectivo" value={money(cobrado('EFECTIVO'))} />
                        <Row label="Cobrado con tarjeta" value={money(cobrado('TARJETA'))} />
                        {transferencia > 0 && (
                          <Row label="Cobrado transferencia" value={money(transferencia)} />
                        )}
                        {otro > 0 && <Row label="Cobrado otros" value={money(otro)} />}
                        <Row label="Total cobrado" value={money(totalCobrado)} bold />
                      </>
                    )
                  })()}
                  <hr className="border-border my-1.5" />
                  <Row label="Subtotal del periodo" value={money(data.subtotalDelDia)} />
                  <Row label="IVA por pagar" value={money(data.ivaDelDia)} />
                </div>
              </section>

              {/* Columna derecha (como el legacy): folios arriba, detalle abajo */}
              <div className="flex flex-col gap-4 min-w-0">
              <section className="border border-border rounded flex flex-col">
                <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide flex justify-between items-center">
                  <span>Folios del periodo</span>
                  <span className="text-[10px] text-muted-foreground normal-case">
                    {data.folios.length}
                  </span>
                </header>
                <div className="overflow-auto max-h-[300px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background border-b border-border z-10">
                      <tr className="text-left">
                        <th className="px-2 py-1">Folio</th>
                        <th className="px-2 py-1">Hora</th>
                        <th className="px-2 py-1 w-20">Pago</th>
                        <th className="px-2 py-1 text-right">Total</th>
                        <th className="px-2 py-1 w-12 text-center">Canc.</th>
                      </tr>
                    </thead>
                    <tbody ref={tableBodyRef}>
                      {data.folios.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-2 py-6 text-center text-muted-foreground italic"
                          >
                            Sin ventas en el periodo
                          </td>
                        </tr>
                      )}
                      {data.folios.map((f, i) => {
                        const t = new Date(f.fecha)
                        return (
                          <tr
                            key={f.id}
                            onClick={() => setIdx(i)}
                            onDoubleClick={() => showDetail(f.folioLocal)}
                            className={`border-b border-border/60 cursor-pointer ${
                              i === idx
                                ? f.cancelada
                                  ? 'bg-red-100'
                                  : 'bg-primary/10'
                                : f.cancelada
                                  ? 'bg-red-50'
                                  : ''
                            } ${f.cancelada ? 'text-red-700 line-through' : ''}`}
                          >
                            <td className="px-2 py-1 font-mono">{fmtFolio(f.folioLocal)}</td>
                            <td className="px-2 py-1 font-mono text-[11px]">
                              {t.toLocaleTimeString('es-MX', {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </td>
                            <td className="px-2 py-1">
                              {f.metodo && (
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                    PAGO_BADGE[f.metodo] ?? 'bg-muted text-muted-foreground'
                                  }`}
                                >
                                  {PAGO_LABEL[f.metodo] ?? f.metodo}
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1 font-mono text-right">{money(f.total)}</td>
                            <td className="px-2 py-1 text-center">
                              {f.cancelada ? (
                                <span className="text-red-700 text-[10px]">SI</span>
                              ) : (
                                ''
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Detalle de venta seleccionada — se actualiza solo al navegar */}
              <section ref={detailRef} className="border border-border rounded">
              <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide flex justify-between items-center">
                <span>
                  Detalle de venta
                  {detail && (
                    <>
                      {' — '}
                      <span className="font-mono">Folio {fmtFolio(detail.folioLocal)}</span>
                      {detail.cancelada && (
                        <span className="ml-2 text-red-700 normal-case font-normal">
                          (cancelada)
                        </span>
                      )}
                    </>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {loadingDetail && <span className="text-[10px] normal-case">cargando…</span>}
                  {esAdmin && detail && !loadingDetail && (
                    <button
                      type="button"
                      onClick={reimprimirTicketVenta}
                      disabled={reimpVentaBusy}
                      title="Volver a imprimir el ticket de esta venta (no abre el cajón)"
                      className="inline-flex items-center gap-1 px-2 py-0.5 border border-border rounded cursor-pointer hover:bg-muted hover:border-primary/40 disabled:opacity-50 disabled:cursor-default text-[11px] normal-case font-normal"
                    >
                      {reimpVentaBusy ? <Spinner size={11} /> : <Printer className="size-3" />}
                      Reimprimir
                    </button>
                  )}
                </span>
              </header>
              <div className="p-3">
                {!detail && !loadingDetail && (
                  <div className="text-muted-foreground text-xs italic">
                    Navega los folios con <span className="font-mono">↑/↓</span> (o haz clic en
                    uno) — el detalle de la nota se muestra aquí automáticamente.
                  </div>
                )}
                {detail && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {new Date(detail.fecha).toLocaleString('es-MX')} · Cajero {detail.cajero}
                      </span>
                      <span>Motivo: {detail.motivo}</span>
                    </div>
                    <div className="border border-border rounded overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40 border-b border-border">
                          <tr className="text-left">
                            <th className="px-2 py-1 w-12 text-right">Cant</th>
                            <th className="px-2 py-1">Producto</th>
                            <th className="px-2 py-1 w-24 text-right">Precio</th>
                            <th className="px-2 py-1 w-24 text-right">Importe</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.items.map((it) => (
                            <tr key={it.id} className="border-b border-border/60">
                              <td className="px-2 py-1 text-right font-mono">{it.cantidad}</td>
                              <td className="px-2 py-1">
                                <div>{it.nombre}</div>
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  {it.codigo}
                                </div>
                              </td>
                              <td className="px-2 py-1 text-right font-mono">
                                {money(it.precioUnitario)}
                              </td>
                              <td className="px-2 py-1 text-right font-mono">{money(it.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                      <MiniField label="Subtotal" value={money(detail.subtotal)} />
                      <MiniField label="IVA" value={money(detail.iva)} />
                      <MiniField label="Total" value={money(detail.total)} highlight />
                    </div>
                    {detail.pagos.length > 0 && (
                      <div className="text-xs">
                        <div className="text-muted-foreground mb-1">Pagos:</div>
                        <div className="font-mono space-y-0.5">
                          {detail.pagos.map((p, i) => (
                            <div key={i} className="flex justify-between">
                              <span>{METODO_LABEL[p.metodo] ?? p.metodo}</span>
                              <span>{money(p.monto)}</span>
                            </div>
                          ))}
                          {detail.cambio > 0 && (
                            <>
                              <div className="flex justify-between border-t border-border/60 pt-0.5">
                                <span>Recibido</span>
                                <span>{money(detail.recibido)}</span>
                              </div>
                              <div className="flex justify-between text-green-700">
                                <span>Cambio</span>
                                <span>{money(detail.cambio)}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              </section>
              </div>
            </div>

            {/* Por método de pago */}
            <section className="border border-border rounded">
              <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide">
                Por método de pago
              </header>
              <div className="p-3">
                {data.porMetodoPago.length === 0 ? (
                  <div className="text-muted-foreground text-xs italic">Sin pagos registrados</div>
                ) : (
                  <table className="w-full text-xs font-mono">
                    <thead className="border-b border-border">
                      <tr>
                        <th className="text-left py-1">Método</th>
                        <th className="text-right py-1 w-24">Ventas</th>
                        <th className="text-right py-1 w-32">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.porMetodoPago.map((p: MetodoPagoTotal) => (
                        <tr key={p.metodo} className="border-b border-border/60">
                          <td className="py-1">{METODO_LABEL[p.metodo] ?? p.metodo}</td>
                          <td className="py-1 text-right">{p.ventas}</td>
                          <td className="py-1 text-right">{money(p.monto)}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="py-1.5">TOTAL COBRADO</td>
                        <td />
                        <td className="py-1.5 text-right">
                          {money(data.porMetodoPago.reduce((s, p) => s + p.monto, 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* Cierre de corte */}
            <section className="border border-border rounded">
              <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide">
                Cerrar corte
              </header>
              <div className="p-3 space-y-2">
                {data.pendiente ? (
                  <div className="text-xs border border-border rounded bg-muted/20 px-3 py-2">
                    <span className="text-muted-foreground">Próximo corte cubrirá: </span>
                    <span className="font-mono font-semibold">
                      folios {fmtFolio(data.pendiente.folioInicio)} –{' '}
                      {fmtFolio(data.pendiente.folioFin)}
                    </span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {data.pendiente.cantidad} nota{data.pendiente.cantidad === 1 ? '' : 's'}
                    </span>
                  </div>
                ) : (
                  <div className="text-xs border border-amber-300 bg-amber-50 text-amber-900 rounded px-3 py-2">
                    <div className="font-semibold">No hay ventas nuevas desde el último corte.</div>
                    {data.ultimoCorte && (
                      <div className="mt-0.5">
                        Último: <span className="font-mono">{CORTE_TIPO_LABEL[data.ultimoCorte.tipo]}</span>{' '}
                        por {data.ultimoCorte.cajero ?? '—'}{' '}
                        el {new Date(data.ultimoCorte.fecha).toLocaleString('es-MX')} · cubrió
                        folios {fmtFolio(data.ultimoCorte.folioInicio)}–
                        {fmtFolio(data.ultimoCorte.folioFin)} (${money(data.ultimoCorte.total)})
                      </div>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => confirmarCorte('PARCIAL')}
                    disabled={cerrando !== null || !data.pendiente}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {cerrando === 'PARCIAL' ? (
                      <>
                        <Spinner size={14} /> Procesando…
                      </>
                    ) : (
                      'Corte parcial'
                    )}
                    <InfoTooltip title="Corte parcial" align="start">
                      Cierra el rango de folios actual e imprime el resumen,{' '}
                      <strong>sin cambio de cajero</strong>. El siguiente rango arranca desde el
                      folio siguiente.
                      <div className="mt-1.5 pt-1.5 border-t border-primary-foreground/20 italic">
                        Ej: a media jornada, el encargado quiere conciliar el efectivo en caja
                        antes del cierre del día.
                      </div>
                    </InfoTooltip>
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmarCorte('FINAL')}
                    disabled={cerrando !== null || data.folios.length === 0}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold"
                  >
                    {cerrando === 'FINAL' ? (
                      <>
                        <Spinner size={14} /> Procesando…
                      </>
                    ) : (
                      'Corte final'
                    )}
                    <InfoTooltip title="Corte final" align="end">
                      El <strong>cierre del periodo COMPLETO</strong>: cubre todas las ventas y
                      caja desde el <strong>último corte final</strong> hasta ahora (sin límite
                      de día), <strong>incluyendo</strong> lo que ya hayan cubierto parciales o
                      cambios de turno. Su ticket cuadra con las cifras en pantalla, y al
                      hacerlo la pantalla arranca en ceros.
                      <div className="mt-1.5 pt-1.5 border-t border-primary-foreground/20 italic">
                        Ej: al apagar la tienda. La venta se acumula hasta que lo hagas.
                      </div>
                    </InfoTooltip>
                  </button>
                </div>
              </div>
            </section>

            {/* Reimpresión de cortes finales — sólo admin/superusuario */}
            {esAdmin && finales.length > 0 && (
              <section className="border border-border rounded">
                <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide flex justify-between items-center">
                  <span>Reimprimir corte final</span>
                  <span className="text-[10px] text-muted-foreground normal-case">
                    {finalesDesde || finalesHasta
                      ? `${finalesFiltrados.length} de ${finales.length}`
                      : `últimos ${finales.length}`}{' '}
                    · sólo administradores
                  </span>
                </header>

                {/* Filtro desde/hasta + imprimir todos */}
                <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-wrap text-xs">
                  <label htmlFor="finales-desde" className="text-muted-foreground">
                    Desde:
                  </label>
                  <input
                    id="finales-desde"
                    type="date"
                    value={finalesDesde}
                    onChange={(e) => setFinalesDesde(e.target.value)}
                    className="border border-border rounded px-2 py-1 bg-background font-mono"
                  />
                  <label htmlFor="finales-hasta" className="text-muted-foreground">
                    Hasta:
                  </label>
                  <input
                    id="finales-hasta"
                    type="date"
                    value={finalesHasta}
                    onChange={(e) => setFinalesHasta(e.target.value)}
                    className="border border-border rounded px-2 py-1 bg-background font-mono"
                  />
                  {(finalesDesde || finalesHasta) && (
                    <button
                      type="button"
                      onClick={() => {
                        setFinalesDesde('')
                        setFinalesHasta('')
                      }}
                      className="p-1 border border-border rounded hover:bg-muted"
                      title="Quitar filtro de fechas"
                      aria-label="Quitar filtro de fechas"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                  {(finalesDesde || finalesHasta) && finalesFiltrados.length > 0 && (
                    <button
                      type="button"
                      onClick={confirmarImprimirTodos}
                      disabled={reimprimiendo !== null || batchProgress !== null}
                      className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 border border-border rounded hover:bg-muted disabled:opacity-50 font-medium"
                    >
                      {batchProgress ? (
                        <>
                          <Spinner size={12} /> Imprimiendo {batchProgress.done}/
                          {batchProgress.total}…
                        </>
                      ) : (
                        <>
                          <Printer className="size-3.5" />
                          Imprimir todos ({finalesFiltrados.length})
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="overflow-auto max-h-[220px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background border-b border-border z-10">
                      <tr className="text-left">
                        <th className="px-2 py-1">Fecha</th>
                        <th className="px-2 py-1">Folios</th>
                        <th className="px-2 py-1 text-right">Total</th>
                        <th className="px-2 py-1">Cajero</th>
                        <th className="px-2 py-1 w-40 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finalesFiltrados.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-2 py-6 text-center text-muted-foreground italic"
                          >
                            Sin cortes finales en el rango de fechas.
                          </td>
                        </tr>
                      )}
                      {finalesFiltrados.map((c) => (
                        <tr key={c.id} className="border-b border-border/60">
                          <td className="px-2 py-1 font-mono">
                            {new Date(c.fecha).toLocaleString('es-MX')}
                          </td>
                          <td className="px-2 py-1 font-mono">
                            {fmtFolio(c.folioInicio)}–{fmtFolio(c.folioFin)}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">${money(c.total)}</td>
                          <td className="px-2 py-1">{c.cajero ?? '—'}</td>
                          <td className="px-2 py-1 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => verCorteFinal(c)}
                              disabled={cargandoVer !== null || batchProgress !== null}
                              title="Ver en pantalla lo que imprime este corte"
                              className="inline-flex items-center gap-1 px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-50 text-[11px]"
                            >
                              {cargandoVer === c.id ? (
                                <Spinner size={11} />
                              ) : (
                                <Eye className="size-3" />
                              )}
                              Ver
                            </button>
                            <button
                              type="button"
                              onClick={() => reimprimirCorte(c)}
                              disabled={reimprimiendo !== null || batchProgress !== null}
                              className="ml-1 inline-flex items-center gap-1 px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-50 text-[11px]"
                            >
                              {reimprimiendo === c.id ? (
                                <Spinner size={11} />
                              ) : (
                                <Printer className="size-3" />
                              )}
                              Imprimir
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

          </div>
        )}
      </div>

      <footer className="flex justify-between items-center px-4 py-3 border-t border-border bg-muted/20 text-xs">
        <div className="text-muted-foreground">
          <span className="font-mono">↑/↓</span> navegar folios (detalle automático) ·{' '}
          <span className="font-mono">Ctrl+R</span> recargar ·{' '}
          <span className="font-mono">Esc</span> cerrar
        </div>
        <div className="flex gap-2">
          {esAdmin && (
            <button
              type="button"
              onClick={() => setVentasDiaOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1 border border-border rounded hover:bg-muted"
              title="Consultar las ventas de cualquier día (calendario)"
            >
              <CalendarDays className="size-3.5" />
              Otros días
            </button>
          )}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1 border border-border rounded hover:bg-muted"
          >
            {loading ? (
              <>
                <Spinner size={14} /> Cargando…
              </>
            ) : (
              'Recargar'
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1 border border-border rounded hover:bg-muted"
          >
            Cerrar
          </button>
        </div>
      </footer>
    </Modal>

    {/* Ventas de otros días (calendario) — sólo admin */}
    <VentasDiaModal open={ventasDiaOpen} onClose={() => setVentasDiaOpen(false)} />

    {/* Corte final en pantalla: lo mismo que su ticket, sin imprimir a fuerzas */}
    {verCorte && (
      <Modal
        open
        title={`Corte final — folios ${fmtFolio(verCorte.d.folioInicio)}–${fmtFolio(verCorte.d.folioFin)}`}
        onClose={() => setVerCorte(null)}
        maxWidth="max-w-md"
      >
        <div className="p-4 space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {verCorte.d.fechaInicio && (
              <>
                Inicio del periodo:{' '}
                <span className="font-mono">
                  {new Date(verCorte.d.fechaInicio).toLocaleString('es-MX')}
                </span>
                <br />
                Corte final:{' '}
                <span className="font-mono">
                  {new Date(verCorte.d.fecha).toLocaleString('es-MX')}
                </span>
                {' · '}
              </>
            )}
            {!verCorte.d.fechaInicio && (
              <>{new Date(verCorte.d.fecha).toLocaleString('es-MX')} · </>
            )}
            Cajero {verCorte.d.cajero} — las mismas cifras que imprime el ticket, en pantalla.
          </p>
          <div className="space-y-1.5 font-mono text-xs">
            <Row label="Notas vendidas" value={String(verCorte.d.foliosVendidos)} />
            <Row label="Canceladas" value={String(verCorte.d.foliosCancelados)} />
            <div className="border-t border-border my-1.5" />
            <Row label="Efectivo" value={`$${money(verCorte.d.efectivo)}`} />
            <Row label="Tarjeta" value={`$${money(verCorte.d.tarjeta)}`} />
            <Row label="Transferencia" value={`$${money(verCorte.d.transferencia)}`} />
            {verCorte.d.otro > 0 && <Row label="Otros" value={`$${money(verCorte.d.otro)}`} />}
            <Row label="Total vendido" value={`$${money(verCorte.d.total)}`} bold />
            <div className="border-t border-border my-1.5" />
            <Row label="Entradas caja" value={`$${money(verCorte.d.entradasCaja)}`} />
            <Row label="Salidas caja" value={`$${money(verCorte.d.salidasCaja)}`} />
            <Row label="Cancelaciones" value={`$${money(verCorte.d.cancelaciones)}`} />
            <div className="border-t border-border my-1.5" />
            <Row label="Subtotal" value={`$${money(verCorte.d.subtotal)}`} />
            <Row label="IVA" value={`$${money(verCorte.d.iva)}`} />
            <Row label="Efectivo en caja" value={`$${money(verCorte.d.efectivoEsperado)}`} bold />
          </div>

          {verCorte.d.ventasTarjeta && verCorte.d.ventasTarjeta.length > 0 && (
            <div className="border border-border rounded p-2 text-xs">
              <div className="font-semibold mb-1">Ventas con tarjeta</div>
              <div className="font-mono space-y-0.5 max-h-32 overflow-auto">
                {verCorte.d.ventasTarjeta.map((v, i) => (
                  <div key={i} className="flex justify-between">
                    <span>Folio {fmtFolio(v.folio)}</span>
                    <span>${money(v.monto)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {verCorte.d.parcialesDelDia && verCorte.d.parcialesDelDia.length > 0 && (
            <div className="border border-border rounded p-2 text-xs">
              <div className="font-semibold mb-1">Cortes parciales del periodo</div>
              <div className="font-mono space-y-0.5 max-h-32 overflow-auto">
                {verCorte.d.parcialesDelDia.map((p, i) => (
                  <div key={i} className="flex justify-between">
                    <span>
                      {p.tipo === 'CAMBIO_TURNO' ? 'Cambio turno' : 'Parcial'}{' '}
                      {new Date(p.fecha).toLocaleTimeString('es-MX', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}{' '}
                      · folios {fmtFolio(p.folioInicio)}–{fmtFolio(p.folioFin)}
                    </span>
                    <span>${money(p.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => reimprimirCorte(verCorte.item)}
              disabled={reimprimiendo !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50"
            >
              {reimprimiendo === verCorte.item.id ? (
                <Spinner size={14} />
              ) : (
                <Printer className="size-3.5" />
              )}
              Imprimir ticket
            </button>
            <button
              type="button"
              onClick={() => setVerCorte(null)}
              className="px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 font-semibold"
            >
              Cerrar
            </button>
          </div>
        </div>
      </Modal>
    )}

    {corteEnPantalla && (
      <Modal
        open
        title={`Corte parcial — folios ${corteEnPantalla.folioInicio}–${corteEnPantalla.folioFin}`}
        onClose={() => (imprimiendoPantalla ? undefined : setCorteEnPantalla(null))}
        maxWidth="max-w-sm"
      >
        <div className="p-4 space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Corte parcial registrado. Lee las cifras (por ejemplo para pasarlas por teléfono) y
            luego imprime el ticket o sólo ciérralo.
          </p>
          <div className="space-y-1.5 font-mono">
            <Row label="Notas vendidas" value={String(corteEnPantalla.totales.foliosVendidos)} />
            <Row label="Canceladas" value={String(corteEnPantalla.totales.foliosCancelados)} />
            <div className="border-t border-border my-1.5" />
            <Row label="Efectivo" value={`$${money(corteEnPantalla.totales.efectivo)}`} />
            <Row label="Tarjeta" value={`$${money(corteEnPantalla.totales.tarjeta)}`} />
            <Row label="Transferencia" value={`$${money(corteEnPantalla.totales.transferencia)}`} />
            {corteEnPantalla.totales.otro > 0 && (
              <Row label="Otros" value={`$${money(corteEnPantalla.totales.otro)}`} />
            )}
            <Row label="Total vendido" value={`$${money(corteEnPantalla.totales.total)}`} bold />
            <div className="border-t border-border my-1.5" />
            <Row label="Entradas caja" value={`$${money(corteEnPantalla.totales.entradasCaja)}`} />
            <Row label="Salidas caja" value={`$${money(corteEnPantalla.totales.salidasCaja)}`} />
            <Row
              label="Efectivo en caja"
              value={`$${money(corteEnPantalla.totales.efectivoEsperado)}`}
              bold
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={imprimirCorteEnPantalla}
              disabled={imprimiendoPantalla}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50"
            >
              {imprimiendoPantalla ? <Spinner size={14} /> : <Printer className="size-3.5" />}
              {imprimiendoPantalla ? 'Imprimiendo…' : 'Imprimir ticket'}
            </button>
            <button
              type="button"
              onClick={() => setCorteEnPantalla(null)}
              disabled={imprimiendoPantalla}
              className="px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 font-semibold"
            >
              Cerrar
            </button>
          </div>
        </div>
      </Modal>
    )}
    </>
  )
}

function Row({
  label,
  value,
  bold,
  textClass
}: {
  label: string
  value: string
  bold?: boolean
  textClass?: string
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4">
      <span className="text-muted-foreground sans-serif">{label}</span>
      <span className={`text-right ${bold ? 'font-bold text-blue-700' : ''} ${textClass ?? ''}`}>
        {value}
      </span>
    </div>
  )
}

function MiniField({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`border border-border rounded p-2 ${highlight ? 'bg-background' : ''}`}>
      <div className="text-[10px] uppercase text-muted-foreground sans-serif">{label}</div>
      <div className={`text-right ${highlight ? 'text-base font-bold text-blue-700' : ''}`}>
        {value}
      </div>
    </div>
  )
}
