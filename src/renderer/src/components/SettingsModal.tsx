import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Database, HardDriveDownload } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import RespaldoModal from './RespaldoModal'
import { useSession } from '../stores/session'
import { useSettings } from '../stores/settings'
import { isFullAdmin, isSuperusuario } from '../lib/roles'

const DEFAULT_PRINTER_HINT = 'EPSON TM-T20III Receipt'

interface Props {
  open: boolean
  onClose: () => void
}

export default function SettingsModal({ open, onClose }: Props) {
  const { settings, update } = useSettings()
  const { user } = useSession()
  const [printers, setPrinters] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [docPrinter, setDocPrinter] = useState<string>('')
  const [docDuplex, setDocDuplex] = useState<boolean>(false)
  const [docFontSize, setDocFontSize] = useState<'chico' | 'mediano' | 'grande'>('chico')
  const [drawerOnCash, setDrawerOnCash] = useState<boolean>(true)
  const [showTime, setShowTime] = useState<boolean>(false)
  const [receiptFooter, setReceiptFooter] = useState<string>('')
  const [mostrarRazonSocial, setMostrarRazonSocial] = useState<boolean>(true)
  const [mostrarRfc, setMostrarRfc] = useState<boolean>(true)
  const [mostrarSucursal, setMostrarSucursal] = useState<boolean>(true)
  const [mostrarDireccion, setMostrarDireccion] = useState<boolean>(true)
  const [mostrarFolio, setMostrarFolio] = useState<boolean>(true)
  const [mostrarPuntoVenta, setMostrarPuntoVenta] = useState<boolean>(true)
  const [esMatriz, setEsMatriz] = useState<boolean>(false)
  const [busy, setBusy] = useState<null | 'test' | 'drawer' | 'save'>(null)
  const [actualizando, setActualizando] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [respaldoOpen, setRespaldoOpen] = useState(false)
  // La zona peligrosa (reset de modo) es exclusiva del SUPERUSUARIO; el backend
  // (instalacion.resetInstalacion) lo exige también.
  const userIsSuper = isSuperusuario(user)
  // Qué se imprime en el ticket (hora, encabezado, pie), la apertura
  // automática del cajón y los botones de prueba (ticket de prueba / abrir
  // cajón): sólo SUPERUSUARIO y ADMINISTRADOR. Cajero/supervisor lo ven
  // deshabilitado — la selección de impresora sí la pueden ajustar (es de
  // hardware, por equipo).
  const puedeConfigurarTicket = isFullAdmin(user)

  const loadPrinters = useCallback(async () => {
    try {
      const list = await window.api.printer.list()
      setPrinters(list)
    } catch (e) {
      toast.error('No pude enumerar impresoras', { description: String(e) })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    loadPrinters()
    setSelected(settings?.printerName ?? '')
    setDocPrinter(settings?.docPrinterName ?? '')
    setDocDuplex(settings?.docPrinterDuplex ?? false)
    setDocFontSize(settings?.docFontSize ?? 'chico')
    setDrawerOnCash(settings?.openDrawerOnCash ?? true)
    setShowTime(settings?.showTimeOnReceipt ?? false)
    setReceiptFooter(settings?.receiptFooter ?? '')
    setMostrarRazonSocial(settings?.ticketMostrarRazonSocial ?? true)
    setMostrarRfc(settings?.ticketMostrarRfc ?? true)
    setMostrarSucursal(settings?.ticketMostrarSucursal ?? true)
    setMostrarDireccion(settings?.ticketMostrarDireccion ?? true)
    setMostrarFolio(settings?.ticketMostrarFolio ?? true)
    setMostrarPuntoVenta(settings?.matrizMostrarPuntoVenta ?? true)
    window.api.instalacion
      .get()
      .then((i) => setEsMatriz(i.configured === true && i.tipo === 'MATRIZ'))
      .catch(() => setEsMatriz(false))
  }, [open, loadPrinters, settings])

  const printTest = async () => {
    if (!selected) {
      toast.warning('Selecciona una impresora primero')
      return
    }
    setBusy('test')
    // Usa el pie tal como está en el campo (aún sin guardar) para previsualizar;
    // vacío → no se imprime ningún pie.
    const r = await window.api.printer.printTest(selected, {
      showTime,
      footer: receiptFooter.trim() || null,
      mostrarRazonSocial,
      mostrarRfc,
      mostrarSucursal,
      mostrarDireccion,
      mostrarFolio
    })
    setBusy(null)
    if (r.ok) toast.success('Ticket de prueba enviado', { description: `${r.bytesSent} bytes → ${selected}` })
    else toast.error('Falló la impresión', { description: (r.stderr || r.stdout).trim() })
  }

  const openDrawer = async () => {
    if (!selected) {
      toast.warning('Selecciona una impresora primero')
      return
    }
    setBusy('drawer')
    const r = await window.api.printer.openDrawer(selected)
    setBusy(null)
    if (r.ok) toast.success('Pulso enviado al cajón')
    else toast.error('No se pudo abrir el cajón', { description: (r.stderr || r.stdout).trim() })
  }

  // Actualizar el sistema desde USB (sólo admin): elige el instalador nuevo,
  // se respalda la base automáticamente, se cierra la app y corre el setup.
  // Los datos se conservan (viven fuera de la carpeta de instalación).
  const actualizarDesdeUsb = async () => {
    if (!user || actualizando) return
    setActualizando(true)
    try {
      const r = await window.api.actualizacion.pick(user.id)
      if (!r.ok) {
        if (!r.cancelled) toast.error('Instalador no válido', { description: r.error })
        return
      }
      const p = r.preview!
      const descripcion =
        p.comparacion === 1
          ? `v${p.versionActual} → v${p.versionNueva}. Se hará un respaldo automático, la app se cerrará y abrirá el instalador. Tus datos se conservan.`
          : p.comparacion === 0
            ? `El instalador es la MISMA versión que ya tienes (v${p.versionActual}). ¿Reinstalar de todas formas?`
            : `¡Atención! El instalador (v${p.versionNueva}) es MÁS VIEJO que la versión instalada (v${p.versionActual}).`
      toast.warning(`¿Actualizar el sistema con "${p.fileName}"?`, {
        id: 'actualizar-confirm',
        description: descripcion,
        duration: 15000,
        action: {
          label: 'Sí, actualizar',
          onClick: async () => {
            const res = await window.api.actualizacion.aplicar(user.id, p.filePath)
            if (!res.ok) {
              toast.error('No se pudo iniciar la actualización', { description: res.error })
            } else {
              toast.success('Abriendo el instalador…', {
                description: 'La app se cerrará. Sigue los pasos del instalador y vuelve a abrir el sistema.'
              })
            }
          }
        }
      })
    } finally {
      setActualizando(false)
    }
  }

  const save = async () => {
    setBusy('save')
    try {
      await update({
        printerName: selected || null,
        docPrinterName: docPrinter || null,
        docPrinterDuplex: docDuplex,
        docFontSize,
        openDrawerOnCash: drawerOnCash,
        showTimeOnReceipt: showTime,
        receiptFooter: receiptFooter.trim() || null,
        ticketMostrarRazonSocial: mostrarRazonSocial,
        ticketMostrarRfc: mostrarRfc,
        ticketMostrarSucursal: mostrarSucursal,
        ticketMostrarDireccion: mostrarDireccion,
        ticketMostrarFolio: mostrarFolio,
        matrizMostrarPuntoVenta: mostrarPuntoVenta
      })
      toast.success('Configuración guardada')
      onClose()
    } catch (e) {
      toast.error('No pude guardar', { description: String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
    <Modal open={open && !resetOpen && !respaldoOpen} title="Configuración" onClose={onClose} maxWidth="max-w-lg">
      <div className="p-4 space-y-4 text-sm">
        <section className="space-y-2">
          <label className="block font-medium">Impresora de tickets</label>
          <div className="flex gap-2">
            <select
              className="flex-1 border border-border rounded px-2 py-1.5 bg-background"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Sin impresora — no imprimir tickets</option>
              {printers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadPrinters}
              className="px-3 py-1 border border-border rounded hover:bg-muted text-xs"
            >
              Recargar
            </button>
          </div>
          {selected === '' && (
            <p className="text-xs text-muted-foreground">
              Con "Sin impresora" el sistema opera normal (ventas, cortes, cancelaciones) pero
              no manda nada a imprimir.
              {printers.includes(DEFAULT_PRINTER_HINT) && (
                <> Tip: parece que tienes &quot;{DEFAULT_PRINTER_HINT}&quot; instalada.</>
              )}
            </p>
          )}
        </section>

        {/* Impresora de DOCUMENTOS (carta): pedidos, resúmenes, historial.
            La térmica de arriba queda EXCLUSIVA de tickets y cortes. */}
        <section className="space-y-2 pt-3 border-t border-border">
          <label className="block font-medium">Impresora de documentos (tamaño carta)</label>
          <select
            className="w-full border border-border rounded px-2 py-1.5 bg-background"
            value={docPrinter}
            onChange={(e) => setDocPrinter(e.target.value)}
          >
            <option value="">— Elegir al imprimir (diálogo de Windows) —</option>
            {printers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Se usa para las hojas de <strong>pedidos de surtido</strong>, el{' '}
            <strong>resumen de surtido</strong> y los documentos del{' '}
            <strong>historial de movimientos</strong>. La impresora de tickets de arriba sólo
            imprime tickets, cortes y cancelaciones.
          </p>
          <div className="flex items-center gap-2">
            <input
              id="doc-duplex"
              type="checkbox"
              checked={docDuplex}
              disabled={!puedeConfigurarTicket}
              onChange={(e) => setDocDuplex(e.target.checked)}
            />
            <label htmlFor="doc-duplex" className={puedeConfigurarTicket ? '' : 'opacity-60'}>
              Imprimir documentos a <strong>doble cara</strong> (si la impresora lo soporta) —
              ahorra papel
            </label>
          </div>

          {/* Tamaño de letra de los documentos impresos/PDF */}
          <div className="pt-1">
            <label className="block text-xs font-medium mb-1">
              Tamaño de letra de los documentos
            </label>
            <div className="flex gap-2">
              {(
                [
                  ['chico', 'Chico (actual)'],
                  ['mediano', 'Mediano'],
                  ['grande', 'Grande']
                ] as const
              ).map(([valor, etiqueta]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => setDocFontSize(valor)}
                  className={`flex-1 px-3 py-1.5 border rounded text-sm cursor-pointer ${
                    docFontSize === valor
                      ? 'border-primary bg-primary/10 font-semibold'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <span
                    className={
                      valor === 'grande'
                        ? 'text-base'
                        : valor === 'mediano'
                          ? 'text-sm'
                          : 'text-xs'
                    }
                  >
                    {etiqueta}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Aplica a las hojas de pedidos, resumen de surtido e historial (impresos y PDF). Con
              letra más grande los documentos pueden usar más hojas — la numeración se ajusta
              sola.
            </p>
          </div>
        </section>

        <section className="flex items-center gap-2">
          <input
            id="drawer"
            type="checkbox"
            checked={drawerOnCash}
            disabled={!puedeConfigurarTicket}
            onChange={(e) => setDrawerOnCash(e.target.checked)}
          />
          <label htmlFor="drawer" className={puedeConfigurarTicket ? '' : 'opacity-60'}>
            Abrir cajón automáticamente al cobrar en efectivo
          </label>
        </section>

        <section className="flex items-center gap-2">
          <input
            id="show-time"
            type="checkbox"
            checked={showTime}
            disabled={!puedeConfigurarTicket}
            onChange={(e) => setShowTime(e.target.checked)}
          />
          <label htmlFor="show-time" className={puedeConfigurarTicket ? '' : 'opacity-60'}>
            Mostrar hora de la venta en el ticket
          </label>
        </section>

        <section className={`space-y-1.5 ${puedeConfigurarTicket ? '' : 'opacity-60'}`}>
          <div className="font-medium text-xs">Encabezado del ticket — qué imprimir</div>
          <div className="border border-border rounded px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={mostrarRazonSocial}
                disabled={!puedeConfigurarTicket}
                onChange={(e) => setMostrarRazonSocial(e.target.checked)}
              />
              Razón social
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={mostrarRfc}
                disabled={!puedeConfigurarTicket}
                onChange={(e) => setMostrarRfc(e.target.checked)}
              />
              RFC
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={mostrarSucursal}
                disabled={!puedeConfigurarTicket}
                onChange={(e) => setMostrarSucursal(e.target.checked)}
              />
              Nombre de la sucursal
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={mostrarDireccion}
                disabled={!puedeConfigurarTicket}
                onChange={(e) => setMostrarDireccion(e.target.checked)}
              />
              Dirección
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={mostrarFolio}
                disabled={!puedeConfigurarTicket}
                onChange={(e) => setMostrarFolio(e.target.checked)}
              />
              Folio
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {puedeConfigurarTicket ? (
              <>
                Lo desmarcado no se imprime. Razón social, RFC, sucursal y dirección aplican a
                todos los tickets (venta, cancelación y corte); el folio aplica al ticket de
                venta. Usa "Ticket de prueba" para previsualizar antes de guardar.
              </>
            ) : (
              <>
                Sólo un <strong>administrador</strong> o <strong>superusuario</strong> puede
                cambiar qué se imprime en el ticket.
              </>
            )}
          </p>
        </section>

        <section className={`space-y-1 ${puedeConfigurarTicket ? '' : 'opacity-60'}`}>
          <label htmlFor="receipt-footer" className="block font-medium text-xs">
            Mensaje al pie del ticket
          </label>
          <textarea
            id="receipt-footer"
            rows={2}
            maxLength={160}
            placeholder='Ej. "¡Gracias por su compra!" — máx. 160 caracteres, una o dos líneas.'
            className="w-full border border-border rounded px-2 py-1.5 text-sm"
            value={receiptFooter}
            disabled={!puedeConfigurarTicket}
            onChange={(e) => setReceiptFooter(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Aparece centrado al final del ticket de venta. Déjalo vacío para no imprimir nada.
          </p>
        </section>

        {puedeConfigurarTicket && (
          <section className="flex gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={printTest}
              disabled={!selected || busy !== null}
              className="flex-1 px-3 py-2 border border-border rounded hover:bg-muted disabled:opacity-50"
            >
              {busy === 'test' ? (
                <>
                  <Spinner size={14} /> Enviando…
                </>
              ) : (
                'Ticket de prueba'
              )}
            </button>
            <button
              type="button"
              onClick={openDrawer}
              disabled={!selected || busy !== null}
              className="flex-1 px-3 py-2 border border-border rounded hover:bg-muted disabled:opacity-50"
            >
              {busy === 'drawer' ? (
                <>
                  <Spinner size={14} /> Enviando…
                </>
              ) : (
                'Abrir cajón'
              )}
            </button>
          </section>
        )}

        {/* Panel de matriz — sólo admin completo en instalación MATRIZ ──── */}
        {esMatriz && puedeConfigurarTicket && (
          <section className="pt-3 border-t border-border space-y-1.5">
            <div className="font-medium text-xs">Panel de matriz</div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={mostrarPuntoVenta}
                onChange={(e) => setMostrarPuntoVenta(e.target.checked)}
              />
              Mostrar "Punto de venta" (vender en este equipo)
            </label>
            <p className="text-[11px] text-muted-foreground">
              Desmárcalo para ocultar la tarjeta de punto de venta del panel de gestión y que
              este equipo no se use para vender.
            </p>
          </section>
        )}

        {/* Respaldo / restauración ──────────────────────────────────────── */}
        <section className="pt-3 border-t border-border space-y-2">
          <div className="font-medium text-xs">Respaldo de la base de datos</div>
          <div className="text-[11px] text-muted-foreground">
            {isFullAdmin(user) ? (
              <>
                Guarda una copia completa del sistema en USB o restaura desde un respaldo. Hazlo
                al cierre del día.
              </>
            ) : (
              <>
                Guarda una copia completa del sistema en USB. Hazlo al cierre del día.{' '}
                <span className="font-medium">
                  Restaurar un respaldo sólo lo puede hacer un administrador o superusuario.
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setRespaldoOpen(true)}
            disabled={busy !== null}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded hover:bg-muted disabled:opacity-50 text-sm"
          >
            <Database className="size-3.5" />
            {isFullAdmin(user) ? 'Respaldo y restauración…' : 'Respaldo…'}
          </button>
        </section>

        {/* Actualización del sistema desde USB — sólo admin completo ───── */}
        {puedeConfigurarTicket && (
          <section className="pt-3 border-t border-border space-y-2">
            <div className="font-medium text-xs">Actualización del sistema</div>
            <div className="text-[11px] text-muted-foreground">
              Selecciona el instalador nuevo (
              <span className="font-mono">farmacias-ms-pos-x.y.z-setup.exe</span>) desde la USB.
              Se respalda la base automáticamente y tus datos se conservan — no hace falta
              desinstalar.
            </div>
            <button
              type="button"
              onClick={actualizarDesdeUsb}
              disabled={busy !== null || actualizando}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded cursor-pointer hover:bg-muted disabled:opacity-50 text-sm"
            >
              {actualizando ? <Spinner size={14} /> : <HardDriveDownload className="size-3.5" />}
              Actualizar desde USB…
            </button>
          </section>
        )}

        {/* Zona peligrosa: reset de modo — sólo SUPERUSUARIO ───────────── */}
        {userIsSuper && (
          <section className="pt-3 border-t border-red-200">
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle className="size-4 text-red-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium text-xs text-red-800">Zona peligrosa</div>
                <div className="text-[11px] text-muted-foreground">
                  Limpieza total: borra usuarios, sucursales, productos, ventas, cortes y
                  existencias para volver al wizard desde cero. No se puede deshacer.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setResetOpen(true)}
              disabled={busy !== null}
              className="w-full px-3 py-2 border border-red-300 rounded hover:bg-red-50 text-sm text-red-800 disabled:opacity-50"
            >
              Resetear modo de instalación…
            </button>
          </section>
        )}
      </div>

      <footer className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted/20">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy !== null}
          className="px-4 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-medium"
        >
          {busy === 'save' ? (
            <>
              <Spinner size={14} /> Guardando…
            </>
          ) : (
            'Guardar'
          )}
        </button>
      </footer>
    </Modal>

    {resetOpen && user && (
      <ResetModoSubModal
        userId={user.id}
        onClose={() => setResetOpen(false)}
      />
    )}
    <RespaldoModal open={respaldoOpen} onClose={() => setRespaldoOpen(false)} />
    </>
  )
}

// ── Sub-modal: confirmar reset de modo ───────────────────────────────────
function ResetModoSubModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [pass, setPass] = useState('')
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const expected = 'RESETEAR'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (phrase.trim().toUpperCase() !== expected) {
      toast.error(`Escribe exactamente "${expected}" para confirmar`)
      return
    }
    setBusy(true)
    try {
      await window.api.instalacion.reset(userId, pass)
      toast.success('Modo reseteado. La app se reinicia para volver al wizard.')
      setTimeout(() => window.api.reload(), 1000)
    } catch (err) {
      toast.error('No se pudo resetear', {
        description: err instanceof Error ? err.message : String(err)
      })
      setBusy(false)
    }
  }

  return (
    <Modal open title="⚠ Resetear modo de instalación" onClose={busy ? () => {} : onClose} maxWidth="max-w-md">
      <form onSubmit={submit} className="p-4 space-y-3 text-sm">
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
          <div className="font-semibold mb-1">Limpieza total — esta acción borra:</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Configuración de modo (MATRIZ / SUCURSAL)</li>
            <li>Todos los usuarios (incluido tú)</li>
            <li>Sucursales y datos de la sucursal local</li>
            <li>Productos, ventas, cortes, lotes y existencias</li>
          </ul>
          <div className="mt-2">
            La app vuelve al <span className="font-semibold">wizard desde cero</span>. No se puede
            deshacer.
          </div>
        </div>

        <label className="block">
          <span className="block text-xs text-muted-foreground mb-1">
            Confirma tu contraseña actual
          </span>
          <input
            type="password"
            required
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            className="w-full border border-border rounded px-2 py-1.5 font-mono"
            autoComplete="current-password"
          />
        </label>

        <label className="block">
          <span className="block text-xs text-muted-foreground mb-1">
            Escribe <span className="font-mono font-bold">{expected}</span> para confirmar
          </span>
          <input
            type="text"
            required
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            className="w-full border border-border rounded px-2 py-1.5 font-mono"
            autoComplete="off"
          />
        </label>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-5 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 text-sm font-semibold"
          >
            {busy ? (
              <>
                <Spinner size={14} /> Reseteando…
              </>
            ) : (
              'Sí, resetear modo'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
