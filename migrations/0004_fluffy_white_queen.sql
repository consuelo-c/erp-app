-- By hand, not drizzle's recreation: D1 keeps foreign keys on, so dropping the old table after
-- copying its rows would leave every offset's reverses_id pointing at a dropped row. Renaming it
-- first moves its self reference along; the copy, in id order, checks each offset against its
-- original already copied. Only the concept_link CHECK changes.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `cash_movements` RENAME TO `__old_cash_movements`;--> statement-breakpoint
CREATE TABLE `cash_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`concept` text NOT NULL,
	`payment_method` text NOT NULL,
	`amount` integer NOT NULL,
	`movement_date` text NOT NULL,
	`entity_type` text,
	`entity_id` integer,
	`payee` text,
	`attributes` text DEFAULT '{}' NOT NULL,
	`receipt_number` integer NOT NULL,
	`reverses_id` integer,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`reverses_id`) REFERENCES `cash_movements`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cash_movements_amount" CHECK("cash_movements"."amount" <> 0),
	CONSTRAINT "cash_movements_entity_pair" CHECK(("cash_movements"."entity_type" IS NULL) = ("cash_movements"."entity_id" IS NULL)),
	CONSTRAINT "cash_movements_concept_link" CHECK(CASE
				WHEN "cash_movements"."concept" = 'INSTALLMENT' THEN coalesce("cash_movements"."entity_type", '') IN ('ORDER', 'RECEIVABLE') AND ("cash_movements"."amount" > 0) = ("cash_movements"."reverses_id" IS NULL)
				WHEN "cash_movements"."concept" IN ('SECURITY_DEPOSIT', 'CANCELLATION_FEE', 'DAMAGE_CHARGE') THEN "cash_movements"."entity_type" IS 'ORDER' AND ("cash_movements"."amount" > 0) = ("cash_movements"."reverses_id" IS NULL)
				WHEN "cash_movements"."concept" IN ('INSTALLMENT_REFUND', 'DEPOSIT_REFUND', 'CARRIER_PAYMENT') THEN "cash_movements"."entity_type" IS 'ORDER' AND ("cash_movements"."amount" < 0) = ("cash_movements"."reverses_id" IS NULL)
				WHEN "cash_movements"."concept" = 'PAYROLL' THEN "cash_movements"."entity_type" IS 'PAYROLL_RUN' AND ("cash_movements"."amount" < 0) = ("cash_movements"."reverses_id" IS NULL)
				WHEN "cash_movements"."concept" = 'OTHER_INCOME' THEN "cash_movements"."entity_type" IS NULL AND ("cash_movements"."amount" > 0) = ("cash_movements"."reverses_id" IS NULL)
				WHEN "cash_movements"."concept" IN ('TRANSPORT_EXPENSE', 'SUPPLIES_EXPENSE', 'RENT', 'OTHER_EXPENSE') THEN "cash_movements"."entity_type" IS NULL AND ("cash_movements"."amount" < 0) = ("cash_movements"."reverses_id" IS NULL)
				ELSE 0
			END),
	CONSTRAINT "cash_movements_payment_method" CHECK("cash_movements"."payment_method" IN ('CASH', 'TRANSFER', 'OTHER'))
);
--> statement-breakpoint
INSERT INTO `cash_movements`("id", "concept", "payment_method", "amount", "movement_date", "entity_type", "entity_id", "payee", "attributes", "receipt_number", "reverses_id", "created_at", "created_by", "updated_at", "updated_by") SELECT "id", "concept", "payment_method", "amount", "movement_date", "entity_type", "entity_id", "payee", "attributes", "receipt_number", "reverses_id", "created_at", "created_by", "updated_at", "updated_by" FROM `__old_cash_movements` ORDER BY "id";--> statement-breakpoint
DROP TABLE `__old_cash_movements`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE UNIQUE INDEX `cash_movements_reverses_id_unique` ON `cash_movements` (`reverses_id`);--> statement-breakpoint
CREATE INDEX `cash_movements_entity` ON `cash_movements` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cash_movements_receipt_number` ON `cash_movements` (("amount" > 0),`receipt_number`);