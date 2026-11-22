PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- By hand: drizzle selected the new column from the old table; every existing quote is the company's.
CREATE TABLE `__new_quotes` (
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
	`transported_by` text DEFAULT 'COMPANY' NOT NULL,
	`quote_total` integer NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quotes_transported_by" CHECK("__new_quotes"."transported_by" IN ('COMPANY', 'CLIENT'))
);
--> statement-breakpoint
INSERT INTO `__new_quotes`("id", "public_token", "client_id", "order_id", "event_date", "valid_until", "rental_days", "client_attributes", "quote_items", "items_total", "discount", "transport_cost", "transported_by", "quote_total", "attributes", "created_at", "created_by", "updated_at", "updated_by") SELECT "id", "public_token", "client_id", "order_id", "event_date", "valid_until", "rental_days", "client_attributes", "quote_items", "items_total", "discount", "transport_cost", 'COMPANY', "quote_total", "attributes", "created_at", "created_by", "updated_at", "updated_by" FROM `quotes`;--> statement-breakpoint
DROP TABLE `quotes`;--> statement-breakpoint
ALTER TABLE `__new_quotes` RENAME TO `quotes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_public_token_unique` ON `quotes` (`public_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_order_id_unique` ON `quotes` (`order_id`);--> statement-breakpoint
CREATE INDEX `quotes_client_id` ON `quotes` (`client_id`);--> statement-breakpoint
CREATE INDEX `quotes_valid_until` ON `quotes` (`valid_until`);