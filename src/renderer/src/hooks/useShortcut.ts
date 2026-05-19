import { useEffect, useRef } from 'react'

export interface Shortcut {
  key: string // e.g. 'F5', 'Escape', 'End', 'Delete', 'Pause', 'F9', 'F11', 'F12', 'Enter'
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
  handler: (e: KeyboardEvent) => void
  /**
   * Si true, el atajo se dispara aunque el foco esté en un input/textarea.
   * Las teclas de función (F1–F12, End, Delete, etc.) siempre se disparan
   * independientemente del foco.
   */
  allowInInput?: boolean
}

const FN_KEYS = new Set([
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'End',
  'Delete',
  'Pause',
  'Insert',
  'Home',
  'PageUp',
  'PageDown'
])

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

/**
 * Registra atajos de teclado global (escucha en `window`). Acepta un array
 * dinámico: si cambia entre renders, los listeners se re-registran.
 */
export function useShortcut(shortcuts: Shortcut[]): void {
  const ref = useRef(shortcuts)
  ref.current = shortcuts

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      for (const s of ref.current) {
        if (e.key !== s.key) continue
        if (s.shift !== undefined && e.shiftKey !== s.shift) continue
        if (s.ctrl !== undefined && e.ctrlKey !== s.ctrl) continue
        if (s.alt !== undefined && e.altKey !== s.alt) continue
        const isFn = FN_KEYS.has(s.key)
        if (!isFn && !s.allowInInput && isEditable(e.target)) continue
        e.preventDefault()
        s.handler(e)
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
