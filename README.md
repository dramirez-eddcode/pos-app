# Farmacias MS POS

Punto de venta **100% local** para Farmacias MS — Electron + React + TypeScript +
Tailwind. SQLite local por equipo (vía Drizzle / better-sqlite3). **Sin dependencias
en la nube**: matriz y sucursales se sincronizan por **USB**.

> Versión actual: **v1.0.0**

## Modos de instalación

Cada equipo se configura, en el primer arranque, en uno de dos modos:

- **MATRIZ**: gestiona catálogo global, precios/IVA, bodegas, sucursales y genera
  paquetes para las sucursales. No vende.
- **SUCURSAL**: el POS que vende día a día. Su inventario es local (Bodega Principal).

## Requisitos

- **Node.js 22 LTS** (probado con `v22.22.3`). No usar Node 24+: `better-sqlite3`
  no tiene binarios precompilados para esas versiones y obliga a compilar desde
  código (Python + Visual Studio Build Tools con C++/ClangCL).

## Comandos

```bash
npm install          # instalar dependencias
npm run dev          # arrancar en desarrollo (HMR)
npm run typecheck    # validar tipos (node + web)
npm run build        # compilar (dist en out/)
npm run build:win    # generar instalador NSIS para Windows → release/
```

El instalador queda en `release/farmacias-ms-pos-<version>-setup.exe`.

> **Nota build en Windows:** si `electron-builder` falla al extraer `winCodeSign`
> con "Cannot create symbolic link", activa el **Modo de desarrollador** de Windows
> (Configuración → Para programadores) y reintenta. El instalador no está firmado:
> en el equipo destino, SmartScreen pedirá "Más información → Ejecutar de todas formas".

## Funcionalidades principales

- **POS de venta**: búsqueda de productos (paginada, atajos de teclado y botones),
  multiplicador `código*N`, IVA por producto (exento / incluido / sumar), cortes,
  cancelaciones e impresión de ticket ESC/POS (RAW vía `resources/scripts/print-raw.ps1`).
- **Catálogo y precios**: alta/edición de productos, IVA con vista previa del precio,
  carga masiva por CSV (catálogo y precios+IVA), todo paginado.
- **Inventario**: entradas por lote, ajustes, salidas, **carga inicial idempotente**
  (CSV) y **stock por bodega** con valor, caducidades y exportación de hoja de conteo.
- **Matriz ↔ Sucursal por USB**:
  - **Exportar `.farma`**: catálogo + precios (opcionalmente con **stock inicial** y
    usuarios admin para configurar una sucursal nueva de un solo archivo).
  - **Traspaso bodega → sucursal**: descuenta de una bodega y genera un `.traspaso`
    (anti-duplicado por folio); la sucursal lo recibe como entrada. **Historial de
    traspasos** con detalle en la matriz.
- **Respaldo / restauración**: copia completa del SQLite (incluye todo: ventas,
  inventario, traspasos, usuarios…). Restaurable desde el asistente inicial.
- **Configuración inicial** (wizard): MATRIZ, SUCURSAL, **configurar sucursal desde
  `.farma`** o **restaurar desde respaldo**.

## Migración desde el sistema legacy

Para migrar productos, precios y existencias de un respaldo `.mdb` legacy se usa el
proyecto **`mdb-export`** (carpeta hermana), que genera los CSV importables. El paso
a paso completo está en `../GUIA-MIGRACION.md`.

## Estructura

```
pos-app/
├── src/
│   ├── main/         # proceso principal (servicios, DB, IPC, impresión)
│   ├── preload/      # bridge contextIsolation seguro
│   ├── renderer/     # UI React (Vite) — páginas y componentes
│   └── shared/       # tipos/DTO y lógica compartida (IVA, etc.)
├── resources/        # icono e scripts auxiliares (print-raw.ps1)
└── electron-builder.yml
```

## Notas de datos

- La base vive en `userData/data/farmacias.db` (prod). El esquema se crea/actualiza
  solo al arrancar (`ensureSchema`, idempotente con `CREATE TABLE IF NOT EXISTS`).
- El stock es **local por equipo** (tabla `caducidad_lote` por bodega). La matriz no
  almacena el inventario de las sucursales; lo mueve por traspaso.
