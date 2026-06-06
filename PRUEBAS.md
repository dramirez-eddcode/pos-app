# Plan de pruebas — Farmacias MS POS

Checklist de QA para validar todos los módulos del POS antes de liberar. Incluye
pruebas por módulo y un **flujo completo end-to-end**. Cada caso tiene espacio
para marcar el resultado y anotar comentarios.

> Cuando algo no salga como se espera, márcalo ❌ o ⚠️, anota un comentario corto
> y registra el detalle en la sección **[Registro de incidencias](#registro-de-incidencias)**
> al final (con un ID tipo `BUG-01`). Después yo lo arreglo.

## Cómo usar este documento

**Leyenda de Estado:**

| Símbolo | Significado |
|---|---|
| ⬜ | Pendiente de probar |
| ✅ | Pasa correctamente |
| ⚠️ | Pasa pero con observaciones (anotar) |
| ❌ | Falla (registrar incidencia) |

En la columna **Comentarios** pon notas cortas o el ID de la incidencia (ej. `BUG-03`).

---

## Preparación del entorno

Antes de empezar, deja listo lo siguiente:

- [ ] App corriendo (`npm run dev` para desarrollo, o el instalador NSIS ya instalado).
- [ ] Impresora térmica EPSON TM-T20III instalada en Windows (o una impresora cualquiera para probar el flujo sin papel).
- [ ] Cajón de dinero conectado a la impresora (opcional, para probar apertura).
- [ ] Una o dos USB para probar export/import `.farma` y respaldos.

**Importante — cómo probar MATRIZ y SUCURSAL en el mismo equipo:** cada
instalación es MATRIZ *o* SUCURSAL (se define en el wizard). Para probar las dos
sin dos PCs, tienes dos opciones:

1. **Dos bases de datos** con la variable `POS_DB_PATH` apuntando a archivos
   distintos (una ventana como matriz, otra como sucursal). Recomendado para
   probar el flujo USB completo.
2. **Resetear el modo** desde Configuración → *Zona peligrosa* → "Resetear modo
   de instalación" entre una prueba y otra (más lento, borra usuarios y datos de
   sucursal).

| # | Preparación | Estado | Comentarios |
|---|---|---|---|
| P1 | La app abre sin errores en consola | ✅ | |
| P2 | Puedo abrir una segunda instancia/DB para simular sucursal | ❌ | Lo hare con 2 computadoras |
| P3 | La impresora aparece en la lista de Configuración | ✅ | |

---

## A. Wizard / Instalación (primer arranque)

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| A1 | Primer arranque con DB vacía | Muestra el Wizard, no el login | ✅ | |
| A2 | Configurar como **MATRIZ** con nombre de propietario | Crea instalación tipo MATRIZ y entra al panel de matriz | ✅ | |
| A3 | Configurar como **SUCURSAL** con código, nombre y datos fiscales | Crea la sucursal local + empresa (header de ticket) y entra al POS | ⬜ | |
| A4 | Crear admin nuevo en el wizard (login/nombre/password) | Queda como ADMINISTRADOR y puede iniciar sesión | ⬜ | |
| A5 | Campos obligatorios vacíos | No deja avanzar, muestra validación | ⬜ | |
| A6 | Reiniciar la app después de configurar | Ya no muestra wizard; va directo a login | ⬜ | |

---

## B. Login / Autenticación / Roles

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| B1 | Login con credenciales correctas | Entra al sistema (matriz o POS según el modo) | ⬜ | |
| B2 | Login con password incorrecto | Muestra error, no entra | ⬜ | |
| B3 | Login con usuario inexistente | Muestra error | ⬜ | |
| B4 | Login con usuario desactivado | No deja entrar | ⬜ | |
| B5 | Rol CAJERO inicia sesión en POS | Entra pero sin acceso a F10 (Procesos) | ⬜ | |
| B6 | Rol ADMINISTRADOR/SUPERVISOR en POS | Tiene acceso a F10 (Procesos) | ⬜ | |
| B7 | Cerrar sesión (F12 en POS / botón en matriz) | Pide confirmación y regresa al login | ⬜ | |

---

