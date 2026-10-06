import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const auditColumns = {
	createdAt: integer('created_at').notNull(),
	createdBy: text('created_by').notNull(),
	updatedAt: integer('updated_at').notNull(),
	updatedBy: text('updated_by').notNull()
};

// Module, label, unit and Zod schema of each key live in src/lib/settings.ts, not in a column.
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	...auditColumns
});

// Append-only. Drizzle can't express triggers, so the initial migration appends two by hand that
// abort any UPDATE or DELETE: re-add them whenever migrations/ is squashed.
export const events = sqliteTable(
	'events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		entityType: text('entity_type').notNull(),
		entityId: integer('entity_id'),
		action: text('action').notNull(),
		actorUsername: text('actor_username').notNull(),
		actorKind: text('actor_kind').notNull(),
		before: text('before'),
		after: text('after'),
		reason: text('reason'),
		ip: text('ip'),
		userAgent: text('user_agent'),
		createdAt: integer('created_at').notNull()
	},
	(table) => [
		check(
			'events_actor_kind',
			sql`${table.actorKind} IN ('user', 'system', 'agent', 'integration')`
		)
	]
);
