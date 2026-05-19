const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function money(n: number): string {
  return n.toFixed(2)
}

/** Formato: "0,123" — separador de miles con coma (estilo legacy) */
export function folio(n: number | string): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** "22/feb/26" — tal cual el legacy */
export function fechaTicket(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = MESES_ES[d.getMonth()]
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd}/${mm}/${yy}`
}

/** "06:44 p. m." — formato del legacy */
export function horaTicket(d: Date): string {
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'p. m.' : 'a. m.'
  h = h % 12 || 12
  return `${String(h).padStart(2, '0')}:${m} ${ampm}`
}
