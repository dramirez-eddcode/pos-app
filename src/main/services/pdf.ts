import { BrowserWindow, app, dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSqlite } from '../db/connection'
import { getMovimientoDetalle } from './movimientos'
import { getEmpresa } from './empresa'
import { getSettings } from './settings'
import { folioMovimiento } from '@shared/dto'
import type { MovimientoDetalle, PdfMovimientoResult, StockBodegaPdfInput } from '@shared/dto'

/**
 * Paginador EN CONTENIDO: mide el documento con el ancho real de impresión,
 * parte la tabla en hojas que caben completas y le pone a cada hoja un pie con
 * "Página i de N". Así la numeración aparece SIEMPRE — tanto al imprimir
 * (webContents.print, cuyo header/footer nativo no es confiable) como al
 * guardar PDF — sin depender de plantillas de Chromium.
 *
 * GEOMETRÍA — por qué estos números:
 *  - Con `@page { margin: 12mm }` la caja de página mide 725.29 × 965.29 px y
 *    es DETERMINISTA en cualquier impresora: 12mm es mayor que el área no
 *    imprimible de cualquier láser (~6.4mm máx), así que Chromium nunca la
 *    recorta contra el área imprimible del driver.
 *  - Cada hoja que arma el paginador mide 940px: 25px MENOS que la caja, para
 *    que ningún redondeo pueda fragmentarla.
 *  - Aquí se MIDE con el layout de pantalla (96dpi) pero se IMPRIME con el del
 *    driver (600/1200dpi), donde las alturas de línea y de fila redondean
 *    hacia arriba: el impreso sale ~5% más alto que lo medido. Ese error era
 *    la causa de los renglones encimados (la cola de una hoja se pintaba sobre
 *    la primera fila de la siguiente, y el pie sobre la última fila). Se
 *    neutraliza con el COLCHÓN + el `overflow:hidden` de `.hoja`.
 *
 * Estructura esperada: <body> con bloques (header, .datos, table.items,
 * .totales, .firmas, footer) o <section> por copia (pedidos). Contrato extra:
 * una <tr class="sub"> dentro de table.items es sub-fila de DETALLE de la
 * fila anterior (p.ej. lotes del stock) y se pagina JUNTO con ella.
 */
