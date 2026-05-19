ALTER TABLE `corte` ADD COLUMN `total_tarjeta` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `corte`
   SET `total_tarjeta` = COALESCE(`total_tarjeta_debito`, 0) + COALESCE(`total_tarjeta_credito`, 0)
 WHERE `total_tarjeta` = 0
   AND (COALESCE(`total_tarjeta_debito`, 0) > 0 OR COALESCE(`total_tarjeta_credito`, 0) > 0);
--> statement-breakpoint
UPDATE `pago` SET `metodo` = 'TARJETA' WHERE `metodo` IN ('TARJETA_DEBITO', 'TARJETA_CREDITO');
