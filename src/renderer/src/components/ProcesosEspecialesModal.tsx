import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PackageMinus, PackagePlus, RefreshCcw, Repeat, Tags, Users } from 'lucide-react'
import Modal from './Modal'

interface Option {
  id: string
  label: string
  hint: string
  icon: ReactNode
  disabled?: boolean
  disabledReason?: string
  handler: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  onEntrada: () => void
  onSalidas: () => void
  onAjustes: () => void
  onPrecios: () => void
  onUsuarios: () => void
}

/**
 * Menú "Procesos Especiales" (F10 en el legacy). Por ahora sólo "Entrada de
 * mercancía" está activa; el resto son stubs que muestran su roadmap.
 */
export default function ProcesosEspecialesModal({
  open,
  onClose,
  onEntrada,
  onSalidas,
  onAjustes,
  onPrecios,
  onUsuarios
}: Props) {
  const options: Option[] = [
    {
      id: 'entrada',
      label: 'Entrada de mercancía',
      hint: 'Registrar compra / alta de inventario por lotes',
      icon: <PackagePlus className="size-5 text-muted-foreground" />,
      handler: () => {
        onClose()
        onEntrada()
      }
    },
    {
      id: 'salidas',
      label: 'Registro de salidas',
      hint: 'Caducidad, merma, traspaso, muestra — se resta del saldo',
      icon: <PackageMinus className="size-5 text-muted-foreground" />,
      handler: () => {
        onClose()
        onSalidas()
      }
    },
    {
      id: 'ajustes',
      label: 'Ajustes de inventario',
      hint: 'Corregir saldo por conteo físico (positivo o negativo)',
      icon: <RefreshCcw className="size-5 text-muted-foreground" />,
      handler: () => {
        onClose()
        onAjustes()
      }
    },
    {
      id: 'precios',
      label: 'Actualizar precios',
      hint: 'Cambiar precio de venta de uno o varios productos',
      icon: <Tags className="size-5 text-muted-foreground" />,
      handler: () => {
        onClose()
        onPrecios()
      }
    },
    {
      id: 'usuarios',
      label: 'Gestión de usuarios',
      hint: 'Crear cajeros, resetear passwords, activar/desactivar',
      icon: <Users className="size-5 text-muted-foreground" />,
      handler: () => {
        onClose()
        onUsuarios()
      }
    },
    {
      id: 'traspasos',
      label: 'Traspasos entre sucursales',
      hint: 'Mover mercancía a / desde otra sucursal',
      icon: <Repeat className="size-5 text-muted-foreground" />,
      disabled: true,
      disabledReason: 'Requiere sincronización con Supabase (Fase 3)',
      handler: () => {}
    }
  ]

  const firstEnabledIdx = options.findIndex((o) => !o.disabled)
  const [idx, setIdx] = useState(Math.max(0, firstEnabledIdx))
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (!open) return
    setIdx(Math.max(0, firstEnabledIdx))
    setTimeout(() => btnRefs.current[firstEnabledIdx]?.focus(), 50)
  }, [open, firstEnabledIdx])

  useEffect(() => {
    if (!open) return
    btnRefs.current[idx]?.focus()
  }, [idx, open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setIdx((i) => {
          // Saltar deshabilitados
          let next = i
          for (let step = 1; step < options.length; step++) {
            const candidate = Math.min(options.length - 1, i + step)
            if (!options[candidate]!.disabled) {
              next = candidate
              break
            }
          }
          return next
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setIdx((i) => {
          let next = i
          for (let step = 1; step < options.length; step++) {
            const candidate = Math.max(0, i - step)
            if (!options[candidate]!.disabled) {
              next = candidate
              break
            }
          }
          return next
        })
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Modal open={open} title="Procesos Especiales" onClose={onClose} maxWidth="max-w-md">
      <div className="p-4 space-y-2">
        {options.map((opt, i) => (
          <button
            key={opt.id}
            ref={(el) => {
              btnRefs.current[i] = el
            }}
            type="button"
            disabled={opt.disabled}
            onClick={opt.handler}
            onFocus={() => !opt.disabled && setIdx(i)}
            className={`w-full flex items-center gap-3 px-4 py-3 border rounded text-left transition-colors focus:outline-none
              ${
                opt.disabled
                  ? 'border-border bg-muted/30 opacity-60 cursor-not-allowed'
                  : 'border-border hover:bg-muted focus:bg-muted focus:border-primary focus:ring-2 focus:ring-primary/40'
              }`}
          >
            {opt.icon}
            <div className="flex-1">
              <div className="font-medium">{opt.label}</div>
              <div className="text-xs text-muted-foreground">{opt.hint}</div>
            </div>
            {opt.disabled && opt.disabledReason && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {opt.disabledReason}
              </span>
            )}
          </button>
        ))}
      </div>

      <footer className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
        <span className="font-mono">↑/↓</span> navegar ·{' '}
        <span className="font-mono">Enter</span> seleccionar ·{' '}
        <span className="font-mono">Esc</span> cierra
      </footer>
    </Modal>
  )
}
