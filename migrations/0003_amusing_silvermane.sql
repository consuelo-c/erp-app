PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`entity_key` text,
	`action` text NOT NULL,
	`actor_username` text NOT NULL,
	`actor_kind` text NOT NULL,
	`before` text,
	`after` text,
	`reason` text,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "events_actor_kind" CHECK("__new_events"."actor_kind" IN ('user', 'system', 'agent', 'integration')),
	CONSTRAINT "events_entity_id_or_key" CHECK("__new_events"."entity_id" IS NULL OR "__new_events"."entity_key" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_events`("id", "entity_type", "entity_id", "entity_key", "action", "actor_username", "actor_kind", "before", "after", "reason", "ip", "user_agent", "created_at") SELECT "id", "entity_type", "entity_id", NULL, "action", "actor_username", "actor_kind", "before", "after", "reason", "ip", "user_agent", "created_at" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- By hand: drizzle selects the new entity_key from the old table, where it doesn't exist (above, NULL);
-- and rebuilding events drops 0000_init's append-only triggers, so they're re-created.
CREATE TRIGGER `events_no_update` BEFORE UPDATE ON `events`
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `events_no_delete` BEFORE DELETE ON `events`
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
