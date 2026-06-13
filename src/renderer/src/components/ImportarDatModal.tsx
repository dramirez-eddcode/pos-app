import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FileUp } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import { useSession } from '../stores/session'
import type { ImportDatPreview } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
  /** Se llama tras una importación exitosa (por si hay que refrescar algo). */
  onDone?: () => void
}

/**
 * Importador del archivo legacy `.dat` accesible directo desde F10 → Procesos.
 * Mismo flujo que el botón morado del Catálogo: elegir archivo → previsualizar
 * conteos → aplicar. Reutiliza window.api.importDat (pick/apply).
 */
export default function ImportarDatModal({ open, onClose, onDone }: Props) {
  const { user } = useSession()
  const [preview, setPreview] = useState<ImportDatPreview | null>(null)
  const [picking, setPicking] = useState(false)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!open) {
      setPreview(null)
      setPicking(false)
      setApplying(false)
    }
  }, [open])

  const elegirArchivo = useCallback(async () => {
    if (!user) return
    setPicking(true)
    try {
      const r = await window.api.importDat.pick()
      if (!r.ok) {
        if (!r.cancelled) toast.error('No pude leer el archivo .dat', { description: r.error })
        return
      }
      setPreview(r.preview)
    } finally {
      setPicking(false)
    }
  }, [user])

  const aplicar = useCallback(async () => {
    if (!user || !preview) return
    setApplying(true)
    try {
      const res = await window.api.importDat.apply(user.id, preview.filePath)
      const parts = [`${res.creados} creados`, `${res.actualizados} actualizados`]
      if (res.desactivados > 0) parts.push(`${res.desactivados} desactivados`)
      if (res.sinCambio > 0) parts.push(`${res.sinCambio} sin cambio`)
      if (res.invalidos.length > 0) {
        parts.push(`${res.invalidos.length} omitidos`)
        console.warn('[import .dat] omitidos:', res.invalidos.slice(0, 100))
      }
      toast.success('Archivo .dat importado', { description: parts.join(' · ') })
      setPreview(null)
      onDone?.()
      onClose()
    } catch (e) {
      toast.error('Falló la importación del .dat', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setApplying(false)
    }
  }, [user, preview, onDone, onClose])

  return (
    <Modal
      open={open}
      title="Importar archivo legacy (.dat)"
      onClose={() => (applying ? undefined : onClose())}
      maxWidth="max-w-lg"
    >
      <div className="p-4 space-y-4 text-sm">
        {!preview ? (
          <>
            <p className="text-muted-foreground">
              Carga el archivo <span className="font-mono">.dat</span> que genera el sistema viejo
              para actualizar el catálogo, las descripciones y los precios. Crea los productos
              nuevos y actualiza los existentes; conserva costo, stock e IVA ya capturados.
            </p>
            <button
              type="button"
              onClick={elegirArchivo}
              disabled={picking}
              className="inline-flex items-center gap-2 px-4 py-2 border border-purple-400 bg-purple-50 text-purple-800 font-medium rounded hover:bg-purple-100 disabled:opacity-50"
            >
              {picking ? <Spinner size={16} /> : <FileUp className="size-4 text-purple-600" />}
              {picking ? 'Leyendo archivo…' : 'Elegir archivo .dat'}
            </button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              Archivo: <span className="font-mono text-foreground">{preview.fileName}</span> ·{' '}
              {preview.totalRegistros.toLocaleString('es-MX')} registros leídos.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-border px-3 py-2">
                <div className="text-xl font-semibold text-emerald-600">
                  {preview.aCrear.toLocaleString('es-MX')}
                </div>
                <div className="text-xs text-muted-foreground">productos nuevos (IVA exento)</div>
              </div>
              <div className="rounded border border-border px-3 py-2">
                <div className="text-xl font-semibold text-blue-600">
                  {preview.aActualizar.toLocaleString('es-MX')}
                </div>
                <div className="text-xs text-muted-foreground">existentes a actualizar</div>
              </div>
              <div className="rounded border border-border px-3 py-2">
                <div className="text-xl font-semibold text-amber-600">
                  {preview.aDesactivar.toLocaleString('es-MX')}
                </div>
                <div className="text-xs text-muted-foreground">se marcarán inactivos (baja)</div>
              </div>
              <div className="rounded border border-border px-3 py-2">
                <div className="text-xl font-semibold text-muted-foreground">
                  {preview.invalidos.toLocaleString('es-MX')}
                </div>
                <div className="text-xs text-muted-foreground">omitidos (datos inválidos)</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Se actualizan nombre, sustancia y precio. Se conservan costo, stock mín/máx,
              laboratorio, descripción e IVA de los productos existentes.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={applying}
                className="px-3 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50"
              >
                Elegir otro
              </button>
              <button
                type="button"
                onClick={aplicar}
                disabled={applying}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-purple-400 bg-purple-600 text-white font-medium rounded hover:bg-purple-700 disabled:opacity-50"
              >
                {applying ? <Spinner size={14} /> : <FileUp className="size-3.5" />}
                {applying ? 'Importando…' : 'Aplicar importación'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