## C. Matriz — Sucursales

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| C1 | Abrir tarjeta "Sucursales" | Lista las sucursales con total/activas | ⬜ | |
| C2 | Crear sucursal nueva (código único + datos) | Aparece en la lista | ⬜ | |
| C3 | Crear sucursal con código duplicado | Muestra error de código repetido | ⬜ | |
| C4 | Editar datos de una sucursal | Guarda y refleja los cambios | ⬜ | |
| C5 | Desactivar una sucursal | Queda marcada inactiva | ⬜ | |
| C6 | Reactivar una sucursal | Vuelve a activa | ⬜ | |
| C7 | Un CAJERO intenta entrar a Sucursales | Bloqueado (requiere admin) | ⬜ | |

---

## C2. Matriz — Bodegas

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| CB1 | Abrir tarjeta "Bodegas" | Lista las bodegas; existe "Bodega Principal" por default | ⬜ | |
| CB2 | Crear una bodega nueva (código único + nombre) | Aparece en la lista | ⬜ | |
| CB3 | Crear bodega con código duplicado | Muestra error | ⬜ | |
| CB4 | Editar datos de una bodega | Guarda los cambios | ⬜ | |
| CB5 | Desactivar/activar una bodega NO principal | Cambia el estado | ⬜ | |
| CB6 | Intentar desactivar la "Bodega Principal" | Lo impide (no se puede desactivar) | ⬜ | |
| CB7 | La columna "Existencias" muestra el stock de cada bodega | Suma los saldos de los lotes de esa bodega | ⬜ | |
| CB8 | Un CAJERO intenta crear/editar bodega | Bloqueado (requiere admin) | ⬜ | |

---

## D. Matriz — Catálogo de productos (incluye **preview de IVA**)

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| D1 | Abrir "Catálogo de productos" | Lista productos con código, precio, IVA y stock | ⬜ | |
| D2 | Filtrar por código / nombre / sustancia / laboratorio | Filtra correctamente | ⬜ | |
| D3 | Filtrar con los chips de IVA (Exento/Sumar/Incluido) | Muestra solo los del modo elegido | ⬜ | |
| D4 | Mostrar/ocultar inactivos | El checkbox alterna la visibilidad | ⬜ | |
| D5 | Crear producto **exento** | Se guarda con IVA 0, badge "Exento" | ⬜ | |
| D6 | Crear producto **sumar** (precio neto) | Preview muestra Importe = precio, IVA = precio×tasa, Precio venta = precio+IVA | ⬜ | |
| D7 | Crear producto **incluido** | Preview desglosa: Precio venta = precio capturado, Importe e IVA desglosados | ⬜ | |
| D8 | Al elegir modo con IVA, la tasa se pre-llena con el default | El campo "% IVA" toma el default del negocio automáticamente | ⬜ | |
| D9 | El preview se actualiza al cambiar precio / modo / % | Cambia en vivo | ⬜ | |
| D10 | Crear producto con código duplicado | Muestra error | ⬜ | |
| D11 | Editar producto (nombre, sustancia, lab, costo, stock min/max) | Guarda cambios | ⬜ | |
| D12 | En edición, precio e IVA salen como **solo lectura** | No editables (se cambian en sus módulos con auditoría) | ⬜ | |
| D13 | Desactivar / activar producto | Cambia el estado | ⬜ | |
| D14 | **CSV → Plantilla**: descargar plantilla | Baja un CSV con encabezado + 1 fila de ejemplo | ⬜ | |
| D15 | **CSV → Exportar**: exportar catálogo actual | Baja un CSV con todos los productos (código, precio, IVA, stock…) | ⬜ | |
| D16 | **CSV → Importar**: subir CSV con productos nuevos | Los crea (toast "X creados") y aparecen en la lista | ⬜ | |
| D17 | **CSV → Importar**: subir CSV con códigos existentes | Los actualiza (toast "X actualizados"), incluye precio e IVA | ⬜ | |
| D18 | Importar CSV con filas inválidas (sin nombre/precio) | Reporta "N con error" y omite solo esas filas | ⬜ | |

---

## E. Matriz — Impuestos (IVA)

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| E1 | Abrir tarjeta "Impuestos (IVA)" | Muestra el IVA default actual (ej. 16) | ⬜ | |
| E2 | Cambiar el IVA default (ej. a 8) y guardar | Toast de confirmación; queda guardado | ⬜ | |
| E3 | Reabrir el modal | Muestra el valor recién guardado | ⬜ | |
| E4 | Crear un producto nuevo con modo "sumar" | La tasa se pre-llena con el nuevo default | ⬜ | |
| E5 | Validación: porcentaje fuera de 0–100 | Rechaza el valor | ⬜ | |
| E6 | Un CAJERO abre Impuestos | Ve el valor pero no puede guardar | ⬜ | |

