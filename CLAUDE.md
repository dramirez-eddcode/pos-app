# CLAUDE.md — Farmacias MS POS

Contexto para trabajar en este proyecto. **Versión actual: v1.1.17.**

## Qué es
Punto de venta (POS) de escritorio para una cadena de farmacias, **100% local/offline** (sin nube). Matriz y sucursales se sincronizan **por USB**.

## Stack
- **Electron + electron-vite**, **React + TypeScript**, **Tailwind CSS**.
- **SQLite** con **better-sqlite3 + Drizzle ORM**.
- Empaquetado: **electron-builder** (instalador NSIS para Windows).
- **Requiere Node.js 22 LTS** (Node 24+ rompe better-sqlite3). Ver memoria [[pos-requiere-node-22]].

## Comandos
- `npm install`
- `npm run dev` — desarrollo
- `npm run typecheck` — valida tipos node + web. **SIEMPRE correrlo tras cambios, antes de empaquetar.**
- `npm run build:win` — instalador → `release/farmacias-ms-pos-<version>-setup.exe`. Ver memoria [[build-installer-windows]].

## Arquitectura (local-first, sync por USB)
Cada instalación se configura en el primer arranque (wizard) en uno de dos modos:
- **MATRIZ**: catálogo global, precios/IVA, bodegas, sucursales, genera paquetes. **Además puede vender en el mismo equipo** (equipo único que gestiona bodega y vende): los admins completos alternan Panel ↔ Punto de venta (tarjeta "Punto de venta" / botón "Matriz" en el POS; ruteo en `App.tsx` con `vistaPos`); CAJERO/SUPERVISOR en un equipo matriz entran directo al POS. Las ventas descuentan FEFO GLOBAL (todas las bodegas, `ventas.createVenta` no filtra por bodega).
- **SUCURSAL**: el POS que vende. Su inventario es LOCAL (su "Bodega Principal").

El stock NO se centraliza: vive en cada equipo (tabla `caducidad_lote` por bodega).

**Archivos de sincronización (USB):**
- `.farma` = matriz → sucursal: catálogo + precios + IVA (opcional: stock inicial y usuarios admin).
- `.traspaso` = mueve stock de una bodega de la matriz a una sucursal (descuenta origen, anti-duplicado por folio); la sucursal lo recibe como entrada.
- `.bak` = respaldo completo (copia del SQLite); restaurable desde el wizard.
- `.dat` = archivo del **sistema legacy** que aún generan; se importa para actualizar catálogo/precios. Ver memoria [[importador-dat-legacy]].

## Estructura de carpetas (`pos-app/`)
- `src/main/` — proceso principal de Electron
  - `index.ts` — crea la ventana (título con versión, maximizada, ícono)
  - `ipc.ts` — registro central de TODOS los handlers IPC (`ipcMain.handle`)
  - `db/connection.ts` — apertura SQLite + `ensureSchema()` (crea/migra tablas con `CREATE TABLE IF NOT EXISTS` / `ALTER` idempotentes en cada arranque)
  - `db/schema.ts` — schema Drizzle
  - `services/*.ts` — lógica de negocio: auth, productos, ventas, precios, entradas, ajustes, salidas, corte, bodegas, sucursales, empresa, instalacion, backup, exportSucursal, importSucursal, cargaInicial, stock, traspaso, movimientos, **importLegacyDat**, **permisos**
  - `printer/*` — impresión ESC/POS (RAW vía `resources/scripts/print-raw.ps1`)
- `src/preload/` — `index.ts` (expone `window.api.*`) + `index.d.ts` (tipos del api)
- `src/renderer/src/` — UI React (pages/, components/, stores/, hooks/, lib/)
- `src/shared/` — código compartido main↔renderer: `dto.ts` (tipos/DTO + helpers como `folioMovimiento`), `iva.ts`, `types.ts`, `receipt.ts`
- `resources/` + `electron-builder.yml`

## Patrón para agregar una función (de punta a punta)
1. Tipos en `src/shared/dto.ts`
2. Servicio en `src/main/services/*.ts` (`getSqlite()` para SQL crudo o Drizzle)
3. Handler en `src/main/ipc.ts` (`ipcMain.handle('dominio:accion', ...)`)
4. Exponer en `src/preload/index.ts` y tipar en `src/preload/index.d.ts` (`window.api.dominio.accion`)
5. Consumir en el componente/página del renderer
6. Si es tabla/columna nueva: agregarla en `ensureSchema()` de `db/connection.ts` (idempotente) — así se respalda sola (el `.bak` es copia completa del SQLite).

## Convenciones
- UI en **español**, listados grandes **paginados**, indicadores de carga (Spinner/BusyOverlay).
- El `Modal` compartido tiene scroll de overlay (los modales largos scrollean solos). Cierra con Esc o la X del encabezado; a propósito NO cierra con clic fuera del panel (un clic accidental perdería la captura en curso). Además navega con ↑/↓ entre los campos enfocables del panel (helper compartido `lib/arrowNav.ts`, estilo legacy: selecciona el contenido al enfocar; incluye selects cerrados — la opción se cambia abriendo el desplegable con Espacio/Alt+↓); respeta textareas/radios y los modales de lista con listeners en captura. El mismo helper se usa en Login, Wizard y el menú de Matriz; NO usarlo donde las flechas ya signifiquen otra cosa (carrito del POS).
- **NUNCA usar `confirm()`/`alert()` nativos en el renderer**: en Electron dejan la ventana sin foco de teclado (bug de Chromium) y la app queda "bloqueada" hasta alt-tab. Confirmaciones = toast de sonner con `action` (patrón de logout/cortes/descartar venta).
- Tras cualquier cambio: **`npm run typecheck`** antes de empaquetar.

