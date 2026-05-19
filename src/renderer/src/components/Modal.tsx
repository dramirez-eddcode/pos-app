import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  maxWidth?: string // tailwind class, default "max-w-2xl"
  onEscape?: () => void
}

/**
 * Modal ligero con overlay. No atrapa foco (los inputs propios se encargan),
 * pero cierra con ESC (reemplazable con `onEscape`) y bloquea el scroll del
 * body mientras está abierto.
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-start justify-center pt-20 bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={`w-[92%] ${maxWidth} bg-background border border-border rounded-lg shadow-xl overflow-hidden`}
      >
        {title && (
          <header className="border-b border-border px-4 py-2 bg-muted/30">
            <div className="text-sm font-semibold">{title}</div>
          </header>
        )}
        {children}
      </div>
    </div>
  )
}
