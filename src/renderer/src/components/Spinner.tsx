import { Loader2 } from 'lucide-react'

interface SpinnerProps {
  /** Tamaño del ícono en px (default 16). */
  size?: number
  /** Clases extra para el ícono (color, márgenes, etc.). */
  className?: string
  /** Texto visible junto al spinner. Si se omite, queda solo el ícono
   *  (con etiqueta accesible "Cargando…" para lectores de pantalla). */
  label?: string
}

/**
 * Spinner reutilizable. Úsalo dentro de botones, filas de tabla o junto a
 * cualquier acción async para indicar que algo está en proceso.
 */
export default function Spinner({ size = 16, className = '', label }: SpinnerProps) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
      <Loader2 className={`animate-spin ${className}`} size={size} aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="sr-only">Cargando…</span>}
    </span>
  )
}
