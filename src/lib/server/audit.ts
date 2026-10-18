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

/**
 * Inserts `values` with the four audit columns filled from `actor`, plus its `CREATED` event.
 * `unlogged` columns are inserted but left out of the event: a password hash never reaches `events`.
 * Returns both statements for the caller's `db.batch()`, in this order: the event takes
 * `entity_id` from `last_insert_rowid()`, so it must run right after the insert.
 */
export function auditedInsert(
	db: D1Database,
	write: AuditedWrite & { values: Row; unlogged?: Row }
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
	const columns = Object.keys(row);
	assertIdentifiers([write.table, ...columns]);
	const insert = db
		.prepare(
			`insert into ${write.table} (${columns.join(', ')}) values (${columns.map(() => '?').join(', ')})`
		)
		.bind(...Object.values(row));
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

type UpdateRow = AuditedWrite & {
	id: number | string;
	idColumn?: string;
	columns: Row;
	now: number;
};

function updateStatement(db: D1Database, write: UpdateRow): D1PreparedStatement {
	const idColumn = write.idColumn ?? 'id';
	assertIdentifiers([write.table, idColumn, ...Object.keys(write.columns)]);
	const assignments = [...Object.keys(write.columns), 'updated_at', 'updated_by'].map(
		(column) => `${column} = ?`
	);
	return db
		.prepare(`update ${write.table} set ${assignments.join(', ')} where ${idColumn} = ?`)
		.bind(...Object.values(write.columns), write.now, write.actor.username, write.id);
}

/**
 * Updates the row `id` (matched on `idColumn`, `id` by default) with the fields of `changes`
 * that differ from `current`, refreshes `updated_at`/`updated_by`, and logs an `EDITED` event
 * (or `action`) with those fields only, and `reason` when the write needs one. `unlogged` columns
 * are always written but never logged: a new password hash. Returns the statements for the caller's `db.batch()`, or none when
 * nothing changed: an edit that changes nothing writes nothing.
 */
export function auditedUpdate(
	db: D1Database,
	write: AuditedWrite & {
		id: number | string;
		idColumn?: string;
		current: Row;
		changes: Row;
		unlogged?: Row;
		action?: string;
		reason?: string;
	}
): D1PreparedStatement[] {
	const { before, after } = diffFields(write.current, write.changes);
	const columns = { ...after, ...write.unlogged };
	if (0 === Object.keys(columns).length) {
		return [];
	}
	const now = nowInSeconds();
	const update = updateStatement(db, { ...write, columns, now });
	const event = {
		...write,
		action: write.action ?? 'EDITED',
		before,
		after,
		now,
		...entityOf(write.id)
	};
	return [update, eventStatement(db, event)];
}
