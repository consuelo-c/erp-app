import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

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
// abort any UPDATE or DELETE: re-add them whenever migrations/ is squashed or a migration recreates
// the table (drizzle does, to add a CHECK).
export const events = sqliteTable(
	'events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		entityType: text('entity_type').notNull(),
		entityId: integer('entity_id'),
		// The key of an entity keyed by text, a `settings` key; never set together with entity_id.
		entityKey: text('entity_key'),
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
		),
		check('events_entity_id_or_key', sql`${table.entityId} IS NULL OR ${table.entityKey} IS NULL`)
	]
);

// The people on payroll. Salary, position, bank account and employment periods live in `attributes` (JSON,
// validated with Zod); "currently employed" is the last period having no end, so there's no `active`.
export const employees = sqliteTable('employees', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	fullName: text('full_name').notNull(),
	idNumber: text('id_number').notNull().unique(),
	attributes: text('attributes').notNull().default('{}'),
	...auditColumns
});

// The logins. A login isn't a person: `employee_id` is null for a login not on payroll, and moves
// to the new hire when a login is reassigned.
export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull().unique(), // lowercase
	roles: text('roles').notNull(), // JSON, validated with Zod
	employeeId: integer('employee_id')
		.unique()
		.references(() => employees.id),
	passwordHash: text('password_hash').notNull(),
	passwordSalt: text('password_salt').notNull(),
	passwordIterations: integer('password_iterations').notNull(),
	active: integer('active').notNull().default(1),
	...auditColumns
});

// `id` is the SHA-256 of the session token, never the token: a leaked table hands over no sessions.
export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		expiresAt: integer('expires_at').notNull(),
		...auditColumns
	},
	(table) => [index('sessions_user_id').on(table.userId)]
);

// A day's four punches, `HH:MM` or null. `employee_id` is whose hours they are, not who typed them,
// and points to the person, not the login. No payment fields: a day is paid when a PAID settlement
// of that employee covers it.
export const timesheets = sqliteTable(
	'timesheets',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		employeeId: integer('employee_id')
			.notNull()
			.references(() => employees.id),
		workDate: text('work_date').notNull(), // YYYY-MM-DD
		morningIn: text('morning_in'),
		morningOut: text('morning_out'),
		afternoonIn: text('afternoon_in'),
		afternoonOut: text('afternoon_out'),
		...auditColumns
	},
	(table) => [unique('timesheets_employee_id_work_date').on(table.employeeId, table.workDate)]
);
