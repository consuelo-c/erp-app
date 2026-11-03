CREATE TABLE `quotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
CREATE UNIQUE INDEX `quotes_order_id_unique` ON `quotes` (`order_id`);--> statement-breakpoint
CREATE INDEX `quotes_client_id` ON `quotes` (`client_id`);--> statement-breakpoint
CREATE INDEX `quotes_valid_until` ON `quotes` (`valid_until`);