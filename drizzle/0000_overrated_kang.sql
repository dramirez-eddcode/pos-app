CREATE TABLE `caducidad_lote` (
	`id` text PRIMARY KEY NOT NULL,
	`producto_id` text NOT NULL,
	`total` integer NOT NULL,
	`saldo` integer NOT NULL,
	`fecha_caducidad` integer NOT NULL,
	`fecha_entrada` integer NOT NULL,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `caducidad_producto_idx` ON `caducidad_lote` (`producto_id`,`fecha_caducidad`);--> statement-breakpoint
CREATE TABLE `corte` (
	`id` text PRIMARY KEY NOT NULL,
	`cajero_id` text NOT NULL,
	`fecha` integer NOT NULL,
	`folio_inicio` integer NOT NULL,
	`folio_fin` integer NOT NULL,
	`tipo` text NOT NULL,
	`total_efectivo` real DEFAULT 0 NOT NULL,
	`total_tarjeta_debito` real DEFAULT 0 NOT NULL,
	`total_tarjeta_credito` real DEFAULT 0 NOT NULL,
	`total_transferencia` real DEFAULT 0 NOT NULL,
	`total_otro` real DEFAULT 0 NOT NULL,
	`entradas_caja` real DEFAULT 0 NOT NULL,
	`salidas_caja` real DEFAULT 0 NOT NULL,
	`cancelaciones` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`cajero_id`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `empresa` (
	`id` text PRIMARY KEY NOT NULL,
	`nombre_comercial` text NOT NULL,
	`razon_social` text NOT NULL,
	`rfc` text,
	`calle` text,
	`colonia` text,
	`ciudad` text,
	`estado` text,
	`sucursal_nombre` text NOT NULL,
	`owner_user_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mov_caja` (
	`id` text PRIMARY KEY NOT NULL,
	`fecha` integer NOT NULL,
	`cajero_id` text NOT NULL,
	`tipo` text NOT NULL,
	`concepto` text NOT NULL,
	`monto` real NOT NULL,
	`corte_id` text,
	FOREIGN KEY (`cajero_id`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`corte_id`) REFERENCES `corte`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pago` (
	`id` text PRIMARY KEY NOT NULL,
	`venta_id` text NOT NULL,
	`metodo` text NOT NULL,
	`monto` real NOT NULL,
	`referencia` text,
	FOREIGN KEY (`venta_id`) REFERENCES `venta`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `producto` (
	`id` text PRIMARY KEY NOT NULL,
	`codigo` text NOT NULL,
	`nombre` text NOT NULL,
	`sustancia_activa` text,
	`descripcion` text,
	`laboratorio` text,
	`precio` real NOT NULL,
	`costo` real DEFAULT 0 NOT NULL,
	`iva_porcentaje` integer DEFAULT 0 NOT NULL,
	`stock_maximo` integer DEFAULT 0,
	`stock_minimo` integer DEFAULT 0,
	`activo` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `producto_codigo_unique` ON `producto` (`codigo`);--> statement-breakpoint
CREATE INDEX `producto_nombre_idx` ON `producto` (`nombre`);--> statement-breakpoint
CREATE INDEX `producto_sustancia_idx` ON `producto` (`sustancia_activa`);--> statement-breakpoint
CREATE TABLE `tipo_usuario` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tipo_usuario_nombre_unique` ON `tipo_usuario` (`nombre`);--> statement-breakpoint
CREATE TABLE `usuario` (
	`id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`password_hash` text NOT NULL,
	`nombre` text NOT NULL,
	`tipo_usuario_id` integer NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`puede_cancelar` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tipo_usuario_id`) REFERENCES `tipo_usuario`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuario_login_unique` ON `usuario` (`login`);--> statement-breakpoint
CREATE TABLE `venta` (
	`id` text PRIMARY KEY NOT NULL,
	`folio_local` integer NOT NULL,
	`cajero_id` text NOT NULL,
	`fecha` integer NOT NULL,
	`subtotal` real NOT NULL,
	`iva` real NOT NULL,
	`descuento` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`motivo` text DEFAULT 'VENTA' NOT NULL,
	`cancelada` integer DEFAULT false NOT NULL,
	`cancelada_por` text,
	`cancelada_en` integer,
	FOREIGN KEY (`cajero_id`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cancelada_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `venta_folio_local_unique` ON `venta` (`folio_local`);--> statement-breakpoint
CREATE INDEX `venta_fecha_idx` ON `venta` (`fecha`);--> statement-breakpoint
CREATE TABLE `venta_item` (
	`id` text PRIMARY KEY NOT NULL,
	`venta_id` text NOT NULL,
	`producto_id` text NOT NULL,
	`lote_id` text,
	`cantidad` real NOT NULL,
	`precio_unitario` real NOT NULL,
	`importe` real NOT NULL,
	`iva` real NOT NULL,
	`descuento` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`venta_id`) REFERENCES `venta`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lote_id`) REFERENCES `caducidad_lote`(`id`) ON UPDATE no action ON DELETE no action
);
