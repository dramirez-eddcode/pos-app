import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRightLeft,
  Boxes,
  Building2,
  Download,
  FileUp,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  RefreshCcw,
  Tags,
  Upload,
  Users
} from 'lucide-react'
import Modal from './Modal'

interface Option {
  id: string
  label: string
  hint: string
  icon: ReactNode
  disabled?: boolean
  disabledReason?: string
  /** Acento de color para destacar la opción (ej. el .dat legacy en morado). */
  accent?: 'purple'
  handler: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  /** Rol del usuario (en mayúsculas en BD). El SUPERVISOR ve un subconjunto. */
  rol: string
  onEntrada: () => void
  onCargaInicial: () => void
  onRecibirTraspaso: () => void
  onGenerarTraspaso: () => void
  onSalidas: () => void
  onAjustes: () => void
  onPrecios: () => void
  onUsuarios: () => void
  onSucursal: () => void
  onCatalogo: () => void
  onImportar: () => void
  onImportarDat: () => void
}

// El SUPERVISOR (de sucursal) sólo puede recibir traspasos y actualizar datos:
// catálogo, precios/IVA, aplicar la actualización de la matriz (.farma) y el
// archivo legacy (.dat). El resto es exclusivo de admins.
const SUPERVISOR_PROCESOS = new Set([
  'recibir-traspaso',
  'precios',
  'catalogo',
  'importar',
  'importar-dat'
])

/**
 * Menú "Procesos Especiales" (F10 en el legacy).
 */
export default function ProcesosEspecialesModal({
  open,
  onClose,
  rol,
  onEntrada,
  onCargaInicial,
  onRecibirTraspaso,
  onGenerarTraspaso,
  onSalidas,
  onAjustes,
  onPrecios,
  onUsuarios,
  onSucursal,
  onCatalogo,
  onImportar,
  onImportarDat
}: Props) {
  const allOptions: Option[] = [
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
      id: 'carga-inicial',
      label: 'Carga inicial de inventario',
      hint: 'Fijar existencias desde CSV (migración / arranque) — idempotente',
      icon: <PackageCheck className="size-5 text-muted-foreground" />,
      handler: () => {
        onClose()
        onCargaInicial()
      }
    },
    {
      id: 'recibir-traspaso',
      label: 'Recibir traspaso',
      hint: 'Cargar un .traspaso enviado por la matriz u otra sucursal (entra a tu inventario)',
      icon: <ArrowRightLeft className="size-5 text-muted-foreground" />,
      handler: () => {
        onClose()
        onRecibirTraspaso()
      }
    },
    {
      id: 'generar-traspaso',
      label: 'Generar traspaso',
      hint: 'Manda stock de tu inventario a otra sucursal o a la matriz (.traspaso)',
      icon: <Upload className="size-5 text-muted-foreground" />,
      handler: () => {
        onClose()
        onGenerarTraspaso()
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
      id: 'catalogo',
      label: 'Catálogo de productos',
      hint: 'Alta, edición y activación de productos',
      icon: <Boxes className="size-5 text-muted-foreground" />,
      handler: () => {
        onClose()
        onCatalogo()
      }
    },
    {
      id: 'usuarios',
      label: 'Gestión de usuarios',
      hint: 'Crear, editar, resetear passwords, activar/desactivar',
      icon: <Users className="size-5 text-muted-foreground" />,
      handler: () => {
        onClose()
        onUsuarios()
      }
    },
    {
      id: 'sucursal',
      label: 'Datos de sucursal',
      hint: 'Razón social, RFC, dirección — aparece en el ticket',
      icon: <Building2 className="size-5 text-muted-foreground" />,
      handler: () => {
        onClose()
        onSucursal()
      }
    },
    {
      id: 'importar',
      label: 'Importar actualización (matriz)',
      hint: 'Aplica archivo .farma con catálogo y precios de la matriz',
      icon: <Download className="size-5 text-blue-600" />,
      handler: () => {
        onClose()
        onImportar()
      }
    },
    {
      id: 'importar-dat',
      label: 'Importar archivo legacy (.dat)',
      hint: 'Carga el .dat del sistema viejo: catálogo, descripciones y precios',
      icon: <FileUp className="size-5 text-purple-600" />,
      accent: 'purple',
      handler: () => {
        onClose()
        onImportarDat()
      }
    }
  ]

  const options =
    rol?.toUpperCase() === 'SUPERVISOR'
      ? allOptions.filter((o) => SUPERVISOR_PROCESOS.has(o.id))
      : allOptions

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
                  : opt.accent === 'purple'
                    ? 'border-purple-400 bg-purple-50 hover:bg-purple-100 focus:bg-purple-100 focus:border-purple-500 focus:ring-2 focus:ring-purple-300'
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
