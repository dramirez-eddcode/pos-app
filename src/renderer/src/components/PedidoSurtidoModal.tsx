import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Minus, Search, Trash2 } from 'lucide-react'
import Modal from './Modal'
import SearchModal from './SearchModal'
import Spinner from './Spinner'
import { useSession } from '../stores/session'
import type {
  BodegaDto,
  PedidoLinea,
  PedidoTraspasoDto,
  ProductoDto,
  ProveedorBasicoDto,
  SucursalBasicaDto
} from '@shared/dto'

/** Borrador de pedido en memoria (vive en el POS mientras no se termina). */
export interface PedidoDraft {
  id: string
  /** Id de sucursal del catálogo, o EXTERNO_ID si el destino se escribe a mano. */
  sucursalId: string
  sucursalNombre: string
  /** Bodega que surtirá (matriz multi-bodega; vacío = falta elegir). */
  bodegaId?: string
  lineas: PedidoLinea[]
  notas: string
  /** Si se está EDITANDO una lista de faltantes abierta (pedido PENDIENTE en BD). */
  pedidoId?: string
  numero?: number
}

/**
 * Copias que se imprimen AL TERMINAR la captura (índices de COPIAS_PEDIDO en
 * main/services/pdf.ts): 0 = sucursal destino, 1 = ORIGINAL del propietario.
 * La 2 (ARCHIVO) la imprime el admin al aprobar. Fuera del componente: así no
 * entra en las deps de los useCallback.
 */
const COPIAS_CAPTURA = [0, 1]

/** Valor del selector para "destino externo — escribir nombre". */
export const EXTERNO_ID = '__externo__'
/** Valor del selector para "proveedor escrito a mano". */
export const PROVEEDOR_EXT_ID = '__proveedor__'
/** Prefijo de proveedores del catálogo en el selector. */
export const PROV_PREFIX = 'prov:'

export function nuevoPedidoDraft(): PedidoDraft {
  return {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sucursalId: '',
    sucursalNombre: '',
    lineas: [],
    notas: ''
  }
}

interface Props {
  open: boolean
  draft: PedidoDraft | null
  /** Actualiza el borrador en el POS (para las pestañas minimizadas). */
  onChange: (draft: PedidoDraft) => void
  /** Minimizar: cierra el modal conservando el borrador como pestaña. */
  onMinimizar: () => void
  /** El pedido se registró (y se imprimió): el POS descarta el borrador. */
  onTerminado: (draftId: string) => void
}

/**
 * Prellenado de pedido de surtido a sucursal (cajeras de una matriz-que-vende,
 * vía F11). NO toca inventario: al terminar queda PENDIENTE de revisión en el
 * panel de matriz, y sólo al aprobarse ahí se genera el traspaso real. Se
 * puede minimizar para atender clientes. Al terminar se imprimen 2 copias: la
 * de la sucursal destino y el ORIGINAL del propietario; la de ARCHIVO sale
 * cuando el admin aprueba.
 */
