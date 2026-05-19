# Farmacias MS POS

Punto de venta local-first para Farmacias MS, Electron + React + TypeScript + Tailwind/shadcn.
SQLite local por sucursal vía Drizzle. Sincronización opcional a Supabase (Fase 3).

## Comandos

```bash
npm install          # instalar dependencias
npm run dev          # arrancar en desarrollo (HMR)
npm run typecheck    # validar tipos (node + web)
npm run build        # compilar (dist en out/)
npm run build:win    # generar instalador NSIS para Windows
```

## Estructura

```
pos-app/
├── src/
│   ├── main/         # proceso principal de Electron
│   ├── preload/      # bridge contextIsolation seguro
│   ├── renderer/     # UI React (Vite)
│   └── shared/       # tipos y constantes compartidas main↔renderer
├── resources/        # assets (icono, etc.)
└── electron-builder.yml
```

## Estado

**Fase 0 — Fundación**: scaffolding del proyecto, Tailwind/shadcn, SQLite/Drizzle, smoke test.

Ver el plan completo en la conversación raíz del proyecto.
