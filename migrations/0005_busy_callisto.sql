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
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	CONSTRAINT "cash_movements_entity_pair" CHECK(("cash_movements"."entity_type" IS NULL) = ("cash_movements"."entity_id" IS NULL)),
	CONSTRAINT "cash_movements_concept_link" CHECK(CASE
				WHEN "cash_movements"."concept" IN ('INSTALLMENT', 'SECURITY_DEPOSIT') THEN "cash_movements"."entity_type" IS 'ORDER' AND "cash_movements"."amount" > 0
				WHEN "cash_movements"."concept" IN ('INSTALLMENT_REFUND', 'DEPOSIT_REFUND', 'CARRIER_PAYMENT') THEN "cash_movements"."entity_type" IS 'ORDER' AND "cash_movements"."amount" < 0
				WHEN "cash_movements"."concept" = 'PAYROLL' THEN "cash_movements"."entity_type" IS 'PAYROLL_RUN' AND "cash_movements"."amount" < 0
				WHEN "cash_movements"."concept" = 'OTHER_EXPENSE' THEN "cash_movements"."entity_type" IS NULL AND "cash_movements"."amount" < 0
				ELSE 0
			END),
	CONSTRAINT "cash_movements_payment_method" CHECK("cash_movements"."payment_method" IN ('CASH', 'TRANSFER', 'OTHER'))
);
--> statement-breakpoint
CREATE INDEX `cash_movements_entity` ON `cash_movements` (`entity_type`,`entity_id`);