export default function PedidoSurtidoModal({
  open,
  draft,
  onChange,
  onMinimizar,
  onTerminado
}: Props) {
  const { user } = useSession()
  const [sucursales, setSucursales] = useState<SucursalBasicaDto[]>([])
  const [proveedores, setProveedores] = useState<ProveedorBasicoDto[]>([])
  // Bodegas activas de la matriz. Con UNA se usa sola; con varias la cajera
  // DEBE elegir cuál surtirá (para no pedir contra el stock de otra bodega).
  const [bodegas, setBodegas] = useState<BodegaDto[]>([])
  // Listas de faltantes a proveedor ABIERTAS (pendientes en BD): las cajeras
  // las reabren para seguir agregando hasta que el admin las autorice.
  const [listas, setListas] = useState<PedidoTraspasoDto[]>([])
  const [codigo, setCodigo] = useState('')
  const [producto, setProducto] = useState<{
    codigo: string
    nombre: string
    existencias: number
  } | null>(null)
  const [cantidad, setCantidad] = useState('')
  // Pedido a PROVEEDOR: no se captura cantidad — cada línea registra la
  // EXISTENCIA del momento (aunque sea 0), la foto del stock para el surtido.
  const esProveedor =
    draft != null &&
    (draft.pedidoId != null ||
      draft.sucursalId === PROVEEDOR_EXT_ID ||
      draft.sucursalId.startsWith(PROV_PREFIX))
  // Bodega efectiva: única bodega activa → automática; varias → la elegida.
  const bodegaSel = bodegas.length === 1 ? bodegas[0]!.id : (draft?.bodegaId ?? '')
  const bodegaNombreSel = bodegas.find((b) => b.id === bodegaSel)?.nombre ?? ''
  const faltaBodega = !esProveedor && bodegas.length > 1 && !bodegaSel
  const [searchOpen, setSearchOpen] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [selRow, setSelRow] = useState(-1)
  const codigoRef = useRef<HTMLInputElement>(null)
  const cantidadRef = useRef<HTMLInputElement>(null)
  const tablaRef = useRef<HTMLDivElement>(null)
  const tbodyRef = useRef<HTMLTableSectionElement>(null)

  useEffect(() => {
    if (!open || !user) return
    setCodigo('')
    setProducto(null)
    setCantidad('')
    setSelRow(-1)
    window.api.pedidos
      .sucursales(user.id)
      .then(setSucursales)
      .catch((e) =>
        toast.error('No pude cargar las sucursales', {
          description: e instanceof Error ? e.message : String(e)
        })
      )
    window.api.pedidos
      .proveedores(user.id)
      .then(setProveedores)
      .catch(() => setProveedores([]))
    window.api.pedidos
      .listasProveedor(user.id)
      .then(setListas)
      .catch(() => setListas([]))
    window.api.bodegas
      .list()
      .then((bs) => setBodegas(bs.filter((b) => b.activa)))
      .catch(() => setBodegas([]))
    setTimeout(() => codigoRef.current?.focus(), 80)
  }, [open, user])

  // Proveedor: agrega directo con la existencia actual (sin pedir cantidad).
  // Si el producto ya estaba, ACTUALIZA su existencia (no la suma: es foto).
  const agregarConExistencia = useCallback(
    (p: { codigo: string; nombre: string; existencias: number }) => {
      if (!draft) return
      const idx = draft.lineas.findIndex((l) => l.codigo === p.codigo)
      const lineas =
        idx >= 0
          ? draft.lineas.map((l, i) => (i === idx ? { ...l, cantidad: p.existencias } : l))
          : [...draft.lineas, { codigo: p.codigo, nombre: p.nombre, cantidad: p.existencias }]
      onChange({ ...draft, lineas })
      setProducto(null)
      setCodigo('')
      setCantidad('')
      setTimeout(() => codigoRef.current?.focus(), 50)
    },
    [draft, onChange]
  )

  const fijarProducto = useCallback(
    async (p: ProductoDto) => {
      if (esProveedor) {
        // Lista a proveedor: foto del stock TOTAL del negocio (todas las bodegas).
        agregarConExistencia({ codigo: p.codigo, nombre: p.nombre, existencias: p.existenciasTotal })
        return
      }
      if (faltaBodega) {
        toast.error('Selecciona la bodega que surtirá el pedido')
        return
      }
      // Pedido a SUCURSAL: sólo productos CON existencia EN LA BODEGA elegida
      // (de ahí se surte al aprobarse; el total global puede estar en otra).
      let existencias = p.existenciasTotal
      if (user && bodegaSel) {
        try {
          existencias = await window.api.pedidos.existenciaBodega(user.id, p.codigo, bodegaSel)
        } catch {
          // sin dato por bodega, se valida contra el global
        }
      }
      if (existencias <= 0) {
        toast.error(
          `"${p.nombre}" no tiene existencias${bodegaNombreSel ? ` en ${bodegaNombreSel}` : ''}`,
          {
            description: 'Sólo se pueden pedir productos con existencia en la bodega que surtirá.'
          }
        )
        return
      }
      setProducto({ codigo: p.codigo, nombre: p.nombre, existencias })
      setCodigo(p.codigo)
      setTimeout(() => {
        cantidadRef.current?.focus()
        cantidadRef.current?.select()
      }, 100)
    },
    [esProveedor, agregarConExistencia, faltaBodega, user, bodegaSel, bodegaNombreSel]
  )

  const buscar = useCallback(async () => {
    const c = codigo.trim()
    if (!c) return
    // Pedido a sucursal: existencias de la bodega que surtirá; a proveedor:
    // la foto es del stock global (todas las bodegas).
    const p = await window.api.productos.byCodigo(c, esProveedor ? null : bodegaSel || null)
    if (!p) {
      toast.error(`Producto "${c}" no encontrado`)
      return
    }
    await fijarProducto(p)
  }, [codigo, esProveedor, bodegaSel, fijarProducto])

  const onKeyCodigo = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      buscar()
    } else if (e.key === 'F5') {
      e.preventDefault()
      setSearchOpen(true)
    }
  }

  const agregar = useCallback(() => {
    if (!draft) return
    if (!producto) {
      toast.error('Busca un producto primero')
      return
    }
    if (esProveedor) {
      agregarConExistencia(producto)
      return
    }
    const n = Math.round(Number(cantidad))
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Cantidad inválida (debe ser 1 o mayor)')
      return
    }
    // No pedir más de lo que la bodega que surtirá tiene (contando lo ya
    // capturado del mismo producto en esta lista).
    const yaPedido = draft.lineas.find((l) => l.codigo === producto.codigo)?.cantidad ?? 0
    if (n + yaPedido > producto.existencias) {
      const disp = Math.max(0, producto.existencias - yaPedido)
      toast.error(
        `Sólo hay ${producto.existencias} en ${bodegaNombreSel || 'la bodega que surtirá'}`,
        {
          description:
            yaPedido > 0
              ? `Ya llevas ${yaPedido} en la lista — disponible: ${disp}.`
              : 'No puedes pedir más de lo que esa bodega tiene.'
        }
      )
      return
    }
    const idx = draft.lineas.findIndex((l) => l.codigo === producto.codigo)
    const lineas =
      idx >= 0
        ? draft.lineas.map((l, i) => (i === idx ? { ...l, cantidad: l.cantidad + n } : l))
        : [...draft.lineas, { codigo: producto.codigo, nombre: producto.nombre, cantidad: n }]
    onChange({ ...draft, lineas })
    setProducto(null)
    setCodigo('')
    setCantidad('')
    setTimeout(() => codigoRef.current?.focus(), 50)
  }, [draft, producto, cantidad, onChange, esProveedor, agregarConExistencia, bodegaNombreSel])

  const onKeyCantidad = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      agregar()
    }
  }

  const setCantidadLinea = (i: number, value: string): void => {
    if (!draft) return
    const n = Math.round(Number(value))
    onChange({
      ...draft,
      lineas: draft.lineas.map((l, idx) =>
        idx === i ? { ...l, cantidad: Number.isFinite(n) && n > 0 ? n : 0 } : l
      )
    })
  }

  const quitarLinea = (i: number): void => {
    if (!draft) return
    onChange({ ...draft, lineas: draft.lineas.filter((_, idx) => idx !== i) })
  }

  // ↑/↓ con la tabla enfocada sombrean renglones (cotejo mientras dictan).
  const onKeyTabla = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const tgt = e.target as HTMLElement | null
    if (tgt instanceof HTMLInputElement || tgt instanceof HTMLSelectElement) return
    const total = draft?.lineas.length ?? 0
    if (total === 0) return
    e.preventDefault()
    e.stopPropagation()
    setSelRow((i) => (e.key === 'ArrowDown' ? Math.min(total - 1, i + 1) : Math.max(0, i - 1)))
  }

  useEffect(() => {
    if (selRow < 0) return
    const row = tbodyRef.current?.children[selRow] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [selRow])

  // Reabre una lista de faltantes pendiente para seguirla editando.
  const cargarLista = useCallback(
    (p: PedidoTraspasoDto) => {
      if (!draft) return
      if (draft.lineas.length > 0 && draft.pedidoId !== p.id) {
        toast.error('Esta captura ya tiene productos', {
          description: 'Termina o guarda este pedido primero, y abre la lista desde F11 de nuevo.'
        })
        return
      }
      onChange({
        ...draft,
        pedidoId: p.id,
        numero: p.numero,
        sucursalId: PROVEEDOR_EXT_ID,
        sucursalNombre: p.sucursalNombre,
        lineas: p.items.map((l) => ({ ...l })),
        notas: p.notas ?? ''
      })
      setTimeout(() => codigoRef.current?.focus(), 80)
    },
    [draft, onChange]
  )

  const terminar = useCallback(async () => {
    if (!draft || !user || guardando) return

    // ── Lista abierta: guardar/sobrescribir (sigue PENDIENTE, sin imprimir) ─
    if (draft.pedidoId) {
      if (draft.lineas.length === 0) {
        toast.error('La lista no tiene productos')
        return
      }
      setGuardando(true)
      try {
        const p = await window.api.pedidos.guardarLista(
          user.id,
          draft.pedidoId,
          draft.lineas,
          draft.notas.trim() || null
        )
        toast.success(`Lista P-${p.numero} guardada`, {
          description:
            'Sigue abierta: pueden agregarle más faltantes hasta que el administrador la autorice.'
        })
        onTerminado(draft.id)
      } catch (e) {
        toast.error('No se pudo guardar la lista', {
          description: e instanceof Error ? e.message : String(e)
        })
      } finally {
        setGuardando(false)
      }
      return
    }

    const esExterno = draft.sucursalId === EXTERNO_ID
    const esProvExt = draft.sucursalId === PROVEEDOR_EXT_ID
    const esProveedor = esProvExt || draft.sucursalId.startsWith(PROV_PREFIX)
    if (!draft.sucursalId) {
      toast.error('Selecciona el destino del pedido')
      return
    }
    if ((esExterno || esProvExt) && !draft.sucursalNombre.trim()) {
      toast.error(esProvExt ? 'Escribe el nombre del proveedor' : 'Escribe el nombre del destino externo')
      return
    }
    if (!esProveedor && bodegas.length > 1 && !bodegaSel) {
      toast.error('Selecciona la bodega que surtirá el pedido')
      return
    }
    // Proveedor: la cantidad es la existencia y puede ser 0.
    const lineas = esProveedor ? draft.lineas : draft.lineas.filter((l) => l.cantidad > 0)
    if (lineas.length === 0) {
      toast.error('El pedido no tiene productos')
      return
    }
    toast.warning(
      esProveedor
        ? `¿Guardar la lista de faltantes para "${draft.sucursalNombre}"?`
        : `¿Terminar el pedido para "${draft.sucursalNombre}"?`,
      {
      id: 'pedido-confirm',
      description: esProveedor
        ? `${lineas.length} producto(s). Quedará ABIERTA: pueden seguir agregándole desde F11 hasta que el administrador la autorice (ahí se imprime).`
        : `${lineas.length} producto(s). Se imprimen 2 hojas (la de la sucursal y el ORIGINAL del propietario) y queda pendiente de aprobación en la matriz — el stock NO se descuenta todavía; la hoja de ARCHIVO se imprime al aprobarse.`,
      duration: 10000,
      action: {
        label: esProveedor ? 'Sí, guardar' : 'Sí, terminar',
        onClick: async () => {
          setGuardando(true)
          try {
            const p = await window.api.pedidos.create(user.id, {
              ...(esProvExt
                ? { proveedorNombre: draft.sucursalNombre.trim() }
                : esProveedor
                  ? { proveedorId: draft.sucursalId.slice(PROV_PREFIX.length) }
                  : esExterno
                    ? { destinoNombre: draft.sucursalNombre.trim() }
                    : { sucursalId: draft.sucursalId }),
              ...(esProveedor ? {} : { bodegaId: bodegaSel || null }),
              items: lineas,
              notas: draft.notas.trim() || null
            })
            toast.success(
              esProveedor
                ? `Lista de faltantes P-${p.numero} guardada`
                : `Pedido P-${p.numero} registrado`,
              {
                description: esProveedor
                  ? 'Queda ABIERTA: pueden seguir agregándole desde F11 hasta que el administrador la autorice (ahí se imprime).'
                  : 'Queda pendiente de aprobación en la matriz.'
              }
            )
            // Sucursal: al terminar salen 2 hojas — la de la SUCURSAL DESTINO
            // (copia 0) y el ORIGINAL del propietario (copia 1). La de ARCHIVO
            // (copia 2) se imprime hasta que el admin apruebe el pedido.
            // Proveedor: su hoja única también sale HASTA la aprobación.
            // Cada copia va como trabajo de impresión SEPARADO: el dúplex no
            // mezcla copias y cada una se numera "Página i de N" por sí sola.
            if (!esProveedor) {
              const idToast = `imp-${p.id}`
              const TOTAL = COPIAS_CAPTURA.length
              for (let n = 0; n < TOTAL; n++) {
                toast.loading(`Imprimiendo hoja ${n + 1} de ${TOTAL}…`, { id: idToast })
                const pr = await window.api.pedidos.imprimir(user.id, p.id, COPIAS_CAPTURA[n])
                if (!pr.ok) {
                  toast.dismiss(idToast)
                  const resto = ` · Puedes reimprimir las ${TOTAL} hojas desde la revisión en matriz.`
                  if (pr.cancelled) {
                    toast.info(`Impresión cancelada en la hoja ${n + 1} de ${TOTAL}`, {
                      description: `Faltó imprimir${n === 0 ? ' todo' : ' el resto'}.${resto}`
                    })
                  } else {
                    toast.warning(`Falló la hoja ${n + 1} de ${TOTAL}`, {
                      description: `${pr.error ?? ''}${resto}`
                    })
                  }
                  break
                }
                if (n === TOTAL - 1) {
                  toast.success(`${TOTAL} hojas impresas (sucursal y original)`, {
                    id: idToast,
                    description: 'La hoja de ARCHIVO se imprime cuando se apruebe el pedido.'
                  })
                }
              }
            }
            onTerminado(draft.id)
          } catch (e) {
            toast.error('No se pudo registrar el pedido', {
              description: e instanceof Error ? e.message : String(e)
            })
          } finally {
            setGuardando(false)
          }
        }
      }
    })
  }, [draft, user, guardando, onTerminado, bodegas.length, bodegaSel])

  if (!draft) return null
  const totalUnidades = draft.lineas.reduce((s, l) => s + l.cantidad, 0)

  return (
    <>
      <Modal
        open={open && !searchOpen}
        title="Pedido de surtido a sucursal"
        onClose={onMinimizar}
        maxWidth="max-w-3xl"
      >
        <div className="p-4 space-y-3 text-sm">
          <p className="text-xs text-muted-foreground border border-dashed border-border rounded px-3 py-2">
            Prellena lo que pide otra <strong>sucursal</strong> (se surte de tus existencias al
            aprobarse) o la lista de faltantes para tu <strong>proveedor</strong> (la mercancía
            entra después con una Entrada). <strong>No descuenta inventario</strong>: al terminar
            se imprimen <strong>2 hojas</strong> (la de la sucursal y el ORIGINAL del propietario)
            y el pedido queda <strong>pendiente de aprobación</strong> en el panel de matriz (la
            hoja de ARCHIVO se imprime al aprobarse). Puedes <strong>minimizarlo</strong> si llega un cliente — queda como
            pestaña abajo y lo retomas cuando quieras.
          </p>

          {/* Listas de faltantes a proveedor abiertas — se pueden retomar */}
          {listas.length > 0 && !draft.pedidoId && (
            <div className="border border-violet-200 bg-violet-50/60 rounded px-3 py-2 text-xs space-y-1.5">
              <div className="font-semibold text-violet-900">
                Listas de faltantes abiertas (clic para seguir agregando):
              </div>
              <div className="flex flex-wrap gap-1.5">
                {listas.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => cargarLista(p)}
                    className="px-2.5 py-1 rounded-full border border-violet-300 bg-white text-violet-900 cursor-pointer hover:bg-violet-100 font-medium"
                    title={`${p.sucursalNombre}${p.notas ? ` · ${p.notas}` : ''} · ${p.items.length} producto(s)`}
                  >
                    P-{p.numero} · {p.notas?.trim() || p.sucursalNombre} ({p.items.length})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Destino + notas */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {draft.pedidoId ? (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Lista abierta</label>
                <div className="border border-violet-300 bg-violet-50 text-violet-900 rounded px-2 py-1.5 font-medium">
                  P-{draft.numero} · {draft.sucursalNombre}
                </div>
              </div>
            ) : (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Destino del pedido{' '}
                {!draft.sucursalId && <span className="text-red-600 font-semibold">*</span>}
              </label>
              <select
                value={draft.sucursalId}
                onChange={(e) => {
                  const v = e.target.value
                  let nombre = ''
                  if (v === EXTERNO_ID || v === PROVEEDOR_EXT_ID) {
                    nombre = '' // se escribe abajo
                  } else if (v.startsWith(PROV_PREFIX)) {
                    nombre = proveedores.find((p) => `${PROV_PREFIX}${p.id}` === v)?.nombre ?? ''
                  } else {
                    nombre = sucursales.find((x) => x.id === v)?.nombre ?? ''
                  }
                  onChange({ ...draft, sucursalId: v, sucursalNombre: nombre })
                }}
                className={`w-full border rounded px-2 py-1.5 ${
                  draft.sucursalId
                    ? 'border-border bg-background'
                    : 'border-red-400 bg-red-50 text-red-900'
                }`}
              >
                <option value="">— Seleccionar destino —</option>
                <optgroup label="Surtir a sucursal (sale de mis existencias al aprobar)">
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                  <option value={EXTERNO_ID}>Otro destino (externo) — escribir nombre…</option>
                </optgroup>
                <optgroup label="Pedido a proveedor (lista de faltantes; la entrada se hace después)">
                  {proveedores.map((p) => (
                    <option key={p.id} value={`${PROV_PREFIX}${p.id}`}>
                      {p.nombre}
                    </option>
                  ))}
                  <option value={PROVEEDOR_EXT_ID}>Otro proveedor — escribir nombre…</option>
                </optgroup>
              </select>
              {(draft.sucursalId === EXTERNO_ID || draft.sucursalId === PROVEEDOR_EXT_ID) && (
                <input
                  type="text"
                  value={draft.sucursalNombre}
                  maxLength={80}
                  autoFocus
                  onChange={(e) => onChange({ ...draft, sucursalNombre: e.target.value })}
                  placeholder={
                    draft.sucursalId === PROVEEDOR_EXT_ID
                      ? 'Nombre del proveedor…'
                      : 'Nombre del destino externo (farmacia/cliente)…'
                  }
                  className={`mt-1.5 w-full border rounded px-2 py-1.5 ${
                    draft.sucursalNombre.trim()
                      ? 'border-border bg-background'
                      : 'border-red-400 bg-red-50 text-red-900'
                  }`}
                />
              )}
            </div>
            )}
            {!esProveedor && !draft.pedidoId && bodegas.length > 1 && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Bodega que surtirá{' '}
                  {!draft.bodegaId && <span className="text-red-600 font-semibold">*</span>}
                </label>
                <select
                  value={draft.bodegaId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === (draft.bodegaId ?? '')) return
                    // Con líneas capturadas, cambiar de bodega REINICIA la
                    // lista: lo validado era contra el stock de la otra bodega.
                    if (draft.lineas.length > 0) {
                      toast.warning('¿Cambiar la bodega que surtirá?', {
                        id: 'pedido-cambio-bodega',
                        description:
                          'La lista capturada se reinicia — las existencias validadas eran de la otra bodega.',
                        duration: 8000,
                        action: {
                          label: 'Sí, cambiar y reiniciar',
                          onClick: () => {
                            onChange({ ...draft, bodegaId: v, lineas: [] })
                            setProducto(null)
                            setCodigo('')
                            setCantidad('')
                            setSelRow(-1)
                            setTimeout(() => codigoRef.current?.focus(), 50)
                          }
                        }
                      })
                      return
                    }
                    onChange({ ...draft, bodegaId: v })
                    // El producto a medio capturar traía existencias de la otra bodega
                    setProducto(null)
                    setCodigo('')
                    setCantidad('')
                  }}
                  className={`w-full border rounded px-2 py-1.5 ${
                    draft.bodegaId
                      ? 'border-border bg-background'
                      : 'border-red-400 bg-red-50 text-red-900'
                  }`}
                >
                  <option value="">— Selecciona una bodega —</option>
                  {bodegas.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                {esProveedor ? 'Nombre de la lista / notas' : 'Notas (opcional)'}
              </label>
              <input
                type="text"
                value={draft.notas}
                maxLength={200}
                onChange={(e) => onChange({ ...draft, notas: e.target.value })}
                placeholder={esProveedor ? 'Ej. "Medicina", "Vitrinas"' : 'Ej. "Urge para el sábado"'}
                className="w-full border border-border rounded px-2 py-1.5"
              />
            </div>
          </div>

          {/* Captura rápida. En pedidos a proveedor NO se pide cantidad: cada
              producto se agrega directo con su existencia del momento. */}
          <section className="border border-border rounded p-3 bg-muted/10">
            <div
              className={`grid gap-2 items-end ${
                esProveedor
                  ? 'grid-cols-[1fr_auto_auto]'
                  : 'grid-cols-[1fr_110px_auto_auto]'
              }`}
            >
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Código <span className="font-mono">(Enter busca · F5 abre búsqueda)</span>
                  {esProveedor && (
                    <span className="ml-2 text-violet-700 font-semibold normal-case">
                      · se agrega con la existencia actual (aunque sea 0)
                    </span>
                  )}
                </label>
                <input
                  ref={codigoRef}
                  type="text"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  onKeyDown={onKeyCodigo}
                  placeholder="EAN-13 o SKU interno…"
                  autoComplete="off"
                  className="w-full border border-border rounded px-2 py-1.5 font-mono"
                />
              </div>
              {!esProveedor && (
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Cantidad</label>
                  <input
                    ref={cantidadRef}
                    type="number"
                    min={1}
                    value={cantidad}
                    onChange={(e) => setCantidad(e.target.value)}
                    onKeyDown={onKeyCantidad}
                    className="w-full border border-border rounded px-2 py-1.5 font-mono text-right"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="px-3 py-1.5 border border-border rounded hover:bg-muted inline-flex items-center gap-1.5"
              >
                <Search className="size-3.5" /> Buscar (F5)
              </button>
              <button
                type="button"
                onClick={agregar}
                className="px-4 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 font-medium"
              >
                Agregar
              </button>
            </div>
            {/* Nombre del producto encontrado — fuera del grid para no
                desalinear los campos de la fila de captura. */}
            {producto && (
              <div className="text-[11px] text-muted-foreground mt-1.5 truncate">
                Producto: <span className="text-foreground font-medium">{producto.nombre}</span>
                {!esProveedor && (
                  <>
                    {' '}· disponible{bodegaNombreSel ? ` en ${bodegaNombreSel}` : ''}:{' '}
                    <span className="font-mono font-semibold text-foreground">
                      {producto.existencias}
                    </span>
                  </>
                )}
              </div>
            )}
          </section>

          {/* Líneas del pedido (orden de captura, sombreado ↑/↓) */}
          <section className="border border-border rounded">
            <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide flex justify-between">
              <span>Productos del pedido</span>
              <span className="text-[10px] normal-case text-muted-foreground">
                {draft.lineas.length} línea{draft.lineas.length === 1 ? '' : 's'} ·{' '}
                {totalUnidades.toLocaleString('es-MX')} unidades
              </span>
            </header>
            <div
              ref={tablaRef}
              tabIndex={0}
              onKeyDown={onKeyTabla}
              title="Con la tabla enfocada: ↑/↓ recorren y sombrean los renglones"
              className="overflow-auto max-h-[38vh] focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-8 text-right">#</th>
                    <th className="px-2 py-1.5 w-32 font-mono">Código</th>
                    <th className="px-2 py-1.5">Producto</th>
                    <th className="px-2 py-1.5 w-28 text-right">
                      {esProveedor ? 'Existencia' : 'Cantidad'}
                    </th>
                    <th className="px-2 py-1.5 w-10"></th>
                  </tr>
                </thead>
                <tbody ref={tbodyRef}>
                  {draft.lineas.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground italic">
                        Aún no agregas productos — captura con el código de arriba.
                      </td>
                    </tr>
                  )}
                  {draft.lineas.map((l, i) => (
                    <tr
                      key={`${l.codigo}-${i}`}
                      onClick={(e) => {
                        setSelRow(i)
                        const tgt = e.target as HTMLElement
                        if (!(tgt instanceof HTMLInputElement) && !tgt.closest('button')) {
                          tablaRef.current?.focus()
                        }
                      }}
                      className={`border-b border-border/60 cursor-pointer ${
                        i === selRow ? 'bg-primary/10' : 'hover:bg-muted/40'
                      }`}
                    >
                      <td className="px-2 py-1 text-right text-muted-foreground">{i + 1}</td>
                      <td className="px-2 py-1 font-mono">{l.codigo}</td>
                      <td className="px-2 py-1">{l.nombre}</td>
                      <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          min={esProveedor ? 0 : 1}
                          value={esProveedor ? l.cantidad : l.cantidad || ''}
                          onChange={(e) => setCantidadLinea(i, e.target.value)}
                          className="w-20 border border-border rounded px-1.5 py-1 font-mono text-right"
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => quitarLinea(i)}
                          title="Quitar del pedido"
                          className="p-1 rounded text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <footer className="flex justify-between items-center px-4 py-3 border-t border-border bg-muted/20">
          <div className="text-xs text-muted-foreground">
            {esProveedor ? (
              <>
                La lista queda <strong>abierta</strong> (se puede seguir editando desde F11); la
                hoja (<strong>1 copia</strong>) se imprime <strong>al aprobarse</strong>.
              </>
            ) : (
              <>
                Al terminar se imprimen <strong>2 hojas</strong> (sucursal y{' '}
                <strong>ORIGINAL</strong>); la de <strong>ARCHIVO</strong> se imprime al
                aprobarse.
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onMinimizar}
              disabled={guardando}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
              title="Guardar como pestaña abajo y seguir vendiendo"
            >
              <Minus className="size-3.5" /> Minimizar
            </button>
            <button
              type="button"
              onClick={terminar}
              disabled={
                guardando ||
                draft.lineas.length === 0 ||
                !draft.sucursalId ||
                faltaBodega ||
                ((draft.sucursalId === EXTERNO_ID || draft.sucursalId === PROVEEDOR_EXT_ID) &&
                  !draft.sucursalNombre.trim())
              }
              className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
            >
              {guardando ? (
                <>
                  <Spinner size={14} /> Guardando…
                </>
              ) : draft.pedidoId ? (
                'Guardar lista'
              ) : esProveedor ? (
                'Guardar lista de faltantes'
              ) : (
                'Terminar pedido'
              )}
            </button>
          </div>
        </footer>
      </Modal>

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={fijarProducto}
        // Proveedor: la lista de faltantes incluye productos en cero.
        // Sucursal: sólo con existencia (no hay qué surtir sin stock).
        allowZeroStock={esProveedor}
        // Pedido a sucursal: "Exist." = stock de la bodega que surtirá;
        // a proveedor: stock global (la foto es de todo el negocio).
        bodegaId={esProveedor ? null : bodegaSel || null}
        returnFocus={() => setTimeout(() => cantidadRef.current?.focus(), 100)}
      />
    </>
  )
}
