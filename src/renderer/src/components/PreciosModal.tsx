import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Download, Trash2, Upload } from 'lucide-react'
import Papa from 'papaparse'
import Modal from './Modal'
import SearchModal from './SearchModal'
import InfoTooltip from './InfoTooltip'
import Spinner from './Spinner'
import { money } from '../lib/format'
import { calcFromBase } from '@shared/iva'
import type { ProductoDto, UpdateIvaItemInput, UpdatePrecioItemInput } from '@shared/dto'
import type { IvaModo, MotivoPrecio } from '@shared/types'

const VALID_MOTIVOS: MotivoPrecio[] = ['CAMBIO_LISTA', 'PROMOCION', 'CORRECCION', 'OTRO']
const VALID_IVA_MODOS: IvaModo[] = ['exento', 'sumar', 'incluido']
const DEFAULT_IVA_PORCENTAJE = 16

interface Props {
  open: boolean
  onClose: () => void
  userId: string
}

type Tab = 'precios' | 'iva'

const MOTIVO_OPTIONS: { value: MotivoPrecio; label: string; hint: string }[] = [
  {
    value: 'CAMBIO_LISTA',
    label: 'Cambio de lista',
    hint: 'El proveedor subió/bajó precios (lista nueva)'
  },
  { value: 'PROMOCION', label: 'Promoción', hint: 'Rebaja temporal' },
  { value: 'CORRECCION', label: 'Corrección', hint: 'El precio estaba mal' },
  { value: 'OTRO', label: 'Otro', hint: 'Usa el campo de nota para explicar' }
]

const IVA_MODO_OPTIONS: { value: IvaModo; label: string; hint: string }[] = [
  { value: 'exento', label: 'Exento', hint: 'No lleva IVA (tasa 0%)' },
  {
    value: 'sumar',
    label: 'Se suma al precio',
    hint: 'El precio capturado es neto; el IVA se agrega al cobrar'
  },
  {
    value: 'incluido',
    label: 'Ya incluido en el precio',
    hint: 'El precio de etiqueta ya trae IVA; se desglosa del total'
  }
]

function labelModo(m: IvaModo): string {
  return IVA_MODO_OPTIONS.find((o) => o.value === m)?.label ?? m
}

