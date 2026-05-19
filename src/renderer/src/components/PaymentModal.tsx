import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import Modal from './Modal'
import { money, folio as fmtFolio } from '../lib/format'
import type { MetodoPago } from '@shared/types'

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: (args: { pagos: { metodo: MetodoPago; monto: number }[]; cambio: number }) => void
  total: number
  folioPreview: number
  busy?: boolean
}

type MetodoId = 'efectivo' | 'tarjeta' | 'transferencia'

const METODOS: { id: MetodoId; label: string; metodo: MetodoPago }[] = [
  { id: 'efectivo', label: 'Efectivo', metodo: 'EFECTIVO' },
  { id: 'tarjeta', label: 'Tarjeta', metodo: 'TARJETA' },
  { id: 'transferencia', label: 'Transferencia', metodo: 'TRANSFERENCIA' }
]

function parseNum(s: string): number {
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export default function PaymentModal({ open, onClose, onConfirm, total, folioPreview, busy }: Props) {
  const [amounts, setAmounts] = useState<Record<MetodoId, string>>({
    efectivo: '',
    tarjeta: '',
    transferencia: ''
  })
  const efectivoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setAmounts({ efectivo: '', tarjeta: '', transferencia: '' })
    setTimeout(() => efectivoRef.current?.focus(), 50)
  }, [open])

  const nums = useMemo<Record<MetodoId, number>>(
    () => ({
      efectivo: parseNum(amounts.efectivo),
      tarjeta: parseNum(amounts.tarjeta),
      transferencia: parseNum(amounts.transferencia)
    }),
    [amounts]
  )

  const recibido = useMemo(
    () => +(nums.efectivo + nums.tarjeta + nums.transferencia).toFixed(2),
    [nums]
  )

  // Solo el efectivo genera cambio; tarjeta/transferencia se cobran exacto.
  const noEfectivo = +(nums.tarjeta + nums.transferencia).toFixed(2)
  const cobertura = +(recibido - total).toFixed(2)
  const cambio = Math.max(0, +(nums.efectivo - Math.max(0, total - noEfectivo)).toFixed(2))
  const faltante = Math.max(0, +(total - recibido).toFixed(2))
  const puedeCobrar = recibido >= total - 0.0049 && total > 0

  const tryConfirm = () => {
    if (!puedeCobrar || busy) return
    const pagos: { metodo: MetodoPago; monto: number }[] = []
    // Primero las no-efectivo por su monto exacto
    if (nums.tarjeta > 0) pagos.push({ metodo: 'TARJETA', monto: nums.tarjeta })
    if (nums.transferencia > 0) pagos.push({ metodo: 'TRANSFERENCIA', monto: nums.transferencia })
    // El efectivo se registra como lo que realmente entró a la caja, menos el cambio
    if (nums.efectivo > 0) {
      const monto = +(nums.efectivo - cambio).toFixed(2)
      if (monto > 0) pagos.push({ metodo: 'EFECTIVO', monto })
    }
    onConfirm({ pagos, cambio })
  }

  const onKeyAny = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      tryConfirm()
    }
  }

  return (
    <Modal
      open={open}
      title={`Cobro · Folio ${fmtFolio(folioPreview)}`}
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      <div className="p-4 space-y-4 text-sm">
        <div className="text-center bg-muted/30 rounded p-3 border border-border">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total a cobrar</div>
          <div className="text-3xl font-bold font-mono text-blue-700">{money(total)}</div>
        </div>

        <div className="space-y-2">
          {METODOS.map((m, i) => (
            <div key={m.id} className="grid grid-cols-[140px_1fr] gap-2 items-center">
              <label className="text-xs text-muted-foreground text-right pr-2">{m.label}</label>
              <input
                ref={i === 0 ? efectivoRef : undefined}
                type="text"
                inputMode="decimal"
                className="border border-border rounded px-2 py-1.5 font-mono text-right"
                value={amounts[m.id]}
                onChange={(e) => setAmounts((a) => ({ ...a, [m.id]: e.target.value }))}
                onKeyDown={onKeyAny}
                placeholder="0.00"
                autoComplete="off"
              />
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-3 space-y-1 font-mono text-right">
          <Row label="RECIBIDO" value={money(recibido)} />
          <Row
            label="CAMBIO"
            value={money(cambio)}
            valueClass={cambio > 0 ? 'text-green-700' : 'text-muted-foreground'}
          />
          {faltante > 0 && <Row label="FALTAN" value={money(faltante)} valueClass="text-red-700" />}
          {cobertura > 0 && nums.efectivo === 0 && (
            <Row label="SOBRAN" value={money(cobertura)} valueClass="text-amber-700" />
          )}
        </div>
      </div>

      <footer className="flex justify-between items-center px-4 py-3 border-t border-border bg-muted/20">
        <div className="text-xs text-muted-foreground">
          <span className="font-mono">Enter</span> cobrar ·{' '}
          <span className="font-mono">Esc</span> cancelar
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={tryConfirm}
            disabled={!puedeCobrar || busy}
            className="px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
          >
            {busy ? 'Procesando…' : 'Cobrar'}
          </button>
        </div>
      </footer>
    </Modal>
  )
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 text-sm">
      <div className="text-left text-muted-foreground">{label}</div>
      <div className={`font-bold ${valueClass ?? ''}`}>{value}</div>
    </div>
  )
}
