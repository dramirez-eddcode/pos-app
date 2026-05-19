CREATE TABLE `mov_stock` (
	`id` text PRIMARY KEY NOT NULL,
	`lote_id` text NOT NULL,
	`venta_item_id` text,
	`tipo` text NOT NULL,
	`cantidad` integer NOT NULL,
	`fecha` integer NOT NULL,
	`motivo` text,
	FOREIGN KEY (`lote_id`) REFERENCES `caducidad_lote`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venta_item_id`) REFERENCES `venta_item`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mov_stock_lote_idx` ON `mov_stock` (`lote_id`);--> statement-breakpoint
CREATE INDEX `mov_stock_venta_item_idx` ON `mov_stock` (`venta_item_id`);