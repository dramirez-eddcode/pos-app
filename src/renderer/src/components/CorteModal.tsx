import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Printer } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import BusyOverlay from './BusyOverlay'
import InfoTooltip from './InfoTooltip'
import { folio as fmtFolio, money } from '../lib/format'
import { useSession } from '../stores/session'
import { useSettings } from '../stores/settings'
import type {
  CorteFinalHistItem,
  CorteHoyDto,
  CortePendienteDia,
  CorteTipo,
  CreateCorteResult,
  MetodoPagoTotal,
  VentaDetailDto
} from '@shared/dto'

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

const TIPO_LABEL: Record<CorteTipo, string> = {
  PARCIAL: 'Corte parcial',
  FINAL: 'Corte final',
  CAMBIO_TURNO: 'Cambio de turno'
}

const CORTE_TIPO_LABEL: Record<CorteTipo, string> = {
  PARCIAL: 'Parcial',
  FINAL: 'Final',
  CAMBIO_TURNO: 'Cambio de turno'
}

function fmtDia(ymd: string): string {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString('es-MX', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
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
  const [pendientesDias, setPendientesDias] = useState<CortePendienteDia[]>([])
  const [cerrandoPendiente, setCerrandoPendiente] = useState<string | null>(null)
  const [finales, setFinales] = useState<CorteFinalHistItem[]>([])
  const [reimprimiendo, setReimprimiendo] = useState<string | null>(null)
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
      setPendientesDias(await window.api.corte.pendientesDias().catch(() => []))
      if (user && esAdmin) {
        setFinales(await window.api.corte.finales(user.id).catch(() => []))
      }
    } catch (e) {
      toast.error('No pude cargar el corte', { description: String(e) })
    } finally {
      setLoading(false)
    }
  }, [user, esAdmin])

  useEffect(() => {
    if (open) load()
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
          parcialesDelDia: r.parcialesDelDia
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

  // ── Corte final de un día anterior que quedó pendiente ──────────────────
  const cerrarCortePendiente = useCallback(
    async (dia: CortePendienteDia) => {
      if (!user || cerrandoPendiente || cerrando) return
      setCerrandoPendiente(dia.fecha)
      try {
        const r = await window.api.corte.createFinalPendiente(user.id, dia.fecha)
        await imprimirTicketCorte(r)
        toast.success(
          `Corte final del ${fmtDia(dia.fecha)} registrado · folios ${fmtFolio(r.folioInicio)}–${fmtFolio(r.folioFin)}`,
          { description: `Total: $${money(r.totales.total)}` }
        )
        await load()
      } catch (e) {
        toast.error('No se pudo registrar el corte final pendiente', {
          description: e instanceof Error ? e.message : String(e)
        })
      } finally {
        setCerrandoPendiente(null)
      }
    },
    [user, cerrandoPendiente, cerrando, imprimirTicketCorte, load]
  )

  const confirmarCortePendiente = useCallback(
    (dia: CortePendienteDia) => {
      toast.warning(`¿Hacer el corte final del ${fmtDia(dia.fecha)}?`, {
        id: 'corte-pendiente-confirm',
        description: `Cubre folios ${fmtFolio(dia.folioInicio)}–${fmtFolio(dia.folioFin)} · $${money(dia.total)}. Solo puede hacerse una vez.`,
        duration: 10000,
        action: { label: 'Sí, cerrar día', onClick: () => cerrarCortePendiente(dia) }
      })
    },
    [cerrarCortePendiente]
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

  const confirmarCorte = useCallback(
    (tipo: CorteTipo) => {
      const esFinal = tipo === 'FINAL'
      toast.warning(`¿Confirmar ${TIPO_LABEL[tipo].toLowerCase()}?`, {
        id: `corte-confirm-${tipo}`,
        description:
          esFinal
            ? 'Cierra TODO el día completo (desde las 00:00), incluyendo lo ya cubierto por parciales o cambios de turno. Se imprimirá el ticket de corte.'
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
    async (folioLocal: number) => {
      setLoadingDetail(true)
      try {
        const d = await window.api.ventas.byFolio(folioLocal)
        setDetail(d)
        setTimeout(() => {
          detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }, 50)
      } catch (e) {
        toast.error('No pude cargar la venta', { description: String(e) })
      } finally {
        setLoadingDetail(false)
      }
    },
    []
  )

  // Navegación por teclado dentro del modal (capture phase → le gana al resto)
  useEffect(() => {
    if (!open) return
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
  }, [open, data, idx, load, showDetail])

  // Auto-scroll de la fila seleccionada
  useEffect(() => {
    const tbody = tableBodyRef.current
    if (!tbody || idx < 0) return
    const row = tbody.children[idx] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
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
          show={cerrando !== null || cerrandoPendiente !== null}
          text={
            cerrandoPendiente !== null
              ? 'Registrando corte final pendiente…'
              : `Registrando ${TIPO_LABEL[cerrando ?? 'PARCIAL'].toLowerCase()}…`
          }
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
                  <Row label="Venta del día" value={money(data.ventaDelDia)} bold />
                  <Row
                    label="Monto cancelado"
                    value={money(data.montoCancelado)}
                    textClass={data.montoCancelado > 0 ? 'text-red-700' : ''}
                  />
                  <Row label="Entradas de caja" value={money(data.entradasCaja)} />
                  <Row label="Salidas de caja" value={money(data.salidasCaja)} />
                  <hr className="border-border my-1.5" />
                  <Row label="Subtotal del día" value={money(data.subtotalDelDia)} />
                  <Row label="IVA por pagar" value={money(data.ivaDelDia)} />
                </div>
              </section>

              {/* Folios del día */}
              <section className="border border-border rounded flex flex-col">
                <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide flex justify-between items-center">
                  <span>Folios del día</span>
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
                        <th className="px-2 py-1 text-right">Total</th>
                        <th className="px-2 py-1 w-12 text-center">Canc.</th>
                      </tr>
                    </thead>
                    <tbody ref={tableBodyRef}>
                      {data.folios.length === 0 && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-2 py-6 text-center text-muted-foreground italic"
                          >
                            Sin ventas hoy
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

            {/* Cortes finales pendientes de días anteriores */}
            {pendientesDias.length > 0 && (
              <section className="border border-amber-300 rounded">
                <header className="px-3 py-2 border-b border-amber-300 bg-amber-50 text-xs font-semibold uppercase tracking-wide text-amber-900">
                  Cortes finales pendientes de días anteriores
                </header>
                <div className="p-3 space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    Estos días tienen ventas sin corte final. Cualquier usuario puede cerrarlos —
                    en orden, del más antiguo al más reciente, y <strong>una sola vez</strong> cada
                    uno. Mientras haya pendientes, los cortes de hoy quedan bloqueados para no
                    mezclar días.
                  </p>
                  {pendientesDias.map((d, i) => (
                    <div
                      key={d.fecha}
                      className="flex items-center justify-between gap-3 border border-border rounded px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-semibold capitalize">{fmtDia(d.fecha)}</span>
                        <span className="font-mono text-muted-foreground">
                          {' '}· folios {fmtFolio(d.folioInicio)}–{fmtFolio(d.folioFin)} · {d.notas}{' '}
                          nota{d.notas === 1 ? '' : 's'} · ${money(d.total)}
                        </span>
                      </div>
                      {i === 0 ? (
                        <button
                          type="button"
                          onClick={() => confirmarCortePendiente(d)}
                          disabled={cerrandoPendiente !== null || cerrando !== null}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-xs font-semibold shrink-0"
                        >
                          {cerrandoPendiente === d.fecha ? (
                            <>
                              <Spinner size={13} /> Procesando…
                            </>
                          ) : (
                            'Hacer corte final'
                          )}
                        </button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic shrink-0">
                          cierra primero el día anterior
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Cierre de corte */}
            <section className="border border-border rounded">
              <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide">
                Cerrar corte
              </header>
              <div className="p-3 space-y-2">
                {pendientesDias.length > 0 && (
                  <div className="text-xs border border-amber-300 bg-amber-50 text-amber-900 rounded px-3 py-2">
                    Hay {pendientesDias.length} día{pendientesDias.length === 1 ? '' : 's'} con
                    corte final pendiente — ciérralo{pendientesDias.length === 1 ? '' : 's'} arriba
                    antes de hacer cortes de hoy.
                  </div>
                )}
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
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => confirmarCorte('PARCIAL')}
                    disabled={cerrando !== null || !data.pendiente || pendientesDias.length > 0}
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
                    onClick={() => confirmarCorte('CAMBIO_TURNO')}
                    disabled={cerrando !== null || !data.pendiente || pendientesDias.length > 0}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {cerrando === 'CAMBIO_TURNO' ? (
                      <>
                        <Spinner size={14} /> Procesando…
                      </>
                    ) : (
                      'Cambio de turno'
                    )}
                    <InfoTooltip title="Cambio de turno" align="center">
                      Igual que el parcial pero indica que un cajero{' '}
                      <strong>entrega la caja a otro</strong>. Queda registrado como{' '}
                      <span className="font-mono">CAMBIO_TURNO</span> para deslindar
                      responsabilidades entre turnos.
                      <div className="mt-1.5 pt-1.5 border-t border-primary-foreground/20 italic">
                        Ej: el cajero matutino termina su turno antes de que llegue el
                        vespertino.
                      </div>
                    </InfoTooltip>
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmarCorte('FINAL')}
                    disabled={cerrando !== null || data.folios.length === 0 || pendientesDias.length > 0}
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
                      El <strong>cierre del día COMPLETO</strong>: cubre todas las ventas y caja
                      desde las 00:00 hasta ahora, <strong>incluyendo</strong> lo que ya hayan
                      cubierto parciales o cambios de turno. Su ticket cuadra con las cifras del
                      día en pantalla.
                      <div className="mt-1.5 pt-1.5 border-t border-primary-foreground/20 italic">
                        Ej: al apagar la tienda. Normalmente sólo se hace uno por día.
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
                    últimos {finales.length} · sólo administradores
                  </span>
                </header>
                <div className="overflow-auto max-h-[220px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background border-b border-border z-10">
                      <tr className="text-left">
                        <th className="px-2 py-1">Fecha</th>
                        <th className="px-2 py-1">Folios</th>
                        <th className="px-2 py-1 text-right">Total</th>
                        <th className="px-2 py-1">Cajero</th>
                        <th className="px-2 py-1 w-28 text-center">Reimprimir</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finales.map((c) => (
                        <tr key={c.id} className="border-b border-border/60">
                          <td className="px-2 py-1 font-mono">
                            {new Date(c.fecha).toLocaleString('es-MX')}
                          </td>
                          <td className="px-2 py-1 font-mono">
                            {fmtFolio(c.folioInicio)}–{fmtFolio(c.folioFin)}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">${money(c.total)}</td>
                          <td className="px-2 py-1">{c.cajero ?? '—'}</td>
                          <td className="px-2 py-1 text-center">
                            <button
                              type="button"
                              onClick={() => reimprimirCorte(c)}
                              disabled={reimprimiendo !== null}
                              className="inline-flex items-center gap-1 px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-50 text-[11px]"
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

            {/* Detalle de venta seleccionada */}
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
                {loadingDetail && <span className="text-[10px] normal-case">cargando…</span>}
              </header>
              <div className="p-3">
                {!detail && !loadingDetail && (
                  <div className="text-muted-foreground text-xs italic">
                    Selecciona un folio y presiona <span className="font-mono">Enter</span> (o
                    doble click) para ver el detalle
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
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      <footer className="flex justify-between items-center px-4 py-3 border-t border-border bg-muted/20 text-xs">
        <div className="text-muted-foreground">
          <span className="font-mono">↑/↓</span> navegar folios ·{' '}
          <span className="font-mono">Enter</span> ver detalle ·{' '}
          <span className="font-mono">Ctrl+R</span> recargar ·{' '}
          <span className="font-mono">Esc</span> cerrar
        </div>
        <div className="flex gap-2">
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