export default function PreciosModal({ open, onClose, userId }: Props) {
  const [tab, setTab] = useState<Tab>('precios')

  // ── Precios ──────────────────────────────────────────────────────────────
  const [items, setItems] = useState<UpdatePrecioItemInput[]>([])
  const [current, setCurrent] = useState<ProductoDto | null>(null)
  const [codigo, setCodigo] = useState('')
  const [nuevoPrecio, setNuevoPrecio] = useState('')
  const [motivo, setMotivo] = useState<MotivoPrecio>('CAMBIO_LISTA')
  const [nota, setNota] = useState('')
  // IVA editable también desde la pestaña Precios (con preview, como en Editar producto)
  const [precioIvaModo, setPrecioIvaModo] = useState<IvaModo>('exento')
  const [precioIvaPct, setPrecioIvaPct] = useState<string>(String(DEFAULT_IVA_PORCENTAJE))
  const [saving, setSaving] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const codRef = useRef<HTMLInputElement>(null)
  const precioRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  // ── IVA ──────────────────────────────────────────────────────────────────
  const [ivaItems, setIvaItems] = useState<UpdateIvaItemInput[]>([])
  const [ivaCurrent, setIvaCurrent] = useState<ProductoDto | null>(null)
  const [ivaCodigo, setIvaCodigo] = useState('')
  const [ivaModoSel, setIvaModoSel] = useState<IvaModo>('exento')
  const [ivaPctInput, setIvaPctInput] = useState<string>(String(DEFAULT_IVA_PORCENTAJE))
  const [savingIva, setSavingIva] = useState(false)
  const [importingIva, setImportingIva] = useState(false)
  const ivaCodRef = useRef<HTMLInputElement>(null)
  const ivaFileRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setTab('precios')
    setItems([])
    setCurrent(null)
    setCodigo('')
    setNuevoPrecio('')
    setMotivo('CAMBIO_LISTA')
    setNota('')
    setIvaItems([])
    setIvaCurrent(null)
    setIvaCodigo('')
    setIvaModoSel('exento')
    setIvaPctInput(String(DEFAULT_IVA_PORCENTAJE))
  }, [])

  const resetRow = useCallback(() => {
    setCurrent(null)
    setCodigo('')
    setNuevoPrecio('')
    setNota('')
    setPrecioIvaModo('exento')
    setPrecioIvaPct(String(DEFAULT_IVA_PORCENTAJE))
    setTimeout(() => codRef.current?.focus(), 30)
  }, [])

  const resetIvaRow = useCallback(() => {
    setIvaCurrent(null)
    setIvaCodigo('')
    setIvaModoSel('exento')
    setIvaPctInput(String(DEFAULT_IVA_PORCENTAJE))
    setTimeout(() => ivaCodRef.current?.focus(), 30)
  }, [])

  useEffect(() => {
    if (!open) return
    reset()
    setTimeout(() => codRef.current?.focus(), 80)
  }, [open, reset])

  useEffect(() => {
    if (!open) return
    if (tab === 'precios') setTimeout(() => codRef.current?.focus(), 30)
    else setTimeout(() => ivaCodRef.current?.focus(), 30)
  }, [tab, open])

  // ── Precios: captura ─────────────────────────────────────────────────────
  const setFromProduct = useCallback((p: ProductoDto) => {
    setCurrent(p)
    setCodigo(p.codigo)
    setNuevoPrecio(String(p.precio.toFixed(2)))
    setPrecioIvaModo(p.ivaModo)
    setPrecioIvaPct(
      p.ivaModo === 'exento'
        ? String(DEFAULT_IVA_PORCENTAJE)
        : String(p.ivaPorcentaje || DEFAULT_IVA_PORCENTAJE)
    )
    setTimeout(() => {
      precioRef.current?.focus()
      precioRef.current?.select()
    }, 30)
  }, [])

  const lookupByCode = useCallback(async () => {
    const c = codigo.trim()
    if (!c) return
    const p = await window.api.productos.byCodigo(c)
    if (!p) {
      toast.error(`Producto "${c}" no encontrado`)
      return
    }
    setFromProduct(p)
  }, [codigo, setFromProduct])

  const addItem = useCallback(() => {
    if (!current) {
      toast.error('Busca un producto primero')
      return
    }
    const nuevo = Math.round(parseFloat(nuevoPrecio) * 100) / 100
    if (!Number.isFinite(nuevo) || nuevo < 0) {
      toast.error('Precio inválido')
      return
    }
    const pct =
      precioIvaModo === 'exento'
        ? 0
        : Math.max(0, Math.min(100, Math.round(Number(precioIvaPct) || 0)))
    const precioCambio = nuevo !== current.precio
    const ivaCambio = precioIvaModo !== current.ivaModo || pct !== current.ivaPorcentaje
    if (!precioCambio && !ivaCambio) {
      toast.warning('No hay cambios (precio e IVA iguales a los actuales)')
      return
    }

    // Cambio de precio → lista de precios
    if (precioCambio) {
      setItems((prev) => {
        const existing = prev.findIndex((x) => x.productoId === current.id)
        const row: UpdatePrecioItemInput = {
          productoId: current.id,
          productoNombre: current.nombre,
          codigo: current.codigo,
          precioAnterior: current.precio,
          nuevoPrecio: nuevo,
          motivo,
          nota: nota.trim() || null
        }
        if (existing >= 0) {
          const next = [...prev]
          next[existing] = row
          return next
        }
        return [...prev, row]
      })
    }

    // Cambio de IVA → lista de IVA (se aplica junto con los precios al guardar)
    if (ivaCambio) {
      setIvaItems((prev) => {
        const existing = prev.findIndex((x) => x.productoId === current.id)
        const row: UpdateIvaItemInput = {
          productoId: current.id,
          productoNombre: current.nombre,
          codigo: current.codigo,
          ivaModoAnterior: current.ivaModo,
          ivaPorcentajeAnterior: current.ivaPorcentaje,
          nuevoModo: precioIvaModo,
          nuevoPorcentaje: pct
        }
        if (existing >= 0) {
          const next = [...prev]
          next[existing] = row
          return next
        }
        return [...prev, row]
      })
    }

    resetRow()
  }, [current, nuevoPrecio, precioIvaModo, precioIvaPct, motivo, nota, resetRow])

  const removeItem = useCallback((i: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }, [])

  // ── IVA: captura ─────────────────────────────────────────────────────────
  const setFromProductIva = useCallback((p: ProductoDto) => {
    setIvaCurrent(p)
    setIvaCodigo(p.codigo)
    setIvaModoSel(p.ivaModo)
    setIvaPctInput(
      p.ivaModo === 'exento'
        ? String(DEFAULT_IVA_PORCENTAJE)
        : String(p.ivaPorcentaje || DEFAULT_IVA_PORCENTAJE)
    )
  }, [])

  const lookupIvaByCode = useCallback(async () => {
    const c = ivaCodigo.trim()
    if (!c) return
    const p = await window.api.productos.byCodigo(c)
    if (!p) {
      toast.error(`Producto "${c}" no encontrado`)
      return
    }
    setFromProductIva(p)
  }, [ivaCodigo, setFromProductIva])

  const addIvaItem = useCallback(() => {
    if (!ivaCurrent) {
      toast.error('Busca un producto primero')
      return
    }
    const pct =
      ivaModoSel === 'exento'
        ? 0
        : Math.max(0, Math.min(100, Math.round(Number(ivaPctInput) || 0)))
    if (ivaModoSel !== 'exento' && !Number.isFinite(Number(ivaPctInput))) {
      toast.error('Porcentaje de IVA inválido')
      return
    }
    if (ivaCurrent.ivaModo === ivaModoSel && ivaCurrent.ivaPorcentaje === pct) {
      toast.warning('La configuración es igual a la actual')
      return
    }
    setIvaItems((prev) => {
      const existing = prev.findIndex((x) => x.productoId === ivaCurrent.id)
      const row: UpdateIvaItemInput = {
        productoId: ivaCurrent.id,
        productoNombre: ivaCurrent.nombre,
        codigo: ivaCurrent.codigo,
        ivaModoAnterior: ivaCurrent.ivaModo,
        ivaPorcentajeAnterior: ivaCurrent.ivaPorcentaje,
        nuevoModo: ivaModoSel,
        nuevoPorcentaje: pct
      }
      if (existing >= 0) {
        const next = [...prev]
        next[existing] = row
        return next
      }
      return [...prev, row]
    })
    resetIvaRow()
  }, [ivaCurrent, ivaModoSel, ivaPctInput, resetIvaRow])

  const removeIvaItem = useCallback((i: number) => {
    setIvaItems((prev) => prev.filter((_, idx) => idx !== i))
  }, [])

  // ── CSV (precios) ────────────────────────────────────────────────────────
  const escapeCsv = (v: string): string => {
    if (v.includes('"') || v.includes(',') || v.includes('\n') || v.includes('\r')) {
      return '"' + v.replace(/"/g, '""') + '"'
    }
    return v
  }

  const downloadCSV = useCallback(async () => {
    try {
      const all = await window.api.productos.getAllActivos()
      const header = 'codigo,nombre,precio,iva_modo,iva_porcentaje,motivo,nota'
      const lines = all.map(
        (p) =>
          `${escapeCsv(p.codigo)},${escapeCsv(p.nombre)},${p.precio.toFixed(2)},${p.ivaModo},${
            p.ivaModo === 'exento' ? 0 : p.ivaPorcentaje
          },,`
      )
      const content = '﻿' + [header, ...lines].join('\r\n')
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const today = new Date().toISOString().slice(0, 10)
      const a = document.createElement('a')
      a.href = url
      a.download = `precios-farmacias-ms-${today}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`Plantilla descargada con ${all.length.toLocaleString('es-MX')} productos`, {
        description:
          'Edita "precio" y/o el IVA (iva_modo: exento, sumar, incluido · iva_porcentaje 0–100) y vuelve a cargar.'
      })
    } catch (e) {
      toast.error('No pude descargar la plantilla', {
        description: e instanceof Error ? e.message : String(e)
      })
    }
  }, [])

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
      if (parsed.errors.length > 0) {
        console.warn('CSV parse errors:', parsed.errors)
      }

      const rows = parsed.data.filter((r) => r.codigo && r.codigo.trim())
      if (rows.length === 0) {
        toast.error('El CSV no tiene filas válidas', {
          description: 'Verifica el encabezado: codigo,nombre,precio,iva_modo,iva_porcentaje,motivo,nota'
        })
        return
      }

      const all = await window.api.productos.getAllActivos()
      const byCodigo = new Map(all.map((p) => [p.codigo, p]))

      let priceAdded = 0
      let ivaAdded = 0
      let unchanged = 0
      const notFound: string[] = []
      const invalid: string[] = []
      const newItems: UpdatePrecioItemInput[] = []
      const newIvaItems: UpdateIvaItemInput[] = []

      for (const row of rows) {
        const codigo = (row.codigo ?? '').trim()
        if (!codigo) continue

        const prod = byCodigo.get(codigo)
        if (!prod) {
          notFound.push(codigo)
          continue
        }

        let touched = false

        // ── Precio (sólo si la columna trae valor) ──────────────────────────
        const precioStr = (row.precio ?? '').trim()
        if (precioStr !== '') {
          const nuevo = Math.round(parseFloat(precioStr) * 100) / 100
          if (!Number.isFinite(nuevo) || nuevo < 0) {
            invalid.push(`${codigo} (precio)`)
          } else if (nuevo !== prod.precio) {
            const motivoRaw = (row.motivo ?? '').trim().toUpperCase() as MotivoPrecio
            const motivo: MotivoPrecio = VALID_MOTIVOS.includes(motivoRaw)
              ? motivoRaw
              : 'CAMBIO_LISTA'
            const nota = (row.nota ?? '').trim() || null
            newItems.push({
              productoId: prod.id,
              productoNombre: prod.nombre,
              codigo: prod.codigo,
              precioAnterior: prod.precio,
              nuevoPrecio: nuevo,
              motivo,
              nota
            })
            priceAdded++
            touched = true
          }
        }

        // ── IVA (sólo si la plantilla trae la columna iva_modo) ─────────────
        const modoStr = (row.iva_modo ?? '').trim().toLowerCase()
        if (modoStr !== '') {
          const modo = modoStr as IvaModo
          if (!VALID_IVA_MODOS.includes(modo)) {
            invalid.push(`${codigo} (iva_modo)`)
          } else {
            const pctNum = Math.max(
              0,
              Math.min(100, Math.round(Number((row.iva_porcentaje ?? '').trim()) || 0))
            )
            const pct = modo === 'exento' ? 0 : pctNum
            if (modo !== prod.ivaModo || pct !== prod.ivaPorcentaje) {
              newIvaItems.push({
                productoId: prod.id,
                productoNombre: prod.nombre,
                codigo: prod.codigo,
                ivaModoAnterior: prod.ivaModo,
                ivaPorcentajeAnterior: prod.ivaPorcentaje,
                nuevoModo: modo,
                nuevoPorcentaje: pct
              })
              ivaAdded++
              touched = true
            }
          }
        }

        if (!touched) unchanged++
      }

      setItems((prev) => {
        const keep = prev.filter((p) => !newItems.some((n) => n.productoId === p.productoId))
        return [...keep, ...newItems]
      })
      setIvaItems((prev) => {
        const keep = prev.filter((p) => !newIvaItems.some((n) => n.productoId === p.productoId))
        return [...keep, ...newIvaItems]
      })

      const parts: string[] = []
      parts.push(`${priceAdded} precio${priceAdded === 1 ? '' : 's'}`)
      parts.push(`${ivaAdded} IVA`)
      if (unchanged > 0) parts.push(`${unchanged} sin cambios`)
      if (notFound.length > 0)
        parts.push(`${notFound.length} no encontrado${notFound.length === 1 ? '' : 's'}`)
      if (invalid.length > 0)
        parts.push(`${invalid.length} inválido${invalid.length === 1 ? '' : 's'}`)

      if (priceAdded > 0 || ivaAdded > 0) {
        toast.success('CSV procesado', { description: parts.join(' · ') })
      } else {
        toast.warning('No se encontraron cambios para aplicar', { description: parts.join(' · ') })
      }

      if (notFound.length > 0) console.warn('[csv] Códigos no encontrados:', notFound.slice(0, 50))
      if (invalid.length > 0) console.warn('[csv] Valores inválidos:', invalid.slice(0, 50))
    } catch (err) {
      toast.error('Error leyendo CSV', {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setImporting(false)
    }
  }, [])

  // ── CSV (IVA) ────────────────────────────────────────────────────────────
  const downloadIvaCSV = useCallback(async () => {
    try {
      const all = await window.api.productos.getAllActivos()
      const header = 'codigo,nombre,iva_modo,iva_porcentaje'
      const lines = all.map(
        (p) =>
          `${escapeCsv(p.codigo)},${escapeCsv(p.nombre)},${p.ivaModo},${
            p.ivaModo === 'exento' ? 0 : p.ivaPorcentaje
          }`
      )
      const content = '﻿' + [header, ...lines].join('\r\n')
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const today = new Date().toISOString().slice(0, 10)
      const a = document.createElement('a')
      a.href = url
      a.download = `iva-farmacias-ms-${today}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`Plantilla descargada con ${all.length.toLocaleString('es-MX')} productos`, {
        description: 'Valores válidos para iva_modo: exento, sumar, incluido.'
      })
    } catch (e) {
      toast.error('No pude descargar la plantilla', {
        description: e instanceof Error ? e.message : String(e)
      })
    }
  }, [])

  const onIvaFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setImportingIva(true)
    try {
      const text = await file.text()
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase()
      })
      if (parsed.errors.length > 0) console.warn('CSV parse errors:', parsed.errors)

      const rows = parsed.data.filter((r) => r.codigo && r.codigo.trim())
      if (rows.length === 0) {
        toast.error('El CSV no tiene filas válidas', {
          description: 'Verifica el encabezado: codigo,nombre,iva_modo,iva_porcentaje'
        })
        return
      }

      const all = await window.api.productos.getAllActivos()
      const byCodigo = new Map(all.map((p) => [p.codigo, p]))

      let added = 0
      let unchanged = 0
      const notFound: string[] = []
      const invalid: string[] = []
      const newItems: UpdateIvaItemInput[] = []

      for (const row of rows) {
        const codigo = (row.codigo ?? '').trim()
        if (!codigo) continue

        const prod = byCodigo.get(codigo)
        if (!prod) {
          notFound.push(codigo)
          continue
        }

        const modoRaw = (row.iva_modo ?? '').trim().toLowerCase() as IvaModo
        if (!VALID_IVA_MODOS.includes(modoRaw)) {
          invalid.push(codigo)
          continue
        }
        const pctRaw = (row.iva_porcentaje ?? '').trim()
        const pctNum = Math.max(0, Math.min(100, Math.round(Number(pctRaw) || 0)))
        const pct = modoRaw === 'exento' ? 0 : pctNum

        if (modoRaw === prod.ivaModo && pct === prod.ivaPorcentaje) {
          unchanged++
          continue
        }

        newItems.push({
          productoId: prod.id,
          productoNombre: prod.nombre,
          codigo: prod.codigo,
          ivaModoAnterior: prod.ivaModo,
          ivaPorcentajeAnterior: prod.ivaPorcentaje,
          nuevoModo: modoRaw,
          nuevoPorcentaje: pct
        })
        added++
      }

      setIvaItems((prev) => {
        const keep = prev.filter((p) => !newItems.some((n) => n.productoId === p.productoId))
        return [...keep, ...newItems]
      })

      const parts: string[] = []
      parts.push(`${added} cambio${added === 1 ? '' : 's'} cargado${added === 1 ? '' : 's'}`)
      if (unchanged > 0) parts.push(`${unchanged} sin cambios`)
      if (notFound.length > 0)
        parts.push(`${notFound.length} código${notFound.length === 1 ? '' : 's'} no encontrado${notFound.length === 1 ? '' : 's'}`)
      if (invalid.length > 0)
        parts.push(`${invalid.length} modo${invalid.length === 1 ? '' : 's'} inválido${invalid.length === 1 ? '' : 's'}`)

      if (added > 0) toast.success('CSV procesado', { description: parts.join(' · ') })
      else toast.warning('No se encontraron cambios para aplicar', { description: parts.join(' · ') })

      if (notFound.length > 0) console.warn('[csv-iva] Códigos no encontrados:', notFound.slice(0, 50))
      if (invalid.length > 0) console.warn('[csv-iva] Modos inválidos:', invalid.slice(0, 50))
    } catch (err) {
      toast.error('Error leyendo CSV', {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setImportingIva(false)
    }
  }, [])

  // ── Save ─────────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (items.length === 0 && ivaItems.length === 0) {
      toast.error('No hay cambios que registrar')
      return
    }
    setSaving(true)
    try {
      let nPrecios = 0
      let nIva = 0
      if (items.length > 0) {
        const r = await window.api.precios.update({ cajeroId: userId, items })
        nPrecios = r.actualizados
      }
      // Si la carga masiva trajo cambios de IVA, se aplican en el mismo paso.
      if (ivaItems.length > 0) {
        const r2 = await window.api.productos.updateIva({ cajeroId: userId, items: ivaItems })
        nIva = r2.actualizados
      }
      toast.success('Cambios aplicados', {
        description: `Precios: ${nPrecios} (con histórico) · IVA: ${nIva}`
      })
      onClose()
    } catch (e) {
      toast.error('Falló el guardado', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setSaving(false)
    }
  }, [items, ivaItems, userId, onClose])

  const saveIva = useCallback(async () => {
    if (ivaItems.length === 0) {
      toast.error('No hay cambios de IVA que registrar')
      return
    }
    setSavingIva(true)
    try {
      const r = await window.api.productos.updateIva({ cajeroId: userId, items: ivaItems })
      toast.success(`Productos con IVA actualizado: ${r.actualizados}`)
      onClose()
    } catch (e) {
      toast.error('Falló el guardado', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setSavingIva(false)
    }
  }, [ivaItems, userId, onClose])

  // ── Key handlers ─────────────────────────────────────────────────────────
  const onKeyCode = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      lookupByCode()
    } else if (e.key === 'F5') {
      e.preventDefault()
      setSearchOpen(true)
    }
  }
  const onKeyPrecio = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addItem()
    }
  }
  const onKeyIvaCode = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      lookupIvaByCode()
    } else if (e.key === 'F5') {
      e.preventDefault()
      setSearchOpen(true)
    }
  }
  const onKeyIvaPct = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addIvaItem()
    }
  }

  const preciosCambiados = items.filter((i) => i.nuevoPrecio !== i.precioAnterior)
  const subidas = preciosCambiados.filter((i) => i.nuevoPrecio > i.precioAnterior).length
  const bajadas = preciosCambiados.filter((i) => i.nuevoPrecio < i.precioAnterior).length

  // Preview del precio según el IVA (misma lógica que "Editar producto" y el POS)
  const precioPrevNum = Number(nuevoPrecio)
  const precioPrevPct = precioIvaModo === 'exento' ? 0 : Number(precioIvaPct || '0')
  const precioPrevOk =
    !!current && nuevoPrecio.trim() !== '' && Number.isFinite(precioPrevNum) && precioPrevNum >= 0
  const desglosePrecio = precioPrevOk
    ? calcFromBase(precioPrevNum, precioPrevPct, precioIvaModo)
    : null

  const isIva = tab === 'iva'
  const saveBusy = isIva ? savingIva : saving
  const saveDisabled = isIva
    ? savingIva || ivaItems.length === 0
    : saving || (items.length === 0 && ivaItems.length === 0)
  const saveLabel = isIva
    ? savingIva
      ? 'Guardando…'
      : 'Aplicar cambios de IVA'
    : saving
      ? 'Guardando…'
      : 'Aplicar cambios'

  return (
    <>
      <Modal
        open={open && !searchOpen}
        title="Precios e IVA"
        onClose={onClose}
        maxWidth="max-w-4xl"
      >
        <div className="px-4 pt-3 border-b border-border bg-background">
          <div className="flex gap-1 text-xs">
            {(['precios', 'iva'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-t border-b-2 -mb-px ${
                  tab === t
                    ? 'border-primary text-foreground font-semibold'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'precios' ? 'Precios' : 'IVA por producto'}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4 text-sm space-y-4 max-h-[75vh] overflow-y-auto">
          {tab === 'precios' && (
            <>
              <section className="border border-dashed border-border rounded p-3 bg-muted/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 text-xs">
                    <div className="font-semibold mb-0.5">Actualización masiva por CSV (precio e IVA)</div>
                    <p className="text-muted-foreground">
                      Descarga la plantilla con todos los productos (precio e IVA actuales). En Excel
                      edita <span className="font-mono">precio</span> y/o el IVA:{' '}
                      <span className="font-mono">iva_modo</span> (exento, sumar, incluido) y{' '}
                      <span className="font-mono">iva_porcentaje</span>. Vuelve a cargarla y aplica;
                      el precio queda con histórico de auditoría.
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
                      {importing ? <Spinner size={14} /> : <Upload className="size-3.5" />}
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

              <section className="border border-border rounded p-3 bg-muted/10 space-y-3">
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      Código o nombre{' '}
                      <span className="font-mono">(Enter busca · F5 abre búsqueda)</span>
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
                      Precio actual:{' '}
                      <span className="font-mono font-semibold">${money(current.precio)}</span>
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-[200px_1fr] gap-2">
                  <div>
                    <label className="flex items-center text-xs text-muted-foreground mb-1">
                      Nuevo precio de venta
                      <InfoTooltip title="Nuevo precio de venta" align="start">
                        El precio que se cobrará en el POS desde ahora. Se guarda el{' '}
                        <strong>precio anterior</strong> en el histórico para auditoría.
                      </InfoTooltip>
                    </label>
                    <input
                      ref={precioRef}
                      type="number"
                      min={0}
                      step={0.01}
                      className="w-full border border-border rounded px-2 py-1.5 font-mono text-right"
                      value={nuevoPrecio}
                      onChange={(e) => setNuevoPrecio(e.target.value)}
                      onKeyDown={onKeyPrecio}
                      disabled={!current}
                    />
                  </div>
                  <div>
                    <label className="flex items-center text-xs text-muted-foreground mb-1">
                      Motivo
                      <InfoTooltip title="Motivo del cambio de precio" align="end">
                        La razón queda en <span className="font-mono">precio_historico</span> para
                        auditoría.
                      </InfoTooltip>
                    </label>
                    <select
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value as MotivoPrecio)}
                      disabled={!current}
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

                {/* IVA del producto + preview (igual que en "Editar producto") */}
                <div className="grid grid-cols-[1fr_120px] gap-2">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">IVA modo</label>
                    <select
                      value={precioIvaModo}
                      onChange={(e) => {
                        const modo = e.target.value as IvaModo
                        setPrecioIvaModo(modo)
                        if (modo !== 'exento' && (precioIvaPct === '' || precioIvaPct === '0')) {
                          setPrecioIvaPct(String(DEFAULT_IVA_PORCENTAJE))
                        }
                      }}
                      disabled={!current}
                      className="w-full border border-border rounded px-2 py-1.5 bg-background text-xs"
                    >
                      {IVA_MODO_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value} title={o.hint}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">% IVA</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={precioIvaPct}
                      onChange={(e) => setPrecioIvaPct(e.target.value)}
                      disabled={!current || precioIvaModo === 'exento'}
                      className="w-full border border-border rounded px-2 py-1.5 font-mono text-right disabled:bg-muted/30"
                    />
                  </div>
                </div>

                {desglosePrecio && (
                  <div className="rounded border border-border bg-muted/30 px-3 py-2 space-y-1.5">
                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                      Vista previa del precio
                    </div>
                    <div className="grid grid-cols-3 gap-2 font-mono text-sm">
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase">Importe (neto)</div>
                        <div>{money(desglosePrecio.importe)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase">IVA</div>
                        <div>{money(desglosePrecio.iva)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase">Precio de venta</div>
                        <div className="font-semibold text-blue-700">{money(desglosePrecio.total)}</div>
                      </div>
                    </div>
                  </div>
                )}

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
                    placeholder='Ej: "Lista octubre 2026", "Promo semana santa"…'
                    disabled={!current}
                  />
                </div>

                <div className="flex justify-between items-center">
                  <div className="text-xs text-muted-foreground">
                    Tip: Enter en Nuevo precio agrega a la lista y resetea el formulario.
                  </div>
                  <button
                    type="button"
                    onClick={addItem}
                    disabled={!current || !nuevoPrecio}
                    className="px-4 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-medium"
                  >
                    Agregar cambio
                  </button>
                </div>
              </section>

              <section className="border border-border rounded">
                <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide flex justify-between items-center">
                  <span>Cambios de precio a aplicar</span>
                  <span className="text-[10px] normal-case text-muted-foreground">
                    {items.length} producto{items.length === 1 ? '' : 's'}
                    {items.length > 0 && (
                      <>
                        {' · '}
                        <span className="text-green-700">
                          {bajadas} baja{bajadas === 1 ? '' : 's'}
                        </span>
                        {' · '}
                        <span className="text-red-700">
                          {subidas} sub{subidas === 1 ? 'e' : 'en'}
                        </span>
                      </>
                    )}
                  </span>
                </header>
                <div className="overflow-auto max-h-[260px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background border-b border-border">
                      <tr className="text-left">
                        <th className="px-2 py-1">Producto</th>
                        <th className="px-2 py-1 w-24 text-right">Anterior</th>
                        <th className="px-2 py-1 w-24 text-right">Nuevo</th>
                        <th className="px-2 py-1 w-20 text-right">Δ</th>
                        <th className="px-2 py-1 w-28">Motivo</th>
                        <th className="px-2 py-1 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-2 py-6 text-center text-muted-foreground italic"
                          >
                            Sin cambios — captura uno arriba
                          </td>
                        </tr>
                      )}
                      {items.map((it, i) => {
                        const delta = it.nuevoPrecio - it.precioAnterior
                        const pct =
                          it.precioAnterior > 0 ? (delta / it.precioAnterior) * 100 : 0
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
                            <td className="px-2 py-1 text-right font-mono">
                              ${money(it.precioAnterior)}
                            </td>
                            <td className="px-2 py-1 text-right font-mono">
                              ${money(it.nuevoPrecio)}
                            </td>
                            <td
                              className={`px-2 py-1 text-right font-mono font-semibold ${
                                delta < 0 ? 'text-green-700' : 'text-red-700'
                              }`}
                            >
                              {delta > 0 ? `+${money(delta)}` : money(delta)}
                              <div className="text-[10px] font-normal">
                                {pct > 0 ? '+' : ''}
                                {pct.toFixed(1)}%
                              </div>
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
            </>
          )}

          {tab === 'iva' && (
            <>
              <section className="border border-dashed border-border rounded p-3 bg-muted/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 text-xs">
                    <div className="font-semibold mb-0.5">Actualización masiva por CSV</div>
                    <p className="text-muted-foreground">
                      Columnas: <span className="font-mono">codigo</span>,{' '}
                      <span className="font-mono">iva_modo</span> (<em>exento</em>, <em>sumar</em>,{' '}
                      <em>incluido</em>) y <span className="font-mono">iva_porcentaje</span> (0–100;
                      ignorado si es exento).
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={downloadIvaCSV}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted text-xs"
                    >
                      <Download className="size-3.5" />
                      Descargar CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => ivaFileRef.current?.click()}
                      disabled={importingIva}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded hover:bg-muted disabled:opacity-50 text-xs"
                    >
                      {importingIva ? <Spinner size={14} /> : <Upload className="size-3.5" />}
                      {importingIva ? 'Procesando…' : 'Cargar CSV'}
                    </button>
                    <input
                      ref={ivaFileRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={onIvaFileSelected}
                    />
                  </div>
                </div>
              </section>

              <section className="border border-border rounded p-3 bg-muted/10 space-y-3">
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      Código o nombre{' '}
                      <span className="font-mono">(Enter busca · F5 abre búsqueda)</span>
                    </label>
                    <input
                      ref={ivaCodRef}
                      type="text"
                      className="w-full border border-border rounded px-2 py-1.5 font-mono"
                      value={ivaCodigo}
                      onChange={(e) => setIvaCodigo(e.target.value)}
                      onKeyDown={onKeyIvaCode}
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

                {ivaCurrent && (
                  <div className="text-xs bg-background border border-border rounded px-3 py-2">
                    <span className="text-muted-foreground">Producto: </span>
                    <span className="font-semibold">{ivaCurrent.nombre}</span>
                    <span className="text-muted-foreground ml-2 font-mono">{ivaCurrent.codigo}</span>
                    <span className="text-muted-foreground ml-3">
                      IVA actual:{' '}
                      <span className="font-semibold">
                        {labelModo(ivaCurrent.ivaModo)}
                        {ivaCurrent.ivaModo !== 'exento' && ` · ${ivaCurrent.ivaPorcentaje}%`}
                      </span>
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-[1fr_140px] gap-2">
                  <div>
                    <label className="flex items-center text-xs text-muted-foreground mb-1">
                      Modo de IVA
                      <InfoTooltip title="Modo de IVA" align="start">
                        <div className="space-y-1">
                          <div>
                            <strong>Exento:</strong> el producto no causa IVA.
                          </div>
                          <div>
                            <strong>Se suma al precio:</strong> el precio capturado es neto; el
                            IVA se agrega al cobrar.
                          </div>
                          <div>
                            <strong>Ya incluido:</strong> el precio de etiqueta ya trae IVA; se
                            desglosa del total.
                          </div>
                        </div>
                      </InfoTooltip>
                    </label>
                    <select
                      value={ivaModoSel}
                      onChange={(e) => setIvaModoSel(e.target.value as IvaModo)}
                      disabled={!ivaCurrent}
                      className="w-full border border-border rounded px-2 py-1.5 bg-background text-xs"
                    >
                      {IVA_MODO_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value} title={o.hint}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="flex items-center text-xs text-muted-foreground mb-1">
                      Porcentaje
                    </label>
                    <div className="flex items-center">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        className="w-full border border-border rounded px-2 py-1.5 font-mono text-right disabled:opacity-50"
                        value={ivaPctInput}
                        onChange={(e) => setIvaPctInput(e.target.value)}
                        onKeyDown={onKeyIvaPct}
                        disabled={!ivaCurrent || ivaModoSel === 'exento'}
                      />
                      <span className="ml-1 text-muted-foreground text-xs">%</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <div className="text-xs text-muted-foreground">
                    Tip: el porcentaje se ignora cuando el modo es exento.
                  </div>
                  <button
                    type="button"
                    onClick={addIvaItem}
                    disabled={!ivaCurrent}
                    className="px-4 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-medium"
                  >
                    Agregar cambio
                  </button>
                </div>
              </section>

              <section className="border border-border rounded">
                <header className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide flex justify-between items-center">
                  <span>Cambios de IVA a aplicar</span>
                  <span className="text-[10px] normal-case text-muted-foreground">
                    {ivaItems.length} producto{ivaItems.length === 1 ? '' : 's'}
                  </span>
                </header>
                <div className="overflow-auto max-h-[260px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background border-b border-border">
                      <tr className="text-left">
                        <th className="px-2 py-1">Producto</th>
                        <th className="px-2 py-1 w-40">Antes</th>
                        <th className="px-2 py-1 w-40">Después</th>
                        <th className="px-2 py-1 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {ivaItems.length === 0 && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-2 py-6 text-center text-muted-foreground italic"
                          >
                            Sin cambios — captura uno arriba
                          </td>
                        </tr>
                      )}
                      {ivaItems.map((it, i) => (
                        <tr key={i} className="border-b border-border/60">
                          <td className="px-2 py-1">
                            <div>{it.productoNombre}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              {it.codigo}
                            </div>
                          </td>
                          <td className="px-2 py-1 text-[11px]">
                            {labelModo(it.ivaModoAnterior)}
                            {it.ivaModoAnterior !== 'exento' && ` · ${it.ivaPorcentajeAnterior}%`}
                          </td>
                          <td className="px-2 py-1 text-[11px] font-semibold">
                            {labelModo(it.nuevoModo)}
                            {it.nuevoModo !== 'exento' && ` · ${it.nuevoPorcentaje}%`}
                          </td>
                          <td className="px-2 py-1 text-center">
                            <button
                              type="button"
                              onClick={() => removeIvaItem(i)}
                              className="p-1 hover:bg-red-50 rounded text-red-700"
                              title="Quitar"
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
            </>
          )}
        </div>

        <footer className="flex justify-between items-center px-4 py-3 border-t border-border bg-muted/20">
          <div className="text-xs text-muted-foreground">
            {isIva
              ? 'Cada cambio actualiza iva_modo / iva_porcentaje en producto.'
              : 'Cada cambio actualiza producto.precio y deja registro en precio_historico.'}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || savingIva}
              className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={isIva ? saveIva : save}
              disabled={saveDisabled}
              className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
            >
              {saveBusy && <Spinner size={14} />}
              {saveLabel}
            </button>
          </div>
        </footer>
      </Modal>

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(p) => (tab === 'iva' ? setFromProductIva(p) : setFromProduct(p))}
        allowZeroStock
      />
    </>
  )
}