---

## F. Precios (con auditoría)

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| F1 | Abrir módulo de Precios | Permite buscar/seleccionar productos | ⬜ | |
| F2 | Cambiar el precio de un producto con motivo | Se actualiza el precio | ⬜ | |
| F3 | Verificar que el precio nuevo se refleja en el catálogo y en ventas | El POS cobra con el precio nuevo | ⬜ | |
| F4 | Importar cambios de precio por **CSV** | Aplica los precios del archivo | ⬜ | |
| F5 | CSV con código inexistente | Reporta el error / lo omite | ⬜ | |
| F6 | El cambio queda en histórico de precios | Hay registro con precio anterior/nuevo + motivo | ⬜ | |

---

## G. Entradas de mercancía (lotes con caducidad)

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| G1 | Registrar entrada de un producto (cantidad, costo, caducidad) | Crea lote y suma existencias | ⬜ | |
| G2 | Entrada sin fecha de caducidad | Usa default (+2 años) | ⬜ | |
| G3 | Entrada de varios productos a la vez | Crea todos los lotes | ⬜ | |
| G4 | Importar entradas por **CSV** | Crea los lotes del archivo | ⬜ | |
| G5 | Verificar existencias en el catálogo después de la entrada | El stock refleja lo ingresado | ⬜ | |
| G6 | Con 2+ bodegas, elegir la **bodega destino** antes de guardar | El stock entra a la bodega elegida (verificar en Bodegas → Existencias) | ⬜ | |
| G7 | Con una sola bodega, el destino se muestra fijo (Bodega Principal) | No exige elegir; usa la principal | ⬜ | |

---

## H. Salidas de inventario

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| H1 | Registrar salida por lote (motivo: caducidad/merma/traspaso/muestra/ajuste) | Resta del saldo del lote | ⬜ | |
| H2 | Salida mayor al saldo disponible | Rechaza o avisa | ⬜ | |
| H3 | Importar salidas por **CSV** | Aplica las salidas del archivo | ⬜ | |
| H4 | Verificar existencias después de la salida | El stock baja correctamente | ⬜ | |

---

## I. Ajustes de inventario

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| I1 | Ajustar el saldo de un lote hacia arriba | El saldo sube al valor indicado | ⬜ | |
| I2 | Ajustar el saldo hacia abajo | El saldo baja al valor indicado | ⬜ | |
| I3 | Ajuste con motivo (merma/caducidad/faltante/conteo/otro) | Registra el motivo | ⬜ | |
| I4 | Importar ajustes por **CSV** | Aplica los ajustes del archivo | ⬜ | |
| I5 | El movimiento queda en el journal de stock (mov_stock) | Hay registro del delta | ⬜ | |

---

## J. Usuarios

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| J1 | Listar usuarios | Muestra login, nombre, rol, estado | ⬜ | |
| J2 | Crear usuario CAJERO | Se crea y puede iniciar sesión | ⬜ | |
| J3 | Crear usuario ADMINISTRADOR | Se crea con permisos de admin | ⬜ | |
| J4 | Crear usuario con login duplicado | Muestra error | ⬜ | |
| J5 | Activar/desactivar "puede cancelar" | El flag se respeta en cancelaciones | ⬜ | |
| J6 | Resetear password de un usuario | El usuario entra con el password nuevo | ⬜ | |
| J7 | Desactivar usuario | Ya no puede iniciar sesión | ⬜ | |
| J8 | Editar nombre/rol de un usuario | Guarda cambios | ⬜ | |

---

## K. Catálogo diferenciado por sucursal (overrides)

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| K1 | Abrir el catálogo de una sucursal específica | Muestra valores globales + efectivos | ⬜ | |
| K2 | Poner un **precio distinto** para un producto en una sucursal | El override queda guardado | ⬜ | |
| K3 | **Excluir** un producto de una sucursal | Marcado como no aplica | ⬜ | |
| K4 | Quitar el override (volver al global) | Vuelve a heredar el precio global | ⬜ | |
| K5 | Exportar esa sucursal y verificar que respeta overrides/exclusiones | El `.farma` lleva precios override y omite los excluidos | ⬜ | |

---

