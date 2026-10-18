CREATE TABLE `cash_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`concept` text NOT NULL,
	`payment_method` text NOT NULL,
	`amount` integer NOT NULL,
	`movement_date` text NOT NULL,
	`payroll_run_id` integer,
	`payee` text,
	`bank_account` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`payroll_run_id`) REFERENCES `payroll_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cash_movements_concept" CHECK("cash_movements"."concept" IN ('INSTALLMENT', 'SECURITY_DEPOSIT', 'INSTALLMENT_REFUND', 'DEPOSIT_REFUND', 'PAYROLL', 'CARRIER_PAYMENT', 'OTHER_EXPENSE')),
	CONSTRAINT "cash_movements_payment_method" CHECK("cash_movements"."payment_method" IN ('CASH', 'TRANSFER', 'OTHER'))
);
--> statement-breakpoint
CREATE INDEX `cash_movements_payroll_run_id` ON `cash_movements` (`payroll_run_id`);