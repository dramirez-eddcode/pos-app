import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * Navegación con ↑/↓ entre los campos enfocables de un contenedor (estilo
 * legacy): mueve el foco al anterior/siguiente elemento visible y habilitado,
 * incluidos selects cerrados (la opción se cambia abriendo el desplegable con
 * Espacio/Alt+↓/clic). Al enfocar un campo de texto/número/fecha se selecciona
 * su contenido para sobreescribir directo.
 *
 * Respeta el comportamiento nativo donde las flechas ya significan algo:
 * textareas (cursor), radios (grupo), Alt+↓ (abre select) y cualquier handler
 * más específico que ya haya hecho preventDefault (listas de resultados, etc.).
 *
 * La usan el `Modal` compartido (todos los modales) y las páginas de captura
 * (Login, Wizard, menú de Matriz). NO usarla donde las flechas tengan un
 * significado propio (el carrito del POS).
 */
export function arrowFieldNav(
  e: ReactKeyboardEvent<HTMLElement>,
  container: HTMLElement | null
): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  // Un handler más específico ya lo procesó — no lo pisamos.
  if (e.defaultPrevented) return
  // Alt+↓ abre el desplegable de un select (nativo) — no navegar.
  if (e.altKey) return
  const target = e.target as HTMLElement
  const tag = target.tagName
  if (tag === 'TEXTAREA') return
  if (tag === 'INPUT' && (target as HTMLInputElement).type === 'radio') return

  if (!container) return
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null) // sólo visibles
  if (focusables.length === 0) return

  const idx = focusables.indexOf(target)
  const dir = e.key === 'ArrowDown' ? 1 : -1
  const next =
    idx === -1
      ? dir === 1
        ? focusables[0]
        : focusables[focusables.length - 1]
      : focusables[idx + dir]
  if (!next) return // en los extremos no cicla

  e.preventDefault()
  next.focus()
  // Selecciona el contenido para sobreescribir directo (estilo legacy)
  if (
    next instanceof HTMLInputElement &&
    ['text', 'number', 'password', 'date'].includes(next.type)
  ) {
    next.select()
  }
}
