import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, FileDown } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import BusyOverlay from './BusyOverlay'
import type { BodegaDto, TraspasoPreview } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
  userId: string
  onSaved?: () => void
}

export default function RecibirTraspasoModal({ open, onClose, userId, onSaved }: Props) {
  const [preview, setPreview] = useState<TraspasoPreview | null>(null)
  const [picking, setPicking] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [forzar, setForzar] = useState(false)
  const [bodegas, setBodegas] = useState<BodegaDto[]>([])
  const [bodegaId, setBodegaId] = useState('')
  // Renglón "activo" de la tabla de contenido, para validar lo que llega:
  // clic o flechas lo sombrean y recorren.
  const [selRow, setSelRow] = useState(-1)
  const tablaRef = useRef<HTMLDivElement>(null)
  const tbodyRef = useRef<HTMLTableSectionElement>(null)

  useEffect(() => {
    if (!open) {
      setPreview(null)
      setPicking(false)
      setAplicando(false)
      setForzar(false)
      return
    }
    // En matriz hay varias bodegas: el traspaso entra a la que se elija.
    window.api.bodegas
      .list()
      .then((bs) => {
        const activas = bs.filter((b) => b.activa)
        setBodegas(activas)
        const principal = activas.find((b) => b.esPrincipal) ?? activas[0]
        setBodegaId(principal?.id ?? '')
      })
      .catch(() => {})
  }, [open])

  const elegir = useCallback(async () => {
    setPicking(true)
    try {
      const r = await window.api.traspaso.pick()
      if (r.cancelled) return
      if (!r.ok || !r.preview) {
        toast.error('No se pudo leer el traspaso', { description: r.error })
        return
      }
      setPreview(r.preview)
      setForzar(false)
      setSelRow(-1)
      setTimeout(() => tablaRef.current?.focus(), 80)
    } finally {
      setPicking(false)
    }
  }, [])

  const aplicar = useCallback(async () => {
    if (!preview) return
    setAplicando(true)
    try {
      const r = await window.api.traspaso.aplicar(userId, preview.filePath, forzar, bodegaId || null)
      if (!r.ok) {
        toast.error('No se pudo aplicar el traspaso', { description: r.error })
        return
      }
      const extra =
        r.noEncontrados && r.noEncontrados.length > 0
          ? ` · ${r.noEncontrados.length} sin producto (importa el catálogo)`
          : ''
      const archivo = r.archivoEliminado
        ? ' · el archivo se borró del USB'
        : ' · no se pudo borrar el archivo del USB (elimínalo a mano)'
      toast.success(`Traspaso recibido · ${r.unidades?.toLocaleString('es-MX')} unidades`, {
        description: `${r.lotesCreados} lotes creados${extra}${archivo}`,
        duration: 8000
      })
      onSaved?.()
      onClose()
    } catch (e) {
      toast.error('Falló al aplicar', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setAplicando(false)
    }
  }, [preview, userId, forzar, bodegaId, onSaved, onClose])

  // Requiere confirmación manual cuando es "otra sucursal" (UUID distinto, p.ej.
  // tras respaldo/restauración). Ya aplicado = bloqueo duro siempre.
  const necesitaForzar = !!preview && !preview.yaAplicado && !preview.sucursalCoincide
  const bloqueado = !!preview && (preview.yaAplicado || (necesitaForzar && !forzar))

  // La tabla agrupa POR PRODUCTO: el archivo trae una línea por lote (FEFO) y
  // ver el mismo código repetido confundía al validar. La cantidad se suma;
  // con varios lotes la caducidad dice "N lotes" (tooltip con las fechas).
  // Al aplicar se usan las líneas originales del archivo — esto es sólo vista.
  interface GrupoRecibe {
    codigo: string
    nombre: string
    cantidad: number
    caducidades: string[]
  }
  const grupos = useMemo<GrupoRecibe[]>(() => {
    const map = new Map<string, GrupoRecibe>()
    for (const it of preview?.items ?? []) {
      const codigo = String(it.codigo)
      const cad = it.caducidad || '—'
      const g = map.get(codigo)
      if (g) {
        g.cantidad += Number(it.cantidad) || 0
        if (!g.caducidades.includes(cad)) g.caducidades.push(cad)
      } else {
        map.set(codigo, {
          codigo,
          nombre: it.nombre,
          cantidad: Number(it.cantidad) || 0,
          caducidades: [cad]
        })
      }
    }
    return [...map.values()]
  }, [preview])

  const numItems = grupos.length

  // ↑/↓ con la tabla enfocada recorren y sombrean los renglones del traspaso
  // (para validar contra lo físico antes de aplicar).
  const onKeyTabla = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (numItems === 0) return
    e.preventDefault()
    setSelRow((i) => (e.key === 'ArrowDown' ? Math.min(numItems - 1, i + 1) : Math.max(0, i - 1)))
  }

  useEffect(() => {
    if (selRow < 0) return
    const row = tbodyRef.current?.children[selRow] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [selRow])

  return (
    <Modal open={open} title="Recibir traspaso" onClose={onClose} maxWidth="max-w-2xl">
      <div className="relative">
        <div className="p-4 space-y-3 text-sm">
          <div className="rounded border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            Selecciona el archivo <span className="font-mono">.traspaso</span> que te enviaron por
            USB. Se agregará como entrada a tu inventario
            {bodegas.length > 1 ? ' en la bodega que elijas' : ' (Bodega Principal)'}. Cada traspaso
            solo puede aplicarse una vez.
          </div>

          {bodegas.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap font-medium">
                Bodega destino:
              </label>
              <select
                className="border border-border rounded px-2 py-1.5 bg-background text-sm"
                value={bodegaId}
                onChange={(e) => setBodegaId(e.target.value)}
                disabled={aplicando}
              >
                {bodegas.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nombre}
                    {b.esPrincipal ? ' (principal)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={elegir}
            disabled={picking || aplicando}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50"
          >
            {picking ? <Spinner size={14} /> : <FileDown className="size-3.5" />}
            {picking ? 'Leyendo…' : 'Seleccionar archivo .traspaso'}
          </button>

          {preview && (
            <div className="rounded border border-border bg-background p-3 text-xs space-y-1">
              <Row k="Folio" v={`${preview.folio.slice(0, 8)}…`} />
              <Row k="Origen" v={preview.bodegaOrigen} />
              <Row k="Destino" v={preview.sucursalNombre} />
              <Row k="Generado" v={new Date(preview.generadoEn).toLocaleString('es-MX')} />
              <Row k="Contenido" v={`${grupos.length} producto${grupos.length === 1 ? '' : 's'} · ${preview.unidades.toLocaleString('es-MX')} unidades`} />
            </div>
          )}

          {/* Contenido del traspaso — navegable para validar contra lo físico */}
          {preview && numItems > 0 && (
            <section className="border border-border rounded">
              <header className="px-3 py-2 border-b border-border bg-muted/30 text-[10px] font-semibold uppercase tracking-wide flex justify-between items-center">
                <span>Lo que recibes</span>
                <span className="normal-case font-normal text-muted-foreground">
                  ↑/↓ recorre los renglones para validar
                </span>
              </header>
              <div
                ref={tablaRef}
                tabIndex={0}
                onKeyDown={onKeyTabla}
                title="Clic en un renglón (o flechas con la tabla enfocada) para recorrer y validar"
                className="overflow-auto max-h-[45vh] focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background border-b border-border">
                    <tr className="text-left">
                      <th className="px-2 py-1 w-8 text-right">#</th>
                      <th className="px-2 py-1 font-mono w-32">Código</th>
                      <th className="px-2 py-1">Producto</th>
                      <th className="px-2 py-1 w-20 text-right">Cantidad</th>
                      <th className="px-2 py-1 w-28 text-center">Caducidad</th>
                    </tr>
                  </thead>
                  <tbody ref={tbodyRef}>
                    {grupos.map((it, i) => (
                      <tr
                        key={it.codigo}
                        onClick={() => {
                          setSelRow(i)
                          tablaRef.current?.focus()
                        }}
                        className={`border-b border-border/60 cursor-pointer ${
                          i === selRow ? 'bg-primary/10' : 'hover:bg-muted/40'
                        }`}
                      >
                        <td className="px-2 py-1 text-right text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1 font-mono">{it.codigo}</td>
                        <td className="px-2 py-1">{it.nombre}</td>
                        <td className="px-2 py-1 text-right font-mono font-semibold">
                          {it.cantidad.toLocaleString('es-MX')}
                        </td>
                        <td
                          className="px-2 py-1 text-center font-mono"
                          title={
                            it.caducidades.length > 1 ? it.caducidades.join(' · ') : undefined
                          }
                        >
                          {it.caducidades.length === 1
                            ? it.caducidades[0]
                            : `${it.caducidades.length} lotes`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {preview && preview.yaAplicado && (
            <div className="rounded border border-red-300 bg-red-50 text-red-800 px-3 py-2 text-xs flex gap-2">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>Este traspaso <strong>ya fue aplicado</strong> antes. No se puede volver a cargar (evita duplicar stock).</div>
            </div>
          )}
          {necesitaForzar && (
            <div className="rounded border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-xs space-y-2">
              <div className="flex gap-2">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div>
                  Este traspaso fue generado para la sucursal{' '}
                  <strong>{preview!.sucursalNombre}</strong> y no coincide con el identificador de
                  esta instalación (puede pasar tras un respaldo/restauración). Verifica que sea la
                  misma sucursal antes de continuar.
                </div>
              </div>
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={forzar} onChange={(e) => setForzar(e.target.checked)} />
                Es la misma sucursal — aplicar de todas formas
              </label>
            </div>
          )}
          {preview && !bloqueado && (
            <div className="rounded border border-green-300 bg-green-50 text-green-800 px-3 py-2 text-xs flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" />
              Listo para aplicar.
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted/20">
          <button type="button" onClick={onClose} disabled={aplicando} className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm">Cerrar</button>
          <button
            type="button"
            onClick={aplicar}
            disabled={!preview || bloqueado || aplicando || picking}
            className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
          >
            {aplicando && <Spinner size={14} />}
            {aplicando ? 'Aplicando…' : 'Aplicar traspaso'}
          </button>
        </footer>

        <BusyOverlay show={aplicando} text="Aplicando traspaso…" />
      </div>
    </Modal>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
  )
}
