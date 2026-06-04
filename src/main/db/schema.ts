import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'

// ── Instalación (1 fila, id fijo = 1) ───────────────────────────────────────
// Define el modo de esta PC: MATRIZ gestiona N sucursales sin vender; SUCURSAL
// es un POS conectado a una sucursal específica. Configurada por el wizard.
export const instalacion = sqliteTable('instalacion', {
  id: integer('id').primaryKey(), // siempre 1
  tipo: text('tipo').notNull(), // 'MATRIZ' | 'SUCURSAL'
  sucursalActivaId: text('sucursal_activa_id'),
  matrizId: text('matriz_id'),
  propietarioNombre: text('propietario_nombre'),
  configuredAt: integer('configured_at', { mode: 'timestamp_ms' }),
  schemaVersion: integer('schema_version').notNull().default(1)
})

// ── Sucursales (matriz: N filas · sucursal: 1 fila auto-creada en wizard) ──
export const sucursal = sqliteTable('sucursal', {
  id: text('id').primaryKey(),
  codigo: text('codigo').notNull().unique(),
  nombre: text('nombre').notNull(),
  razonSocial: text('razon_social'),
  rfc: text('rfc'),
  calle: text('calle'),
  colonia: text('colonia'),
  ciudad: text('ciudad'),
  estado: text('estado'),
  activa: integer('activa', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

// ── Overrides de producto por sucursal (matriz) ─────────────────────────────
// Una fila por (sucursal, producto) sólo cuando esa sucursal tiene un valor
// distinto al global o está excluida. Si no hay fila, la sucursal usa los
// valores globales del producto.
export const sucursalProducto = sqliteTable('sucursal_producto', {
  sucursalId: text('sucursal_id')
    .notNull()
    .references(() => sucursal.id, { onDelete: 'cascade' }),
  productoId: text('producto_id').notNull(), // FK definida en SQL crudo
  precioOverride: real('precio_override'),
  ivaModoOverride: text('iva_modo_override'),
  ivaPorcentajeOverride: integer('iva_porcentaje_override'),
  excluida: integer('excluida', { mode: 'boolean' }).notNull().default(false),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

// ── Empresa (legado, sigue siendo el header del ticket en SUCURSAL) ────────
// Una sola fila con la metadata de la sucursal donde corre este POS.
export const empresa = sqliteTable('empresa', {
  id: text('id').primaryKey(),
  nombreComercial: text('nombre_comercial').notNull(),
  razonSocial: text('razon_social').notNull(),
  rfc: text('rfc'),
  calle: text('calle'),
  colonia: text('colonia'),
  ciudad: text('ciudad'),
  estado: text('estado'),
  sucursalNombre: text('sucursal_nombre').notNull(),
  ownerUserId: text('owner_user_id'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

// ── Usuarios y roles ────────────────────────────────────────────────────────
export const tipoUsuario = sqliteTable('tipo_usuario', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nombre: text('nombre').notNull().unique()
})

export const usuario = sqliteTable('usuario', {
  id: text('id').primaryKey(),
  login: text('login').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  nombre: text('nombre').notNull(),
  tipoUsuarioId: integer('tipo_usuario_id')
    .notNull()
    .references(() => tipoUsuario.id),
  activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
  puedeCancelar: integer('puede_cancelar', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
})

// ── Catálogo de productos ───────────────────────────────────────────────────
export const producto = sqliteTable(
  'producto',
  {
    id: text('id').primaryKey(),
    codigo: text('codigo').notNull().unique(), // EAN-13 o SKU interno, siempre TEXT
    nombre: text('nombre').notNull(),
    sustanciaActiva: text('sustancia_activa'),
    descripcion: text('descripcion'), // PLM opción A: editable por admin
    laboratorio: text('laboratorio'),
    precio: real('precio').notNull(),
    costo: real('costo').notNull().default(0),
    ivaPorcentaje: integer('iva_porcentaje').notNull().default(0),
    // 'exento' | 'sumar' (precio sin IVA, se agrega) | 'incluido' (precio ya trae IVA)
    ivaModo: text('iva_modo').notNull().default('exento'),
    stockMaximo: integer('stock_maximo').default(0),
    stockMinimo: integer('stock_minimo').default(0),
    activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('producto_nombre_idx').on(t.nombre), index('producto_sustancia_idx').on(t.sustanciaActiva)]
)

// ── Lotes con caducidad (base del FEFO) ────────────────────────────────────
export const caducidadLote = sqliteTable(
  'caducidad_lote',
  {
    id: text('id').primaryKey(),
    productoId: text('producto_id')
      .notNull()
      .references(() => producto.id),
    total: integer('total').notNull(),
    saldo: integer('saldo').notNull(),
    fechaCaducidad: integer('fecha_caducidad', { mode: 'timestamp_ms' }).notNull(),
    fechaEntrada: integer('fecha_entrada', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('caducidad_producto_idx').on(t.productoId, t.fechaCaducidad)]
)

// ── Ventas ──────────────────────────────────────────────────────────────────
export const venta = sqliteTable(
  'venta',
  {
    id: text('id').primaryKey(),
    folioLocal: integer('folio_local').notNull().unique(),
    cajeroId: text('cajero_id')
      .notNull()
      .references(() => usuario.id),
    fecha: integer('fecha', { mode: 'timestamp_ms' }).notNull(),
    subtotal: real('subtotal').notNull(),
    iva: real('iva').notNull(),
    descuento: real('descuento').notNull().default(0),
    total: real('total').notNull(),
    motivo: text('motivo').notNull().default('VENTA'),
    cancelada: integer('cancelada', { mode: 'boolean' }).notNull().default(false),
    canceladaPor: text('cancelada_por').references(() => usuario.id),
    canceladaEn: integer('cancelada_en', { mode: 'timestamp_ms' })
  },
  (t) => [index('venta_fecha_idx').on(t.fecha)]
)

export const ventaItem = sqliteTable('venta_item', {
  id: text('id').primaryKey(),
  ventaId: text('venta_id')
    .notNull()
    .references(() => venta.id, { onDelete: 'cascade' }),
  productoId: text('producto_id')
    .notNull()
    .references(() => producto.id),
  loteId: text('lote_id').references(() => caducidadLote.id),
  cantidad: real('cantidad').notNull(),
  precioUnitario: real('precio_unitario').notNull(),
  importe: real('importe').notNull(),
  iva: real('iva').notNull(),
  descuento: real('descuento').notNull().default(0)
})

export const pago = sqliteTable('pago', {
  id: text('id').primaryKey(),
  ventaId: text('venta_id')
    .notNull()
    .references(() => venta.id, { onDelete: 'cascade' }),
  metodo: text('metodo').notNull(), // EFECTIVO|TARJETA|TRANSFERENCIA|OTRO
  monto: real('monto').notNull(),
  referencia: text('referencia') // últimos 4, autorización
})

// ── Cortes y caja ───────────────────────────────────────────────────────────
export const corte = sqliteTable('corte', {
  id: text('id').primaryKey(),
  cajeroId: text('cajero_id')
    .notNull()
    .references(() => usuario.id),
  fecha: integer('fecha', { mode: 'timestamp_ms' }).notNull(),
  folioInicio: integer('folio_inicio').notNull(),
  folioFin: integer('folio_fin').notNull(),
  tipo: text('tipo').notNull(), // FINAL|PARCIAL|CAMBIO_TURNO
  totalEfectivo: real('total_efectivo').notNull().default(0),
  totalTarjeta: real('total_tarjeta').notNull().default(0),
  totalTransferencia: real('total_transferencia').notNull().default(0),
  totalOtro: real('total_otro').notNull().default(0),
  entradasCaja: real('entradas_caja').notNull().default(0),
  salidasCaja: real('salidas_caja').notNull().default(0),
  cancelaciones: real('cancelaciones').notNull().default(0)
})

export const movCaja = sqliteTable('mov_caja', {
  id: text('id').primaryKey(),
  fecha: integer('fecha', { mode: 'timestamp_ms' }).notNull(),
  cajeroId: text('cajero_id')
    .notNull()
    .references(() => usuario.id),
  tipo: text('tipo').notNull(), // ENTRADA|SALIDA
  concepto: text('concepto').notNull(),
  monto: real('monto').notNull(),
  corteId: text('corte_id').references(() => corte.id)
})

// ── Histórico de precios ───────────────────────────────────────────────────
// Cada cambio de precio_venta deja una fila aquí, para auditoría y reportes.
export const precioHistorico = sqliteTable(
  'precio_historico',
  {
    id: text('id').primaryKey(),
    productoId: text('producto_id')
      .notNull()
      .references(() => producto.id),
    precioAnterior: real('precio_anterior').notNull(),
    precioNuevo: real('precio_nuevo').notNull(),
    cajeroId: text('cajero_id')
      .notNull()
      .references(() => usuario.id),
    fecha: integer('fecha', { mode: 'timestamp_ms' }).notNull(),
    motivo: text('motivo')
  },
  (t) => [index('precio_historico_producto_idx').on(t.productoId, t.fecha)]
)

// ── Journal de movimientos de stock por lote ───────────────────────────────
// Cada venta, entrada, ajuste o cancelación deja un registro aquí. La cantidad
// es un delta firmado (negativo = salida, positivo = ingreso al lote). Permite
// revertir operaciones (cancelación = insertar movs opuestos por ventaItem).
export const movStock = sqliteTable(
  'mov_stock',
  {
    id: text('id').primaryKey(),
    loteId: text('lote_id')
      .notNull()
      .references(() => caducidadLote.id),
    ventaItemId: text('venta_item_id').references(() => ventaItem.id, { onDelete: 'set null' }),
    tipo: text('tipo').notNull(), // VENTA | CANCELACION_VENTA | ENTRADA | AJUSTE
    cantidad: integer('cantidad').notNull(), // delta firmado aplicado a lote.saldo
    fecha: integer('fecha', { mode: 'timestamp_ms' }).notNull(),
    motivo: text('motivo')
  },
  (t) => [
    index('mov_stock_lote_idx').on(t.loteId),
    index('mov_stock_venta_item_idx').on(t.ventaItemId)
  ]
)
