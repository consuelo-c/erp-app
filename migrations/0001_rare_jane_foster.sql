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
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_status" CHECK("orders"."status" IN ('DRAFT', 'CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'OUT_FOR_PICKUP', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "orders_delivery_method" CHECK(coalesce(json_extract("orders"."delivery_attributes", '$.method'), '') IN ('COMPANY_DELIVERY', 'CLIENT_PICKUP', 'EXTERNAL_CARRIER')),
	CONSTRAINT "orders_pickup_method" CHECK(coalesce(json_extract("orders"."pickup_attributes", '$.method'), '') IN ('COMPANY_PICKUP', 'CLIENT_RETURN', 'EXTERNAL_CARRIER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_public_token_unique` ON `orders` (`public_token`);--> statement-breakpoint
CREATE INDEX `orders_delivery_date` ON `orders` (`delivery_date`);--> statement-breakpoint
CREATE INDEX `orders_pickup_date` ON `orders` (`pickup_date`);--> statement-breakpoint
CREATE INDEX `orders_event_date` ON `orders` (`event_date`);--> statement-breakpoint
CREATE INDEX `orders_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_client_id` ON `orders` (`client_id`);