const PAGINADOR_JS = String.raw`
(() => {
  const PIE_IZQUIERDO = "__PIE__";
  const DPI = 96;
  const mm = (v) => (v / 25.4) * DPI;
  // Caja de @page { size: letter; margin: 12mm } — la misma que se le pasa a
  // printToPDF (0.4724in por lado), así PDF e impresión componen igual.
  const ANCHO = 8.5 * DPI - 2 * mm(12);        // 725.29
  const CAJA_ALTO = 11 * DPI - 2 * mm(12);     // 965.29
  const ALTO_HOJA = 940;                       // 25px de aire contra la caja
  document.body.style.width = ANCHO.toFixed(2) + 'px';

  // Redondeo SIEMPRE hacia arriba: el error de medición se acumula a favor del
  // colchón. El -0.01 evita sumar 1px de más en valores ya enteros.
  const ceil = (n) => Math.ceil(n - 0.01);

  // Alto REAL del pie (escala con "Tamaño de letra de documentos"): una
  // constante fija se quedaba corta con letra grande.
  const pieRef = document.createElement('div');
  pieRef.className = 'pie';
  pieRef.style.cssText = 'position:static;visibility:hidden;';
  pieRef.textContent = PIE_IZQUIERDO + ' — Página 88 de 88';
  document.body.appendChild(pieRef);
  const ALTO_PIE = ceil(pieRef.getBoundingClientRect().height) + 6;
  pieRef.remove();

  // Colchón anti-deriva: ~5% de la hoja (la deriva medida en campo fue ~5%,
  // 2 filas de 43). Con overflow:hidden como red de seguridad la tolerancia
  // total ronda el 7.8%.
  const COLCHON = Math.max(48, Math.round(ALTO_HOJA * 0.05));
  const ALTO_CONTENIDO = ALTO_HOJA - ALTO_PIE - COLCHON;

  const hijos = Array.from(document.body.children);
  const esSecciones = hijos.length > 0 && hijos.every((el) => el.tagName === 'SECTION');
  const unidades = esSecciones ? hijos : [document.body];

  const alturaDe = (el) => {
    const cs = getComputedStyle(el);
    return ceil(
      el.getBoundingClientRect().height +
      Math.max(parseFloat(cs.marginTop) || 0, 0) +
      Math.max(parseFloat(cs.marginBottom) || 0, 0)
    );
  };

  for (const unidad of unidades) {
    // Cada <section> puede llevar su propio sufijo de pie (data-pie): en los
    // pedidos es el nombre de la copia (COPIA / ORIGINAL / ARCHIVO), para que
    // la hoja se identifique también al pie, no sólo por el rótulo de arriba.
    const sufijo = unidad.dataset ? unidad.dataset.pie : '';
    const pieTexto = sufijo
      ? (PIE_IZQUIERDO ? PIE_IZQUIERDO + ' · ' + sufijo : sufijo)
      : PIE_IZQUIERDO;
    const bloques = Array.from(unidad.children);
    const paginas = [];
    let actual = [];
    let usado = 0;
    const cerrar = () => {
      if (actual.length) {
        paginas.push(actual);
        actual = [];
        usado = 0;
      }
    };
    const meter = (nodo, h) => {
      if (usado + h > ALTO_CONTENIDO && actual.length) cerrar();
      actual.push(nodo);
      usado += h;
    };

    for (const b of bloques) {
      if (b.matches('table.items')) {
        // La tabla grande se parte por filas; cada trozo lleva su thead.
        // (table-layout:fixed en el CSS garantiza que las columnas midan igual
        // en la tabla original —donde medimos— y en estos clones.)
        // Las tr.sub (sub-filas de detalle, p.ej. los lotes del stock) viajan
        // JUNTAS con su fila padre: nunca abren hoja separadas de ella.
        const thead = b.querySelector('thead');
        const filas = Array.from(b.querySelectorAll('tbody > tr'));
        const grupos = [];
        for (const fila of filas) {
          if (fila.classList.contains('sub') && grupos.length > 0) {
            grupos[grupos.length - 1].push(fila);
          } else {
            grupos.push([fila]);
          }
        }
        const hThead = thead ? alturaDe(thead) : 0;
        let tabla = null;
        let tbody = null;
        let hTabla = 0;
        const abrirTabla = () => {
          tabla = b.cloneNode(false);
          if (thead) tabla.appendChild(thead.cloneNode(true));
          tbody = document.createElement('tbody');
          tabla.appendChild(tbody);
          hTabla = hThead;
        };
        // Si h no cabe en lo que queda de la hoja (y hay algo previo),
        // cierra la tabla/hoja actual y abre la siguiente.
        const asegurarEspacio = (h) => {
          if (usado + hTabla + h > ALTO_CONTENIDO && (tbody.children.length || actual.length)) {
            if (tbody.children.length) {
              actual.push(tabla);
              usado += hTabla;
            }
            cerrar();
            abrirTabla();
          }
        };
        abrirTabla();
        for (const grupo of grupos) {
          const alturas = grupo.map((f) => ceil(f.getBoundingClientRect().height));
          const hGrupo = alturas.reduce((s, h) => s + h, 0);
          // El grupo se empaca completo sólo si cabe en UNA hoja limpia; si ni
          // así cupiera (detalle gigante), degrada al corte fila por fila de
          // siempre (overflow:hidden de .hoja sigue de red de seguridad).
          const indivisible = grupo.length > 1 && hThead + hGrupo <= ALTO_CONTENIDO;
          if (indivisible) asegurarEspacio(hGrupo);
          grupo.forEach((f, j) => {
            if (!indivisible) asegurarEspacio(alturas[j]);
            tbody.appendChild(f.cloneNode(true));
            hTabla += alturas[j];
          });
        }
        if (tbody.children.length) {
          actual.push(tabla);
          usado += hTabla;
        }
      } else {
        meter(b.cloneNode(true), alturaDe(b));
      }
    }
    cerrar();

    const total = paginas.length;
    unidad.innerHTML = '';
    paginas.forEach((nodos, i) => {
      // Sin page-break-inside:avoid: en un box del tamaño de la hoja es un
      // no-op en el mejor caso y fuerza fragmentación en el peor.
      const pag = document.createElement('div');
      pag.className = 'hoja';
      for (const n of nodos) pag.appendChild(n);
      // Pie anclado al fondo de la hoja: documento/folio + "Página i de N".
      const pie = document.createElement('div');
      pie.className = 'pie';
      const izq = document.createElement('span');
      izq.textContent = pieTexto;
      const der = document.createElement('span');
      der.className = 'num-pag';
      der.textContent = 'Página ' + (i + 1) + ' de ' + total;
      pie.appendChild(izq);
      pie.appendChild(der);
      pag.appendChild(pie);
      unidad.appendChild(pag);
    });
    // La última hoja de la unidad no fuerza salto (el <section> ya trae el
    // suyo entre copias); evita hojas en blanco. Hay que limpiar las DOS
    // propiedades porque el CSS declara page-break-after Y break-after.
    const ultima = unidad.lastElementChild;
    if (ultima) {
      ultima.style.pageBreakAfter = 'auto';
      ultima.style.breakAfter = 'auto';
    }
  }
  return { hojas: document.querySelectorAll('.hoja').length, altoHoja: ALTO_HOJA,
           cajaAlto: CAJA_ALTO, altoContenido: ALTO_CONTENIDO, altoPie: ALTO_PIE };
})();
`

/**
 * Renderiza un HTML en una BrowserWindow oculta (vía archivo temporal), lo
 * pagina en contenido (pie por hoja: `pieIzquierdo` + "Página i de N") y
 * ejecuta `fn` con la ventana lista. Limpia ventana y temp al terminar.
 */
