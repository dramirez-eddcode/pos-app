import type { ReactNode } from 'react'
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

  return (
    <Modal
      open
      title={title}
      onClose={() => (procesando ? undefined : onCancel())}
      maxWidth="max-w-2xl"
    >
      <div className="p-4 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Revisa los productos y cantidades antes de aplicar. Si falta algo o hay un error, dale{' '}
          <strong>Cancelar</strong> y podrás ajustarlo sin perder lo que ya capturaste.
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
            <tbody>
              {lineas.map((l, i) => (
                <tr key={`${l.codigo}-${i}`} className="border-b border-border/60">
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
          type="button"
          onClick={onConfirm}
          disabled={procesando}
          className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
        >
          {procesando && <Spinner size={14} />}
          {procesando ? 'Procesando…' : confirmLabel}
        </button>
      </footer>
    </Modal>
  )
}