## L. Exportar a sucursal (`.farma` por USB) — modo MATRIZ

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| L1 | Exportar una sucursal activa | Genera el archivo `.farma` con productos y datos | ⬜ | |
| L2 | El nombre sugerido del archivo incluye código/nombre/fecha | `farmacias-<codigo>-<nombre>-<fecha>.farma` | ⬜ | |
| L3 | Exportar una sucursal **desactivada** | Lo impide con mensaje claro | ⬜ | |
| L4 | Un CAJERO intenta exportar | Bloqueado (requiere admin) | ⬜ | |
| L5 | El archivo trae checksum y solo productos activos | Verificable abriendo el JSON | ⬜ | |
| L6 | (Pendiente diseño) Usuarios viajan en el alta | ⚠️ Aún no implementado — confirmar comportamiento actual | ⬜ | |

---

## M. Importar `.farma` en la sucursal — modo SUCURSAL

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| M1 | Seleccionar un `.farma` válido (preview) | Muestra sucursal, # de productos, fecha, sin aplicar todavía | ⬜ | |
| M2 | Aplicar el `.farma` (primera importación) | Crea/actualiza productos y adopta los datos de la sucursal | ⬜ | |
| M3 | Reimportar un `.farma` más nuevo de la misma sucursal | Actualiza productos (upsert por código) sin borrar locales | ⬜ | |
| M4 | Importar un `.farma` de **otra** sucursal | Avisa que es distinta y pide confirmación (force) | ⬜ | |
| M5 | Importar un archivo corrupto/modificado | Rechaza por checksum inválido | ⬜ | |
| M6 | Importar en modo MATRIZ | Lo impide (solo SUCURSAL) | ⬜ | |
| M7 | Un CAJERO intenta importar | Bloqueado (requiere admin) | ⬜ | |

---

## N. POS — Flujo de venta

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| N1 | Escanear/teclear código + Enter | Agrega el producto al carrito | ⬜ | |
| N2 | Usar multiplicador `codigo*cantidad` (ej. `16*3`) | Agrega 3 unidades | ⬜ | |
| N3 | Código inexistente | Muestra "Producto no encontrado" | ⬜ | |
| N4 | Producto sin existencias | Avisa que no hay stock, no lo agrega | ⬜ | |
| N5 | Agregar más cantidad que el stock disponible | Avisa cuántas faltan | ⬜ | |
| N6 | Buscar con **F5** y agregar desde la búsqueda | Agrega el seleccionado | ⬜ | |
| N7 | Info de medicamento con **F7** | Muestra info de la sustancia | ⬜ | |
| N8 | Seleccionar línea y eliminar con **SUPR** | Quita el renglón | ⬜ | |
| N9 | Cancelar venta en curso con **ESC** | Pide confirmación y limpia el carrito | ⬜ | |
| N10 | Totales: ARTÍCULOS / IMPORTE / IVA / TOTAL correctos | Coinciden con el desglose de IVA por producto | ⬜ | |
| N11 | Intentar cobrar sin impresora configurada | Avisa que configure la impresora primero | ⬜ | |
| N12 | Cobrar con **FIN** en efectivo (pago exacto) | Cambio 0, imprime ticket | ⬜ | |
| N13 | Cobrar en efectivo con pago mayor | Calcula el cambio correcto | ⬜ | |
| N14 | Cobrar con tarjeta | Registra el pago como TARJETA | ⬜ | |
| N15 | Cobrar con transferencia | Registra el pago como TRANSFERENCIA | ⬜ | |
| N16 | Pago mixto (efectivo + tarjeta) | Suma de pagos = total | ⬜ | |
| N17 | El cajón abre solo si hay efectivo y la opción está activa | Abre/no abre según corresponda | ⬜ | |
| N18 | Después de cobrar, el folio incrementa y el carrito se limpia | Listo para la siguiente venta | ⬜ | |
| N19 | El ticket impreso coincide con el formato legacy | Header, folio, tabla, IMPORTE/IVA/TOTAL/EFECTIVO/CAMBIO, pie | ⬜ | |
| N20 | El stock baja por lote (FEFO: caduca primero el más próximo) | El lote correcto pierde saldo | ⬜ | |

---

## O. POS — Cancelaciones

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| O1 | Abrir Cancelaciones (F11 → Cancelaciones) y buscar por folio | Muestra la venta | ⬜ | |
| O2 | Cancelar una venta con usuario que **puede cancelar** | Marca cancelada y reintegra el stock | ⬜ | |
| O3 | Usuario sin permiso de cancelar | Bloqueado | ⬜ | |
| O4 | Cancelar una venta ya cancelada | Lo impide / avisa | ⬜ | |
| O5 | Verificar que el stock vuelve al lote original | Las existencias se restauran | ⬜ | |
| O6 | La cancelación aparece reflejada en el corte | El monto cancelado se contabiliza | ⬜ | |

