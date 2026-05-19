CREATE TABLE `precio_historico` (
	`id` text PRIMARY KEY NOT NULL,
	`producto_id` text NOT NULL,
	`precio_anterior` real NOT NULL,
	`precio_nuevo` real NOT NULL,
	`cajero_id` text NOT NULL,
	`fecha` integer NOT NULL,
	`motivo` text,
	FOREIGN KEY (`producto_id`) REFERENCES `producto`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cajero_id`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `precio_historico_producto_idx` ON `precio_historico` (`producto_id`,`fecha`);