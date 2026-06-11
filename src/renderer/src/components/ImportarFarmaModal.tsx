import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FolderOpen,
  PackageCheck,
  ShieldCheck,
  Sparkles
} from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import { useSession } from '../stores/session'
import type { ImportFarmaPreview } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
  onApplied?: () => void
}

type Phase = 'idle' | 'picking' | 'preview' | 'applying' | 'done' | 'error'

export default function ImportarFarmaModal({ open, onClose, onApplied }: Props) {
  const { user, updateSucursal } = useSession()
  const [phase, setPhase] = useState<Phase>('idle')
  const [preview, setPreview] = useState<ImportFarmaPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requiresForce, setRequiresForce] = useState(false)
  const [forceChecked, setForceChecked] = useState(false)
  const [resultStats, setResultStats] = useState<{
    creados: number
    actualizados: number
    stockLotes: number
    stockNoEncontrados: number
    sucursalNombre: string
  } | null>(null)

  const reset = useCallback(() => {
    setPhase('idle')
    setPreview(null)
    setError(null)
    setRequiresForce(false)
    setForceChecked(false)
    setResultStats(null)
  }, [])

  const handleClose = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  const onPick = useCallback(async () => {
    setError(null)
    setPhase('picking')
    try {
      const r = await window.api.importFarma.pick()
      if (!r.ok) {
        if (r.cancelled) {
          setPhase('idle')
          return
        }
        setError(r.error ?? 'Error desconocido')
        setPhase('error')
        return
      }
      setPreview(r.preview)
      setPhase('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }, [])

  const onApply = useCallback(async () => {
    if (!user || !preview) return
    setPhase('applying')
    setError(null)
    try {
      const r = await window.api.importFarma.apply(user.id, preview.filePath, forceChecked)
      if (!r.ok) {
        if (r.requiresForce) {
          setRequiresForce(true)
          setError(r.error ?? 'Sucursal distinta')
          setPhase('preview')
          return
        }
        setError(r.error ?? 'Error desconocido')
        setPhase('error')
        return
      }
      setResultStats({
        creados: r.productosCreados,
        actualizados: r.productosActualizados,
        stockLotes: r.stockLotes,
        stockNoEncontrados: r.stockNoEncontrados,
        sucursalNombre: r.sucursal.nombre
      })
      // Refresh session.sucursal con los datos del import
      try {
        const emp = await window.api.empresa.get()
        if (emp) updateSucursal(emp)
      } catch {
        /* no-op */
      }
      setPhase('done')
      onApplied?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }, [user, preview, forceChecked, updateSucursal, onApplied])

  const fechaPreview =
    preview?.generadoEn ? new Date(preview.generadoEn).toLocaleString() : null

  return (
    <Modal
      open={open}
      title="Importar actualización desde matriz"
      onClose={phase === 'applying' ? () => {} : handleClose}
      maxWidth="max-w-2xl"
    >
      <div className="p-4 space-y-4 text-sm">
        {/* ── Fase: idle / picking ──────────────────────────────────────── */}
        {(phase === 'idle' || phase === 'picking') && (
          <div className="space-y-3">
            <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              <div className="flex items-start gap-2">
                <Sparkles className="size-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p>
                    Selecciona el archivo <code className="font-mono">.farma</code> que llegó
                    desde la matriz (USB de bodega). Se validará primero y verás un resumen
                    antes de aplicar nada.
                  </p>
                  <p className="text-[11px] text-blue-800/80">
                    El import actualiza catálogo, precios e IVA de productos. Las ventas, lotes
                    locales y configuración de impresora <span className="font-semibold">NO</span>{' '}
                    se modifican.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onPick}
              disabled={phase === 'picking'}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
            >
              {phase === 'picking' ? <Spinner size={14} /> : <FolderOpen className="size-4" />}
              {phase === 'picking' ? 'Abriendo selector…' : 'Elegir archivo .farma'}
            </button>
          </div>
        )}

        {/* ── Fase: preview ────────────────────────────────────────────── */}
        {phase === 'preview' && preview && (
          <div className="space-y-3">
            <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900 flex items-start gap-2">
              <ShieldCheck className="size-4 mt-0.5 shrink-0 text-green-700" />
              <div>
                Archivo válido · checksum verificado · versión {preview.version}
              </div>
            </div>

            {/* Aviso si la sucursal no coincide */}
            {preview.aplicaA === 'DISTINTA' && (
              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <div className="font-semibold">
                      ⚠ Este archivo es de una sucursal distinta a la configurada localmente
                    </div>
                    <div>
                      Local:{' '}
                      <span className="font-mono">
                        {preview.sucursalLocalActual?.codigo ?? '—'}
                      </span>{' '}
                      {preview.sucursalLocalActual?.nombre ?? ''} · Archivo:{' '}
                      <span className="font-mono">{preview.sucursal.codigo}</span>{' '}
                      {preview.sucursal.nombre}
                    </div>
                    <label className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        checked={forceChecked}
                        onChange={(e) => setForceChecked(e.target.checked)}
                      />
                      <span className="text-[11px]">
                        Sí, sé lo que hago — quiero cambiar la sucursal de esta computadora a{' '}
                        <span className="font-semibold">{preview.sucursal.nombre}</span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {preview.aplicaA === 'NUEVA' && (
              <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 flex items-start gap-2">
                <Sparkles className="size-4 mt-0.5 shrink-0" />
                <div>
                  Primera importación: esta computadora adoptará la identidad de la sucursal{' '}
                  <span className="font-semibold">{preview.sucursal.nombre}</span>.
                </div>
              </div>
            )}

            {/* Resumen del archivo */}
            <div className="border border-border rounded">
              <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" />
                <span className="text-xs font-semibold">Resumen del archivo</span>
              </div>
              <dl className="divide-y divide-border text-xs">
                <Row label="Sucursal destino">
                  <span className="font-mono font-semibold">{preview.sucursal.codigo}</span>{' '}
                  {preview.sucursal.nombre}
                </Row>
                {preview.sucursal.razonSocial && (
                  <Row label="Razón social">{preview.sucursal.razonSocial}</Row>
                )}
                {preview.sucursal.rfc && (
                  <Row label="RFC">
                    <span className="font-mono">{preview.sucursal.rfc}</span>
                  </Row>
                )}
                <Row label="Matriz">
                  {preview.matriz.propietario ?? 'Sin propietario'}
                  {preview.matriz.id && (
                    <span className="ml-2 text-muted-foreground opacity-60">
                      ({preview.matriz.id.slice(0, 8)})
                    </span>
                  )}
                </Row>
                <Row label="Productos">
                  <span className="font-semibold">{preview.productosCount}</span> productos en el
                  archivo
                </Row>
                <Row label="Generado">
                  {fechaPreview}{' '}
                  <span className="text-muted-foreground opacity-60">
                    (checksum {preview.checksum.slice(0, 12)}…)
                  </span>
                </Row>
                {preview.ultimoImportLocalEn && (
                  <Row label="Último import local">
                    {new Date(preview.ultimoImportLocalEn).toLocaleString()}
                  </Row>
                )}
              </dl>
            </div>

            <div className="rounded border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-semibold">Qué hará el import:</span> upsert de productos por
              código (los locales que no estén en el archivo se conservan). Datos de sucursal y
              header de ticket se sobreescriben.
            </div>

            {error && (
              <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={reset}
                className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
              >
                Elegir otro
              </button>
              <button
                type="button"
                onClick={onApply}
                disabled={preview.aplicaA === 'DISTINTA' && !forceChecked}
                className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
              >
                <PackageCheck className="size-4" />
                Aplicar import
              </button>
            </div>
          </div>
        )}

        {/* ── Fase: applying ──────────────────────────────────────────── */}
        {phase === 'applying' && (
          <div className="py-8 text-center space-y-3">
            <div className="flex justify-center text-blue-700">
              <Spinner size={32} />
            </div>
            <div className="text-sm">Aplicando actualización…</div>
            <div className="text-xs text-muted-foreground">
              No cierres la ventana. Esto puede tardar unos segundos.
            </div>
          </div>
        )}

        {/* ── Fase: done ──────────────────────────────────────────────── */}
        {phase === 'done' && resultStats && (
          <div className="space-y-3">
            <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900 flex items-start gap-3">
              <CheckCircle2 className="size-5 mt-0.5 shrink-0 text-green-700" />
              <div className="space-y-1">
                <div className="font-semibold">Import aplicado correctamente</div>
                <div className="text-xs">
                  Sucursal:{' '}
                  <span className="font-semibold">{resultStats.sucursalNombre}</span>
                </div>
                <div className="text-xs">
                  Productos: <span className="font-semibold">{resultStats.creados}</span> creados ·{' '}
                  <span className="font-semibold">{resultStats.actualizados}</span> actualizados
                </div>
                {resultStats.stockLotes > 0 && (
                  <div className="text-xs">
                    Stock inicial:{' '}
                    <span className="font-semibold">{resultStats.stockLotes}</span> lotes cargados
                  </div>
                )}
                {resultStats.stockNoEncontrados > 0 && (
                  <div className="text-xs text-amber-700">
                    ⚠ {resultStats.stockNoEncontrados} renglón(es) de stock no cargaron porque su
                    código no está en el catálogo (producto inactivo o excluido de esta sucursal).
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end pt-2 border-t border-border">
              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 text-sm font-semibold"
              >
                Listo
              </button>
            </div>
          </div>
        )}

        {/* ── Fase: error ─────────────────────────────────────────────── */}
        {phase === 'error' && (
          <div className="space-y-3">
            <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 flex items-start gap-3">
              <AlertTriangle className="size-5 mt-0.5 shrink-0 text-red-700" />
              <div className="space-y-1">
                <div className="font-semibold">No se pudo procesar el archivo</div>
                <div className="text-xs">{error}</div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => {
                  reset()
                  onPick()
                }}
                className="px-4 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 text-sm"
              >
                Elegir otro
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 px-3 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
