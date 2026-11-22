CREATE TABLE `cash_handovers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`handover_date` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cash_handovers_amount" CHECK("cash_handovers"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `cash_handovers_user_id` ON `cash_handovers` (`user_id`,`handover_date`);