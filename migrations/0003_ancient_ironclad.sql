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
