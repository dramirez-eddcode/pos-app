import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import { toast } from 'sonner'
import { Ban, CheckCircle2, Pencil, RotateCcw, Search } from 'lucide-react'
import Modal from './Modal'
import Spinner from './Spinner'
import { useSession } from '../stores/session'
import { money } from '../lib/format'
import type {
  CatalogoSucursalItem,
  SetSucursalProductoInput,
  SucursalDto
} from '@shared/dto'
import type { IvaModo } from '@shared/types'

interface Props {
  open: boolean
  onClose: () => void
  sucursal: SucursalDto | null
}

type SubForm = { kind: 'edit'; target: CatalogoSucursalItem } | null

export default function SucursalCatalogoModal({ open, onClose, sucursal }: Props) {
  const { user } = useSession()
  const [list, setList] = useState<CatalogoSucursalItem[]>([])
  const [loading, setLoading] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [showSoloOverride, setShowSoloOverride] = useState(false)
  const [showExcluidos, setShowExcluidos] = useState(true)
  const [sub, setSub] = useState<SubForm>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const load = useCallback(async () => {
    if (!user || !sucursal) return
    setLoading(true)
    try {
      const r = await window.api.sucursalProducto.getCatalogo(user.id, sucursal.id)
      setList(r)
    } catch (e) {
      toast.error('No pude cargar el catálogo de esta sucursal', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setLoading(false)
    }
  }, [user, sucursal])

  useEffect(() => {
    if (open && sucursal) load()
  }, [open, sucursal, load])

  const filtered = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    return list.filter((p) => {
      if (!showExcluidos && p.override?.excluida) return false
      if (showSoloOverride && !p.override) return false
      if (!q) return true
      return (
        p.codigo.toLowerCase().includes(q) ||
        p.nombre.toLowerCase().includes(q) ||
        (p.laboratorio ?? '').toLowerCase().includes(q)
      )
    })
  }, [list, filtro, showSoloOverride, showExcluidos])

  const stats = useMemo(() => {
    const total = list.length
    const conOverride = list.filter((p) => p.override).length
    const excluidos = list.filter((p) => p.override?.excluida).length
    return { total, conOverride, excluidos }
  }, [list])

  // ── Paginación ──────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageSafe = Math.min(page, totalPages)
  const pageItems = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize)

  useEffect(() => {
    setPage(1)
  }, [filtro, showSoloOverride, showExcluidos, pageSize])

  const clearOverride = useCallback(
    async (p: CatalogoSucursalItem) => {
      if (!user || !sucursal) return
      setBusyId(p.productoId)
      try {
        await window.api.sucursalProducto.clear(user.id, sucursal.id, p.productoId)
        toast.success(`"${p.nombre}" vuelve a usar valores globales`)
        await load()
      } catch (e) {
        toast.error('No se pudo reiniciar', {
          description: e instanceof Error ? e.message : String(e)
        })
      } finally {
        setBusyId(null)
      }
    },
    [user, sucursal, load]
  )

  const toggleExcluida = useCallback(
    async (p: CatalogoSucursalItem) => {
      if (!user || !sucursal) return
      const nuevo = !(p.override?.excluida ?? false)
      setBusyId(p.productoId)
      try {
        await window.api.sucursalProducto.set(user.id, {
          sucursalId: sucursal.id,
          productoId: p.productoId,
          excluida: nuevo
        })
        toast.success(
          nuevo
            ? `"${p.nombre}" excluido de esta sucursal`
            : `"${p.nombre}" vuelve a aplicar en esta sucursal`
        )
        await load()
      } catch (e) {
        toast.error('No se pudo actualizar', {
          description: e instanceof Error ? e.message : String(e)
        })
      } finally {
        setBusyId(null)
      }
    },
    [user, sucursal, load]
  )

  if (!sucursal) return null

  return (
    <>
      <Modal
        open={open && !sub}
        title={
          <span>
            Catálogo de sucursal — <span className="font-mono">{sucursal.codigo}</span>{' '}
            {sucursal.nombre}
          </span>
        }
        onClose={onClose}
        maxWidth="max-w-[1100px]"
      >
        <div className="p-4 space-y-3 text-sm">
          <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-900">
            Cada producto usa por defecto los valores del catálogo global. Edita la fila para
            asignar un <span className="font-semibold">precio o IVA distinto</span> en esta
            sucursal, o márcalo como <span className="font-semibold">excluido</span> si no se
            vende aquí. "Resetear" elimina el override y vuelve a usar el global.
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 relative min-w-[240px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filtrar por código, nombre o laboratorio…"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                className="w-full pl-7 pr-2 py-1.5 border border-border rounded text-sm"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
              <input
                type="checkbox"
                checked={showSoloOverride}
                onChange={(e) => setShowSoloOverride(e.target.checked)}
              />
              Sólo con override
            </label>
            <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
              <input
                type="checkbox"
                checked={showExcluidos}
                onChange={(e) => setShowExcluidos(e.target.checked)}
              />
              Mostrar excluidos
            </label>
          </div>

          <div className="border border-border rounded overflow-auto max-h-[60vh]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-mono w-28">Código</th>
                  <th className="px-2 py-1.5">Producto</th>
                  <th className="px-2 py-1.5 w-24 text-right">P. global</th>
                  <th className="px-2 py-1.5 w-24 text-right">P. sucursal</th>
                  <th className="px-2 py-1.5 w-20 text-center">IVA suc.</th>
                  <th className="px-2 py-1.5 w-20 text-center">Aplica</th>
                  <th className="px-2 py-1.5 w-44 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-muted-foreground italic">
                      <div className="flex justify-center">
                        <Spinner label="Cargando…" />
                      </div>
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-8 text-center text-muted-foreground italic">
                      {list.length === 0
                        ? 'No hay productos en el catálogo global todavía.'
                        : 'Sin coincidencias.'}
                    </td>
                  </tr>
                )}
                {pageItems.map((p) => {
                  const hasOverride = Boolean(p.override)
                  const excluida = p.override?.excluida ?? false
                  return (
                    <tr
                      key={p.productoId}
                      className={`border-b border-border/60 ${
                        excluida ? 'bg-red-50/40 text-muted-foreground' : ''
                      }`}
                    >
                      <td className="px-2 py-1.5 font-mono">{p.codigo}</td>
                      <td className="px-2 py-1.5">
                        <div>{p.nombre}</div>
                        {p.laboratorio && (
                          <div className="text-[10px] text-muted-foreground">{p.laboratorio}</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                        {money(p.precioGlobal)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {p.override?.precio != null ? (
                          <span className="font-semibold text-blue-700">
                            {money(p.override.precio)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center text-[11px]">
                        {p.override?.ivaModo || p.override?.ivaPorcentaje != null ? (
                          <span className="text-blue-700 font-semibold">
                            {(p.override.ivaModo ?? p.ivaModoGlobal).slice(0, 3)}{' '}
                            {p.override.ivaPorcentaje ?? p.ivaPorcentajeGlobal}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {excluida ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-red-700">
                            <Ban className="size-3" /> Excluida
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-green-700">
                            <CheckCircle2 className="size-3" /> Sí
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            onClick={() => setSub({ kind: 'edit', target: p })}
                            className="inline-flex items-center gap-1 px-2 py-1 border border-border rounded hover:bg-muted text-[11px]"
                            title="Editar precio / IVA"
                          >
                            <Pencil className="size-3" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleExcluida(p)}
                            disabled={busyId === p.productoId}
                            className={`inline-flex items-center gap-1 px-2 py-1 border rounded text-[11px] disabled:opacity-50 ${
                              excluida
                                ? 'border-border hover:bg-green-50 hover:border-green-300 text-green-700'
                                : 'border-border hover:bg-red-50 hover:border-red-300 text-red-700'
                            }`}
                            title={excluida ? 'Volver a aplicar en esta sucursal' : 'Excluir de esta sucursal'}
                          >
                            {busyId === p.productoId ? (
                              <Spinner size={14} />
                            ) : (
                              <Ban className="size-3" />
                            )}
                            {excluida ? 'Aplicar' : 'Excluir'}
                          </button>
                          {hasOverride && (
                            <button
                              type="button"
                              onClick={() => clearOverride(p)}
                              disabled={busyId === p.productoId}
                              className="inline-flex items-center gap-1 px-2 py-1 border border-border rounded hover:bg-muted text-[11px] disabled:opacity-50"
                              title="Reiniciar — volver al catálogo global"
                            >
                              {busyId === p.productoId ? (
                                <Spinner size={14} />
                              ) : (
                                <RotateCcw className="size-3" />
                              )}
                              Reset
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{filtered.length} de {stats.total}</span>
              <span className="text-blue-700 font-medium">{stats.conOverride} con override</span>
              {stats.excluidos > 0 && (
                <span className="text-red-700 font-medium">{stats.excluidos} excluidos</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="border border-border rounded px-1.5 py-1 bg-background"
              >
                {[10, 20, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>
                    {n}/pág
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setPage(pageSafe - 1)}
                disabled={pageSafe <= 1}
                className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40"
              >
                ‹
              </button>
              <span className="whitespace-nowrap">
                Pág {pageSafe}/{totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(pageSafe + 1)}
                disabled={pageSafe >= totalPages}
                className="px-2 py-1 border border-border rounded hover:bg-muted disabled:opacity-40"
              >
                ›
              </button>
            </div>
          </div>
        </div>

        <footer className="flex justify-end px-4 py-3 border-t border-border bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
          >
            Cerrar
          </button>
        </footer>
      </Modal>

      {sub?.kind === 'edit' && sucursal && (
        <OverrideEditorSubModal
          sucursalId={sucursal.id}
          target={sub.target}
          onClose={() => setSub(null)}
          onSaved={async () => {
            setSub(null)
            await load()
          }}
        />
      )}
    </>
  )
}

// ── Sub-modal: editar precio + IVA override de UN producto ────────────────
interface SubProps {
  sucursalId: string
  target: CatalogoSucursalItem
  onClose: () => void
  onSaved: () => void
}

function OverrideEditorSubModal({ sucursalId, target, onClose, onSaved }: SubProps) {
  const { user } = useSession()

  // Estado: usePrecioOverride controla si se aplica un precio distinto al global
  const [usePrecioOverride, setUsePrecioOverride] = useState<boolean>(
    target.override?.precio != null
  )
  const [precio, setPrecio] = useState<string>(
    target.override?.precio != null
      ? String(target.override.precio)
      : String(target.precioGlobal)
  )

  const [useIvaOverride, setUseIvaOverride] = useState<boolean>(
    target.override?.ivaModo != null || target.override?.ivaPorcentaje != null
  )
  const [ivaModo, setIvaModo] = useState<IvaModo>(
    target.override?.ivaModo ?? target.ivaModoGlobal
  )
  const [ivaPorcentaje, setIvaPorcentaje] = useState<string>(
    target.override?.ivaPorcentaje != null
      ? String(target.override.ivaPorcentaje)
      : String(target.ivaPorcentajeGlobal)
  )

  const [saving, setSaving] = useState(false)
  const precioRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => precioRef.current?.focus(), 80)
  }, [])

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!user) return
      const input: SetSucursalProductoInput = {
        sucursalId,
        productoId: target.productoId
      }
      if (usePrecioOverride) {
        const n = Number(precio)
        if (!Number.isFinite(n) || n < 0) {
          toast.error('Precio inválido')
          return
        }
        input.precio = n
      } else {
        input.precio = null
      }
      if (useIvaOverride) {
        input.ivaModo = ivaModo
        const p = ivaModo === 'exento' ? 0 : Number(ivaPorcentaje)
        if (!Number.isFinite(p) || p < 0 || p > 100) {
          toast.error('Porcentaje de IVA inválido (0–100)')
          return
        }
        input.ivaPorcentaje = p
      } else {
        input.ivaModo = null
        input.ivaPorcentaje = null
      }

      setSaving(true)
      try {
        await window.api.sucursalProducto.set(user.id, input)
        toast.success(`Override de "${target.nombre}" guardado`)
        onSaved()
      } catch (err) {
        toast.error('No se pudo guardar', {
          description: err instanceof Error ? err.message : String(err)
        })
      } finally {
        setSaving(false)
      }
    },
    [user, sucursalId, target, usePrecioOverride, precio, useIvaOverride, ivaModo, ivaPorcentaje, onSaved]
  )

  return (
    <Modal
      open
      title={`Override — ${target.codigo} · ${target.nombre}`}
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      <form onSubmit={submit} className="p-4 space-y-4 text-sm">
        {/* ── Precio ─────────────────────────────────────────────────── */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-medium">Precio</div>
            <div className="text-xs text-muted-foreground">
              Global: <span className="font-mono font-medium">{money(target.precioGlobal)}</span>
            </div>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={usePrecioOverride}
              onChange={(e) => setUsePrecioOverride(e.target.checked)}
            />
            <span className="text-xs">Usar precio distinto en esta sucursal</span>
          </label>
          {usePrecioOverride && (
            <input
              ref={precioRef}
              type="number"
              step="0.01"
              min="0"
              required
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 font-mono"
              autoComplete="off"
            />
          )}
        </section>

        {/* ── IVA ────────────────────────────────────────────────────── */}
        <section className="space-y-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <div className="font-medium">IVA</div>
            <div className="text-xs text-muted-foreground">
              Global:{' '}
              <span className="font-medium">
                {target.ivaModoGlobal} {target.ivaPorcentajeGlobal}%
              </span>
            </div>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useIvaOverride}
              onChange={(e) => setUseIvaOverride(e.target.checked)}
            />
            <span className="text-xs">Usar IVA distinto en esta sucursal</span>
          </label>
          {useIvaOverride && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[11px] text-muted-foreground mb-1">Modo</span>
                <select
                  value={ivaModo}
                  onChange={(e) => setIvaModo(e.target.value as IvaModo)}
                  className="w-full border border-border rounded px-2 py-1.5 bg-background"
                >
                  <option value="exento">Exento</option>
                  <option value="sumar">Sumar al cobrar</option>
                  <option value="incluido">Incluido en precio</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] text-muted-foreground mb-1">% IVA</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  disabled={ivaModo === 'exento'}
                  value={ivaPorcentaje}
                  onChange={(e) => setIvaPorcentaje(e.target.value)}
                  className="w-full border border-border rounded px-2 py-1.5 font-mono disabled:bg-muted/30"
                  autoComplete="off"
                />
              </label>
            </div>
          )}
        </section>

        <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
          Si desmarcas las dos opciones, el producto vuelve a usar 100% los valores del catálogo
          global en esta sucursal (sin override).
        </p>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
          >
            {saving ? (
              <>
                <Spinner size={14} /> Guardando…
              </>
            ) : (
              'Guardar override'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// (helper sin uso fuera del archivo)
type _Field = ReactNode
