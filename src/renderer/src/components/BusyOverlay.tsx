import Spinner from './Spinner'

interface BusyOverlayProps {
  /** Si true, muestra la capa de carga. */
  show: boolean
  /** Texto a mostrar (default "Procesando…"). */
  text?: string
}

/**
 * Capa semitransparente con spinner que cubre su contenedor durante un proceso.
 *
 * Requisito: el contenedor padre debe tener `position: relative` (clase
 * `relative` de Tailwind) para que el overlay se posicione encima de él.
 *
 *   <div className="relative">
 *     ...contenido...
 *     <BusyOverlay show={saving} text="Guardando…" />
 *   </div>
 */
export default function BusyOverlay({ show, text = 'Procesando…' }: BusyOverlayProps) {
  if (!show) return null
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 backdrop-blur-[1px]"
      aria-busy="true"
    >
      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm shadow-md">
        <Spinner size={18} />
        <span>{text}</span>
      </div>
    </div>
  )
}
