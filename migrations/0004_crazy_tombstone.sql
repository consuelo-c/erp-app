CREATE TABLE `payroll_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`week_number` integer NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`payment_date` text NOT NULL,
	`employee_name` text NOT NULL,
	`employee_id_number` text NOT NULL,
	`employee_position` text,
	`employee_hire_date` text,
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
CREATE UNIQUE INDEX `payroll_runs_employee_id_period_start` ON `payroll_runs` (`employee_id`,`period_start`);