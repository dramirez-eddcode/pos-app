import { useEffect, useRef, useState, type ReactNode } from 'react'
import Modal from './Modal'
import Spinner from './Spinner'

export interface ConfirmLinea {
  codigo: string
  nombre: string
  cantidad: number
  /** Columna extra opcional (caducidad, motivo, etc.). */
  detalle?: string | null
}

interface Props {
  title: string
  /** Contexto del movimiento (destino, bodega, etc.) que se muestra arriba. */
  encabezado?: ReactNode
  /** Encabezado de la columna extra; si se pasa, se muestra la columna `detalle`. */
  detalleHeader?: string
  lineas: ConfirmLinea[]
  confirmLabel: string
  /** true mientras se ejecuta el movimiento (deshabilita botones). */
  procesando: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Preview de confirmación para entradas / salidas / traspasos. Muestra los
 * productos y cantidades antes de aplicar el movimiento. "Cancelar" regresa al
 * formulario SIN perder lo capturado (para corregir o agregar lo que falte).
 */
export default function ConfirmMovimientoModal({
  title,
  encabezado,
  detalleHeader,
  lineas,
  confirmLabel,
  procesando,
  onConfirm,
  onCancel
}: Props) {
  const totalUnidades = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0)

  // El foco entra al botón de confirmar: sin esto se queda en el botón del
  // modal padre (que sigue montado atrás) y ni Enter ni las flechas responden
  // aquí. Con el foco dentro: Enter confirma, Esc cancela, y ↓/↑ recorren las
  // filas (ver efecto de revisión más abajo).
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const t = setTimeout(() => confirmRef.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [])

  // Revisión fila por fila con ↓/↑: la primera ↓ sombrea la primera fila, cada
  // ↓ avanza una, y al pasar de la última el foco cae en el botón de confirmar
  // (Enter aplica). ↑ regresa. Listener en captura: le gana a la navegación
  // genérica del Modal entre botones.
  const [selRow, setSelRow] = useState(-1)
  const selRowRef = useRef(-1)
  useEffect(() => {
    selRowRef.current = selRow
  }, [selRow])
  const tbodyRef = useRef<HTMLTableSectionElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (procesando) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const tgt = e.target as HTMLElement | null
      if (
        tgt instanceof HTMLInputElement ||
        tgt instanceof HTMLTextAreaElement ||
        tgt?.isContentEditable === true
      ) {
        return
      }
      const last = lineas.length - 1
      if (last < 0) return
      const cur = selRowRef.current
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        if (cur < last) setSelRow(cur + 1)
        else confirmRef.current?.focus()
      } else if (cur >= 0) {
        e.preventDefault()
        e.stopPropagation()
        if (cur > 0) setSelRow(cur - 1)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [lineas.length, procesando])

  // Mantén visible la fila sombreada (el thead sticky no debe taparla).
  useEffect(() => {
    if (selRow < 0) return
    const tbody = tbodyRef.current
    const row = tbody?.children[selRow] as HTMLElement | undefined
    const cont = tbody?.closest('.overflow-auto') as HTMLElement | null
    if (!row || !cont) return
    const headerH = cont.querySelector('thead')?.getBoundingClientRect().height ?? 0
    const rowTop = row.offsetTop
    const rowBottom = rowTop + row.offsetHeight
    if (rowTop - headerH < cont.scrollTop) {
      cont.scrollTop = Math.max(0, rowTop - headerH)
    } else if (rowBottom > cont.scrollTop + cont.clientHeight) {
      cont.scrollTop = rowBottom - cont.clientHeight
    }
  }, [selRow])

  return (
    <Modal
      open
      title={title}
      onClose={() => (procesando ? undefined : onCancel())}
      maxWidth="max-w-2xl"
    >
      <div className="p-4 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Revisa los productos y cantidades antes de aplicar — con <span className="font-mono">↓</span>{' '}
          recorres las filas una por una y, al pasar la última, el foco cae en el botón de
          confirmar. Si falta algo o hay un error, dale <strong>Cancelar</strong> y podrás
          ajustarlo sin perder lo que ya capturaste.
        </p>
        {encabezado && <div className="text-xs">{encabezado}</div>}

        <div className="border border-border rounded overflow-auto max-h-[50vh]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
              <tr className="text-left">
                <th className="px-2 py-1.5 w-10 text-right">#</th>
                <th className="px-2 py-1.5 font-mono w-32">Código</th>
                <th className="px-2 py-1.5">Producto</th>
                {detalleHeader && <th className="px-2 py-1.5 w-32">{detalleHeader}</th>}
                <th className="px-2 py-1.5 w-24 text-right">Cantidad</th>
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {lineas.map((l, i) => (
                <tr
                  key={`${l.codigo}-${i}`}
                  onClick={() => setSelRow(i)}
                  className={`border-b border-border/60 cursor-pointer ${
                    i === selRow ? 'bg-primary/10' : 'hover:bg-muted/40'
                  }`}
                >
                  <td className="px-2 py-1 text-right text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1 font-mono">{l.codigo}</td>
                  <td className="px-2 py-1">{l.nombre}</td>
                  {detalleHeader && <td className="px-2 py-1">{l.detalle ?? '—'}</td>}
                  <td className="px-2 py-1 text-right font-mono">
                    {Number(l.cantidad).toLocaleString('es-MX')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center text-xs font-mono">
          <span className="text-muted-foreground">
            {lineas.length} {lineas.length === 1 ? 'línea' : 'líneas'}
          </span>
          <span className="font-semibold">
            Total: {totalUnidades.toLocaleString('es-MX')} unidades
          </span>
        </div>
      </div>

      <footer className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted/20">
        <button
          type="button"
          onClick={onCancel}
          disabled={procesando}
          className="px-4 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50 text-sm"
        >
          Cancelar
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          disabled={procesando}
          className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 focus:ring-2 focus:ring-primary/50 focus:outline-none text-sm font-semibold"
        >
          {procesando && <Spinner size={14} />}
          {procesando ? 'Procesando…' : confirmLabel}
        </button>
      </footer>
    </Modal>
  )
}
