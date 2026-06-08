import { useCallback, useEffect, useState } from 'react'
import Spinner from './Spinner'
import type { PrintResultLike } from '@shared/types'

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; msg: string; details?: string }
  | { kind: 'err'; msg: string; details?: string }

const DEFAULT_PRINTER_NAME = 'EPSON TM-T20III Receipt'

export default function PrinterTestPanel() {
  const [printers, setPrinters] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [state, setState] = useState<State>({ kind: 'idle' })

  const loadPrinters = useCallback(async () => {
    try {
      const list = await window.api.printer.list()
      setPrinters(list)
      const preferred = list.find((p) => p === DEFAULT_PRINTER_NAME) ?? list[0] ?? ''
      setSelected(preferred)
    } catch (e) {
      setState({ kind: 'err', msg: 'No pude enumerar impresoras', details: String(e) })
    }
  }, [])

  useEffect(() => {
    loadPrinters()
  }, [loadPrinters])

  const showResult = (label: string, r: PrintResultLike): void => {
    if (r.ok) {
      setState({ kind: 'ok', msg: `${label}: ${r.bytesSent} bytes enviados`, details: r.stdout.trim() })
    } else {
      setState({
        kind: 'err',
        msg: `${label} falló (exit ${r.exitCode ?? 'n/a'})`,
        details: (r.stderr || r.stdout).trim()
      })
    }
  }

  const printTest = async (): Promise<void> => {
    if (!selected) return
    setState({ kind: 'loading' })
    const r = await window.api.printer.printTest(selected)
    showResult('Ticket de prueba', r)
  }

  const openDrawer = async (): Promise<void> => {
    if (!selected) return
    setState({ kind: 'loading' })
    const r = await window.api.printer.openDrawer(selected)
    showResult('Apertura de cajón', r)
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-4">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Configuración de impresora</h2>
        <p className="text-sm text-muted-foreground">
          Prueba la EPSON TM-T20III y la apertura del cajón antes de operar.
        </p>
      </header>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Impresora</label>
        <div className="flex gap-2">
          <select
            className="flex-1 border border-border rounded px-2 py-1 bg-background"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {printers.length === 0 && <option value="">— sin impresoras —</option>}
            {printers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            className="px-3 py-1 border border-border rounded hover:bg-muted"
            onClick={loadPrinters}
            type="button"
          >
            Recargar
          </button>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
          disabled={!selected || state.kind === 'loading'}
          onClick={printTest}
        >
          {state.kind === 'loading' && <Spinner size={14} />}
          Imprimir ticket de prueba
        </button>
        <button
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 border border-border rounded hover:bg-muted disabled:opacity-50"
          disabled={!selected || state.kind === 'loading'}
          onClick={openDrawer}
        >
          {state.kind === 'loading' && <Spinner size={14} />}
          Abrir cajón
        </button>
      </div>

      {state.kind !== 'idle' && (
        <div
          className={`text-sm p-3 rounded border ${
            state.kind === 'ok'
              ? 'border-border bg-muted'
              : state.kind === 'err'
                ? 'border-red-300 bg-red-50 text-red-900'
                : 'border-border bg-muted'
          }`}
        >
          {state.kind === 'loading' && <span>Enviando…</span>}
          {state.kind !== 'loading' && (
            <>
              <div className="font-medium">{state.msg}</div>
              {state.details && (
                <pre className="text-xs mt-1 whitespace-pre-wrap font-mono">{state.details}</pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
