CREATE INDEX `events_created_at` ON `events` (`created_at`);--> statement-breakpoint
CREATE INDEX `events_actor_username` ON `events` (`actor_username`);--> statement-breakpoint
CREATE INDEX `events_entity_type_action` ON `events` (`entity_type`,`action`);--> statement-breakpoint
CREATE INDEX `events_entity` ON `events` (`entity_type`,`entity_id`);