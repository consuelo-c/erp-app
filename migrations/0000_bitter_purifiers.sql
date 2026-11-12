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
				WHEN "cash_movements"."concept" IN ('SECURITY_DEPOSIT', 'CANCELLATION_FEE') THEN "cash_movements"."entity_type" IS 'ORDER' AND ("cash_movements"."amount" > 0) = ("cash_movements"."reverses_id" IS NULL)
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
	`phone` text,
	`whatsapp` text,
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
CREATE TABLE `incidents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`incident_items` text NOT NULL,
	`incident_description` text NOT NULL,
	`responsible_party` text DEFAULT 'UNDETERMINED' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`reversal_reason` text,
	`reversed_by` text,
	`reversed_at` integer,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "incidents_responsible_party" CHECK("incidents"."responsible_party" IN ('UNDETERMINED', 'CLIENT', 'CARRIER', 'COMPANY')),
	CONSTRAINT "incidents_status" CHECK("incidents"."status" IN ('ACTIVE', 'REVERSED'))
);
--> statement-breakpoint
CREATE INDEX `incidents_order_id` ON `incidents` (`order_id`);--> statement-breakpoint
CREATE TABLE `inventory_counts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text NOT NULL,
	`inventory_items` text NOT NULL,
	`review_note` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`reversal_reason` text,
	`reversed_by` text,
	`reversed_at` integer,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	CONSTRAINT "inventory_counts_status" CHECK("inventory_counts"."status" IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVERSED'))
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_token` text NOT NULL,
	`client_id` integer NOT NULL,
	`status` text NOT NULL,
	`has_incident` integer DEFAULT 0 NOT NULL,
	`event_date` text NOT NULL,
	`delivery_date` text NOT NULL,
	`pickup_date` text NOT NULL,
	`rental_days` integer NOT NULL,
	`client_attributes` text NOT NULL,
	`delivery_attributes` text NOT NULL,
	`pickup_attributes` text NOT NULL,
	`order_items` text NOT NULL,
	`items_total` integer NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`transport_cost` integer DEFAULT 0 NOT NULL,
	`order_total` integer NOT NULL,
	`deposit_amount` integer DEFAULT 0 NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`receivable_id` integer,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receivable_id`) REFERENCES `receivables`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_status" CHECK("orders"."status" IN ('CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'OUT_FOR_PICKUP', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "orders_delivery_method" CHECK(coalesce(json_extract("orders"."delivery_attributes", '$.method'), '') IN ('COMPANY_DELIVERY', 'CLIENT_PICKUP', 'EXTERNAL_CARRIER')),
	CONSTRAINT "orders_pickup_method" CHECK(coalesce(json_extract("orders"."pickup_attributes", '$.method'), '') IN ('COMPANY_PICKUP', 'CLIENT_RETURN', 'EXTERNAL_CARRIER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_public_token_unique` ON `orders` (`public_token`);--> statement-breakpoint
CREATE INDEX `orders_delivery_date` ON `orders` (`delivery_date`);--> statement-breakpoint
CREATE INDEX `orders_pickup_date` ON `orders` (`pickup_date`);--> statement-breakpoint
CREATE INDEX `orders_event_date` ON `orders` (`event_date`);--> statement-breakpoint
CREATE INDEX `orders_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_client_id` ON `orders` (`client_id`);--> statement-breakpoint
CREATE INDEX `orders_receivable_id` ON `orders` (`receivable_id`);--> statement-breakpoint
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
CREATE TABLE `quotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_token` text NOT NULL,
	`client_id` integer NOT NULL,
	`order_id` integer,
	`event_date` text,
	`valid_until` text NOT NULL,
	`rental_days` integer NOT NULL,
	`client_attributes` text NOT NULL,
	`quote_items` text NOT NULL,
	`items_total` integer NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`transport_cost` integer,
	`quote_total` integer NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_public_token_unique` ON `quotes` (`public_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_order_id_unique` ON `quotes` (`order_id`);--> statement-breakpoint
CREATE INDEX `quotes_client_id` ON `quotes` (`client_id`);--> statement-breakpoint
CREATE INDEX `quotes_valid_until` ON `quotes` (`valid_until`);--> statement-breakpoint
CREATE TABLE `receivables` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`issue_date` text NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `receivables_client_id` ON `receivables` (`client_id`);--> statement-breakpoint
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