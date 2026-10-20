PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cash_movements` (
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
	CONSTRAINT "cash_movements_amount" CHECK("__new_cash_movements"."amount" <> 0),
	CONSTRAINT "cash_movements_entity_pair" CHECK(("__new_cash_movements"."entity_type" IS NULL) = ("__new_cash_movements"."entity_id" IS NULL)),
	CONSTRAINT "cash_movements_concept_link" CHECK(CASE
				WHEN "__new_cash_movements"."concept" IN ('INSTALLMENT', 'SECURITY_DEPOSIT') THEN "__new_cash_movements"."entity_type" IS 'ORDER' AND ("__new_cash_movements"."amount" > 0) = ("__new_cash_movements"."reverses_id" IS NULL)
				WHEN "__new_cash_movements"."concept" IN ('INSTALLMENT_REFUND', 'DEPOSIT_REFUND', 'CARRIER_PAYMENT') THEN "__new_cash_movements"."entity_type" IS 'ORDER' AND ("__new_cash_movements"."amount" < 0) = ("__new_cash_movements"."reverses_id" IS NULL)
				WHEN "__new_cash_movements"."concept" = 'PAYROLL' THEN "__new_cash_movements"."entity_type" IS 'PAYROLL_RUN' AND ("__new_cash_movements"."amount" < 0) = ("__new_cash_movements"."reverses_id" IS NULL)
				WHEN "__new_cash_movements"."concept" = 'OTHER_INCOME' THEN "__new_cash_movements"."entity_type" IS NULL AND ("__new_cash_movements"."amount" > 0) = ("__new_cash_movements"."reverses_id" IS NULL)
				WHEN "__new_cash_movements"."concept" = 'OTHER_EXPENSE' THEN "__new_cash_movements"."entity_type" IS NULL AND ("__new_cash_movements"."amount" < 0) = ("__new_cash_movements"."reverses_id" IS NULL)
				ELSE 0
			END),
	CONSTRAINT "cash_movements_payment_method" CHECK("__new_cash_movements"."payment_method" IN ('CASH', 'TRANSFER', 'OTHER'))
);
--> statement-breakpoint
-- Edited by hand: the old table has no receipt_number or reverses_id. Existing movements are
-- numbered by id, one sequence per sign, and none offsets another.
INSERT INTO `__new_cash_movements`("id", "concept", "payment_method", "amount", "movement_date", "entity_type", "entity_id", "payee", "attributes", "receipt_number", "reverses_id", "created_at", "created_by", "updated_at", "updated_by") SELECT "id", "concept", "payment_method", "amount", "movement_date", "entity_type", "entity_id", "payee", "attributes", ROW_NUMBER() OVER (PARTITION BY "amount" > 0 ORDER BY "id"), NULL, "created_at", "created_by", "updated_at", "updated_by" FROM `cash_movements`;--> statement-breakpoint
DROP TABLE `cash_movements`;--> statement-breakpoint
ALTER TABLE `__new_cash_movements` RENAME TO `cash_movements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `cash_movements_reverses_id_unique` ON `cash_movements` (`reverses_id`);--> statement-breakpoint
CREATE INDEX `cash_movements_entity` ON `cash_movements` (`entity_type`,`entity_id`);--> statement-breakpoint
-- Edited by hand: drizzle-kit quotes the expression as if it were a column name.
CREATE UNIQUE INDEX `cash_movements_receipt_number` ON `cash_movements` (("amount" > 0),`receipt_number`);