// Audited writes: build insert/update statements with the audit columns filled from the actor,
// each paired with its `events` row, for the caller to run in a single `db.batch()`.

import { z } from 'zod';
import type { Actor } from './actor';

type ColumnValue = string | number | null;
export type Row = Record<string, ColumnValue>;

/** `events.before` / `events.after`: only the changed fields, never a snapshot of the whole row. */
export const eventFieldsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

type AuditedWrite = { table: string; entityType: string; actor: Actor };

// Table and column names are interpolated into SQL: they come from code, but a typo or a key
// spread from client input must fail loudly instead of reaching the query.
const IDENTIFIER = /^[a-z_]+$/;

function assertIdentifiers(names: string[]): void {
	const invalid = names.find((name) => !IDENTIFIER.test(name));
	if (undefined !== invalid) {
		throw new Error(`Invalid SQL identifier: ${invalid}`);
	}
}

export function nowInSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function toEventJson(fields: Row | null): string | null {
	return null === fields ? null : JSON.stringify(eventFieldsSchema.parse(fields));
}

type EventRow = {
	entityType: string;
	action: string;
	actor: Actor;
	before: Row | null;
	after: Row;
	now: number;
	// NEW_ROW: the row inserted by the statement right before this one in the batch.
	entityId: number | null | 'NEW_ROW';
	entityKey?: string;
	reason?: string;
};

// Rows keyed by text, like settings, log their key in entity_key and leave entity_id null.
function entityOf(id: number | string) {
	return 'string' === typeof id ? { entityId: null, entityKey: id } : { entityId: id };
}