## Subsistemas / decisiones clave (al día)
- **Folios de movimientos**: entradas/salidas/traspasos tienen un **UUID interno** (llave, sync USB, anti-duplicado) y un **folio numérico consecutivo por tipo** para mostrar: `E-1` (entrada), `S-1` (salida), `T-1` (traspaso). Helper `folioMovimiento(tipo, numero)` en `shared/dto.ts`. En reportes/PDF/historial se muestra el número corto, no el UUID. Ver memoria [[folio-numerico-movimientos]].
- **Roles**: SUPERUSUARIO (todo; único que ve/puede el reset de modo de instalación — `isSuperusuario` + gate en `instalacion.resetInstalacion`), ADMINISTRADOR (todo excepto el reset), SUPERVISOR (sólo en SUCURSAL: entradas de mercancía + aplicar actualizaciones .farma/.dat + reportes de sólo lectura —historial/consultar folio—; **recibir traspasos lo puede hacer en cualquier modo**, incluidas bodegas en modo MATRIZ que venden directo — gate propio `requireRecibirTraspaso` en `traspaso.ts`; NO edita precios/IVA ni catálogo a mano, NO corrige códigos duplicados — `requireAdmin` en `precios.ts`/`productos.ts`/`dedupCodigos.ts`), CAJERO. Gating en `services/permisos.ts` (`requireAdmin` / `requireAdminOrSupervisor`) y en `lib/roles.ts` (`isFullAdmin` / `isAdminLike`). Ver memoria [[rol-supervisor-permisos]].
- **Preview de confirmación**: entradas/salidas/traspasos muestran `ConfirmMovimientoModal` (productos + cantidades) antes de aplicar; Cancelar conserva la captura.
- **Corte**: por PERIODO, no por día — el "corte en pantalla" acumula desde el último corte FINAL (puede abarcar varios días o varios finales en un día) y el corte final cierra ese periodo completo y "limpia" la pantalla (los parciales/cambios de turno NO la limpian). Parcial se ve en pantalla (imprimir opcional); final imprime siempre e incluye el desglose de parciales del periodo y el **detalle de notas con tarjeta** (folio + monto tarjeta; en pago mixto sólo la parte tarjeta — `ventasConTarjeta` en corte.ts, aplica también a reimpresiones). El subsistema de "cortes finales pendientes por día" se eliminó (obsoleto con periodos), y el botón de "Cambio de turno" se quitó de la UI (en operación sólo usan parcial y final; el tipo CAMBIO_TURNO se conserva en backend por los registros históricos).
- **Stock por bodega**: opción "incluir existencia 0" y **edición inline de la caducidad** de cada lote (`stock.updateLoteCaducidad`).
- **Lotes agotados**: `getLotesByProducto` sólo regresa lotes con `saldo > 0` — los selectores de lote (ajustes, salidas, ficha F7) no listan lotes vacíos. Los lotes agotados NO se borran de BD (el kárdex `mov_stock` los referencia); se ven en Stock por bodega con "incluir existencia 0". Para revivir stock: Entrada de mercancía (lote nuevo), no ajuste sobre el lote vacío.
- **Salidas de inventario**: dos modos en `SalidasModal` — "Automático (FEFO)" (default: capturas la cantidad total y se reparte entre lotes descontando del más próximo a caducar, respetando lo ya capturado) y "Elegir lote". El motivo/nota es de TODO el documento (se aplica a cada línea al guardar). Backend sin cambios.
- **Ajustes de inventario**: dos modos en `AjustesModal` — "Automático" (default; captura la existencia total del producto; el modal reparte en líneas por lote: las bajas descuentan FEFO —lote más próximo a caducar primero— y las subidas van al lote más lejano) y "Por lote" (elige lote + nuevo saldo). El backend (`ajustes.createAjustes`) siempre recibe líneas por lote con saldo absoluto; la distribución se calcula en el renderer y se previsualiza en la tabla antes de guardar.
- **Historial de movimientos + kárdex**: `MovimientosModal` (matriz y sucursal vía F10, incluido supervisor) tiene dos pestañas: documentos (entradas/salidas/traspasos con PDF) y **"Movimientos de producto"** (kárdex; `movimientos.getKardexProducto`: journal `mov_stock` con saldo acumulado; referencia folio de venta; motivo limpio sin uuid). Al **recibir** un traspaso, `aplicarTraspaso` crea además un documento ENTRADA (folio E-n) — sin él, los traspasos recibidos no aparecerían en el historial de la sucursal.
- **Migración legacy**: el proyecto hermano `mdb-export` genera CSV desde `.mdb`. Existencias de bodega = columna "Existencia" (`CANTIDAD_PRODUCTO`). Ver memoria [[mdb-export-bodega-existencias]] y `../GUIA-MIGRACION.md`.