---

## P. POS — Corte de caja

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| P1 | Abrir "Corte en pantalla" (F11 → Corte) | Muestra ventas del día, totales por método, cancelaciones | ⬜ | |
| P2 | Los totales por método (efectivo/tarjeta/transferencia) cuadran | Coinciden con las ventas hechas | ⬜ | |
| P3 | Generar corte **parcial** | Registra el corte sin cerrar el día | ⬜ | |
| P4 | Generar corte **final** | Cierra el rango de folios del día | ⬜ | |
| P5 | El corte imprime correctamente | Ticket de corte legible | ⬜ | |
| P6 | Efectivo esperado considera entradas/salidas de caja | El cálculo cuadra | ⬜ | |

---

## Q. POS — Atajos de teclado (muscle memory legacy)

| # | Tecla | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| Q1 | **F5** | Abre Buscar | ⬜ | |
| Q2 | **F7** | Abre Info medicamento | ⬜ | |
| Q3 | **F10** | Abre Procesos (solo admin) | ⬜ | |
| Q4 | **F11** | Abre Funciones | ⬜ | |
| Q5 | **F12** | Cerrar sesión (con confirmación) | ⬜ | |
| Q6 | **FIN** | Terminar venta / cobrar | ⬜ | |
| Q7 | **SUPR** | Eliminar línea seleccionada | ⬜ | |
| Q8 | **ESC** | Cancelar venta en curso | ⬜ | |
| Q9 | **Pausa** | Muestra/oculta totales recientes (MS An-/A-/H-) | ⬜ | |
| Q10 | **↑/↓** | Navega líneas del carrito | ⬜ | |
| Q11 | **Ctrl+,** | Abre Configuración | ⬜ | |

---

## R. Configuración / Impresora / Cajón

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| R1 | Listar impresoras y seleccionar la EPSON | Queda guardada | ⬜ | |
| R2 | Imprimir ticket de prueba | Sale impreso | ⬜ | |
| R3 | Abrir cajón manualmente | El cajón abre | ⬜ | |
| R4 | Activar/desactivar "abrir cajón al cobrar en efectivo" | Se respeta en la venta | ⬜ | |
| R5 | Activar "mostrar hora en el ticket" | El ticket incluye la hora | ⬜ | |
| R6 | Poner un mensaje al pie del ticket | Aparece centrado al final | ⬜ | |
| R7 | La config de impresora sobrevive a reiniciar la app | Sigue seleccionada | ⬜ | |

---

## S. Respaldo y restauración

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| S1 | Crear respaldo desde la **tarjeta de la matriz** | Genera el `.bak` en la USB | ⬜ | |
| S2 | Crear respaldo desde **F11 → Respaldo** (POS) | Genera el `.bak` | ⬜ | |
| S3 | Crear respaldo desde **Configuración (⚙)** | Genera el `.bak` | ⬜ | |
| S4 | Un CAJERO crea respaldo | Permitido (crear sí) | ⬜ | |
| S5 | Un CAJERO intenta restaurar | Bloqueado (restaurar es solo admin) | ⬜ | |
| S6 | Restaurar pide escribir "RESTAURAR" | Sin la frase no procede | ⬜ | |
| S7 | Aparece el **aviso de mover de equipo** (impresora no viaja) | Se muestra el recuadro azul | ⬜ | |
| S8 | Restaurar un `.bak` válido | Reemplaza la DB y reinicia la app | ⬜ | |
| S9 | Restaurar un archivo que no es SQLite | Rechaza por firma inválida | ⬜ | |
| S10 | Datos después de restaurar = los del respaldo | Productos/ventas/usuarios correctos | ⬜ | |

---

## T. Reset de modo (zona peligrosa)

| # | Caso de prueba | Resultado esperado | Estado | Comentarios |
|---|---|---|---|---|
| T1 | Resetear modo pide password + frase "RESETEAR" | Sin ambos no procede | ⬜ | |
| T2 | Tras resetear, la app vuelve al wizard | Pide reconfigurar modo desde cero | ⬜ | |
| T3 | Reset con ventas/cortes existentes | **NO truena** (antes fallaba por FOREIGN KEY) | ⬜ | |
| T4 | Limpieza total: usuarios, sucursales, productos, ventas, cortes y existencias borrados | Todo limpio; la app arranca como instalación nueva | ⬜ | |

