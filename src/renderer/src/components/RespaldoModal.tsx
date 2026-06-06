import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Download, Upload } from 'lucide-react'
import Modal from './Modal'
import { useSession } from '../stores/session'
import { isAdminLike } from '../lib/roles'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * Respaldo / restauración de la base de datos completa. Funciona en matriz o
 * sucursal (persiste/reemplaza todo el SQLite, no un subset). Componente
 * reutilizable: se abre desde el dashboard de la matriz, Funciones (F11) del
 * POS y Configuración. El backend está en main/services/backup.ts.
 *
 *  - "Crear respaldo": cualquier usuario; copia la DB a una USB (.bak).
 *  - "Restaurar": solo admin; reemplaza la DB local y reinicia la app.
 */
export default function RespaldoModal({ open, onClose }: Props) {
  const { user } = useSession()
  const userIsAdmin = isAdminLike(user)
  const [busy, setBusy] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)

  const doBackup = async (): Promise<void> => {
    setBusy(true)
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
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open={open && !restoreOpen}
        title="Respaldo de la base de datos"
        onClose={onClose}
        maxWidth="max-w-md"
      >
        <div className="p-4 space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Guarda una copia completa del sistema (productos, ventas, usuarios y datos) en una USB.
            Úsalo al cierre del día por seguridad, o para mover toda la información a otra
            computadora.
          </p>

          <button
            type="button"
            onClick={doBackup}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded hover:bg-muted disabled:opacity-50 text-sm"
          >
            <Download className="size-4" />
            {busy ? 'Respaldando…' : 'Crear respaldo en USB'}
          </button>

          <div className="pt-3 border-t border-border">
            {userIsAdmin ? (
              <button
                type="button"
                onClick={() => setRestoreOpen(true)}
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded hover:bg-amber-50 hover:border-amber-300 disabled:opacity-50 text-sm text-amber-800"
              >
                <Upload className="size-4" />
                Restaurar desde un respaldo…
              </button>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Restaurar un respaldo requiere permisos de administrador.
              </p>
            )}
          </div>
        </div>

        <footer className="flex justify-end px-4 py-3 border-t border-border bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
          >
            Cerrar
          </button>
        </footer>
      </Modal>

      {restoreOpen && <RestoreSubModal onClose={() => setRestoreOpen(false)} />}
    </>
  )
}

// ── Sub-modal: confirmar restore desde respaldo ─────────────────────────
function RestoreSubModal({ onClose }: { onClose: () => void }) {
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const expected = 'RESTAURAR'

  const submit = async (e: FormEvent): Promise<void> => {
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

        <div className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <span className="font-semibold">¿Estás moviendo el sistema a otra computadora?</span> El
          respaldo trae todos los datos, pero <span className="font-semibold">no</span> la
          configuración de la impresora ni del cajón (esa vive en cada equipo). Después de restaurar
          tendrás que seleccionarla de nuevo en Configuración.
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
