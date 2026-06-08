import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Download, Upload } from 'lucide-react'
import Papa from 'papaparse'
import Modal from './Modal'
import Spinner from './Spinner'
import BusyOverlay from './BusyOverlay'
import { useSession } from '../stores/session'
import type { BodegaDto, CargaInicialItemInput } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
  userId: string
  onSaved?: () => void
}

/** Normaliza una fecha de Excel a YYYY-MM-DD (acepta DD/MM/YYYY). '' si vacía. */
function parseCaducidad(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  const mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (mIso) return `${mIso[1]}-${mIso[2]!.padStart(2, '0')}-${mIso[3]!.padStart(2, '0')}`
  const mMx = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mMx) return `${mMx[3]}-${mMx[2]!.padStart(2, '0')}-${mMx[1]!.padStart(2, '0')}`
  return ''
}

export default function CargaInicialModal({ open, onClose, userId, onSaved }: Props) {
  const { user } = useSession()
  const [bodegas, setBodegas] = useState<BodegaDto[]>([])
  const [bodegaId, setBodegaId] = useState('')
  const [esMatriz, setEsMatriz] = useState(false)
  const sucursalNombre =
    user?.sucursal?.sucursalNombre ?? user?.sucursal?.nombreComercial ?? 'esta sucursal'
  const [items, setItems] = useState<CargaInicialItemInput[]>([])
  const [fileName, setFileName] = useState('')
  const [reemplazar, setReemplazar] = useState(false)
  const [importing, setImporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [verificando, setVerificando] = useState(false)
  // Resultado de cotejar los códigos del CSV contra el catálogo ya cargado.
  const [check, setCheck] = useState<{ matched: number; unmatched: number; muestras: string[] } | null>(
    null
  )
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setItems([])
    setFileName('')
    setReemplazar(false)
    setCheck(null)
    Promise.all([window.api.bodegas.list(), window.api.instalacion.get()])
      .then(([bs, inst]) => {
        const activas = bs.filter((b) => b.activa)
        setBodegas(activas)
        setEsMatriz(inst.configured && inst.tipo === 'MATRIZ')
        const principal = activas.find((b) => b.esPrincipal) ?? activas[0]
        setBodegaId(principal?.id ?? '')
      })
      .catch(() => {})
  }, [open])

  const totalUnidades = items.reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0)

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
      const rows = parsed.data.filter((r) => (r.codigo ?? '').trim())
      if (rows.length === 0) {
        toast.error('El CSV no tiene filas válidas', {
          description: 'Se esperan las columnas: codigo, cantidad, caducidad'
        })
        return
      }
      const parsedItems: CargaInicialItemInput[] = rows.map((r) => ({
        codigo: (r.codigo ?? '').trim(),
        cantidad: Math.round(Number((r.cantidad ?? '').trim()) || 0),
        fechaCaducidad: parseCaducidad(r.caducidad ?? '') || null
      }))
      setItems(parsedItems)
      setFileName(file.name)
      toast.success(`CSV leído: ${parsedItems.length.toLocaleString('es-MX')} renglones`)

      // Verificar cuántos códigos existen ya en el catálogo (guía de orden).
      setVerificando(true)
      try {
        const catalogo = await window.api.productos.listCatalogo(userId)
        const codigos = new Set(catalogo.map((p) => p.codigo))
        let matched = 0
        const muestras: string[] = []
        for (const it of parsedItems) {
          if (codigos.has(it.codigo)) matched++
          else if (muestras.length < 15) muestras.push(it.codigo)
        }
        setCheck({ matched, unmatched: parsedItems.length - matched, muestras })
      } catch {
        setCheck(null) // sin permiso o error → no bloquea, sólo no muestra guía
      } finally {
        setVerificando(false)
      }
    } catch (err) {
      toast.error('Error leyendo CSV', {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setImporting(false)
    }
  }, [userId])

  const aplicar = useCallback(async () => {
    if (!bodegaId) {
      toast.error('Selecciona una bodega destino')
      return
    }
    if (items.length === 0) {
      toast.error('Primero carga un CSV')
      return
    }
    setSaving(true)
    try {
      const r = await window.api.inventario.cargaInicial({
        usuarioId: userId,
        bodegaId,
        items,
        reemplazarBodega: reemplazar
      })
      const parts = [
        `${r.lotesCreados} creados`,
        `${r.lotesActualizados} ajustados`,
        `${r.lotesSinCambio} sin cambio`
      ]
      if (r.lotesPuestosCero > 0) parts.push(`${r.lotesPuestosCero} puestos en 0`)
      if (r.noEncontrados.length > 0) parts.push(`${r.noEncontrados.length} sin producto`)
      if (r.invalidos.length > 0) parts.push(`${r.invalidos.length} inválidos`)

      if (r.noEncontrados.length > 0)
        console.warn('[carga-inicial] códigos sin producto:', r.noEncontrados.slice(0, 100))

      const aplicados = r.lotesCreados + r.lotesActualizados + r.lotesPuestosCero
      if (aplicados === 0 && r.noEncontrados.length > 0) {
        // Caso típico: el catálogo no se importó antes → nada coincide.
        toast.error('No se cargó nada: los códigos no existen en el catálogo', {
          description: 'Importa primero el Catálogo de productos y vuelve a intentar.'
        })
        return // no cerramos para que el usuario corrija
      }

      toast.success(`Carga inicial aplicada · ${r.unidadesTotal.toLocaleString('es-MX')} unidades`, {
        description: parts.join(' · ')
      })
      onSaved?.()
      onClose()
    } catch (e) {
      toast.error('Falló la carga inicial', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setSaving(false)
    }
  }, [bodegaId, items, reemplazar, userId, onSaved, onClose])

  return (
    <Modal open={open} title="Carga inicial de inventario" onClose={onClose} maxWidth="max-w-2xl">
      <div className="relative">
        <div className="p-4 space-y-4 text-sm">
          <div className="rounded border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1.5">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <span className="inline-flex items-center justify-center size-4 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
                1
              </span>
              Importa el <strong>Catálogo de productos</strong> (catalogo.csv) — crea los productos.
              <span className="inline-flex items-center justify-center size-4 rounded-full bg-primary/15 text-primary text-[10px] font-bold ml-2">
                2
              </span>
              Esta carga inicial (existencias-entradas.csv) — fija el stock.
            </div>
            <div>
              El orden importa: la carga busca cada código en el catálogo, así que los productos
              deben existir primero. Es <strong>idempotente</strong> (fija el saldo al valor del CSV,
              no suma) y cada cambio queda en el historial de stock.
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Destino</label>
              {esMatriz ? (
                <select
                  value={bodegaId}
                  onChange={(e) => setBodegaId(e.target.value)}
                  className="w-full border border-border rounded px-2 py-1.5 bg-background"
                >
                  {bodegas.length === 0 && <option value="">(sin bodegas)</option>}
                  {bodegas.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nombre}
                      {b.esPrincipal ? ' (principal)' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="w-full border border-border rounded px-2 py-1.5 bg-muted/40 font-medium">
                  {sucursalNombre}
                  <span className="text-muted-foreground font-normal"> · inventario de la sucursal</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50"
              >
                {importing ? <Spinner size={14} /> : <Upload className="size-3.5" />}
                {importing ? 'Leyendo…' : 'Cargar CSV'}
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

          {items.length > 0 && (
            <div className="rounded border border-border bg-background px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <Download className="size-3.5 text-muted-foreground" />
                <span className="font-medium">{fileName}</span>
              </div>
              <div className="mt-1 text-muted-foreground">
                {items.length.toLocaleString('es-MX')} renglones ·{' '}
                {totalUnidades.toLocaleString('es-MX')} unidades en total
              </div>
            </div>
          )}

          {/* Verificación contra el catálogo */}
          {items.length > 0 && verificando && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size={14} /> Verificando códigos contra el catálogo…
            </div>
          )}
          {items.length > 0 && !verificando && check && check.matched === 0 && (
            <div className="rounded border border-red-300 bg-red-50 text-red-800 px-3 py-2 text-xs flex gap-2">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Ningún código existe en el catálogo todavía.</div>
                Importa primero el <strong>Catálogo de productos</strong> (catalogo.csv) y vuelve a
                cargar este archivo. Si no, no se cargará ningún stock.
              </div>
            </div>
          )}
          {items.length > 0 && !verificando && check && check.matched > 0 && check.unmatched > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 text-xs flex gap-2">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                <strong>{check.matched.toLocaleString('es-MX')}</strong> códigos coinciden con el
                catálogo y <strong>{check.unmatched.toLocaleString('es-MX')}</strong> no existen (se
                omitirán). ¿Importaste el catálogo completo?
                {check.muestras.length > 0 && (
                  <div className="mt-1 font-mono text-[10px] opacity-80">
                    Ej. sin producto: {check.muestras.slice(0, 8).join(', ')}…
                  </div>
                )}
              </div>
            </div>
          )}
          {items.length > 0 && !verificando && check && check.unmatched === 0 && (
            <div className="rounded border border-green-300 bg-green-50 text-green-800 px-3 py-2 text-xs flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" />
              Los {check.matched.toLocaleString('es-MX')} códigos existen en el catálogo. Listo para
              aplicar.
            </div>
          )}

          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={reemplazar}
              onChange={(e) => setReemplazar(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Reemplazar inventario de {esMatriz ? 'la bodega' : 'la sucursal'}</span>{' '}
              — los lotes que NO estén en el CSV se ponen en saldo 0 (queda exactamente como el CSV).
              Si lo dejas desmarcado, solo se fijan los productos del CSV y el resto se conserva.
            </span>
          </label>
        </div>

        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted/20">
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
            onClick={aplicar}
            disabled={
              saving ||
              importing ||
              verificando ||
              items.length === 0 ||
              !bodegaId ||
              (check !== null && check.matched === 0)
            }
            className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
          >
            {saving && <Spinner size={14} />}
            {saving ? 'Aplicando…' : 'Aplicar carga inicial'}
          </button>
        </footer>

        <BusyOverlay show={saving} text="Aplicando carga inicial…" />
      </div>
    </Modal>
  )
}
