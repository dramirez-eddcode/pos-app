-- ══════════════════════════════════════════════════════════════════════════
-- Farmacias MS — Schema Postgres para Supabase
-- ══════════════════════════════════════════════════════════════════════════
-- Este script replica el schema SQLite local pero con `sucursal_id` en cada
-- tabla transaccional para soportar multi-tenancy (16 sucursales que
-- pertenecen a diferentes dueños de la familia).
--
-- INSTRUCCIONES:
--   1. Abre tu proyecto en https://supabase.com/dashboard
--   2. Ve a SQL Editor
--   3. Pega este archivo COMPLETO y dale Run
--   4. Verifica en Table Editor que las tablas aparezcan
--
-- NOTA DE SEGURIDAD — Tirón 1 (actual):
--   RLS NO está habilitado todavía. Eso se hace en el Tirón 2 junto con
--   la integración de Supabase Auth + tabla user_sucursal. Hasta entonces,
--   cualquier cliente con la publishable key puede leer/escribir, así que
--   NO subas data real aún.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Extensiones ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- para gen_random_uuid()

-- ── Types enumerados ───────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE rol_usuario AS ENUM ('CAJERO', 'ADMINISTRADOR', 'SUPERVISOR', 'SUPERUSUARIO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE metodo_pago AS ENUM ('EFECTIVO', 'TARJETA_DEBITO', 'TARJETA_CREDITO', 'TRANSFERENCIA', 'OTRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_mov_stock AS ENUM ('VENTA', 'CANCELACION_VENTA', 'ENTRADA', 'SALIDA', 'AJUSTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE corte_tipo AS ENUM ('PARCIAL', 'FINAL', 'CAMBIO_TURNO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_mov_caja AS ENUM ('ENTRADA', 'SALIDA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Helper: trigger de updated_at ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════════════════════════════════════
-- TABLAS GLOBALES (no per-sucursal)
-- ══════════════════════════════════════════════════════════════════════════

-- Sucursal: el ancla multi-tenant. Cada venta/lote/etc. pertenece a una.
CREATE TABLE IF NOT EXISTS public.sucursal (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_comercial  text NOT NULL,
  sucursal_nombre   text NOT NULL,
  razon_social      text,
  rfc               text,
  calle             text,
  colonia           text,
  ciudad            text,
  estado            text,
  owner_user_id     uuid, -- referencia futura a auth.users del dueño responsable
  activa            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_sucursal_touch ON public.sucursal;
CREATE TRIGGER trg_sucursal_touch BEFORE UPDATE ON public.sucursal
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ══════════════════════════════════════════════════════════════════════════
-- CATÁLOGO Y STOCK (per-sucursal)
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.producto (
  id                  uuid PRIMARY KEY,
  sucursal_id         uuid NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  codigo              text NOT NULL,
  nombre              text NOT NULL,
  sustancia_activa    text,
  descripcion         text,
  laboratorio         text,
  precio              numeric(12,2) NOT NULL DEFAULT 0,
  costo               numeric(12,2) NOT NULL DEFAULT 0,
  iva_porcentaje      smallint NOT NULL DEFAULT 0,
  stock_maximo        integer,
  stock_minimo        integer,
  activo              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sucursal_id, codigo)
);
CREATE INDEX IF NOT EXISTS producto_sucursal_nombre_idx ON public.producto (sucursal_id, nombre);
CREATE INDEX IF NOT EXISTS producto_sucursal_sustancia_idx ON public.producto (sucursal_id, sustancia_activa);

DROP TRIGGER IF EXISTS trg_producto_touch ON public.producto;
CREATE TRIGGER trg_producto_touch BEFORE UPDATE ON public.producto
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Lotes con caducidad. Base del FEFO.
CREATE TABLE IF NOT EXISTS public.caducidad_lote (
  id                uuid PRIMARY KEY,
  sucursal_id       uuid NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  producto_id       uuid NOT NULL REFERENCES public.producto(id),
  total             integer NOT NULL,
  saldo             integer NOT NULL,
  fecha_caducidad   timestamptz NOT NULL,
  fecha_entrada     timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS caducidad_producto_idx ON public.caducidad_lote (sucursal_id, producto_id, fecha_caducidad);

DROP TRIGGER IF EXISTS trg_lote_touch ON public.caducidad_lote;
CREATE TRIGGER trg_lote_touch BEFORE UPDATE ON public.caducidad_lote
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ══════════════════════════════════════════════════════════════════════════
-- VENTAS
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.venta (
  id                uuid PRIMARY KEY,
  sucursal_id       uuid NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  folio_local       integer NOT NULL,
  cajero_id         uuid NOT NULL,
  fecha             timestamptz NOT NULL,
  subtotal          numeric(12,2) NOT NULL,
  iva               numeric(12,2) NOT NULL,
  descuento         numeric(12,2) NOT NULL DEFAULT 0,
  total             numeric(12,2) NOT NULL,
  motivo            text NOT NULL DEFAULT 'VENTA',
  cancelada         boolean NOT NULL DEFAULT false,
  cancelada_por     uuid,
  cancelada_en      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sucursal_id, folio_local)
);
CREATE INDEX IF NOT EXISTS venta_fecha_idx ON public.venta (sucursal_id, fecha);

DROP TRIGGER IF EXISTS trg_venta_touch ON public.venta;
CREATE TRIGGER trg_venta_touch BEFORE UPDATE ON public.venta
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.venta_item (
  id                uuid PRIMARY KEY,
  venta_id          uuid NOT NULL REFERENCES public.venta(id) ON DELETE CASCADE,
  producto_id       uuid NOT NULL REFERENCES public.producto(id),
  lote_id           uuid REFERENCES public.caducidad_lote(id),
  cantidad          numeric(12,2) NOT NULL,
  precio_unitario   numeric(12,2) NOT NULL,
  importe           numeric(12,2) NOT NULL,
  iva               numeric(12,2) NOT NULL,
  descuento         numeric(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS venta_item_venta_idx ON public.venta_item (venta_id);

CREATE TABLE IF NOT EXISTS public.pago (
  id           uuid PRIMARY KEY,
  venta_id     uuid NOT NULL REFERENCES public.venta(id) ON DELETE CASCADE,
  metodo       metodo_pago NOT NULL,
  monto        numeric(12,2) NOT NULL,
  referencia   text
);
CREATE INDEX IF NOT EXISTS pago_venta_idx ON public.pago (venta_id);

-- ══════════════════════════════════════════════════════════════════════════
-- CORTES Y MOVIMIENTOS DE CAJA
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.corte (
  id                        uuid PRIMARY KEY,
  sucursal_id               uuid NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  cajero_id                 uuid NOT NULL,
  fecha                     timestamptz NOT NULL,
  folio_inicio              integer NOT NULL,
  folio_fin                 integer NOT NULL,
  tipo                      corte_tipo NOT NULL,
  total_efectivo            numeric(12,2) NOT NULL DEFAULT 0,
  total_tarjeta_debito      numeric(12,2) NOT NULL DEFAULT 0,
  total_tarjeta_credito     numeric(12,2) NOT NULL DEFAULT 0,
  total_transferencia       numeric(12,2) NOT NULL DEFAULT 0,
  total_otro                numeric(12,2) NOT NULL DEFAULT 0,
  entradas_caja             numeric(12,2) NOT NULL DEFAULT 0,
  salidas_caja              numeric(12,2) NOT NULL DEFAULT 0,
  cancelaciones             numeric(12,2) NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corte_sucursal_fecha_idx ON public.corte (sucursal_id, fecha DESC);

CREATE TABLE IF NOT EXISTS public.mov_caja (
  id            uuid PRIMARY KEY,
  sucursal_id   uuid NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  fecha         timestamptz NOT NULL,
  cajero_id     uuid NOT NULL,
  tipo          tipo_mov_caja NOT NULL,
  concepto      text NOT NULL,
  monto         numeric(12,2) NOT NULL,
  corte_id      uuid REFERENCES public.corte(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mov_caja_sucursal_fecha_idx ON public.mov_caja (sucursal_id, fecha);

-- ══════════════════════════════════════════════════════════════════════════
-- JOURNALS (AUDITORIA)
-- ══════════════════════════════════════════════════════════════════════════

-- Journal de movimientos de stock por lote.
CREATE TABLE IF NOT EXISTS public.mov_stock (
  id              uuid PRIMARY KEY,
  sucursal_id     uuid NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  lote_id         uuid NOT NULL REFERENCES public.caducidad_lote(id),
  venta_item_id   uuid REFERENCES public.venta_item(id) ON DELETE SET NULL,
  tipo            tipo_mov_stock NOT NULL,
  cantidad        integer NOT NULL, -- delta firmado (+ entrada, - salida)
  fecha           timestamptz NOT NULL,
  motivo          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mov_stock_sucursal_lote_idx ON public.mov_stock (sucursal_id, lote_id, fecha DESC);
CREATE INDEX IF NOT EXISTS mov_stock_venta_item_idx ON public.mov_stock (venta_item_id);

-- Histórico de cambios de precio.
CREATE TABLE IF NOT EXISTS public.precio_historico (
  id                uuid PRIMARY KEY,
  sucursal_id       uuid NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  producto_id       uuid NOT NULL REFERENCES public.producto(id),
  precio_anterior   numeric(12,2) NOT NULL,
  precio_nuevo      numeric(12,2) NOT NULL,
  cajero_id         uuid NOT NULL,
  fecha             timestamptz NOT NULL,
  motivo            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS precio_historico_sucursal_producto_idx
  ON public.precio_historico (sucursal_id, producto_id, fecha DESC);

-- ══════════════════════════════════════════════════════════════════════════
-- FIN SCHEMA
--
-- Próximo tirón:
--   - Supabase Auth + tabla public.user_sucursal (user ↔ sucursal ↔ rol)
--   - RLS jerárquico: CAJERO ve su sucursal; ADMIN gestiona sus sucursales;
--     SUPERUSUARIO ve todo
--   - Triggers de conflict resolution para sync
-- ══════════════════════════════════════════════════════════════════════════
