import { BrowserWindow, app, dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSqlite } from '../db/connection'
import { getMovimientoDetalle } from './movimientos'
import { getEmpresa } from './empresa'
import type { MovimientoDetalle, PdfMovimientoResult, StockBodegaPdfInput } from '@shared/dto'

/**
 * Renderiza un HTML en una BrowserWindow oculta (vía archivo temporal) y
 * ejecuta `fn` con la ventana lista. Limpia ventana y temp al terminar.
 */
async function renderEnVentanaOculta<T>(
  html: string,
  fn: (win: BrowserWindow) => Promise<T>
): Promise<T> {
  const tmpPath = join(app.getPath('temp'), `fms-mov-${randomUUID()}.html`)
  writeFileSync(tmpPath, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true }
  })
  try {
    await win.loadFile(tmpPath)
    return await fn(win)
  } finally {
    win.destroy()
    try {
      unlinkSync(tmpPath)
    } catch {
      /* el temp es desechable */
    }
  }
}

/**
 * Exporta un movimiento del historial (entrada, salida o traspaso) a un PDF
 * tamaño carta para imprimirlo en una impresora normal (no la de tickets).
 *
 * Flujo: arma un HTML imprimible → lo renderiza en una BrowserWindow oculta →
 * `printToPDF` → guarda donde el usuario elija → lo abre con el visor de PDF
 * del sistema (desde ahí se manda a imprimir). 100% offline.
 */
