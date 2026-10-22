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
				WHEN "cash_movements"."concept" IN ('INSTALLMENT', 'SECURITY_DEPOSIT') THEN "cash_movements"."entity_type" IS 'ORDER' AND ("cash_movements"."amount" > 0) = ("cash_movements"."reverses_id" IS NULL)
				WHEN "cash_movements"."concept" IN ('INSTALLMENT_REFUND', 'DEPOSIT_REFUND', 'CARRIER_PAYMENT') THEN "cash_movements"."entity_type" IS 'ORDER' AND ("cash_movements"."amount" < 0) = ("cash_movements"."reverses_id" IS NULL)
				WHEN "cash_movements"."concept" = 'PAYROLL' THEN "cash_movements"."entity_type" IS 'PAYROLL_RUN' AND ("cash_movements"."amount" < 0) = ("cash_movements"."reverses_id" IS NULL)
				WHEN "cash_movements"."concept" = 'OTHER_INCOME' THEN "cash_movements"."entity_type" IS NULL AND ("cash_movements"."amount" > 0) = ("cash_movements"."reverses_id" IS NULL)
				WHEN "cash_movements"."concept" = 'OTHER_EXPENSE' THEN "cash_movements"."entity_type" IS NULL AND ("cash_movements"."amount" < 0) = ("cash_movements"."reverses_id" IS NULL)
				ELSE 0
			END),
	CONSTRAINT "cash_movements_payment_method" CHECK("cash_movements"."payment_method" IN ('CASH', 'TRANSFER', 'OTHER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_movements_reverses_id_unique` ON `cash_movements` (`reverses_id`);--> statement-breakpoint
CREATE INDEX `cash_movements_entity` ON `cash_movements` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cash_movements_receipt_number` ON `cash_movements` (("amount" > 0),`receipt_number`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phone` text NOT NULL,
	`full_name` text NOT NULL,
	`document_id` text NOT NULL,
	`services` text DEFAULT '[]' NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_document_id_unique` ON `contacts` (`document_id`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_contact_id_unique` ON `employees` (`contact_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`entity_key` text,
	`action` text NOT NULL,
	`actor_username` text NOT NULL,
	`actor_kind` text NOT NULL,
	`before` text,
	`after` text,
	`reason` text,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "events_actor_kind" CHECK("events"."actor_kind" IN ('user', 'system', 'agent', 'integration')),
	CONSTRAINT "events_entity_id_or_key" CHECK("events"."entity_id" IS NULL OR "events"."entity_key" IS NULL)
);
--> statement-breakpoint
-- By hand: drizzle can't express triggers. events is append-only.
CREATE TRIGGER `events_no_update` BEFORE UPDATE ON `events`
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `events_no_delete` BEFORE DELETE ON `events`
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
--> statement-breakpoint
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
CREATE UNIQUE INDEX `payroll_runs_employee_id_period_start` ON `payroll_runs` (`employee_id`,`period_start`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`variant_group` text,
	`variant_name` text,
	`description` text,
	`rental_price` integer NOT NULL,
	`total_quantity` integer NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	CONSTRAINT "products_category" CHECK("products"."category" IN ('CHAIRS_TABLES', 'LINENS', 'GLASSWARE', 'CUTLERY', 'TABLEWARE', 'CHAFERS_TRAYS', 'DECOR'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_variant_unique` ON `products` ("variant_group" COLLATE NOCASE,"variant_name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `timesheets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`work_date` text NOT NULL,
	`morning_in` text,
	`morning_out` text,
	`afternoon_in` text,
	`afternoon_out` text,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timesheets_employee_id_work_date` ON `timesheets` (`employee_id`,`work_date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`roles` text NOT NULL,
	`employee_id` integer,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_employee_id_unique` ON `users` (`employee_id`);