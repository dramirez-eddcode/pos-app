import logoUrl from '../assets/logo-farmacias-ms.png'

interface LogoProps {
  /** Lado del cuadro en px (default 40). Ignorado si `full` es true. */
  size?: number
  /** Si true, ocupa el 100% del ancho del contenedor y la altura sigue al logo. */
  full?: boolean
  /** Clases extra para el contenedor. */
  className?: string
}

/**
 * Logo de Farmacias MS sobre un cuadro blanco redondeado. El PNG es circular con
 * fondo transparente, por eso va sobre blanco para que resalte en cualquier tema.
 */
export default function Logo({ size = 40, full = false, className = '' }: LogoProps) {
  return (
    <span
      className={`flex items-center justify-center bg-white border border-border overflow-hidden ${
        full ? 'w-full rounded' : 'inline-flex shrink-0 rounded-lg'
      } ${className}`}
      style={full ? undefined : { width: size, height: size }}
    >
      <img
        src={logoUrl}
        alt="Farmacias MS"
        className={full ? 'w-full h-auto object-contain p-3' : 'w-full h-full object-contain p-1'}
        draggable={false}
      />
    </span>
  )
}
