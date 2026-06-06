import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Percent } from 'lucide-react'
import Modal from './Modal'
import { useSession } from '../stores/session'
import { isAdminLike } from '../lib/roles'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * Configuración del IVA default del negocio (modo MATRIZ). Es la tasa sugerida
 * al crear un producto; el modo (exento/sumar/incluido) y la tasa final se
 * eligen por producto. El valor viaja por USB a las sucursales.
 */
export default function IvaConfigModal({ open, onClose }: Props) {
  const { user } = useSession()
  const userIsAdmin = isAdminLike(user)
  const [porcentaje, setPorcentaje] = useState('16')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    window.api.config
      .get()
      .then((c) => setPorcentaje(String(c.ivaPorcentajeDefault)))
      .catch((e) => toast.error('No pude cargar la configuración', { description: String(e) }))
      .finally(() => setLoading(false))
  }, [open])

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!user) return
    const v = Math.round(Number(porcentaje))
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      toast.error('Porcentaje inválido (0–100)')
      return
    }
    setSaving(true)
    try {
      const c = await window.api.config.update(user.id, { ivaPorcentajeDefault: v })
      setPorcentaje(String(c.ivaPorcentajeDefault))
      toast.success(`IVA default guardado: ${c.ivaPorcentajeDefault}%`)
      onClose()
    } catch (err) {
      toast.error('No se pudo guardar', {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title="Impuestos · IVA" onClose={onClose} maxWidth="max-w-md">
      <form onSubmit={submit} className="p-4 space-y-4 text-sm">
        <p className="text-xs text-muted-foreground">
          Esta es la tasa de IVA <span className="font-medium">sugerida</span> al dar de alta un
          producto. En cada producto eliges si el IVA es <span className="font-medium">exento</span>,
          se <span className="font-medium">suma</span> al precio o ya viene{' '}
          <span className="font-medium">incluido</span>, y puedes ajustar la tasa. El valor se envía
          a las sucursales por USB.
        </p>

        <label className="block">
          <span className="block text-xs text-muted-foreground mb-1">IVA default (%)</span>
          <div className="relative w-40">
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              required
              disabled={!userIsAdmin || loading}
              value={porcentaje}
              onChange={(e) => setPorcentaje(e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 font-mono pr-8 disabled:bg-muted/30"
              autoComplete="off"
            />
            <Percent className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          </div>
        </label>

        {!userIsAdmin && (
          <p className="text-[11px] text-muted-foreground">
            Cambiar el IVA default requiere permisos de administrador.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-1.5 border border-border rounded hover:bg-muted text-sm"
          >
            Cerrar
          </button>
          {userIsAdmin && (
            <button
              type="submit"
              disabled={saving || loading}
              className="px-5 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 text-sm font-semibold"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}
