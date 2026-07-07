import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  maxWidth?: string // tailwind class, default "max-w-2xl"
  onEscape?: () => void
}

/**
 * Modal ligero con overlay. No atrapa foco (los inputs propios se encargan).
 * Cierra con ESC (reemplazable con `onEscape`) o con la X del encabezado, y
 * bloquea el scroll del body mientras está abierto.
 *
 * A propósito NO cierra al hacer clic fuera del panel: un clic accidental en
 * el overlay perdería la captura en curso (entradas, ajustes, traspasos…).
 */
export default function Modal({
  open,
  title,
  onClose,
  children,
  maxWidth = 'max-w-2xl',
  onEscape
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (onEscape) onEscape()
        else onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', handler, true)
    }
  }, [open, onClose, onEscape])

  if (!open) return null

  const close = onEscape ?? onClose

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-start justify-center px-4 pt-20 pb-10 bg-black/40 backdrop-blur-sm overflow-y-auto"
    >
      <div
        ref={panelRef}
        className={`w-[92%] ${maxWidth} bg-background border border-border rounded-lg shadow-xl overflow-hidden`}
      >
        {title && (
          <header className="flex items-center gap-2 border-b border-border px-4 py-2 bg-muted/30">
            <div className="flex-1 text-sm font-semibold">{title}</div>
            <button
              type="button"
              onClick={close}
              title="Cerrar (Esc)"
              aria-label="Cerrar"
              className="p-1 -mr-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          </header>
        )}
        {children}
      </div>
    </div>
  )
}
