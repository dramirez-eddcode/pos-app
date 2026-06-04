import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Download, Upload } from 'lucide-react'
import Modal from './Modal'
import { useSession } from '../stores/session'
import { useSettings } from '../stores/settings'
import { isAdminLike } from '../lib/roles'

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
  const [drawerOnCash, setDrawerOnCash] = useState<boolean>(true)
  const [showTime, setShowTime] = useState<boolean>(false)
  const [receiptFooter, setReceiptFooter] = useState<string>('')
  const [busy, setBusy] = useState<null | 'test' | 'drawer' | 'save' | 'backup' | 'restore'>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const userIsAdmin = isAdminLike(user)

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
    setDrawerOnCash(settings?.openDrawerOnCash ?? true)
    setShowTime(settings?.showTimeOnReceipt ?? false)
    setReceiptFooter(settings?.receiptFooter ?? '')
  }, [open, loadPrinters, settings])

  const printTest = async () => {
    if (!selected) {
      toast.warning('Selecciona una impresora primero')
      return
    }
    setBusy('test')
    const r = await window.api.printer.printTest(selected, { showTime })
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

  const doBackup = async () => {
    setBusy('backup')
    try {
      const r = await window.api.backup.export()
      if (r.cancelled) return
      if (r.ok) {
        const mb = ((r.bytes ?? 0) / 1024 / 1024).toFixed(2)
        toast.success('Respaldo guardado', { description: `${mb} MB → ${r.path}` })
      } else {
        toast.error('Falló el respaldo', { description: r.error ?? 'Error desconocido' })
      }
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    setBusy('save')
    try {
      await update({
        printerName: selected || null,
        openDrawerOnCash: drawerOnCash,
        showTimeOnReceipt: showTime,
        receiptFooter: receiptFooter.trim() || null
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
    <Modal open={open && !resetOpen && !restoreOpen} title="Configuración" onClose={onClose} maxWidth="max-w-lg">
      <div className="p-4 space-y-4 text-sm">
        <section className="space-y-2">
          <label className="block font-medium">Impresora de tickets</label>
          <div className="flex gap-2">
            <select
              className="flex-1 border border-border rounded px-2 py-1.5 bg-background"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">— elige impresora —</option>
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
          {selected === '' && printers.includes(DEFAULT_PRINTER_HINT) && (
            <p className="text-xs text-muted-foreground">
              Tip: parece que tienes "{DEFAULT_PRINTER_HINT}" instalada.
            </p>
          )}
        </section>

        <section className="flex items-center gap-2">
          <input
            id="drawer"
            type="checkbox"
            checked={drawerOnCash}
            onChange={(e) => setDrawerOnCash(e.target.checked)}
          />
          <label htmlFor="drawer">Abrir cajón automáticamente al cobrar en efectivo</label>
        </section>

        <section className="flex items-center gap-2">
          <input
            id="show-time"
            type="checkbox"
            checked={showTime}
            onChange={(e) => setShowTime(e.target.checked)}
          />
          <label htmlFor="show-time">Mostrar hora de la venta en el ticket</label>
        </section>

        <section className="space-y-1">
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
            onChange={(e) => setReceiptFooter(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Aparece centrado al final del ticket de venta. Déjalo vacío para no imprimir nada.
          </p>
        </section>

        <section className="flex gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={printTest}
            disabled={!selected || busy !== null}
            className="flex-1 px-3 py-2 border border-border rounded hover:bg-muted disabled:opacity-50"
          >
            {busy === 'test' ? 'Enviando…' : 'Ticket de prueba'}
          </button>
          <button
            type="button"
            onClick={openDrawer}
            disabled={!selected || busy !== null}
            className="flex-1 px-3 py-2 border border-border rounded hover:bg-muted disabled:opacity-50"
          >
            {busy === 'drawer' ? 'Enviando…' : 'Abrir cajón'}
          </button>
        </section>

        {/* Respaldo / restauración ──────────────────────────────────────── */}
        <section className="pt-3 border-t border-border space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-xs">Respaldo de la base de datos</div>
              <div className="text-[11px] text-muted-foreground">
                Guarda una copia completa del sistema en USB. Hazlo al cierre del día.
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={doBackup}
              disabled={busy !== null}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded hover:bg-muted disabled:opacity-50 text-sm"
            >
              <Download className="size-3.5" />
              {busy === 'backup' ? 'Respaldando…' : 'Crear respaldo'}
            </button>
            {userIsAdmin && (
              <button
                type="button"
                onClick={() => setRestoreOpen(true)}
                disabled={busy !== null}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded hover:bg-amber-50 hover:border-amber-300 disabled:opacity-50 text-sm text-amber-800"
              >
                <Upload className="size-3.5" />
                Restaurar
              </button>
            )}
          </div>
          {!userIsAdmin && (
            <p className="text-[11px] text-muted-foreground">
              Restaurar respaldo requiere permisos de administrador.
            </p>
          )}
        </section>

        {/* Zona peligrosa: reset de modo ──────────────────────────────── */}
        {userIsAdmin && (
          <section className="pt-3 border-t border-red-200">
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle className="size-4 text-red-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium text-xs text-red-800">Zona peligrosa</div>
                <div className="text-[11px] text-muted-foreground">
                  Borra la configuración de modo (MATRIZ/SUCURSAL), usuarios y datos de sucursal.
                  Productos y ventas se mantienen. Tendrás que volver a configurar el wizard.
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
          {busy === 'save' ? 'Guardando…' : 'Guardar'}
        </button>
      </footer>
    </Modal>

    {resetOpen && user && (
      <ResetModoSubModal
        userId={user.id}
        onClose={() => setResetOpen(false)}
      />
    )}
    {restoreOpen && (
      <RestoreSubModal
        onClose={() => setRestoreOpen(false)}
      />
    )}
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
          <div className="font-semibold mb-1">Esta acción borra:</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Configuración de modo (MATRIZ / SUCURSAL)</li>
            <li>Todos los usuarios (incluido tú)</li>
            <li>Datos de la sucursal local + lista de sucursales (si es matriz)</li>
          </ul>
          <div className="mt-2">
            <span className="font-semibold">NO</span> borra: productos, ventas, cortes, lotes.
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
            {busy ? 'Reseteando…' : 'Sí, resetear modo'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Sub-modal: confirmar restore desde respaldo ─────────────────────────
function RestoreSubModal({ onClose }: { onClose: () => void }) {
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const expected = 'RESTAURAR'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (phrase.trim().toUpperCase() !== expected) {
      toast.error(`Escribe exactamente "${expected}" para confirmar`)
      return
    }
    setBusy(true)
    try {
      const r = await window.api.backup.import()
      if (r.cancelled) {
        setBusy(false)
        return
      }
      if (!r.ok) {
        toast.error('No se pudo restaurar', { description: r.error ?? 'Error desconocido' })
        setBusy(false)
        return
      }
      toast.success('Respaldo restaurado. Reiniciando…', {
        description: `Desde: ${r.fromPath}`
      })
      setTimeout(() => window.api.reload(), 1000)
    } catch (err) {
      toast.error('Falló restaurar', {
        description: err instanceof Error ? err.message : String(err)
      })
      setBusy(false)
    }
  }

  return (
    <Modal open title="⚠ Restaurar respaldo" onClose={busy ? () => {} : onClose} maxWidth="max-w-md">
      <form onSubmit={submit} className="p-4 space-y-3 text-sm">
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Esta operación <span className="font-semibold">reemplaza completamente</span> la base de
          datos actual con la del archivo de respaldo. Los datos que no estén en el respaldo se
          perderán. La app se reinicia al terminar.
        </div>

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
            className="px-5 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 text-sm font-semibold"
          >
            {busy ? 'Restaurando…' : 'Elegir respaldo y restaurar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