---

## Flujo completo end-to-end

Escenario realista: dar de alta una sucursal desde la matriz, llevarla por USB,
operar ventas en la sucursal y respaldar. Marca cada paso.

### Parte 1 — En la MATRIZ (PC de bodega)

| # | Paso | Estado | Comentarios |
|---|---|---|---|
| E2E-01 | Configurar la PC como MATRIZ en el wizard (crear admin) | ⬜ | |
| E2E-02 | Configurar el IVA default en "Impuestos (IVA)" | ⬜ | |
| E2E-02b | Crear al menos una bodega (además de la Principal) en "Bodegas" | ⬜ | |
| E2E-03 | Crear varios productos (uno exento, uno sumar, uno incluido) verificando el preview | ⬜ | |
| E2E-03b | Alternativa: cargar el catálogo masivo por **CSV** (plantilla → importar) | ⬜ | |
| E2E-04 | Registrar entradas de mercancía eligiendo la **bodega destino** (lotes con caducidad) | ⬜ | |
| E2E-05 | Crear una sucursal nueva con sus datos fiscales | ⬜ | |
| E2E-06 | (Opcional) Poner overrides de precio para esa sucursal | ⬜ | |
| E2E-07 | Exportar la sucursal a un archivo `.farma` en la USB | ⬜ | |
| E2E-08 | Crear un respaldo de la matriz en la USB | ⬜ | |

### Parte 2 — En la SUCURSAL (PC del punto de venta)

| # | Paso | Estado | Comentarios |
|---|---|---|---|
| E2E-09 | Configurar la PC como SUCURSAL en el wizard (crear admin local) | ⬜ | |
| E2E-10 | Configurar la impresora en Configuración e imprimir ticket de prueba | ⬜ | |
| E2E-11 | Importar el `.farma` desde la USB (preview + aplicar) | ⬜ | |
| E2E-12 | Verificar que el catálogo y precios llegaron correctos | ⬜ | |
| E2E-13 | Cargar las existencias iniciales por **conteo físico** (primera entrada) | ⬜ | |
| E2E-14 | Iniciar sesión como cajero y hacer 3–4 ventas (efectivo, tarjeta, mixto) | ⬜ | |
| E2E-15 | Verificar que los tickets imprimen con el formato correcto | ⬜ | |
| E2E-16 | Cancelar una de las ventas y verificar el reintegro de stock | ⬜ | |
| E2E-17 | Hacer el corte del día y revisar que los totales cuadran | ⬜ | |
| E2E-18 | Crear un respaldo de la sucursal al cierre del día | ⬜ | |

### Parte 3 — Validación cruzada

| # | Paso | Estado | Comentarios |
|---|---|---|---|
| E2E-19 | Restaurar el respaldo de la sucursal en otra PC/instancia y confirmar que todo está | ⬜ | |
| E2E-20 | Confirmar que el aviso de "reconfigurar impresora" apareció al restaurar | ⬜ | |

---

## Registro de incidencias

Anota aquí cada problema encontrado. Usa un ID (`BUG-01`, `BUG-02`, …) y
referéncialo en la columna Comentarios de la prueba correspondiente.

### BUG-01
- **Módulo / prueba:** (ej. D6)
- **Severidad:** 🔴 Bloqueante / 🟠 Mayor / 🟡 Menor / 🔵 Cosmético
- **Qué esperaba:**
- **Qué pasó:**
- **Pasos para reproducir:**
  1.
  2.
- **Capturas / notas:**
- **Estado:** ⬜ Abierto / 🔧 En arreglo / ✅ Resuelto

### BUG-02
- **Módulo / prueba:**
- **Severidad:**
- **Qué esperaba:**
- **Qué pasó:**
- **Pasos para reproducir:**
  1.
  2.
- **Capturas / notas:**
- **Estado:** ⬜ Abierto / 🔧 En arreglo / ✅ Resuelto

### BUG-03
- **Módulo / prueba:**
- **Severidad:**
- **Qué esperaba:**
- **Qué pasó:**
- **Pasos para reproducir:**
  1.
  2.
- **Capturas / notas:**
- **Estado:** ⬜ Abierto / 🔧 En arreglo / ✅ Resuelto

> Copia el bloque `### BUG-xx` cuantas veces necesites.