async function renderEnVentanaOculta<T>(
  html: string,
  fn: (win: BrowserWindow) => Promise<T>,
  pieIzquierdo = ''
): Promise<T> {
  const tmpPath = join(app.getPath('temp'), `fms-mov-${randomUUID()}.html`)
  writeFileSync(tmpPath, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true }
  })
  try {
    await win.loadFile(tmpPath)
    // Las fuentes del sistema deben estar resueltas ANTES de medir: si el
    // paginador midiera con la fuente de reemplazo, todas las alturas de fila
    // saldrían falsas y las hojas quedarían mal cortadas.
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    await win.webContents.executeJavaScript(
      PAGINADOR_JS.replace('"__PIE__"', JSON.stringify(pieIzquierdo))
    )
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
 * Imprime el documento renderizado en `win` usando la IMPRESORA DE DOCUMENTOS
 * configurada (Configuración → "Impresora de documentos"): impresión directa
 * sin diálogo. Si no hay impresora configurada — o la configurada falla
 * (apagada, renombrada) — cae al diálogo nativo de Windows para elegir una.
 * La impresora térmica de tickets NUNCA se usa aquí: es exclusiva de tickets,
 * cortes y cancelaciones (ESC/POS).
 */
async function printDoc(
  win: BrowserWindow,
  opts: { forzarSimplex?: boolean } = {}
): Promise<PdfMovimientoResult> {
  const { docPrinterName: docPrinter, docPrinterDuplex } = getSettings()
  // Doble cara (borde largo) si el admin lo habilitó; si la impresora no lo
  // soporta, el driver de Windows lo ignora e imprime normal. `forzarSimplex`
  // la desactiva para documentos cuyas hojas se reparten por separado (las 3
  // copias del pedido: dos copias en la misma hoja no se podrían entregar).
  // SIEMPRE explícito ('longEdge' o 'simplex'), nunca omitido: si se omite
  // manda el DEVMODE del driver, y una impresora con dúplex predeterminado de
  // fábrica imprimiría a doble cara con el checkbox apagado (o mezclaría dos
  // copias en una hoja pese a forzarSimplex).
  const duplexMode = docPrinterDuplex && !opts.forzarSimplex ? ('longEdge' as const) : ('simplex' as const)

  // Los márgenes los define el @page CSS del documento (12mm por lado), que es
  // con lo que mide el paginador: sin la opción `margins`, Chromium usa
  // marginType 'default' y SÍ honra el @page. NO pasarla aquí — print() la
  // interpreta en otra unidad y deja el área de contenido vacía ("content size
  // is empty"): la impresión falla y se cuelga.
  // TAMPOCO pasar `header`/`footer`: activan el encabezado/pie NATIVO de
  // Chromium, que cambia los márgenes reales del trabajo — el área impresa
  // queda más chica que la medida por el paginador y las hojas se desbordan
  // (la última fila de una hoja se imprimía ENCIMA de la primera de la
  // siguiente, y se cortaba la columna derecha). El pie del paginador ya trae
  // título · folio y "Página i de N" en cada hoja.
  const doPrint = (extra: Electron.WebContentsPrintOptions): Promise<{ success: boolean; reason: string }> =>
    new Promise((resolve) => {
      win.webContents.print(
        {
          printBackground: true,
          // Carta explícito: si el driver está configurado en A4, la geometría
          // medida (8.5×11in) no coincidiría con el papel.
          pageSize: 'Letter',
          duplexMode,
          ...extra
        },
        (success, failureReason) => resolve({ success, reason: failureReason })
      )
    })

  if (docPrinter) {
    // Tope de tiempo: si el intento silencioso falla sin invocar el callback
    // (pasa con configuraciones inválidas), no dejamos la UI colgada — se cae
    // al diálogo para que el usuario elija impresora.
    const r = await Promise.race([
      doPrint({ silent: true, deviceName: docPrinter }),
      new Promise<{ success: boolean; reason: string }>((resolve) =>
        setTimeout(() => resolve({ success: false, reason: 'timeout' }), 60_000)
      )
    ])
    if (r.success) return { ok: true }
    // La configurada falló → deja elegir otra con el diálogo.
  }
  const r = await doPrint({ silent: false })
  if (!r.success) {
    if (/cancel/i.test(r.reason)) return { ok: false, cancelled: true }
    return { ok: false, error: r.reason || 'No se pudo imprimir' }
  }
  return { ok: true }
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
    const defaultName = `${det.tipo.toLowerCase()}-${stamp}-${folioMovimiento(det.tipo, det.numero)}.pdf`
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

    // El pie ("<doc> · folio X" + "Página i de N") lo pone el paginador en
    // contenido — idéntico al de la impresión directa.
    await renderEnVentanaOculta(
      buildHtml(det),
      async (win) => {
        const pdf = await win.webContents.printToPDF({
          pageSize: 'Letter',
          printBackground: true,
          // MISMA geometría que el @page (12mm = 0.4724in por lado) y que la
          // que mide el paginador: el PDF y lo impreso componen idéntico.
          margins: { marginType: 'custom', top: 0.4724, bottom: 0.4724, left: 0.4724, right: 0.4724 }
        })
        writeFileSync(filePath, pdf)
      },
      `${TITULOS[det.tipo]} · folio ${folioMovimiento(det.tipo, det.numero)}`
    )

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

  // Con "Detalle de lotes en impresión": bajo cada producto va una sub-fila
  // (tr.sub) con sus lotes "caducidad ×cantidad" — el paginador la empaca
  // JUNTO con su fila padre para que nunca queden en hojas distintas.
  const conLotes = Boolean(input.incluirLotes)
  const filas = input.items
    .map((it, i) => {
      const cadClase = it.vencido ? 'bad' : it.porVencer ? 'warn' : ''
      const lotes = conLotes ? (it.lotes ?? []) : []
      const fila = `<tr${lotes.length > 0 ? ' class="con-sub"' : ''}>
        <td class="num">${i + 1}</td>
        <td class="mono">${esc(it.codigo)}</td>
        <td>${esc(it.nombre)}${it.bajoMinimo ? ' <span class="warn">▼ bajo mín</span>' : ''}</td>
        <td class="sec">${esc(it.sustanciaActiva ?? '—')}</td>
        <td class="num">${entero(it.existencias)}</td>
        <td class="num">${it.stockMinimo ? entero(it.stockMinimo) : '—'}</td>
        <td class="num">$${money(it.valorCosto)}</td>
        <td class="mono center ${cadClase}">${esc(fechaDMA(it.proximaCaducidad) ?? '—')}</td>
      </tr>`
      if (lotes.length === 0) return fila
      // Cada lote entre corchetes: [fecha ×cantidad] — separa visualmente
      // cada fecha con su cantidad al leer/anotar sobre la hoja impresa.
      const detalle = lotes
        .map((l) => {
          const cls = l.vencido ? ' bad' : l.porVencer ? ' warn' : ''
          return `<span class="lote${cls}">[${esc(fechaDMA(l.caducidad) ?? '—')} ×${entero(l.saldo)}]</span>`
        })
        .join(' ')
      return `${fila}
      <tr class="sub">
        <td></td>
        <td colspan="7" class="lotes-det">Lotes (FEFO): ${detalle}</td>
      </tr>`
    })
    .join('\n')

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Stock por bodega — ${esc(input.bodegaNombre)}</title>
<style>${estilosDoc()}${estilosStockCompacto()}</style>
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

    await renderEnVentanaOculta(
      buildStockHtml(input),
      async (win) => {
        const pdf = await win.webContents.printToPDF({
          pageSize: 'Letter',
          printBackground: true,
          // MISMA geometría que el @page (12mm = 0.4724in por lado) y que la
          // que mide el paginador: el PDF y lo impreso componen idéntico.
          margins: { marginType: 'custom', top: 0.4724, bottom: 0.4724, left: 0.4724, right: 0.4724 }
        })
        writeFileSync(filePath, pdf)
      },
      `Stock por bodega · ${input.bodegaNombre}`
    )

    await shell.openPath(filePath)
    return { ok: true, path: filePath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Manda el reporte de stock a la impresora de documentos configurada. */
export async function imprimirStockBodega(input: StockBodegaPdfInput): Promise<PdfMovimientoResult> {
  try {
    return await renderEnVentanaOculta(
      buildStockHtml(input),
      (win) => printDoc(win),
      `Stock por bodega · ${input.bodegaNombre}`
    )
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function ymdHoy(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Manda un movimiento directo a la impresora: mismo documento que el PDF (el
 * pie con "Página i de N" lo pone el paginador en contenido, así que sale
 * idéntico impreso o guardado).
 */
export async function imprimirMovimiento(folio: string): Promise<PdfMovimientoResult> {
  try {
    const det = getMovimientoDetalle(folio)
    if (!det) return { ok: false, error: 'Movimiento no encontrado en el historial' }

    return await renderEnVentanaOculta(
      buildHtml(det),
      (win) => printDoc(win),
      `${TITULOS[det.tipo]} · folio ${folioMovimiento(det.tipo, det.numero)}`
    )
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Pedido de surtido a sucursal: 3 copias ──────────────────────────────────
// 2 al capturar (sucursal destino + ORIGINAL del propietario) y 1 al aprobar
// (ARCHIVO). Cada copia se manda como trabajo de impresión separado.

export interface PedidoPrintData {
  numero: number
  tipo: 'SUCURSAL' | 'PROVEEDOR'
  fecha: string // ISO
  sucursalCodigo: string
  sucursalNombre: string
  /** Bodega elegida para surtir (matriz multi-bodega); null = no aplica. */
  bodegaNombre?: string | null
  creadoNombre: string | null
  notas: string | null
  items: { codigo: string; nombre: string; cantidad: number }[]
}

/** Una copia del pedido. `titulo` = rótulo centrado en grande hasta arriba. */
interface CopiaPedido {
  etiqueta: string
  titulo?: string
}

/**
 * SUCURSAL: 3 copias. Los índices son el ORDEN EN QUE SE IMPRIMEN:
 *   [0] y [1] al TERMINAR la captura (la de la sucursal y el ORIGINAL del
 *   propietario), [2] al APROBARSE en la matriz (la de archivo).
 * PROVEEDOR: UNA sola — la lista de compra, y sólo tras aprobarse.
 */
const COPIAS_PEDIDO: Record<PedidoPrintData['tipo'], CopiaPedido[]> = {
  SUCURSAL: [
    { etiqueta: 'COPIA: SUCURSAL DESTINO', titulo: 'COPIA' },
    { etiqueta: 'COPIA: PROPIETARIO', titulo: 'ORIGINAL' },
    { etiqueta: 'COPIA: ARCHIVO', titulo: 'ARCHIVO' }
  ],
  PROVEEDOR: [{ etiqueta: 'PEDIDO DE COMPRA' }]
}

const TITULO_PEDIDO: Record<PedidoPrintData['tipo'], string> = {
  SUCURSAL: 'Pedido de surtido a sucursal',
  PROVEEDOR: 'Pedido a proveedor'
}

function buildPedidoHtml(p: PedidoPrintData, copiaIdx?: number): string {
  const negocio = encabezadoNegocio()
  const fecha = new Date(p.fecha).toLocaleString('es-MX', {
    dateStyle: 'long',
    timeStyle: 'short'
  })
  const unidades = p.items.reduce((s, l) => s + (Number(l.cantidad) || 0), 0)

  const datos: Array<[string, string]> = [
    ['Folio', `P-${p.numero}`],
    ['Fecha', fecha],
    p.tipo === 'PROVEEDOR'
      ? ['Proveedor', p.sucursalNombre]
      : ['Sucursal destino', `${p.sucursalNombre} (${p.sucursalCodigo})`]
  ]
  if (p.tipo !== 'PROVEEDOR' && p.bodegaNombre) datos.push(['Bodega que surte', p.bodegaNombre])
  if (p.creadoNombre) datos.push(['Solicitó', p.creadoNombre])
  if (p.notas) datos.push(['Notas', p.notas])

  const filas = p.items
    .map(
      (l, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td class="mono">${esc(l.codigo)}</td>
        <td>${esc(l.nombre)}</td>
        <td class="num">${entero(l.cantidad)}</td>
      </tr>`
    )
    .join('\n')

  // Cada copia lleva los espacios de firma. Si se pide UNA copia (copiaIdx),
  // se renderiza sola — cada copia se manda como trabajo de impresión
  // SEPARADO: así el dúplex nunca junta dos copias en la misma hoja y la
  // numeración de páginas es por copia ("1 de N" de esa copia).
  const listaCopias =
    copiaIdx != null
      ? [COPIAS_PEDIDO[p.tipo][copiaIdx] ?? { etiqueta: 'COPIA' }]
      : COPIAS_PEDIDO[p.tipo]
  // El rótulo centrado va DENTRO del <section> (nunca como hijo de <body>: el
  // paginador detecta las copias con `todos los hijos son <section>`).
  const copias = listaCopias.map(
    (copia, idx) => `
  <section ${idx < listaCopias.length - 1 ? 'style="page-break-after: always;"' : ''}${
    copia.titulo ? ` data-pie="${esc(copia.titulo)}"` : ''
  }>
    ${copia.titulo ? `<div class="hoja-titulo">${esc(copia.titulo)}</div>` : ''}
    <header>
      <div>
        <div class="negocio">${esc(negocio.nombre)}</div>
        ${negocio.subtitulo ? `<div class="negocio-sub">${esc(negocio.subtitulo)}</div>` : ''}
      </div>
      <div class="doc-titulo">
        ${esc(TITULO_PEDIDO[p.tipo])}<br>
        <span class="doc-tipo">${esc(copia.etiqueta)}</span>
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
          <th style="width:130px">Código</th>
          <th>Producto</th>
          <th style="width:70px">${p.tipo === 'PROVEEDOR' ? 'Exist.' : 'Cant.'}</th>
        </tr>
      </thead>
      <tbody>
        ${filas || '<tr><td colspan="4" class="center">Sin líneas</td></tr>'}
      </tbody>
    </table>

    <div class="totales">
      <div><div class="label">Líneas</div><div class="value">${entero(p.items.length)}</div></div>
      <div><div class="label">Unidades</div><div class="value">${entero(unidades)}</div></div>
    </div>

    <div class="firmas">
      <div class="firma"><div class="linea"></div><div class="rol">Surtió</div></div>
      <div class="firma"><div class="linea"></div><div class="rol">Revisó</div></div>
      <div class="firma"><div class="linea"></div><div class="rol">Firma de autorización</div></div>
    </div>

    <footer>Documento generado por Farmacias MS POS · ${esc(
      new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
    )}</footer>
  </section>`
  ).join('\n')

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(TITULO_PEDIDO[p.tipo])} P-${p.numero}</title>
<style>${estilosDoc()}</style>
</head>
<body>
${copias}
</body>
</html>`
}

/**
 * Guarda el pedido como PDF (tamaño carta) donde el usuario elija — típico:
 * USB o para mandarlo digital al proveedor. PROVEEDOR genera 1 hoja; SUCURSAL
 * las 3 copias (sucursal, ORIGINAL y ARCHIVO) en un solo PDF: es el respaldo
 * digital completo. Al terminar se abre con el visor del sistema.
 */
export async function exportPedidoPdf(
  p: PedidoPrintData,
  window: BrowserWindow | null
): Promise<PdfMovimientoResult> {
  try {
    const stamp = p.fecha.slice(0, 10).replace(/-/g, '')
    const base = p.sucursalNombre.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const prefijo = p.tipo === 'PROVEEDOR' ? 'pedido-compra' : 'pedido-surtido'
    const opts = {
      title: `Guardar PDF de ${TITULO_PEDIDO[p.tipo].toLowerCase()}`,
      defaultPath: join(app.getPath('documents'), `${prefijo}-P-${p.numero}-${base}-${stamp}.pdf`),
      filters: [
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    }
    const dlg = window ? await dialog.showSaveDialog(window, opts) : await dialog.showSaveDialog(opts)
    if (dlg.canceled || !dlg.filePath) return { ok: false, cancelled: true }
    const filePath = dlg.filePath

    await renderEnVentanaOculta(
      buildPedidoHtml(p),
      async (win) => {
        const pdf = await win.webContents.printToPDF({
          pageSize: 'Letter',
          printBackground: true,
          // MISMA geometría que el @page (12mm = 0.4724in por lado) y que la
          // que mide el paginador: el PDF y lo impreso componen idéntico.
          margins: { marginType: 'custom', top: 0.4724, bottom: 0.4724, left: 0.4724, right: 0.4724 }
        })
        writeFileSync(filePath, pdf)
      },
      `${TITULO_PEDIDO[p.tipo]} · folio P-${p.numero}`
    )

    await shell.openPath(filePath)
    return { ok: true, path: filePath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Imprime el pedido en la impresora de documentos configurada. Con `copiaIdx`
 * imprime SÓLO esa copia (trabajo separado): el renderer manda las copias una
 * por una con su progreso, el dúplex aplica dentro de cada copia sin mezclar
 * dos copias en una hoja, y cada copia se numera "página X de Y" por sí sola.
 */
export async function imprimirPedidoSurtido(
  p: PedidoPrintData,
  copiaIdx?: number
): Promise<PdfMovimientoResult> {
  try {
    const total = COPIAS_PEDIDO[p.tipo].length
    // El pie NO menciona "hoja X de Y" (se confundía con "Página i de N");
    // qué copia es ya lo dice el recuadro del encabezado (COPIA: …).
    return await renderEnVentanaOculta(
      buildPedidoHtml(p, copiaIdx),
      (win) =>
        printDoc(win, {
          // Sin copiaIdx (las 3 juntas en un trabajo): a UNA cara para que dos
          // copias no compartan hoja. Por copia separada el dúplex sí aplica.
          forzarSimplex: copiaIdx == null && total > 1
        }),
      `${TITULO_PEDIDO[p.tipo]} · folio P-${p.numero}`
    )
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Resumen de surtido a sucursales (consolidado del rango, sin repetir) ─────

export interface ResumenSurtidoPrintData {
  desde: string // 'AAAA-MM-DD'
  hasta: string
  traspasos: { numero: number; destino: string }[]
  items: { codigo: string; nombre: string; enviado: number; existencia: number; destinos: number }[]
  totalUnidades: number
}

function buildResumenSurtidoHtml(r: ResumenSurtidoPrintData): string {
  const negocio = encabezadoNegocio()
  const fmt = (ymd: string): string => {
    const [y, m, d] = ymd.split('-')
    return `${d}/${m}/${y}`
  }
  const destinosUnicos = [...new Set(r.traspasos.map((t) => t.destino))]

  const filas = r.items
    .map(
      (it, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td class="mono">${esc(it.codigo)}</td>
        <td>${esc(it.nombre)}</td>
        <td class="num">${entero(it.enviado)}</td>
        <td class="num">${entero(it.existencia)}</td>
        <td class="num sec">${entero(it.destinos)}</td>
        <td></td>
      </tr>`
    )
    .join('\n')

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Resumen de surtido ${esc(fmt(r.desde))} a ${esc(fmt(r.hasta))}</title>
<style>${estilosDoc()}</style>
</head>
<body>
  <header>
    <div>
      <div class="negocio">${esc(negocio.nombre)}</div>
      ${negocio.subtitulo ? `<div class="negocio-sub">${esc(negocio.subtitulo)}</div>` : ''}
    </div>
    <div class="doc-titulo">
      Resumen de surtido a sucursales<br>
      <span class="doc-tipo">CONSOLIDADO</span>
    </div>
  </header>

  <table class="datos">
    <tr><td class="k">Periodo:</td><td class="v">${esc(fmt(r.desde))} — ${esc(fmt(r.hasta))}</td></tr>
    <tr><td class="k">Traspasos:</td><td class="v">${entero(r.traspasos.length)} (${r.traspasos
      .map((t) => `T-${t.numero}`)
      .join(', ')})</td></tr>
    <tr><td class="k">Destinos:</td><td class="v">${esc(destinosUnicos.join(' · '))}</td></tr>
  </table>

  <table class="items">
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th style="width:115px">Código</th>
        <th>Producto</th>
        <th style="width:62px">Enviado</th>
        <th style="width:62px">Exist.</th>
        <th style="width:50px">Dest.</th>
        <th style="width:70px">Pedir</th>
      </tr>
    </thead>
    <tbody>
      ${filas || '<tr><td colspan="7" class="center">Sin traspasos en el periodo</td></tr>'}
    </tbody>
  </table>

  <div class="totales">
    <div><div class="label">Productos</div><div class="value">${entero(r.items.length)}</div></div>
    <div><div class="label">Unidades enviadas</div><div class="value">${entero(r.totalUnidades)}</div></div>
  </div>

  <footer>La columna "Pedir" es para anotar a mano los faltantes — base del pedido a proveedor ·
    Documento generado por Farmacias MS POS · ${esc(
      new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
    )}</footer>
</body>
</html>`
}

/** Imprime el resumen de surtido en la impresora de documentos (columna "Pedir" en blanco). */
export async function imprimirResumenSurtido(
  r: ResumenSurtidoPrintData
): Promise<PdfMovimientoResult> {
  try {
    return await renderEnVentanaOculta(
      buildResumenSurtidoHtml(r),
      (win) => printDoc(win),
      `Resumen de surtido · ${r.desde} a ${r.hasta}`
    )
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Construcción del HTML ────────────────────────────────────────────────────

// Tamaño de letra configurable (Configuración → "Tamaño de letra de
// documentos"): chico = el tamaño original; mediano/grande escalan TODAS las
// fuentes de los documentos. El paginador en contenido mide el DOM ya
// escalado, así que las hojas y la numeración se ajustan solas (letra más
// grande = más hojas).
const ESCALA_DOC = { chico: 1, mediano: 1.2, grande: 1.4 } as const

function escalaDoc(): number {
  const { docFontSize } = getSettings()
  return ESCALA_DOC[docFontSize] ?? 1
}

// Estilos compartidos por todos los documentos imprimibles (carta), con las
// fuentes escaladas al tamaño configurado.
function estilosDoc(): string {
  const k = escalaDoc()
  const fs = (n: number): string => `${Math.round(n * k * 10) / 10}px`
  return `
  /* margin 12mm en los 4 lados: mayor que el área no imprimible de cualquier
     láser, así la caja de página (725.29 x 965.29 px) es la MISMA en toda
     impresora y coincide con la que mide el paginador y con la que se le pasa
     a printToPDF (0.4724in). */
  @page { size: letter; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  /* line-height numérico (no 'normal'): 'normal' depende de las métricas del
     dispositivo y hacía que lo impreso midiera más que lo medido en pantalla
     — el origen de los renglones encimados. */
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: ${fs(10)}; color: #111;
         line-height: 1.25; }

  /* Hojas que arma el paginador. Alto fijo MENOR que la caja de @page, y
     overflow:hidden como red de seguridad: un desborde residual jamás puede
     sangrar sobre la hoja siguiente. */
  .hoja { position: relative; width: 100%; height: 940px; overflow: hidden;
          page-break-after: always; break-after: page; }
  .hoja > .pie { position: absolute; left: 0; right: 0; bottom: 0;
                 display: flex; justify-content: space-between; align-items: flex-end;
                 background: #fff; z-index: 2;
                 font-size: ${fs(10)}; line-height: 1.25; color: #333; }

  /* Rótulo centrado de la copia (ORIGINAL / ARCHIVO), hasta arriba de la hoja. */
  .hoja-titulo { text-align: center; font-weight: 700; font-size: ${fs(16)};
                 text-transform: uppercase; letter-spacing: 2px; margin: 0 0 6px; }

  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #111; padding-bottom: 5px; margin-bottom: 6px; }
  .negocio { font-size: ${fs(14)}; font-weight: 700; }
  .negocio-sub { color: #555; margin-top: 1px; }
  .doc-titulo { text-align: right; font-size: ${fs(13)}; font-weight: 700; text-transform: uppercase; }
  .doc-tipo { display: inline-block; margin-top: 3px; padding: 1px 7px; border: 1px solid #111;
              border-radius: 3px; font-size: ${fs(9)}; letter-spacing: 1px; }
  .datos { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  .datos td { padding: 1px 6px; vertical-align: top; }
  .datos .k { color: #555; white-space: nowrap; width: ${Math.round(110 * k)}px; }
  .datos .v { font-weight: 600; }
  .mono { font-family: Consolas, 'Courier New', monospace; }
  /* table-layout:fixed: las columnas miden igual en la tabla original (donde
     el paginador mide las filas) que en las tablas clonadas por hoja. */
  table.items { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.items th { background: #f0f0f0; border: 1px solid #999; padding: 2px 5px;
                   font-size: ${fs(9)}; line-height: 1.25; text-transform: uppercase;
                   letter-spacing: 0.3px; text-align: left; }
  table.items td { border: 1px solid #bbb; padding: 2px 5px; line-height: 1.25;
                   overflow-wrap: anywhere; word-break: break-word; }
  table.items tr { page-break-inside: avoid; break-inside: avoid; }
  .num { text-align: right; font-family: Consolas, 'Courier New', monospace; white-space: nowrap; }
  .center { text-align: center; }
  .sec { font-size: ${fs(10)}; color: #444; }
  .warn { color: #b45309; font-weight: 600; }
  .bad { color: #b91c1c; font-weight: 700; }
  tfoot td { border: none !important; padding-top: 8px; font-size: ${fs(12)}; }
  .kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-bottom: 12px; }
  .kpi { border: 1px solid #ccc; border-radius: 4px; padding: 5px 8px; background: #f8f8f8; }
  .kpi .label { color: #555; font-size: ${fs(8)}; text-transform: uppercase; letter-spacing: 0.4px; }
  .kpi .value { font-size: ${fs(12)}; font-weight: 700; font-family: Consolas, monospace; }
  .totales { display: flex; justify-content: flex-end; gap: 24px; margin-top: 6px;
             padding: 5px 8px; background: #f5f5f5; border: 1px solid #ccc; border-radius: 4px; }
  .totales div { text-align: right; }
  .totales .label { color: #555; font-size: ${fs(10)}; text-transform: uppercase; }
  .totales .value { font-size: ${fs(13)}; font-weight: 700; font-family: Consolas, monospace; }
  .firmas { display: flex; justify-content: space-around; gap: 40px; margin-top: 30px;
            page-break-inside: avoid; }
  .firma { flex: 1; max-width: 220px; text-align: center; }
  .firma .linea { border-top: 1px solid #111; margin-bottom: 4px; }
  .firma .rol { font-size: ${fs(10)}; color: #555; }
  footer { margin-top: 14px; text-align: center; color: #888; font-size: ${fs(9)}; }
`
}

// Compactación EXTRA para el reporte de stock (suele tener cientos de filas).
// Reduce alto de fila al máximo razonable para usar menos hojas. También
// escala con el tamaño configurado (relativo a sus valores compactos).
function estilosStockCompacto(): string {
  const k = escalaDoc()
  const fs = (n: number): string => `${Math.round(n * k * 10) / 10}px`
  // Paddings y tamaños ENTEROS: los fraccionarios (0.5px, 7.5px) redondean
  // distinto a 96dpi que a la resolución de la impresora.
  return `
  table.items td { padding: 1px 4px; font-size: ${fs(8)}; line-height: 1.12; }
  table.items th { padding: 2px 4px; font-size: ${fs(8)}; line-height: 1.12; }
  table.items .sec { font-size: ${fs(8)}; line-height: 1.12; }
  .kpis { gap: 4px; margin-bottom: 5px; }
  .kpi { padding: 3px 6px; }
  .kpi .label { font-size: ${fs(7)}; }
  .kpi .value { font-size: ${fs(11)}; }
  header { margin-bottom: 5px; padding-bottom: 4px; }
  .negocio { font-size: ${fs(13)}; }
  .datos { margin-bottom: 5px; }
  .datos td { padding: 0.5px 6px; }
  .totales { margin-top: 6px; padding: 4px 8px; }
  footer { margin-top: 8px; }
  /* Sub-fila de lotes: pegada visualmente a su fila padre. Con
     border-collapse hay que apagar los DOS lados del borde compartido. */
  tr.con-sub td { border-bottom: none; }
  tr.sub td { border-top: none; padding: 0 4px 2px 4px; line-height: 1.12; }
  tr.sub .lotes-det { color: #555; font-size: ${fs(8)}; padding-left: 10px; }
  tr.sub .lote { font-family: Consolas, 'Courier New', monospace; white-space: nowrap; }
`
}

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

// 'YYYY-MM-DD' → 'DD-MM-YYYY': las caducidades se imprimen día-mes-año (igual
// que en pantalla). Si la fecha viene en otro formato, se deja tal cual.
function fechaDMA(s: string | null | undefined): string | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s
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
    ['Folio', folioMovimiento(det.tipo, det.numero)],
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
      return `<tr>
        <td class="num">${i + 1}</td>
        <td class="mono">${esc(l.codigo)}</td>
        <td>${esc(l.nombre)}</td>
        <td class="sec">${esc(l.sustancia ?? '—')}</td>
        <td class="mono center">${esc(fechaDMA(l.caducidad) ?? '—')}</td>
        ${conProveedorLinea ? `<td class="sec">${esc(provDeLinea(l))}</td>` : ''}
        ${conMotivoLinea ? `<td>${esc(l.motivo ?? '—')}</td>` : ''}
        <td class="num">${entero(l.cantidad)}</td>
      </tr>`
    })
    .join('\n')

  // Columnas base: #, Código, Producto, Sustancia, Caducidad, Cant.
  const cols = 6 + (conMotivoLinea ? 1 : 0) + (conProveedorLinea ? 1 : 0)

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(TITULOS[det.tipo])} ${esc(folioMovimiento(det.tipo, det.numero))}</title>
<style>${estilosDoc()}</style>
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
        <th style="width:120px">Código</th>
        <th>Producto</th>
        <th style="width:150px">Sustancia</th>
        <th style="width:80px">Caducidad</th>
        ${conProveedorLinea ? '<th style="width:130px">Proveedor</th>' : ''}
        ${conMotivoLinea ? '<th style="width:150px">Motivo</th>' : ''}
        <th style="width:60px">Cant.</th>
      </tr>
    </thead>
    <tbody>
      ${filas || `<tr><td colspan="${cols}" class="center">Sin líneas</td></tr>`}
    </tbody>
  </table>

  <div class="totales">
    <div><div class="label">Líneas</div><div class="value">${entero(det.lineas)}</div></div>
    <div><div class="label">Unidades</div><div class="value">${entero(det.unidades)}</div></div>
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
