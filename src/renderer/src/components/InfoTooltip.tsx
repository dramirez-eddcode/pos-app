import { Info } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  title?: string
  children: ReactNode
  /** Dónde colocar el tooltip respecto al ícono */
  side?: 'top' | 'bottom'
  /** Anclaje horizontal respecto al ícono para evitar overflow en columnas extremas */
  align?: 'start' | 'center' | 'end'
}

/**
 * Ícono `ⓘ` con tooltip contextual al hacer hover o foco. El tooltip se
 * renderiza en un portal al `document.body` con `position: fixed` para que
 * no lo corte ningún contenedor `overflow: hidden / auto` en la jerarquía
 * (p.ej. un Modal con scroll interno).
 *
 * Usa `align="start"` para íconos en la columna izquierda, `align="end"` para
 * los de la derecha; `center` (default) para intermedios.
 */
export default function InfoTooltip({
  title,
  children,
  side = 'top',
  align = 'center'
}: Props) {
  const iconRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const updateRect = useCallback(() => {
    if (iconRef.current) setRect(iconRef.current.getBoundingClientRect())
  }, [])

  const show = useCallback(() => {
    updateRect()
    setOpen(true)
  }, [updateRect])
  const hide = useCallback(() => setOpen(false), [])

  // Mantener posición al hacer scroll o resize mientras está visible
  useEffect(() => {
    if (!open) return
    const handler = () => updateRect()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [open, updateRect])

  const style: CSSProperties = rect
    ? (() => {
        const gap = 6
        const top = side === 'top' ? rect.top - gap : rect.bottom + gap
        const translateY = side === 'top' ? '-100%' : '0'
        let left: number
        let translateX: string
        if (align === 'start') {
          left = rect.left
          translateX = '0'
        } else if (align === 'end') {
          left = rect.right
          translateX = '-100%'
        } else {
          left = rect.left + rect.width / 2
          translateX = '-50%'
        }
        return {
          position: 'fixed',
          top,
          left,
          transform: `translate(${translateX}, ${translateY})`
        }
      })()
    : { display: 'none' }

  return (
    <span className="relative inline-flex items-center align-middle ml-1">
      <span
        ref={iconRef}
        tabIndex={0}
        aria-label="Más información"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        // Evitar que el click en el ícono dispare acciones del elemento padre
        // (ej. si el tooltip está dentro de un <button>)
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className="inline-flex items-center justify-center cursor-help rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Info className="size-3.5 text-muted-foreground hover:text-foreground transition-colors" />
      </span>
      {open &&
        createPortal(
          <div
            role="tooltip"
            style={style}
            className="pointer-events-none w-64 max-w-[min(16rem,90vw)] p-2.5 text-xs normal-case font-normal bg-primary text-primary-foreground border border-primary rounded shadow-lg z-[1000]"
          >
            {title && <div className="font-semibold mb-1 tracking-normal">{title}</div>}
            <div className="leading-relaxed tracking-normal">{children}</div>
          </div>,
          document.body
        )}
    </span>
  )
}
