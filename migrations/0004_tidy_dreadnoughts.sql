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
CREATE INDEX `cash_movements_entity` ON `cash_movements` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `payroll_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`week_number` integer NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`payment_date` text NOT NULL,
	`employee_snapshot` text NOT NULL,
	`prepared_by` text NOT NULL,
	`earnings` text NOT NULL,
	`deductions` text NOT NULL,
	`settings_snapshot` text NOT NULL,
	`total_earnings` integer NOT NULL,
	`total_deductions` integer NOT NULL,
	`net_pay` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payroll_runs_status" CHECK("payroll_runs"."status" IN ('DRAFT', 'PAID'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payroll_runs_employee_id_period_start` ON `payroll_runs` (`employee_id`,`period_start`);