import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { arrowFieldNav } from '../lib/arrowNav'

interface ModalProps {
  open: boolean
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  maxWidth?: string // tailwind class, default "max-w-2xl"
  onEscape?: () => void
}

// Pila de modales abiertos: con modales APILADOS (p. ej. el preview de
// confirmación encima de entradas/traspasos), sólo el de hasta arriba debe
// responder a ESC — sin esto, un solo ESC cerraba los dos a la vez.
const modalStack: symbol[] = []

/**
 * Modal ligero con overlay. No atrapa foco (los inputs propios se encargan).
 * Cierra con ESC (reemplazable con `onEscape`) o con la X del encabezado, y
 * bloquea el scroll del body mientras está abierto.
 *
 * A propósito NO cierra al hacer clic fuera del panel: un clic accidental en
 * el overlay perdería la captura en curso (entradas, ajustes, traspasos…).
 *
 * Navegación con ↑/↓ entre campos (estilo legacy): mueve el foco al
 * anterior/siguiente elemento enfocable del panel, para capturar sin mouse —
 * incluidos los selects cerrados (la opción se cambia abriendo el desplegable
 * con Espacio/Alt+↓/clic). Se respeta el comportamiento nativo en textareas
 * (mueven el cursor), radios (grupo) y en los modales de lista
 * (F10/F11/búsqueda/corte), cuyos listeners en fase captura ganan antes de
 * llegar aquí.
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

  // Callbacks vía ref para que el efecto dependa SÓLO de `open`: si dependiera
  // de onClose/onEscape (funciones inline que cambian con cada render del
  // padre), el efecto se re-registraría y el modal "brincaría" al tope de la
  // pila, rompiendo el orden con modales apilados.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape

  useEffect(() => {
    if (!open) return
    const id = Symbol('modal')
    modalStack.push(id)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Sólo el modal de hasta arriba de la pila responde a ESC.
        if (modalStack[modalStack.length - 1] !== id) return
        e.preventDefault()
        e.stopPropagation()
        if (onEscapeRef.current) onEscapeRef.current()
        else onCloseRef.current()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => {
      const i = modalStack.indexOf(id)
      if (i >= 0) modalStack.splice(i, 1)
      document.body.style.overflow = prev
      window.removeEventListener('keydown', handler, true)
    }
  }, [open])

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
        onKeyDown={(e) => arrowFieldNav(e, panelRef.current)}
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
