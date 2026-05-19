import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Download, Trash2, Upload } from 'lucide-react'
import Papa from 'papaparse'
import Modal from './Modal'
import SearchModal from './SearchModal'
import InfoTooltip from './InfoTooltip'
import { money } from '../lib/format'
import type { AjusteItemInput, LoteInfo, ProductoDto } from '@shared/dto'
import type { MotivoAjuste } from '@shared/types'

const VALID_MOTIVOS: MotivoAjuste[] = ['MERMA', 'CADUCIDAD', 'FALTANTE', 'CONTEO', 'OTRO']

interface Row extends AjusteItemInput {
  fechaCaducidad: string
}

interface Props {
  open: boolean
  onClose: () => void
  userId: string
}

const MOTIVO_OPTIONS: { value: MotivoAjuste; label: string; hint: string }[] = [
  { value: 'MERMA', label: 'Merma', hint: 'Producto dañado, derramado, abierto' },
  { value: 'CADUCIDAD', label: 'Caducidad vencida', hint: 'El lote ya caducó, saldo → 0' },
  { value: 'FALTANTE', label: 'Faltante físico', hint: 'Robo, extravío, no se encontró' },
  { value: 'CONTEO', label: 'Ajuste por conteo', hint: 'Conteo físico difiere del sistema' },
  { value: 'OTRO', label: 'Otro', hint: 'Usa el campo de nota para explicar' }
]

function isoToYmd(iso: string): string {
  return iso.slice(0, 10)
}

