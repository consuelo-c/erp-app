CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`action` text NOT NULL,
	`actor_username` text NOT NULL,
	`actor_kind` text NOT NULL,
	`before` text,
	`after` text,
	`reason` text,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "events_actor_kind" CHECK("events"."actor_kind" IN ('user', 'system', 'agent', 'integration'))
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `events_no_update` BEFORE UPDATE ON `events`
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `events_no_delete` BEFORE DELETE ON `events`
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
