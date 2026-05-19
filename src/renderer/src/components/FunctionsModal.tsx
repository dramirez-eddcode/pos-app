import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RotateCcw, FileText, Power } from 'lucide-react'
import Modal from './Modal'

interface Option {
  id: string
  label: string
  hint: string
  icon: ReactNode
  variant?: 'default' | 'danger'
  handler: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  onCancelaciones: () => void
  onCorte: () => void
  onSalir: () => void
}

/**
 * Menú "Funciones del Sistema" (F11 en el legacy).
 * Navegación teclado-first: ↑/↓ mueve selección, Enter activa, Esc cierra.
 */
export default function FunctionsModal({
  open,
  onClose,
  onCancelaciones,
  onCorte,
  onSalir
}: Props) {
  const options: Option[] = [
    {
      id: 'corte',
      label: 'Corte en pantalla',
      hint: 'Ver ventas del día y cifras de control',
      icon: <FileText className="size-5 text-muted-foreground" />,
      handler: () => {
        onClose()
        onCorte()
      }
    },
    {
      id: 'cancel',
      label: 'Cancelaciones',
      hint: 'Cancelar una venta por folio y reintegrar al inventario',
      icon: <RotateCcw className="size-5 text-muted-foreground" />,
      handler: () => {
        onClose()
        onCancelaciones()
      }
    },
    {
      id: 'exit',
      label: 'Cerrar sistema',
      hint: 'Cerrar la aplicación y apagar el POS',
      icon: <Power className="size-5 text-red-700" />,
      variant: 'danger',
      handler: onSalir
    }
  ]

  const [idx, setIdx] = useState(0)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Reset + focus al abrir
  useEffect(() => {
    if (!open) return
    setIdx(0)
    setTimeout(() => btnRefs.current[0]?.focus(), 50)
  }, [open])

  // Mantener focus sincronizado con idx
  useEffect(() => {
    if (!open) return
    btnRefs.current[idx]?.focus()
  }, [idx, open])

  // Navegación por teclado (capture phase para ganarle al useShortcut global)
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setIdx((i) => Math.min(options.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setIdx((i) => Math.max(0, i - 1))
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Modal open={open} title="Funciones del Sistema" onClose={onClose} maxWidth="max-w-sm">
      <div className="p-4 space-y-2">
        {options.map((opt, i) => {
          const danger = opt.variant === 'danger'
          return (
            <button
              key={opt.id}
              ref={(el) => {
                btnRefs.current[i] = el
              }}
              type="button"
              onClick={opt.handler}
              onFocus={() => setIdx(i)}
              className={`w-full flex items-center gap-3 px-4 py-3 border rounded text-left transition-colors focus:outline-none
                ${
                  danger
                    ? 'border-border hover:bg-red-50 hover:border-red-300 focus:bg-red-50 focus:border-red-400 focus:ring-2 focus:ring-red-300'
                    : 'border-border hover:bg-muted focus:bg-muted focus:border-primary focus:ring-2 focus:ring-primary/40'
                }`}
            >
              {opt.icon}
              <div>
                <div className={`font-medium ${danger ? 'text-red-900' : ''}`}>{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.hint}</div>
              </div>
            </button>
          )
        })}
      </div>

      <footer className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
        <span className="font-mono">↑/↓</span> navegar ·{' '}
        <span className="font-mono">Enter</span> seleccionar ·{' '}
        <span className="font-mono">Esc</span> cierra
      </footer>
    </Modal>
  )
}