export default function AjustesModal({ open, onClose, userId }: Props) {
  const [items, setItems] = useState<Row[]>([])
  const [current, setCurrent] = useState<ProductoDto | null>(null)
  const [lotes, setLotes] = useState<LoteInfo[]>([])
  const [codigo, setCodigo] = useState('')
  const [loteId, setLoteId] = useState('')
  const [nuevoSaldo, setNuevoSaldo] = useState('')
  const [motivo, setMotivo] = useState<MotivoAjuste>('MERMA')
  const [nota, setNota] = useState('')
  const [saving, setSaving] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const codRef = useRef<HTMLInputElement>(null)
  const loteRef = useRef<HTMLSelectElement>(null)
  const saldoRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  const reset = useCallback(() => {
    setItems([])
    setCurrent(null)
    setLotes([])
    setCodigo('')
    setLoteId('')
    setNuevoSaldo('')
    setMotivo('MERMA')
    setNota('')
  }, [])

  const resetRow = useCallback(() => {
    setCurrent(null)
    setLotes([])
    setCodigo('')
    setLoteId('')
    setNuevoSaldo('')
    setNota('')
    setTimeout(() => codRef.current?.focus(), 30)
  }, [])

  useEffect(() => {
    if (!open) return
    reset()
    setTimeout(() => codRef.current?.focus(), 80)
  }, [open, reset])

  const setFromProduct = useCallback(async (p: ProductoDto) => {
    setCurrent(p)
    setCodigo(p.codigo)
    try {
      const ls = await window.api.productos.getLotes(p.id)
      setLotes(ls)
      if (ls.length === 0) {
        toast.warning(`"${p.nombre}" no tiene lotes`, {
          description:
            'Necesitas registrar primero una entrada de mercancía para este producto.'
        })
        setLoteId('')
        setNuevoSaldo('')
        return
      }
      // Prefill con el primer lote (más próximo a caducar)
      const first = ls[0]!
      setLoteId(first.id)
      setNuevoSaldo(String(first.saldo))
      setTimeout(() => saldoRef.current?.focus(), 30)
    } catch (e) {
      toast.error('No se pudieron cargar los lotes', {
        description: e instanceof Error ? e.message : String(e)
      })
    }
  }, [])

  const lookupByCode = useCallback(async () => {
    const c = codigo.trim()
    if (!c) return
    const p = await window.api.productos.byCodigo(c)
    if (!p) {
      toast.error(`Producto "${c}" no encontrado`)
      return
    }
    await setFromProduct(p)
  }, [codigo, setFromProduct])

  // Al cambiar de lote, repopula el saldo actual
  const onLoteChange = (id: string): void => {
    setLoteId(id)
    const l = lotes.find((x) => x.id === id)
    if (l) setNuevoSaldo(String(l.saldo))
  }

  const addItem = useCallback(() => {
    if (!current) {
      toast.error('Busca un producto primero')
      return
    }
    const l = lotes.find((x) => x.id === loteId)
    if (!l) {
      toast.error('Selecciona un lote')
      return
    }
    const nuevo = Math.round(parseFloat(nuevoSaldo))
    if (!Number.isFinite(nuevo) || nuevo < 0) {
      toast.error('Nuevo saldo inválido (debe ser 0 o mayor)')
      return
    }
    const delta = nuevo - l.saldo
    if (delta === 0) {
      toast.warning('El nuevo saldo es igual al actual — no hay ajuste')
      return
    }
    setItems((prev) => [
      ...prev,
      {
        loteId: l.id,
        productoNombre: current.nombre,
        codigo: current.codigo,
        saldoActual: l.saldo,
        nuevoSaldo: nuevo,
        motivo,
        nota: nota.trim() || null,
        fechaCaducidad: l.fechaCaducidad
      }
    ])
    resetRow()
  }, [current, lotes, loteId, nuevoSaldo, motivo, nota, resetRow])

  const removeItem = useCallback((i: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }, [])

  // ── CSV: descarga plantilla + carga bulk ─────────────────────────────────
  const escapeCsv = (v: string): string => {
    if (v.includes('"') || v.includes(',') || v.includes('\n') || v.includes('\r')) {
      return '"' + v.replace(/"/g, '""') + '"'
    }
    return v
  }

  const downloadCSV = useCallback(async () => {
    try {
      const all = await window.api.productos.getAllLotesActivos()
      const header = 'codigo,nombre,caducidad,saldo_actual,saldo_nuevo,motivo,nota'
      const lines = all.map(
        (l) =>
          `${escapeCsv(l.codigo)},${escapeCsv(l.nombre)},${l.caducidad},${l.saldo},,,`
      )
      const content = '﻿' + [header, ...lines].join('\r\n')
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const today = new Date().toISOString().slice(0, 10)
      const a = document.createElement('a')
      a.href = url
      a.download = `ajustes-plantilla-farmacias-ms-${today}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(
        `Plantilla descargada con ${all.length.toLocaleString('es-MX')} lotes`,
        {
          description:
            'Llena "saldo_nuevo" y opc. "motivo"/"nota" sólo en los lotes a ajustar.'
        }
      )
    } catch (e) {
      toast.error('No pude descargar la plantilla', {
        description: e instanceof Error ? e.message : String(e)
      })
    }
  }, [])

  const normalizeCaducidad = (raw: string): string | null => {
    const s = raw.trim()
    if (!s) return null
    // YYYY-MM-DD directo
    const mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (mIso) {
      return `${mIso[1]}-${mIso[2]!.padStart(2, '0')}-${mIso[3]!.padStart(2, '0')}`
    }
    // DD/MM/YYYY (formato mexicano de Excel)
    const mMx = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (mMx) {
      return `${mMx[3]}-${mMx[2]!.padStart(2, '0')}-${mMx[1]!.padStart(2, '0')}`
    }
    return null
  }

  const onFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setImporting(true)
    try {
      const text = await file.text()
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase()
      })

      const rows = parsed.data.filter((r) => r.codigo && r.codigo.trim())
      if (rows.length === 0) {
        toast.error('El CSV no tiene filas válidas', {
          description:
            'Verifica encabezado: codigo,nombre,caducidad,saldo_actual,saldo_nuevo,motivo,nota'
        })
        return
      }

      // Índice de lotes por "codigo|caducidad" para matching
      const lotesAll = await window.api.productos.getAllLotesActivos()
      const loteIdx = new Map<
        string,
        { loteId: string; nombre: string; codigo: string; saldo: number; caducidad: string }
      >()
      for (const l of lotesAll) {
        loteIdx.set(`${l.codigo}|${l.caducidad}`, {
          loteId: l.loteId,
          nombre: l.nombre,
          codigo: l.codigo,
          saldo: l.saldo,
          caducidad: l.caducidad
        })
      }

      let added = 0
      let noChange = 0
      const noLote: string[] = []
      const invalid: string[] = []
      const newItems: Row[] = []

      for (const row of rows) {
        const codigo = (row.codigo ?? '').trim()
        const saldoNuevoStr = (row.saldo_nuevo ?? '').trim()
        if (!codigo || !saldoNuevoStr) continue // fila sin ajuste, skip

        const caducidad = normalizeCaducidad(row.caducidad ?? '')
        if (!caducidad) {
          invalid.push(`${codigo} (caducidad inválida: "${row.caducidad}")`)
          continue
        }

        const key = `${codigo}|${caducidad}`
        const lote = loteIdx.get(key)
        if (!lote) {
          noLote.push(`${codigo} · ${caducidad}`)
          continue
        }

        const nuevo = Math.round(parseFloat(saldoNuevoStr))
        if (!Number.isFinite(nuevo) || nuevo < 0) {
          invalid.push(`${codigo} (saldo_nuevo=${saldoNuevoStr})`)
          continue
        }
        if (nuevo === lote.saldo) {
          noChange++
          continue
        }

        const motivoRaw = (row.motivo ?? '').trim().toUpperCase() as MotivoAjuste
        const motivo: MotivoAjuste = VALID_MOTIVOS.includes(motivoRaw) ? motivoRaw : 'MERMA'
        const nota = (row.nota ?? '').trim() || null

        newItems.push({
          loteId: lote.loteId,
          productoNombre: lote.nombre,
          codigo: lote.codigo,
          saldoActual: lote.saldo,
          nuevoSaldo: nuevo,
          motivo,
          nota,
          fechaCaducidad: new Date(caducidad + 'T12:00:00').toISOString()
        })
        added++
      }

      // Dedup: el CSV reemplaza cualquier línea previa del mismo lote
      setItems((prev) => {
        const keep = prev.filter((p) => !newItems.some((n) => n.loteId === p.loteId))
        return [...keep, ...newItems]
      })

      const parts: string[] = []
      parts.push(`${added} ajuste${added === 1 ? '' : 's'} cargado${added === 1 ? '' : 's'}`)
      if (noChange > 0) parts.push(`${noChange} sin cambio`)
      if (noLote.length > 0)
        parts.push(
          `${noLote.length} lote${noLote.length === 1 ? '' : 's'} no encontrado${noLote.length === 1 ? '' : 's'}`
        )
      if (invalid.length > 0)
        parts.push(
          `${invalid.length} fila${invalid.length === 1 ? '' : 's'} inválida${invalid.length === 1 ? '' : 's'}`
        )

      if (added > 0) toast.success('CSV procesado', { description: parts.join(' · ') })
      else toast.warning('Sin ajustes cargados', { description: parts.join(' · ') })

      if (noLote.length > 0) console.warn('[csv] Lotes no encontrados:', noLote.slice(0, 50))
      if (invalid.length > 0) console.warn('[csv] Filas inválidas:', invalid.slice(0, 50))
    } catch (err) {
      toast.error('Error leyendo CSV', {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setImporting(false)
    }
  }, [])

  const save = useCallback(async () => {
    if (items.length === 0) {
      toast.error('No hay ajustes para registrar')
      return
    }
    setSaving(true)
    try {
      const r = await window.api.ajustes.create({
        cajeroId: userId,
        items: items.map(({ fechaCaducidad: _omit, ...rest }) => rest)
      })
      const sign = r.deltaTotalUnidades >= 0 ? '+' : ''
      toast.success(
        `Ajustes registrados: ${r.ajustesAplicados} ${r.ajustesAplicados === 1 ? 'línea' : 'líneas'}`,
        { description: `Δ total: ${sign}${r.deltaTotalUnidades} unidades` }
      )
      onClose()
    } catch (e) {
      toast.error('Falló el guardado', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setSaving(false)
    }
  }, [items, userId, onClose])

  const onKeyCode = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      lookupByCode()
    } else if (e.key === 'F5') {
      e.preventDefault()
      setSearchOpen(true)
    }
  }
  const onKeySaldo = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addItem()
    }
  }

  return (
    <>
      <Modal
        open={open && !searchOpen}
        title="Ajuste de inventario"
        onClose={onClose}
        maxWidth="max-w-4xl"
      >
        <div className="p-4 text-sm space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Bulk CSV */}
          <section className="border border-dashed border-border rounded p-3 bg-muted/20">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 text-xs">
                <div className="font-semibold mb-0.5">
                  Ajustes masivos por CSV — conteo físico completo
                </div>
                <p className="text-muted-foreground">
                  Descarga la plantilla (una fila por lote activo). En Excel llena sólo{' '}
                  <span className="font-mono">saldo_nuevo</span> en los lotes ajustados; los
                  lotes se identifican por <span className="font-mono">codigo + caducidad</span>.
                  Motivos válidos: <span className="font-mono">MERMA</span>,{' '}
                  <span className="font-mono">CADUCIDAD</span>,{' '}
                  <span className="font-mono">FALTANTE</span>,{' '}
                  <span className="font-mono">CONTEO</span>,{' '}
                  <span className="font-mono">OTRO</span>. Si omites, usa{' '}
                  <span className="font-mono">MERMA</span>.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={downloadCSV}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted text-xs"
                >
                  <Download className="size-3.5" />
                  Descargar CSV
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={importing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50 text-xs"
                >
                  <Upload className="size-3.5" />
                  {importing ? 'Procesando…' : 'Cargar CSV'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={onFileSelected}
                />
              </div>
            </div>
          </section>

          {/* Formulario de captura */}
          <section className="border border-border rounded p-3 bg-muted/10 space-y-3">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Código o nombre <span className="font-mono">(Enter busca · F5 abre búsqueda)</span>
                </label>
                <input
                  ref={codRef}
                  type="text"
                  className="w-full border border-border rounded px-2 py-1.5 font-mono"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  onKeyDown={onKeyCode}
                  placeholder="EAN-13 o SKU interno…"
                  autoComplete="off"
                />
              </div>
              <div className="self-end">
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="px-3 py-1.5 border border-border rounded hover:bg-muted"
                >
                  Buscar (F5)
                </button>
              </div>
            </div>

            {current && (
              <div className="text-xs bg-background border border-border rounded px-3 py-2">
                <span className="text-muted-foreground">Producto: </span>
                <span className="font-semibold">{current.nombre}</span>
                <span className="text-muted-foreground ml-2 font-mono">{current.codigo}</span>
                <span className="text-muted-foreground ml-3">
                  Existencias actuales: <span className="font-mono font-semibold">{current.existenciasTotal}</span>
                </span>
              </div>
            )}

            {/* Lote + nuevo saldo + motivo */}
            <div className="grid grid-cols-[1fr_140px_1fr] gap-2">
              <div>
                <label className="flex items-center text-xs text-muted-foreground mb-1">
                  Lote
                  <InfoTooltip title="Lote a ajustar" align="start">
                    Los ajustes se aplican a un <strong>lote específico</strong>. Los lotes se
                    listan ordenados por caducidad, el más próximo primero. Si el producto no
                    tiene lotes, regístralo primero con Entrada de mercancía.
                  </InfoTooltip>
                </label>
                <select
                  ref={loteRef}
                  value={loteId}
                  onChange={(e) => onLoteChange(e.target.value)}
                  disabled={!current || lotes.length === 0}
                  className="w-full border border-border rounded px-2 py-1.5 bg-background text-xs font-mono"
                >
                  <option value="">— elige lote —</option>
                  {lotes.map((l) => (
                    <option key={l.id} value={l.id}>
                      Cad. {isoToYmd(l.fechaCaducidad)} · saldo {l.saldo} / total {l.total}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flex items-center text-xs text-muted-foreground mb-1">
                  Nuevo saldo
                  <InfoTooltip title="Nuevo saldo del lote" align="center">
                    La cantidad real que debería tener el lote <strong>después</strong> del
                    ajuste. El sistema calcula el delta (diferencia) con el saldo actual y lo
                    registra en el journal.
                    <div className="mt-1.5 pt-1.5 border-t border-primary-foreground/20 italic">
                      Ej: saldo actual 10, se cayeron 3 al piso y no sirven → nuevo saldo{' '}
                      <strong>7</strong>.
                    </div>
                  </InfoTooltip>
                </label>
                <input
                  ref={saldoRef}
                  type="number"
                  min={0}
                  step={1}
                  className="w-full border border-border rounded px-2 py-1.5 font-mono text-right"
                  value={nuevoSaldo}
                  onChange={(e) => setNuevoSaldo(e.target.value)}
                  onKeyDown={onKeySaldo}
                  disabled={!loteId}
                />
              </div>
              <div>
                <label className="flex items-center text-xs text-muted-foreground mb-1">
                  Motivo
                  <InfoTooltip title="Motivo del ajuste" align="end">
                    La razón del ajuste queda en el journal (<span className="font-mono">mov_stock</span>
                    ) para auditoría. Si es "Otro", usa el campo <strong>Nota</strong> para
                    explicar detalles.
                  </InfoTooltip>
                </label>
                <select
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value as MotivoAjuste)}
                  disabled={!loteId}
                  className="w-full border border-border rounded px-2 py-1.5 bg-background text-xs"
                >
                  {MOTIVO_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value} title={m.hint}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Nota (opcional)
              </label>
              <input
                type="text"
                maxLength={200}
                className="w-full border border-border rounded px-2 py-1.5 text-xs"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder='Ej: "Se cayó la caja al descargar", "Cambio por mal embalaje"…'
                disabled={!loteId}
              />
            </div>

            <div className="flex justify-between items-center">
              <div className="text-xs text-muted-foreground">
                Tip: Enter en &quot;Nuevo saldo&quot; agrega el ajuste y resetea el formulario.
              </div>
              <button
                type="button"
                onClick={addItem}
                disabled={!loteId || !nuevoSaldo}
                className="px-4 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-medium"
              >
                Agregar ajuste
              </button>
            </div>
          </section>

          {/* Tabla de ajustes pendientes */}
          <section className="border border-border rounded">
            <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide flex justify-between">
              <span>Ajustes a registrar</span>
              <span className="text-[10px] normal-case text-muted-foreground">
                {items.length} línea{items.length === 1 ? '' : 's'}
              </span>
            </header>
            <div className="overflow-auto max-h-[260px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background border-b border-border">
                  <tr className="text-left">
                    <th className="px-2 py-1">Producto</th>
                    <th className="px-2 py-1 w-24">Caducidad</th>
                    <th className="px-2 py-1 w-16 text-right">Actual</th>
                    <th className="px-2 py-1 w-16 text-right">Nuevo</th>
                    <th className="px-2 py-1 w-16 text-right">Δ</th>
                    <th className="px-2 py-1 w-24">Motivo</th>
                    <th className="px-2 py-1 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-2 py-6 text-center text-muted-foreground italic"
                      >
                        Sin ajustes — captura uno arriba
                      </td>
                    </tr>
                  )}
                  {items.map((it, i) => {
                    const delta = it.nuevoSaldo - it.saldoActual
                    return (
                      <tr key={i} className="border-b border-border/60">
                        <td className="px-2 py-1">
                          <div>{it.productoNombre}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {it.codigo}
                          </div>
                          {it.nota && (
                            <div className="text-[10px] text-muted-foreground italic">
                              {it.nota}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1 font-mono text-[11px]">
                          {isoToYmd(it.fechaCaducidad)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{it.saldoActual}</td>
                        <td className="px-2 py-1 text-right font-mono">{it.nuevoSaldo}</td>
                        <td
                          className={`px-2 py-1 text-right font-mono font-semibold ${
                            delta < 0 ? 'text-red-700' : 'text-green-700'
                          }`}
                        >
                          {delta > 0 ? `+${delta}` : delta}
                        </td>
                        <td className="px-2 py-1 text-[11px]">{it.motivo}</td>
                        <td className="px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => removeItem(i)}
                            className="p-1 hover:bg-red-50 rounded text-red-700"
                            title="Quitar"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <footer className="flex justify-between items-center px-4 py-3 border-t border-border bg-muted/20">
          <div className="text-xs text-muted-foreground">
            Cada línea crea un <span className="font-mono">mov_stock</span> tipo=AJUSTE y modifica
            el saldo del lote.
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || items.length === 0}
              className="px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
            >
              {saving ? 'Guardando…' : 'Guardar ajustes'}
            </button>
          </div>
        </footer>
      </Modal>

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(p) => setFromProduct(p)}
        allowZeroStock
      />
    </>
  )
}
