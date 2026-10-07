import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  FileText,
  Printer,
  Search,
  Trash2,
  XCircle
} from 'lucide-react'
import Modal from './Modal'
import SearchModal from './SearchModal'
import Spinner from './Spinner'
import ResumenSurtidoModal from './ResumenSurtidoModal'
import { useSession } from '../stores/session'
import type { BodegaDto, PedidoLinea, PedidoTraspasoDto, ProductoDto } from '@shared/dto'

interface Props {
  open: boolean
  onClose: () => void
  /** Notifica cambios (aprobado/rechazado) para refrescar contadores. */
  onDone?: () => void
}

const ESTADO_BADGE: Record<string, string> = {
  PENDIENTE: 'bg-amber-100 text-amber-900',
  APROBADO: 'bg-green-100 text-green-900',
  RECHAZADO: 'bg-red-100 text-red-900'
}

/**
 * Revisión de pedidos de surtido (matriz, sólo admin): la cajera los prellena
 * desde el POS y aquí se aprueban (ejecuta el traspaso real y descuenta stock),
 * se rechazan o se editan. Al aprobar se imprime la hoja de ARCHIVO (la de la
 * sucursal y el ORIGINAL ya salieron al capturar); tras editar se pueden
 * reimprimir las hojas que correspondan.
 */
