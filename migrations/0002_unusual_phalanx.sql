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
CREATE INDEX `incidents_order_id` ON `incidents` (`order_id`);