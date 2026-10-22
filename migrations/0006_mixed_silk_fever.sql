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
CREATE UNIQUE INDEX `products_variant_unique` ON `products` ("variant_group" COLLATE NOCASE,"variant_name" COLLATE NOCASE);