export default function PedidosRevisionModal({ open, onClose, onDone }: Props) {
  const { user } = useSession()
  const [pedidos, setPedidos] = useState<PedidoTraspasoDto[]>([])
  const [bodegas, setBodegas] = useState<BodegaDto[]>([])
  const [loading, setLoading] = useState(false)
  const [detalle, setDetalle] = useState<PedidoTraspasoDto | null>(null)
  const [items, setItems] = useState<PedidoLinea[]>([])
  const [dirty, setDirty] = useState(false)
  // Lista a PROVEEDOR: existencia real de cada código AHORA, para detectar
  // renglones cuya "foto" quedó vieja (ventas/traspasos tras capturarlos).
  const [actuales, setActuales] = useState<Record<string, number> | null>(null)
  const [bodegaId, setBodegaId] = useState('')
  const [busy, setBusy] = useState<null | 'guardar' | 'aprobar' | 'rechazar' | 'imprimir' | 'pdf'>(
    null
  )
  const [selRow, setSelRow] = useState(-1)
  const [resumenOpen, setResumenOpen] = useState(false)
  // Captura para AGREGAR productos durante la revisión (corregir errores).
  const [capCodigo, setCapCodigo] = useState('')
  const [capProducto, setCapProducto] = useState<{
    codigo: string
    nombre: string
    existencias: number
  } | null>(null)
  const [capCantidad, setCapCantidad] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const capCodigoRef = useRef<HTMLInputElement>(null)
  const capCantidadRef = useRef<HTMLInputElement>(null)
  const tablaRef = useRef<HTMLDivElement>(null)
  const tbodyRef = useRef<HTMLTableSectionElement>(null)
  // Sombreado con ↑/↓ en la LISTA de pedidos (Enter = Revisar/Ver).
  const [listaSelRow, setListaSelRow] = useState(-1)
  const listaSelRowRef = useRef(-1)
  useEffect(() => {
    listaSelRowRef.current = listaSelRow
  }, [listaSelRow])
  const listaTbodyRef = useRef<HTMLTableSectionElement>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [ps, bs] = await Promise.all([
        window.api.pedidos.list(user.id),
        window.api.bodegas.list().catch(() => [] as BodegaDto[])
      ])
      setPedidos(ps)
      const activas = bs.filter((b) => b.activa)
      setBodegas(activas)
      setBodegaId((prev) => prev || ((activas.find((b) => b.esPrincipal) ?? activas[0])?.id ?? ''))
    } catch (e) {
      toast.error('No pude cargar los pedidos', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (open) {
      setDetalle(null)
      load()
    }
  }, [open, load])

  const abrirDetalle = (p: PedidoTraspasoDto): void => {
    setDetalle(p)
    setItems(p.items.map((l) => ({ ...l })))
    setDirty(false)
    setSelRow(-1)
    setCapCodigo('')
    setCapProducto(null)
    setCapCantidad('')
    // La bodega elegida al capturar el pedido queda preseleccionada para
    // surtir (el admin puede cambiarla, pero el default es la correcta).
    if (p.bodegaId && bodegas.some((b) => b.id === p.bodegaId)) setBodegaId(p.bodegaId)
  }

  // ↑/↓ recorren la lista de pedidos y Enter abre Revisar/Ver de la fila
  // sombreada (captura: le gana al arrowFieldNav del Modal).
  // Al abrir una lista a proveedor pendiente, compara su "foto" de existencias
  // con el stock real de ahora.
  useEffect(() => {
    setActuales(null)
    if (!open || !user || !detalle) return
    if (detalle.tipo !== 'PROVEEDOR' || detalle.estado !== 'PENDIENTE') return
    let vivo = true
    window.api.pedidos
      .existenciasActuales(
        user.id,
        detalle.items.map((l) => l.codigo)
      )
      .then((a) => {
        if (vivo) setActuales(a)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [open, user, detalle])

  const desactualizadas = actuales
    ? items.filter((l) => actuales[l.codigo] !== undefined && actuales[l.codigo] !== l.cantidad)
    : []

  // Pone cada renglón al stock real (queda como cambio pendiente de guardar /
  // aprobar — al aprobar el backend lo vuelve a refrescar de todas formas).
  const actualizarExistencias = (): void => {
    if (!actuales || desactualizadas.length === 0) return
    setItems((prev) =>
      prev.map((l) =>
        actuales[l.codigo] !== undefined ? { ...l, cantidad: actuales[l.codigo]! } : l
      )
    )
    setDirty(true)
    toast.success(
      `${desactualizadas.length} existencia${desactualizadas.length === 1 ? '' : 's'} actualizada${desactualizadas.length === 1 ? '' : 's'} al stock real`,
      { description: 'Guarda o aprueba la lista para dejarlas registradas.' }
    )
  }

  useEffect(() => {
    setListaSelRow(-1)
  }, [pedidos])
  useEffect(() => {
    if (!open || detalle || searchOpen || resumenOpen) return
    const handler = (e: KeyboardEvent): void => {
      const tgt = e.target as HTMLElement | null
      if (
        tgt instanceof HTMLInputElement ||
        tgt instanceof HTMLSelectElement ||
        tgt instanceof HTMLTextAreaElement ||
        tgt?.isContentEditable === true
      ) {
        return
      }
      const total = pedidos.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (total === 0) return
        e.preventDefault()
        e.stopPropagation()
        const cur = listaSelRowRef.current
        if (e.key === 'ArrowDown') setListaSelRow(Math.min(total - 1, cur + 1))
        else if (cur >= 0) setListaSelRow(Math.max(0, cur - 1))
      } else if (e.key === 'Enter') {
        if (tgt?.tagName === 'BUTTON') return
        const p = pedidos[listaSelRowRef.current]
        if (!p) return
        e.preventDefault()
        e.stopPropagation()
        abrirDetalle(p)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, detalle, searchOpen, resumenOpen, pedidos, bodegas])

  // Mantiene visible la fila sombreada (compensa el thead sticky).
  useEffect(() => {
    if (listaSelRow < 0) return
    const tbody = listaTbodyRef.current
    const row = tbody?.children[listaSelRow] as HTMLElement | undefined
    const cont = tbody?.closest('.overflow-auto') as HTMLElement | null
    if (!row || !cont) return
    const headerH = cont.querySelector('thead')?.getBoundingClientRect().height ?? 0
    if (row.offsetTop - headerH < cont.scrollTop) {
      cont.scrollTop = Math.max(0, row.offsetTop - headerH)
    } else if (row.offsetTop + row.offsetHeight > cont.scrollTop + cont.clientHeight) {
      cont.scrollTop = row.offsetTop + row.offsetHeight - cont.clientHeight
    }
  }, [listaSelRow])

  // ── Agregar productos durante la revisión (corregir el pedido) ────────────
  const agregarLinea = useCallback(
    (codigo: string, nombre: string, cantidad: number) => {
      setItems((prev) => {
        const idx = prev.findIndex((l) => l.codigo === codigo)
        if (idx >= 0) {
          // Sucursal suma a lo pedido; proveedor fija la existencia (foto).
          return prev.map((l, i) =>
            i === idx
              ? {
                  ...l,
                  cantidad:
                    detalle?.tipo === 'PROVEEDOR' ? cantidad : l.cantidad + cantidad
                }
              : l
          )
        }
        return [...prev, { codigo, nombre, cantidad }]
      })
      setDirty(true)
      setCapProducto(null)
      setCapCodigo('')
      setCapCantidad('')
      setTimeout(() => capCodigoRef.current?.focus(), 50)
    },
    [detalle?.tipo]
  )

  const fijarProd = useCallback(
    async (p: ProductoDto) => {
      if (!detalle) return
      if (detalle.tipo === 'PROVEEDOR') {
        // Igual que en la captura del cajero: entra directo con la existencia
        // del momento (aunque sea 0).
        agregarLinea(p.codigo, p.nombre, p.existenciasTotal)
        return
      }
      // Validar contra la bodega que va a surtir (la del selector), no contra
      // el total global — con varias bodegas pueden no coincidir.
      let existencias = p.existenciasTotal
      const bodegaNombre = bodegas.find((b) => b.id === bodegaId)?.nombre ?? ''
      if (user && bodegaId) {
        try {
          existencias = await window.api.pedidos.existenciaBodega(user.id, p.codigo, bodegaId)
        } catch {
          // sin dato por bodega, se valida contra el global
        }
      }
      if (existencias <= 0) {
        toast.error(
          `"${p.nombre}" no tiene existencias${bodegaNombre ? ` en ${bodegaNombre}` : ''}`,
          { description: 'Sólo se pueden pedir productos con existencia en la bodega que surtirá.' }
        )
        return
      }
      setCapProducto({ codigo: p.codigo, nombre: p.nombre, existencias })
      setCapCodigo(p.codigo)
      setTimeout(() => {
        capCantidadRef.current?.focus()
        capCantidadRef.current?.select()
      }, 100)
    },
    [detalle, agregarLinea, user, bodegaId, bodegas]
  )

  const buscarCap = useCallback(async () => {
    const c = capCodigo.trim()
    if (!c) return
    // Sucursal: existencias de la bodega que surtirá; proveedor: global.
    const p = await window.api.productos.byCodigo(
      c,
      detalle?.tipo === 'PROVEEDOR' ? null : bodegaId || null
    )
    if (!p) {
      toast.error(`Producto "${c}" no encontrado`)
      return
    }
    await fijarProd(p)
  }, [capCodigo, detalle?.tipo, bodegaId, fijarProd])

  const agregarCapturado = useCallback(() => {
    if (!capProducto) {
      toast.error('Busca un producto primero')
      return
    }
    const n = Math.round(Number(capCantidad))
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Cantidad inválida (debe ser 1 o mayor)')
      return
    }
    // No pedir más de lo que la bodega que surtirá tiene (contando lo que el
    // pedido ya trae del mismo producto). Sólo aplica a pedidos de sucursal.
    if (detalle?.tipo !== 'PROVEEDOR') {
      const yaPedido = items.find((l) => l.codigo === capProducto.codigo)?.cantidad ?? 0
      if (n + yaPedido > capProducto.existencias) {
        const bodegaNombre = bodegas.find((b) => b.id === bodegaId)?.nombre ?? 'la bodega que surte'
        const disp = Math.max(0, capProducto.existencias - yaPedido)
        toast.error(`Sólo hay ${capProducto.existencias} en ${bodegaNombre}`, {
          description:
            yaPedido > 0
              ? `El pedido ya trae ${yaPedido} — disponible: ${disp}.`
              : 'No puedes pedir más de lo que esa bodega tiene.'
        })
        return
      }
    }
    agregarLinea(capProducto.codigo, capProducto.nombre, n)
  }, [capProducto, capCantidad, agregarLinea, detalle?.tipo, items, bodegas, bodegaId])

  // ↑/↓ con la tabla del detalle enfocada: sombrea renglones para revisar.
  const onKeyTabla = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const tgt = e.target as HTMLElement | null
    if (tgt instanceof HTMLInputElement || tgt instanceof HTMLSelectElement) return
    if (items.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    setSelRow((i) => (e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)))
  }

  useEffect(() => {
    if (selRow < 0) return
    const row = tbodyRef.current?.children[selRow] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [selRow])

  const editable = detalle?.estado === 'PENDIENTE'

  const setCantidad = (i: number, value: string): void => {
    if (!editable) return
    const n = Math.round(Number(value))
    setItems((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, cantidad: Number.isFinite(n) && n > 0 ? n : 0 } : l))
    )
    setDirty(true)
  }

  const quitarLinea = (i: number): void => {
    if (!editable) return
    setItems((prev) => prev.filter((_, idx) => idx !== i))
    setDirty(true)
  }

  const guardarCambios = useCallback(async (): Promise<PedidoTraspasoDto | null> => {
    if (!user || !detalle) return null
    // Proveedor: la cantidad es la EXISTENCIA del momento y puede ser 0.
    const limpio =
      detalle.tipo === 'PROVEEDOR' ? items : items.filter((l) => l.cantidad > 0)
    if (limpio.length === 0) {
      toast.error('El pedido quedaría sin productos — mejor recházalo')
      return null
    }
    const upd = await window.api.pedidos.update(user.id, detalle.id, limpio)
    setDetalle(upd)
    setItems(upd.items.map((l) => ({ ...l })))
    setDirty(false)
    await load()
    return upd
  }, [user, detalle, items, load])

  // Imprime copias del pedido UNA POR UNA (trabajos separados: el dúplex no
  // mezcla copias y cada hoja se numera por sí sola), con progreso. `copias`
  // son los ÍNDICES de copia a imprimir (SUCURSAL: 0 = sucursal destino,
  // 1 = ORIGINAL del propietario —ambas se imprimen al capturar—, 2 = ARCHIVO,
  // que sale al aprobar); undefined = la hoja única del proveedor.
  const imprimirHojas = useCallback(
    async (pedidoId: string, copias?: number[]): Promise<void> => {
      if (!user) return
      const idToast = `imp-${pedidoId}`
      const lista: (number | undefined)[] = copias ?? [undefined]
      const total = lista.length
      for (let n = 0; n < total; n++) {
        if (total > 1) toast.loading(`Imprimiendo hoja ${n + 1} de ${total}…`, { id: idToast })
        const pr = await window.api.pedidos.imprimir(user.id, pedidoId, lista[n])
        if (!pr.ok) {
          toast.dismiss(idToast)
          if (pr.cancelled) {
            toast.info(
              total > 1 ? `Impresión cancelada en la hoja ${n + 1} de ${total}` : 'Impresión cancelada'
            )
          } else {
            toast.error(
              total > 1 ? `Falló la hoja ${n + 1} de ${total}` : 'Falló la impresión',
              { description: pr.error }
            )
          }
          return
        }
      }
      toast.success(total === 1 ? 'Hoja del pedido impresa' : `${total} hojas impresas`, {
        id: idToast
      })
    },
    [user]
  )

  const onGuardar = useCallback(async () => {
    setBusy('guardar')
    try {
      const r = await guardarCambios()
      if (r) {
        if (r.tipo === 'PROVEEDOR') {
          toast.success('Cambios guardados', {
            description: 'La hoja del proveedor se imprime al aprobar.'
          })
        } else {
          // Pedido corregido → las 2 hojas impresas al capturar (sucursal y
          // ORIGINAL) ya no sirven. La de ARCHIVO sale al aprobar, ya corregida.
          toast.warning('Cambios guardados — hay que reimprimir las 2 hojas', {
            id: `reimp-aviso-${r.id}`,
            description:
              'Las hojas impresas antes de la corrección (sucursal y ORIGINAL) ya no coinciden. La de ARCHIVO se imprime al aprobar, ya corregida.',
            duration: 12000,
            action: { label: 'Imprimir 2 hojas', onClick: () => imprimirHojas(r.id, [0, 1]) }
          })
        }
      }
    } catch (e) {
      toast.error('No se pudieron guardar los cambios', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusy(null)
    }
  }, [guardarCambios, imprimirHojas])

  const reimprimir = useCallback(async () => {
    if (!user || !detalle) return
    setBusy('imprimir')
    try {
      // Si hay ediciones sin guardar, se guardan primero para que las hojas
      // salgan con lo que se ve en pantalla.
      if (dirty && editable) {
        const r = await guardarCambios()
        if (!r) return
      }
      // Proveedor: hoja única. Sucursal APROBADA: las 3 copias. Sucursal sin
      // aprobar: las 2 que ya salieron al capturar (la de ARCHIVO se imprime
      // hasta la aprobación).
      await imprimirHojas(
        detalle.id,
        detalle.tipo === 'PROVEEDOR'
          ? undefined
          : detalle.estado === 'APROBADO'
            ? [0, 1, 2]
            : [0, 1]
      )
    } catch (e) {
      toast.error('No se pudo imprimir', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusy(null)
    }
  }, [user, detalle, dirty, editable, guardarCambios, imprimirHojas])

  // PDF del pedido (para USB / envío digital), como en el historial.
  const guardarPdf = useCallback(async () => {
    if (!user || !detalle) return
    setBusy('pdf')
    try {
      if (dirty && editable) {
        const r = await guardarCambios()
        if (!r) return
      }
      const pr = await window.api.pedidos.pdf(user.id, detalle.id)
      if (pr.ok) toast.success('PDF guardado', { description: pr.path })
      else if (!pr.cancelled) toast.error('No se pudo generar el PDF', { description: pr.error })
    } catch (e) {
      toast.error('No se pudo generar el PDF', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusy(null)
    }
  }, [user, detalle, dirty, editable, guardarCambios])

  const rechazar = useCallback(() => {
    if (!user || !detalle) return
    toast.warning(`¿Rechazar el pedido P-${detalle.numero}?`, {
      id: 'pedido-rechazar',
      description: 'No se descuenta nada; el pedido queda marcado como rechazado.',
      duration: 8000,
      action: {
        label: 'Sí, rechazar',
        onClick: async () => {
          setBusy('rechazar')
          try {
            await window.api.pedidos.rechazar(user.id, detalle.id)
            toast.success(`Pedido P-${detalle.numero} rechazado`)
            setDetalle(null)
            await load()
            onDone?.()
          } catch (e) {
            toast.error('No se pudo rechazar', {
              description: e instanceof Error ? e.message : String(e)
            })
          } finally {
            setBusy(null)
          }
        }
      }
    })
  }, [user, detalle, load, onDone])

  const aprobar = useCallback(() => {
    if (!user || !detalle) return
    const esProveedor = detalle.tipo === 'PROVEEDOR'
    if (!esProveedor && !bodegaId) {
      toast.error('Selecciona la bodega que va a surtir')
      return
    }
    const bodegaNombre = bodegas.find((b) => b.id === bodegaId)?.nombre ?? 'la bodega'
    toast.warning(`¿Aprobar el pedido P-${detalle.numero}?`, {
      id: 'pedido-aprobar',
      description: esProveedor
        ? `Lista de compra para "${detalle.sucursalNombre}": sólo se marca aprobado (no toca inventario). Las existencias de la hoja se ponen al stock real de este momento. Registra la Entrada cuando el proveedor surta.`
        : `Se genera el traspaso real: descuenta FEFO de ${bodegaNombre} y crea el archivo .traspaso para "${detalle.sucursalNombre}".`,
      duration: 10000,
      action: {
        label: 'Sí, aprobar',
        onClick: async () => {
          setBusy('aprobar')
          try {
            if (dirty && editable) {
              const r = await guardarCambios()
              if (!r) return
            }
            const res = await window.api.pedidos.aprobar(user.id, detalle.id, bodegaId)
            if (res.ok) {
              toast.success(
                esProveedor
                  ? `Pedido P-${detalle.numero} aprobado (lista de compra)`
                  : `Pedido aprobado · traspaso T-${res.numero} generado`,
                {
                  description: esProveedor
                    ? 'Imprimiendo la hoja del proveedor · registra la Entrada cuando surta.'
                    : `Imprimiendo la hoja de ARCHIVO.${res.path ? ` · Archivo: ${res.path}` : ''}`,
                  duration: 10000
                }
              )
              // Lo que se imprime HASTA aprobar: proveedor → su hoja única;
              // sucursal → la copia de ARCHIVO (la de la sucursal y el
              // ORIGINAL ya se imprimieron al capturar el pedido).
              await imprimirHojas(detalle.id, esProveedor ? undefined : [2])
              setDetalle(null)
              await load()
              onDone?.()
            } else if (res.faltantes && res.faltantes.length > 0) {
              toast.error('Stock insuficiente — ajusta cantidades o rechaza', {
                description: res.faltantes
                  .map((f) => `${f.codigo}: pedido ${f.pedido}, disponible ${f.disponible}`)
                  .join(' · '),
                duration: 12000
              })
            } else if (!res.cancelled) {
              toast.error('No se pudo aprobar', { description: res.error })
            }
          } catch (e) {
            toast.error('No se pudo aprobar', {
              description: e instanceof Error ? e.message : String(e)
            })
          } finally {
            setBusy(null)
          }
        }
      }
    })
  }, [user, detalle, bodegaId, bodegas, dirty, editable, guardarCambios, imprimirHojas, load, onDone])

  const totalUnidades = items.reduce((s, l) => s + l.cantidad, 0)

  return (
    <>
    <Modal
      open={open && !resumenOpen && !searchOpen}
      title="Pedidos de sucursales"
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <div className="p-4 space-y-3 text-sm">
        {/* ── Lista ─────────────────────────────────────────────────────── */}
        {!detalle && (
          <>
            <p className="text-xs text-muted-foreground">
              Pedidos prellenados por las cajeras desde el punto de venta. Los de{' '}
              <strong>sucursal</strong> descuentan stock <strong>sólo al aprobar</strong> (generan
              el traspaso y el archivo <span className="font-mono">.traspaso</span>); los de{' '}
              <strong>proveedor</strong> son la lista de compra — al aprobar sólo se marcan y la
              mercancía entra después con una Entrada de mercancía.
            </p>
            <div className="border border-border rounded overflow-auto max-h-[55vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-16">Folio</th>
                    <th className="px-2 py-1.5 w-36">Fecha</th>
                    <th className="px-2 py-1.5">Sucursal</th>
                    <th className="px-2 py-1.5 w-32">Solicitó</th>
                    <th className="px-2 py-1.5 w-20 text-right">Líneas</th>
                    <th className="px-2 py-1.5 w-24 text-center">Estado</th>
                    <th className="px-2 py-1.5 w-24 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody ref={listaTbodyRef}>
                  {loading && (
                    <tr>
                      <td colSpan={7} className="px-2 py-8">
                        <span className="flex items-center justify-center">
                          <Spinner label="Cargando…" />
                        </span>
                      </td>
                    </tr>
                  )}
                  {!loading && pedidos.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-2 py-8 text-center text-muted-foreground italic">
                        No hay pedidos registrados.
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    pedidos.map((p, i) => (
                      <tr
                        key={p.id}
                        onClick={() => setListaSelRow(i)}
                        onDoubleClick={() => abrirDetalle(p)}
                        className={`border-b border-border/60 cursor-pointer ${
                          i === listaSelRow ? 'bg-primary/10' : 'hover:bg-muted/40'
                        }`}
                      >
                        <td className="px-2 py-1 font-mono">P-{p.numero}</td>
                        <td className="px-2 py-1 font-mono text-[11px]">
                          {new Date(p.fechaCreado).toLocaleString('es-MX')}
                        </td>
                        <td className="px-2 py-1">
                          {p.tipo === 'PROVEEDOR' && (
                            <span className="inline-block mr-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-violet-100 text-violet-900">
                              Proveedor
                            </span>
                          )}
                          {p.sucursalNombre}
                          {p.tipo === 'PROVEEDOR' && p.notas?.trim() && (
                            <div className="text-[11px] text-muted-foreground truncate max-w-[220px]">
                              Lista: «{p.notas}»
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1">{p.creadoNombre ?? '—'}</td>
                        <td className="px-2 py-1 text-right font-mono">{p.items.length}</td>
                        <td className="px-2 py-1 text-center">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              ESTADO_BADGE[p.estado] ?? 'bg-muted'
                            }`}
                          >
                            {p.estado}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => abrirDetalle(p)}
                            className="px-2 py-1 border border-border rounded cursor-pointer hover:bg-muted text-[11px]"
                          >
                            {p.estado === 'PENDIENTE' ? 'Revisar' : 'Ver'}
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Detalle / revisión ────────────────────────────────────────── */}
        {detalle && (
          <>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setDetalle(null)}
                className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline cursor-pointer"
              >
                <ChevronLeft className="size-3.5" /> Volver a la lista
              </button>
              <span
                className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                  ESTADO_BADGE[detalle.estado] ?? 'bg-muted'
                }`}
              >
                {detalle.estado}
              </span>
            </div>

            <div className="border border-border rounded p-3 bg-muted/10 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <div>
                <span className="text-muted-foreground">Folio: </span>
                <span className="font-mono font-semibold">P-{detalle.numero}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Fecha: </span>
                {new Date(detalle.fechaCreado).toLocaleString('es-MX')}
              </div>
              <div>
                <span className="text-muted-foreground">
                  {detalle.tipo === 'PROVEEDOR' ? 'Proveedor: ' : 'Sucursal destino: '}
                </span>
                <strong>{detalle.sucursalNombre}</strong>
                {detalle.tipo === 'PROVEEDOR' && (
                  <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-violet-100 text-violet-900">
                    Pedido de compra
                  </span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Solicitó: </span>
                {detalle.creadoNombre ?? '—'}
              </div>
              {detalle.tipo !== 'PROVEEDOR' && detalle.bodegaNombre && (
                <div>
                  <span className="text-muted-foreground">Bodega elegida al capturar: </span>
                  {detalle.bodegaNombre}
                </div>
              )}
              {detalle.notas && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Notas: </span>
                  {detalle.notas}
                </div>
              )}
              {detalle.revisadoNombre && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Revisó: </span>
                  {detalle.revisadoNombre}
                  {detalle.fechaRevision &&
                    ` · ${new Date(detalle.fechaRevision).toLocaleString('es-MX')}`}
                </div>
              )}
            </div>

            {/* Agregar productos (corrección durante la revisión) */}
            {editable && (
              <div className="border border-border rounded p-3 bg-muted/10">
                <div
                  className={`grid gap-2 items-end ${
                    detalle.tipo === 'PROVEEDOR'
                      ? 'grid-cols-[1fr_auto_auto]'
                      : 'grid-cols-[1fr_110px_auto_auto]'
                  }`}
                >
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      Agregar producto{' '}
                      <span className="font-mono">(Enter busca · F5 abre búsqueda)</span>
                    </label>
                    <input
                      ref={capCodigoRef}
                      type="text"
                      value={capCodigo}
                      onChange={(e) => setCapCodigo(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          buscarCap()
                        } else if (e.key === 'F5') {
                          e.preventDefault()
                          setSearchOpen(true)
                        }
                      }}
                      placeholder="EAN-13 o SKU interno…"
                      autoComplete="off"
                      className="w-full border border-border rounded px-2 py-1.5 font-mono"
                    />
                  </div>
                  {detalle.tipo !== 'PROVEEDOR' && (
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Cantidad</label>
                      <input
                        ref={capCantidadRef}
                        type="number"
                        min={1}
                        value={capCantidad}
                        onChange={(e) => setCapCantidad(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            agregarCapturado()
                          }
                        }}
                        className="w-full border border-border rounded px-2 py-1.5 font-mono text-right"
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setSearchOpen(true)}
                    className="px-3 py-1.5 border border-border rounded cursor-pointer hover:bg-muted inline-flex items-center gap-1.5"
                  >
                    <Search className="size-3.5" /> Buscar (F5)
                  </button>
                  <button
                    type="button"
                    onClick={agregarCapturado}
                    disabled={detalle.tipo === 'PROVEEDOR'}
                    className="px-4 py-1.5 bg-primary text-primary-foreground rounded cursor-pointer hover:opacity-90 disabled:opacity-50 font-medium"
                  >
                    Agregar
                  </button>
                </div>
                {capProducto && (
                  <div className="text-[11px] text-muted-foreground mt-1.5 truncate">
                    Producto:{' '}
                    <span className="text-foreground font-medium">{capProducto.nombre}</span>
                    {' · '}existencia: {capProducto.existencias}
                  </div>
                )}
              </div>
            )}

            {/* Lista a proveedor: aviso de existencias desactualizadas + botón */}
            {detalle.tipo === 'PROVEEDOR' &&
              editable &&
              (desactualizadas.length > 0 ? (
                <div className="flex items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <span>
                    <strong>
                      {desactualizadas.length} producto{desactualizadas.length === 1 ? '' : 's'}
                    </strong>{' '}
                    con existencia desactualizada: hubo ventas o traspasos después de capturarlos
                    (en cada renglón se muestra la existencia de ahora).
                  </span>
                  <button
                    type="button"
                    onClick={actualizarExistencias}
                    className="shrink-0 px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 cursor-pointer font-semibold"
                  >
                    Actualizar existencias
                  </button>
                </div>
              ) : actuales ? (
                <div className="text-[11px] text-muted-foreground">
                  Existencias al día con el stock actual. Al aprobar se vuelven a verificar antes
                  de imprimir la hoja.
                </div>
              ) : null)}

            <div
              ref={tablaRef}
              tabIndex={0}
              onKeyDown={onKeyTabla}
              title="Con la tabla enfocada: ↑/↓ recorren y sombrean los renglones"
              className="border border-border rounded overflow-auto max-h-[42vh] focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40 border-b border-border z-10">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-8 text-right">#</th>
                    <th className="px-2 py-1.5 w-32 font-mono">Código</th>
                    <th className="px-2 py-1.5">Producto</th>
                    <th className="px-2 py-1.5 w-28 text-right">
                      {detalle.tipo === 'PROVEEDOR' ? 'Existencia' : 'Cantidad'}
                    </th>
                    {editable && <th className="px-2 py-1.5 w-10"></th>}
                  </tr>
                </thead>
                <tbody ref={tbodyRef}>
                  {items.map((l, i) => (
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
                        {editable ? (
                          <>
                            <input
                              type="number"
                              min={detalle.tipo === 'PROVEEDOR' ? 0 : 1}
                              value={detalle.tipo === 'PROVEEDOR' ? l.cantidad : l.cantidad || ''}
                              onChange={(e) => setCantidad(i, e.target.value)}
                              className={`w-20 border rounded px-1.5 py-1 font-mono text-right ${
                                detalle.tipo === 'PROVEEDOR' &&
                                actuales &&
                                actuales[l.codigo] !== undefined &&
                                actuales[l.codigo] !== l.cantidad
                                  ? 'border-amber-400 bg-amber-50'
                                  : 'border-border'
                              }`}
                            />
                            {detalle.tipo === 'PROVEEDOR' &&
                              actuales &&
                              actuales[l.codigo] !== undefined &&
                              actuales[l.codigo] !== l.cantidad && (
                                <div className="text-[10px] text-amber-700 text-right font-mono">
                                  ahora: {actuales[l.codigo]}
                                </div>
                              )}
                          </>
                        ) : (
                          <span className="font-mono">{l.cantidad}</span>
                        )}
                      </td>
                      {editable && (
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
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-2 text-xs">
              <div className="font-mono">
                {items.length} línea{items.length === 1 ? '' : 's'} ·{' '}
                <strong>{totalUnidades.toLocaleString('es-MX')} unidades</strong>
                {dirty && <span className="ml-2 text-amber-700 font-semibold">(sin guardar)</span>}
              </div>
              {editable && detalle.tipo !== 'PROVEEDOR' && (
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-0.5">
                    Bodega que surte (al aprobar)
                  </label>
                  <select
                    value={bodegaId}
                    onChange={(e) => {
                      setBodegaId(e.target.value)
                      // El producto a medio capturar traía existencias de la
                      // otra bodega — se descarta la captura en curso.
                      setCapProducto(null)
                      setCapCodigo('')
                      setCapCantidad('')
                    }}
                    className="border border-border rounded px-2 py-1 bg-background"
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
            </div>
          </>
        )}
      </div>

      <footer className="flex justify-between items-center px-4 py-3 border-t border-border bg-muted/20">
        <div>
          {detalle ? (
            // Proveedor PENDIENTE: sin impresión ni PDF — salen hasta aprobar.
            detalle.tipo === 'PROVEEDOR' && detalle.estado === 'PENDIENTE' ? (
              <span className="text-xs text-muted-foreground">
                La hoja del proveedor se imprime (o genera en PDF) al aprobar.
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={guardarPdf}
                  disabled={busy !== null}
                  title="Guardar como PDF (para USB o mandar por digital)"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded cursor-pointer hover:bg-muted disabled:opacity-50 text-sm"
                >
                  {busy === 'pdf' ? <Spinner size={14} /> : <FileText className="size-3.5" />}
                  Guardar PDF
                </button>
                <button
                  type="button"
                  onClick={reimprimir}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded cursor-pointer hover:bg-muted disabled:opacity-50 text-sm"
                >
                  {busy === 'imprimir' ? <Spinner size={14} /> : <Printer className="size-3.5" />}
                  {detalle.tipo === 'PROVEEDOR'
                    ? 'Reimprimir hoja'
                    : detalle.estado === 'APROBADO'
                      ? 'Reimprimir 3 hojas'
                      : 'Reimprimir 2 hojas'}
                </button>
              </span>
            )
          ) : (
            <button
              type="button"
              onClick={() => setResumenOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded cursor-pointer hover:bg-muted text-sm"
              title="Consolidado de los traspasos del periodo: productos sin repetir, enviado y existencia"
            >
              <CalendarDays className="size-3.5" />
              Resumen de surtido…
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {detalle && editable && (
            <>
              <button
                type="button"
                onClick={onGuardar}
                disabled={busy !== null || !dirty}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded cursor-pointer hover:bg-muted disabled:opacity-50 text-sm"
              >
                {busy === 'guardar' && <Spinner size={14} />}
                Guardar cambios
              </button>
              <button
                type="button"
                onClick={rechazar}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-300 text-red-800 rounded cursor-pointer hover:bg-red-50 disabled:opacity-50 text-sm"
              >
                {busy === 'rechazar' ? <Spinner size={14} /> : <XCircle className="size-3.5" />}
                Rechazar
              </button>
              <button
                type="button"
                onClick={aprobar}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground rounded cursor-pointer hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
              >
                {busy === 'aprobar' ? <Spinner size={14} /> : <CheckCircle2 className="size-3.5" />}
                {detalle.tipo === 'PROVEEDOR' ? 'Aprobar pedido' : 'Aprobar y generar traspaso'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 border border-border rounded cursor-pointer hover:bg-muted text-sm"
          >
            Cerrar
          </button>
        </div>
      </footer>
    </Modal>

    <SearchModal
      open={searchOpen}
      onClose={() => setSearchOpen(false)}
      onSelect={fijarProd}
      // Proveedor: la lista de faltantes incluye productos en cero; sucursal
      // sólo con existencia (igual que la captura del cajero).
      allowZeroStock={detalle?.tipo === 'PROVEEDOR'}
      // Sucursal: "Exist." = stock de la bodega que surtirá; proveedor: global.
      bodegaId={detalle?.tipo === 'PROVEEDOR' ? null : bodegaId || null}
      returnFocus={() =>
        setTimeout(
          () =>
            (detalle?.tipo === 'PROVEEDOR' ? capCodigoRef : capCantidadRef).current?.focus(),
          100
        )
      }
    />

    <ResumenSurtidoModal open={resumenOpen} onClose={() => setResumenOpen(false)} />
    </>
  )
}