export async function exportMovimientoPdf(
  folio: string,
  window: BrowserWindow | null
): Promise<PdfMovimientoResult> {
  try {
    const det = getMovimientoDetalle(folio)
    if (!det) return { ok: false, error: 'Movimiento no encontrado en el historial' }

    const stamp = det.fecha.slice(0, 10).replace(/-/g, '')
    const defaultName = `${det.tipo.toLowerCase()}-${stamp}-${det.folio.slice(0, 8)}.pdf`
    const opts = {
      title: `Guardar PDF de ${TITULOS[det.tipo].toLowerCase()}`,
      defaultPath: join(app.getPath('documents'), defaultName),
      filters: [
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    }
    const dlg = window ? await dialog.showSaveDialog(window, opts) : await dialog.showSaveDialog(opts)
    if (dlg.canceled || !dlg.filePath) return { ok: false, cancelled: true }
    const filePath = dlg.filePath

    await renderEnVentanaOculta(buildHtml(det), async (win) => {
      const pdf = await win.webContents.printToPDF({
        pageSize: 'Letter',
        printBackground: true,
        preferCSSPageSize: true,
        // Pie de página por hoja (se dibuja en el margen inferior del @page).
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `
          <div style="width:100%; padding:0 12mm; display:flex; justify-content:space-between;
                      font-family:'Segoe UI', Arial, sans-serif; font-size:8px; color:#888;">
            <span>${esc(TITULOS[det.tipo])} · folio ${esc(det.folio.slice(0, 8))}</span>
            <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
          </div>`
      })
      writeFileSync(filePath, pdf)
    })

    // Abrir con el visor default — desde ahí el usuario imprime (Ctrl+P).
    await shell.openPath(filePath)
    return { ok: true, path: filePath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Reporte imprimible de stock por bodega ──────────────────────────────────

function buildStockHtml(input: StockBodegaPdfInput): string {
  const negocio = encabezadoNegocio()
  const generado = new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })
  const r = input.resumen

  const unidadesListadas = input.items.reduce((s, it) => s + (Number(it.existencias) || 0), 0)
  const valorListado = input.items.reduce((s, it) => s + (Number(it.valorCosto) || 0), 0)

  const datos: Array<[string, string]> = [
    ['Bodega', input.bodegaNombre],
    ['Generado', generado]
  ]
  if (input.filtroDescripcion) datos.push(['Filtro aplicado', input.filtroDescripcion])

  const filas = input.items
    .map((it, i) => {
      const cadClase = it.vencido ? 'bad' : it.porVencer ? 'warn' : ''
      return `<tr>
        <td class="num">${i + 1}</td>
        <td class="mono">${esc(it.codigo)}</td>
        <td>${esc(it.nombre)}${it.bajoMinimo ? ' <span class="warn">▼ bajo mín</span>' : ''}</td>
        <td class="sec">${esc(it.sustanciaActiva ?? '—')}</td>
        <td class="num">${entero(it.existencias)}</td>
        <td class="num">${it.stockMinimo ? entero(it.stockMinimo) : '—'}</td>
        <td class="num">$${money(it.valorCosto)}</td>
        <td class="mono center ${cadClase}">${esc(it.proximaCaducidad ?? '—')}</td>
      </tr>`
    })
    .join('\n')

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Stock por bodega — ${esc(input.bodegaNombre)}</title>
<style>${ESTILOS_DOC}</style>
</head>
<body>
  <header>
    <div>
      <div class="negocio">${esc(negocio.nombre)}</div>
      ${negocio.subtitulo ? `<div class="negocio-sub">${esc(negocio.subtitulo)}</div>` : ''}
    </div>
    <div class="doc-titulo">
      Stock por bodega<br>
      <span class="doc-tipo">INVENTARIO</span>
    </div>
  </header>

  <table class="datos">
    ${datos
      .map(([k, v]) => `<tr><td class="k">${esc(k)}:</td><td class="v">${esc(v)}</td></tr>`)
      .join('\n')}
  </table>

  <div class="kpis">
    <div class="kpi"><div class="label">SKUs con stock</div><div class="value">${entero(r.skusConStock)}</div></div>
    <div class="kpi"><div class="label">Unidades</div><div class="value">${entero(r.unidades)}</div></div>
    <div class="kpi"><div class="label">Valor (costo)</div><div class="value">$${money(r.valorCosto)}</div></div>
    <div class="kpi"><div class="label">Lotes</div><div class="value">${entero(r.lotes)}</div></div>
    <div class="kpi"><div class="label">Bajo mínimo</div><div class="value">${entero(r.bajoMinimo)}</div></div>
    <div class="kpi"><div class="label">Por vencer / vencidos</div><div class="value">${entero(r.porVencer)} / ${entero(r.vencidos)}</div></div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th style="width:105px">Código</th>
        <th>Producto</th>
        <th style="width:115px">Sustancia</th>
        <th style="width:62px">Exist.</th>
        <th style="width:50px">Mín.</th>
        <th style="width:80px">Valor</th>
        <th style="width:78px">Próx. cad.</th>
      </tr>
    </thead>
    <tbody>
      ${filas || '<tr><td colspan="8" class="center">Sin productos</td></tr>'}
    </tbody>
  </table>

  <div class="totales">
    <div><div class="label">Productos listados</div><div class="value">${entero(input.items.length)}</div></div>
    <div><div class="label">Unidades listadas</div><div class="value">${entero(unidadesListadas)}</div></div>
    <div><div class="label">Valor listado (costo)</div><div class="value">$${money(valorListado)}</div></div>
  </div>

  <footer>Documento generado por Farmacias MS POS · ${esc(
    new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
  )}</footer>
</body>
</html>`
}

/** Guarda el reporte de stock como PDF (carta, paginado) y lo abre para imprimir. */
export async function exportStockBodegaPdf(
  input: StockBodegaPdfInput,
  window: BrowserWindow | null
): Promise<PdfMovimientoResult> {
  try {
    const stamp = ymdHoy().replace(/-/g, '')
    const base = input.bodegaNombre.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const opts = {
      title: 'Guardar PDF de stock por bodega',
      defaultPath: join(app.getPath('documents'), `stock-${base}-${stamp}.pdf`),
      filters: [
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    }
    const dlg = window ? await dialog.showSaveDialog(window, opts) : await dialog.showSaveDialog(opts)
    if (dlg.canceled || !dlg.filePath) return { ok: false, cancelled: true }
    const filePath = dlg.filePath

    await renderEnVentanaOculta(buildStockHtml(input), async (win) => {
      const pdf = await win.webContents.printToPDF({
        pageSize: 'Letter',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `
          <div style="width:100%; padding:0 12mm; display:flex; justify-content:space-between;
                      font-family:'Segoe UI', Arial, sans-serif; font-size:8px; color:#888;">
            <span>Stock por bodega · ${esc(input.bodegaNombre)}</span>
            <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
          </div>`
      })
      writeFileSync(filePath, pdf)
    })

    await shell.openPath(filePath)
    return { ok: true, path: filePath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Manda el reporte de stock directo a la impresora (diálogo nativo). */
export async function imprimirStockBodega(input: StockBodegaPdfInput): Promise<PdfMovimientoResult> {
  try {
    return await renderEnVentanaOculta(buildStockHtml(input), async (win) => {
      const r = await new Promise<{ success: boolean; reason: string }>((resolve) => {
        win.webContents.print(
          {
            silent: false,
            printBackground: true,
            header: 'Stock por bodega',
            footer: input.bodegaNombre
          },
          (success, failureReason) => resolve({ success, reason: failureReason })
        )
      })
      if (!r.success) {
        if (/cancel/i.test(r.reason)) return { ok: false, cancelled: true }
        return { ok: false, error: r.reason || 'No se pudo imprimir' }
      }
      return { ok: true }
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function ymdHoy(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Manda un movimiento directo a la impresora: mismo documento que el PDF, pero
 * abre el diálogo nativo de impresión de Windows (el usuario elige impresora y
 * copias) sin guardar archivo. Las plantillas de pie del printToPDF no aplican
 * aquí; en su lugar se activa el encabezado/pie NATIVO de Chromium (header/
 * footer), que numera las hojas automáticamente ("página/total" abajo a la
 * derecha) e imprime el título del documento y el folio en cada hoja.
 */
export async function imprimirMovimiento(folio: string): Promise<PdfMovimientoResult> {
  try {
    const det = getMovimientoDetalle(folio)
    if (!det) return { ok: false, error: 'Movimiento no encontrado en el historial' }

    return await renderEnVentanaOculta(buildHtml(det), async (win) => {
      const r = await new Promise<{ success: boolean; reason: string }>((resolve) => {
        win.webContents.print(
          {
            silent: false,
            printBackground: true,
            header: TITULOS[det.tipo],
            footer: `Folio ${det.folio.slice(0, 8)}`
          },
          (success, failureReason) => resolve({ success, reason: failureReason })
        )
      })
      if (!r.success) {
        if (/cancel/i.test(r.reason)) return { ok: false, cancelled: true }
        return { ok: false, error: r.reason || 'No se pudo imprimir' }
      }
      return { ok: true }
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Construcción del HTML ────────────────────────────────────────────────────

// Estilos compartidos por todos los documentos imprimibles (carta).
const ESTILOS_DOC = `
  @page { size: letter; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #111; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
  .negocio { font-size: 16px; font-weight: 700; }
  .negocio-sub { color: #555; margin-top: 2px; }
  .doc-titulo { text-align: right; font-size: 14px; font-weight: 700; text-transform: uppercase; }
  .doc-tipo { display: inline-block; margin-top: 4px; padding: 2px 8px; border: 1px solid #111;
              border-radius: 3px; font-size: 10px; letter-spacing: 1px; }
  .datos { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  .datos td { padding: 2px 6px; vertical-align: top; }
  .datos .k { color: #555; white-space: nowrap; width: 110px; }
  .datos .v { font-weight: 600; }
  .mono { font-family: Consolas, 'Courier New', monospace; }
  table.items { width: 100%; border-collapse: collapse; }
  table.items th { background: #f0f0f0; border: 1px solid #999; padding: 4px 6px;
                   font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; text-align: left; }
  table.items td { border: 1px solid #bbb; padding: 3px 6px; }
  table.items tr { page-break-inside: avoid; }
  .num { text-align: right; font-family: Consolas, 'Courier New', monospace; white-space: nowrap; }
  .center { text-align: center; }
  .sec { font-size: 10px; color: #444; }
  .warn { color: #b45309; font-weight: 600; }
  .bad { color: #b91c1c; font-weight: 700; }
  tfoot td { border: none !important; padding-top: 8px; font-size: 12px; }
  .kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-bottom: 12px; }
  .kpi { border: 1px solid #ccc; border-radius: 4px; padding: 5px 8px; background: #f8f8f8; }
  .kpi .label { color: #555; font-size: 8px; text-transform: uppercase; letter-spacing: 0.4px; }
  .kpi .value { font-size: 12px; font-weight: 700; font-family: Consolas, monospace; }
  .totales { display: flex; justify-content: flex-end; gap: 24px; margin-top: 10px;
             padding: 8px 10px; background: #f5f5f5; border: 1px solid #ccc; border-radius: 4px; }
  .totales div { text-align: right; }
  .totales .label { color: #555; font-size: 10px; text-transform: uppercase; }
  .totales .value { font-size: 13px; font-weight: 700; font-family: Consolas, monospace; }
  .firmas { display: flex; justify-content: space-around; gap: 40px; margin-top: 56px;
            page-break-inside: avoid; }
  .firma { flex: 1; max-width: 220px; text-align: center; }
  .firma .linea { border-top: 1px solid #111; margin-bottom: 4px; }
  .firma .rol { font-size: 10px; color: #555; }
  footer { margin-top: 28px; text-align: center; color: #888; font-size: 9px; }
`

const TITULOS: Record<MovimientoDetalle['tipo'], string> = {
  ENTRADA: 'Entrada de mercancía',
  SALIDA: 'Salida de inventario',
  TRASPASO: 'Traspaso a sucursal'
}

const FIRMAS: Record<MovimientoDetalle['tipo'], [string, string]> = {
  ENTRADA: ['Recibió', 'Autorizó'],
  SALIDA: ['Entregó', 'Autorizó'],
  TRASPASO: ['Entregó', 'Recibió (sucursal)']
}

function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(n: number): string {
  return (Number(n) || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function entero(n: number): string {
  return (Number(n) || 0).toLocaleString('es-MX')
}

interface EncabezadoNegocio {
  nombre: string
  subtitulo: string | null
}

/** "Otilio Gómez Villegas" → "OGV" (omite partículas: de, del, la, y…). */
function iniciales(nombre: string): string {
  const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e'])
  const palabras = nombre
    .trim()
    .split(/\s+/)
    .filter((w) => w && !PARTICULAS.has(w.toLowerCase()))
  const ini = palabras.map((w) => w[0]!.toUpperCase()).join('')
  return ini || nombre.trim().slice(0, 1).toUpperCase()
}

function encabezadoNegocio(): EncabezadoNegocio {
  const empresa = getEmpresa()
  const instal = getSqlite()
    .prepare('SELECT tipo, propietario_nombre AS propietario FROM instalacion WHERE id = 1')
    .get() as { tipo: string; propietario: string | null } | undefined

  const partes: string[] = []
  if (instal?.tipo === 'MATRIZ') partes.push('Matriz')
  else if (empresa?.sucursalNombre) partes.push(`Sucursal ${empresa.sucursalNombre}`)
  if (instal?.propietario) partes.push(iniciales(instal.propietario))

  return {
    nombre: empresa?.nombreComercial || 'Farmacias MS',
    subtitulo: partes.length > 0 ? partes.join(' · ') : null
  }
}

function buildHtml(det: MovimientoDetalle): string {
  const negocio = encabezadoNegocio()
  const fecha = new Date(det.fecha).toLocaleString('es-MX', {
    dateStyle: 'long',
    timeStyle: 'short'
  })
  const conMotivoLinea = det.tipo === 'SALIDA'
  // Las entradas SIEMPRE llevan la columna Proveedor (— si el renglón no tiene).
  // El proveedor es POR LÍNEA; documentos viejos solo lo tienen a nivel
  // documento y se usa como fallback.
  const conProveedorLinea = det.tipo === 'ENTRADA'
  const provDeLinea = (l: MovimientoDetalle['items'][number]): string =>
    l.proveedor === undefined ? (det.proveedor ?? '—') : (l.proveedor ?? '—')
  const esTraspasoInterno = det.tipo === 'TRASPASO' && det.destinoTipo === 'BODEGA'
  const [firma1, firma2Base] = FIRMAS[det.tipo]
  const firma2 = esTraspasoInterno ? 'Recibió (bodega)' : firma2Base

  const datos: Array<[string, string]> = [
    ['Folio', det.folio],
    ['Fecha', fecha],
    [det.tipo === 'ENTRADA' ? 'Bodega destino' : 'Bodega origen', det.bodega]
  ]
  if (det.tipo === 'TRASPASO') {
    datos.push([esTraspasoInterno ? 'Bodega destino' : 'Sucursal destino', det.destino ?? '—'])
  }
  if (det.proveedor) datos.push(['Proveedor', det.proveedor])
  if (det.usuario) datos.push(['Registró', det.usuario])
  if (det.motivo) datos.push(['Motivo', det.motivo])

  const filas = det.items
    .map((l, i) => {
      const importe = (Number(l.cantidad) || 0) * (Number(l.costo) || 0)
      return `<tr>
        <td class="num">${i + 1}</td>
        <td class="mono">${esc(l.codigo)}</td>
        <td>${esc(l.nombre)}</td>
        <td class="sec">${esc(l.sustancia ?? '—')}</td>
        <td class="mono center">${esc(l.caducidad ?? '—')}</td>
        ${conProveedorLinea ? `<td class="sec">${esc(provDeLinea(l))}</td>` : ''}
        ${conMotivoLinea ? `<td>${esc(l.motivo ?? '—')}</td>` : ''}
        <td class="num">${entero(l.cantidad)}</td>
        <td class="num">$${money(l.costo)}</td>
        <td class="num">$${money(importe)}</td>
      </tr>`
    })
    .join('\n')

  const cols = 8 + (conMotivoLinea ? 1 : 0) + (conProveedorLinea ? 1 : 0)

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(TITULOS[det.tipo])} ${esc(det.folio.slice(0, 8))}</title>
<style>${ESTILOS_DOC}</style>
</head>
<body>
  <header>
    <div>
      <div class="negocio">${esc(negocio.nombre)}</div>
      ${negocio.subtitulo ? `<div class="negocio-sub">${esc(negocio.subtitulo)}</div>` : ''}
    </div>
    <div class="doc-titulo">
      ${esc(TITULOS[det.tipo])}<br>
      <span class="doc-tipo">${esc(det.tipo)}</span>
    </div>
  </header>

  <table class="datos">
    ${datos
      .map(
        ([k, v]) =>
          `<tr><td class="k">${esc(k)}:</td><td class="v ${k === 'Folio' ? 'mono' : ''}">${esc(v)}</td></tr>`
      )
      .join('\n')}
  </table>

  <table class="items">
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th style="width:110px">Código</th>
        <th>Producto</th>
        <th style="width:120px">Sustancia</th>
        <th style="width:80px">Caducidad</th>
        ${conProveedorLinea ? '<th style="width:110px">Proveedor</th>' : ''}
        ${conMotivoLinea ? '<th style="width:130px">Motivo</th>' : ''}
        <th style="width:60px">Cant.</th>
        <th style="width:75px">Costo</th>
        <th style="width:85px">Importe</th>
      </tr>
    </thead>
    <tbody>
      ${filas || `<tr><td colspan="${cols}" class="center">Sin líneas</td></tr>`}
    </tbody>
  </table>

  <div class="totales">
    <div><div class="label">Líneas</div><div class="value">${entero(det.lineas)}</div></div>
    <div><div class="label">Unidades</div><div class="value">${entero(det.unidades)}</div></div>
    <div><div class="label">Valor (costo)</div><div class="value">$${money(det.valor)}</div></div>
  </div>

  <div class="firmas">
    <div class="firma"><div class="linea"></div><div class="rol">${esc(firma1)}</div></div>
    <div class="firma"><div class="linea"></div><div class="rol">${esc(firma2)}</div></div>
  </div>

  <footer>Documento generado por Farmacias MS POS · ${esc(
    new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
  )}</footer>
</body>
</html>`
}