function eventStatement(db: D1Database, event: EventRow) {
	const isNewRow = 'NEW_ROW' === event.entityId;
	const entityIdSql = isNewRow ? 'last_insert_rowid()' : '?';
	const entityId = isNewRow ? [] : [event.entityId];
	return db
		.prepare(
			`insert into events (entity_type, entity_id, entity_key, action, actor_username, actor_kind, before, after, reason, created_at) values (?, ${entityIdSql}, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			event.entityType,
			...entityId,
			event.entityKey ?? null,
			event.action,
			event.actor.username,
			event.actor.kind,
			toEventJson(event.before),
			toEventJson(event.after),
			event.reason ?? null,
			event.now
		);
}

/** Columns whose value a subquery works out inside the same INSERT: no separate read. */
type Computed = Record<string, { sql: string; params: ColumnValue[] }>;

function insertStatement(
	db: D1Database,
	{ table, row, computed }: { table: string; row: Row; computed: Computed }
): D1PreparedStatement {
	const subqueries = Object.values(computed);
	const columns = [...Object.keys(row), ...Object.keys(computed)];
	assertIdentifiers([table, ...columns]);
	const values = [...Object.keys(row).map(() => '?'), ...subqueries.map(({ sql }) => `(${sql})`)];
	return db
		.prepare(`insert into ${table} (${columns.join(', ')}) values (${values.join(', ')})`)
		.bind(...Object.values(row), ...subqueries.flatMap(({ params }) => params));
}

/**
 * Inserts `values` with the four audit columns filled from `actor`, plus its `CREATED` event.
 * `unlogged` columns are inserted but left out of the event: a password hash never reaches `events`.
 * `computed` columns come from a subquery in the same statement, like a receipt's consecutive.
 * Returns both statements for the caller's `db.batch()`, in this order: the event takes
 * `entity_id` from `last_insert_rowid()`, so it must run right after the insert.
 */
export function auditedInsert(
	db: D1Database,
	write: AuditedWrite & { values: Row; unlogged?: Row; computed?: Computed }
): D1PreparedStatement[] {
	const now = nowInSeconds();
	const row = {
		...write.values,
		...write.unlogged,
		created_at: now,
		created_by: write.actor.username,
		updated_at: now,
		updated_by: write.actor.username
	};
	const insert = insertStatement(db, { table: write.table, row, computed: write.computed ?? {} });
	const event = {
		...write,
		action: 'CREATED',
		before: null,
		after: write.values,
		now,
		entityId: 'NEW_ROW' as const
	};
	return [insert, eventStatement(db, event)];
}

/** The fields of `changes` whose value differs from `current`, as `{ before, after }`. */
export function diffFields(current: Row, changes: Row): { before: Row; after: Row } {
	const changed = Object.keys(changes).filter((column) => changes[column] !== current[column]);
	return {
		before: Object.fromEntries(changed.map((column) => [column, current[column] ?? null])),
		after: Object.fromEntries(changed.map((column) => [column, changes[column]]))
	};
}

type Diff = { before: Row; after: Row };

function parseObject(json: ColumnValue | undefined): Row {
	return null === json || undefined === json ? {} : (JSON.parse(String(json)) as Row);
}

// The keys of a JSON column that changed, as `attributes.bank_account`; a missing key logs as null.
function diffJsonColumn(column: string, before: ColumnValue, after: ColumnValue): Diff {
	const old = parseObject(before);
	const next = parseObject(after);
	const keys = [...new Set([...Object.keys(old), ...Object.keys(next)])].filter(
		(key) => old[key] !== next[key]
	);
	const prefixed = (object: Row) =>
		Object.fromEntries(keys.map((key) => [`${column}.${key}`, object[key] ?? null]));
	return { before: prefixed(old), after: prefixed(next) };
}

// What the event logs: the changed fields, each `jsonColumns` one replaced by its changed keys.
function loggedFields(diff: Diff, jsonColumns: readonly string[]): Diff {
	const plain = (row: Row) =>
		Object.fromEntries(Object.entries(row).filter(([column]) => !jsonColumns.includes(column)));
	const expanded = jsonColumns
		.filter((column) => column in diff.after)
		.map((column) => diffJsonColumn(column, diff.before[column], diff.after[column]));
	return {
		before: Object.assign(plain(diff.before), ...expanded.map((keys) => keys.before)),
		after: Object.assign(plain(diff.after), ...expanded.map((keys) => keys.after))
	};
}

type UpdateRow = AuditedWrite & {
	id: number | string;
	idColumn?: string;
	columns: Row;
	computed: Computed;
	now: number;
};

function updateStatement(db: D1Database, write: UpdateRow): D1PreparedStatement {
	const idColumn = write.idColumn ?? 'id';
	const subqueries = Object.values(write.computed);
	assertIdentifiers([
		write.table,
		idColumn,
		...Object.keys(write.columns),
		...Object.keys(write.computed)
	]);
	const assignments = [
		...[...Object.keys(write.columns), 'updated_at', 'updated_by'].map((column) => `${column} = ?`),
		...Object.entries(write.computed).map(([column, { sql }]) => `${column} = (${sql})`)
	];
	return db
		.prepare(`update ${write.table} set ${assignments.join(', ')} where ${idColumn} = ?`)
		.bind(
			...Object.values(write.columns),
			write.now,
			write.actor.username,
			...subqueries.flatMap(({ params }) => params),
			write.id
		);
}

type AuditedEdit = AuditedWrite & {
	id: number | string;
	idColumn?: string;
	current: Row;
	changes: Row;
	unlogged?: Row;
	jsonColumns?: readonly string[];
	computed?: Computed;
	action?: string;
	reason?: string;
};

/**
 * Updates the row `id` (matched on `idColumn`, `id` by default) with the fields of `changes`
 * that differ from `current`, refreshes `updated_at`/`updated_by`, and logs an `EDITED` event
 * (or `action`) with those fields only, and `reason` when the write needs one. `unlogged` columns
 * are always written but never logged: a new password hash. `jsonColumns` are written whole but logged
 * key by key, only the keys that changed. `computed` columns are set from a subquery and not logged,
 * like the id of a row inserted earlier in the same batch. Returns the statements for the caller's
 * `db.batch()`, or none when nothing changed: an edit that changes nothing writes nothing.
 */
export function auditedUpdate(db: D1Database, write: AuditedEdit): D1PreparedStatement[] {
	const diff = diffFields(write.current, write.changes);
	const columns = { ...diff.after, ...write.unlogged };
	const computed = write.computed ?? {};
	if (0 === Object.keys(columns).length + Object.keys(computed).length) {
		return [];
	}
	const now = nowInSeconds();
	const update = updateStatement(db, { ...write, columns, computed, now });
	const event = {
		...write,
		action: write.action ?? 'EDITED',
		...loggedFields(diff, write.jsonColumns ?? []),
		now,
		...entityOf(write.id)
	};
	return [update, eventStatement(db, event)];
}
