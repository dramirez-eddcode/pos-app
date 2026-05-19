import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Cloud, CloudOff } from 'lucide-react'
import Modal from './Modal'
import { useSettings } from '../stores/settings'

const DEFAULT_PRINTER_HINT = 'EPSON TM-T20III Receipt'

interface Props {
  open: boolean
  onClose: () => void
}

export default function SettingsModal({ open, onClose }: Props) {
  const { settings, update } = useSettings()
  const [printers, setPrinters] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [drawerOnCash, setDrawerOnCash] = useState<boolean>(true)
  const [showTime, setShowTime] = useState<boolean>(false)
  const [busy, setBusy] = useState<null | 'test' | 'drawer' | 'save' | 'supabase'>(null)
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean | null>(null)
  const [supabaseStatus, setSupabaseStatus] = useState<{
    ok: boolean
    latencyMs: number
    message: string
    schemaReady?: boolean
  } | null>(null)

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
    // Estado inicial de supabase
    window.api.supabase
      .isConfigured()
      .then(setSupabaseConfigured)
      .catch(() => setSupabaseConfigured(false))
    setSupabaseStatus(null)
  }, [open, loadPrinters, settings])

  const testSupabase = async () => {
    setBusy('supabase')
    try {
      const r = await window.api.supabase.test()
      setSupabaseStatus({
        ok: r.ok,
        latencyMs: r.latencyMs,
        message: r.error ?? `Conexión OK · ${r.sucursalCount ?? 0} sucursales registradas`,
        schemaReady: r.schemaReady
      })
      if (r.ok && r.schemaReady !== false) {
        toast.success(`Supabase OK (${r.latencyMs} ms)`)
      } else if (r.ok && r.schemaReady === false) {
        toast.warning('Conexión OK pero schema no aplicado', {
          description: 'Pega supabase/schema.sql en el SQL Editor de Supabase.'
        })
      } else {
        toast.error('Falló la conexión a Supabase', { description: r.error })
      }
    } finally {
      setBusy(null)
    }
  }

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

  const save = async () => {
    setBusy('save')
    try {
      await update({
        printerName: selected || null,
        openDrawerOnCash: drawerOnCash,
        showTimeOnReceipt: showTime
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
    <Modal open={open} title="Configuración" onClose={onClose} maxWidth="max-w-lg">
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

        {/* Sincronización en la nube (Fase 3) */}
        <section className="pt-3 border-t border-border space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {supabaseConfigured ? (
                <Cloud className="size-4 text-blue-600" />
              ) : (
                <CloudOff className="size-4 text-muted-foreground" />
              )}
              <div>
                <div className="font-medium text-xs">Sincronización con Supabase</div>
                <div className="text-[11px] text-muted-foreground">
                  {supabaseConfigured === null
                    ? 'Verificando…'
                    : supabaseConfigured
                      ? 'Configurado · prueba la conexión para validar el schema'
                      : 'No configurado (revisa .env)'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={testSupabase}
              disabled={!supabaseConfigured || busy !== null}
              className="px-3 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50 text-xs"
            >
              {busy === 'supabase' ? 'Probando…' : 'Probar conexión'}
            </button>
          </div>
          {supabaseStatus && (
            <div
              className={`text-[11px] rounded px-2 py-1.5 border ${
                supabaseStatus.ok && supabaseStatus.schemaReady !== false
                  ? 'border-green-300 bg-green-50 text-green-900'
                  : supabaseStatus.ok
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-red-300 bg-red-50 text-red-900'
              }`}
            >
              <span className="font-medium">
                {supabaseStatus.ok ? 'OK' : 'Error'} · {supabaseStatus.latencyMs} ms
              </span>
              <div className="text-[10px] mt-0.5">{supabaseStatus.message}</div>
            </div>
          )}
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
  )
}
