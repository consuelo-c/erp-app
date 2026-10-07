// Audited writes: build insert/update statements with the audit columns filled from the actor,
// each paired with its `events` row, for the caller to run in a single `db.batch()`.

import { z } from 'zod';
import type { Actor } from './actor';

type ColumnValue = string | number | null;
type Row = Record<string, ColumnValue>;

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

function nowInSeconds(): number {
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
};

function eventStatement(db: D1Database, event: EventRow) {
	const isNewRow = 'NEW_ROW' === event.entityId;
	const entityIdSql = isNewRow ? 'last_insert_rowid()' : '?';
	const entityId = isNewRow ? [] : [event.entityId];
	return db
		.prepare(
			`insert into events (entity_type, entity_id, action, actor_username, actor_kind, before, after, created_at) values (?, ${entityIdSql}, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			event.entityType,
			...entityId,
			event.action,
			event.actor.username,
			event.actor.kind,
			toEventJson(event.before),
			toEventJson(event.after),
			event.now
		);
}

/**
 * Inserts `values` with the four audit columns filled from `actor`, plus its `CREATED` event.
 * Returns both statements for the caller's `db.batch()`, in this order: the event takes
 * `entity_id` from `last_insert_rowid()`, so it must run right after the insert.
 */
export function auditedInsert(
	db: D1Database,
	write: AuditedWrite & { values: Row }
): D1PreparedStatement[] {
	const now = nowInSeconds();
	const row = {
		...write.values,
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

/**
 * Updates the row `id` (matched on `idColumn`, `id` by default) with the fields of `changes`
 * that differ from `current`, refreshes `updated_at`/`updated_by`, and logs an `EDITED` event
 * with those fields only. Returns the statements for the caller's `db.batch()`, or none when
 * nothing changed: an edit that changes nothing writes nothing.
 */
export function auditedUpdate(
	db: D1Database,
	write: AuditedWrite & { id: number | string; idColumn?: string; current: Row; changes: Row }
): D1PreparedStatement[] {
	const { before, after } = diffFields(write.current, write.changes);
	const changedColumns = Object.keys(after);
	if (0 === changedColumns.length) {
		return [];
	}
	const idColumn = write.idColumn ?? 'id';
	assertIdentifiers([write.table, idColumn, ...changedColumns]);
	const now = nowInSeconds();
	const assignments = [...changedColumns, 'updated_at', 'updated_by'].map(
		(column) => `${column} = ?`
	);
	const update = db
		.prepare(`update ${write.table} set ${assignments.join(', ')} where ${idColumn} = ?`)
		.bind(...Object.values(after), now, write.actor.username, write.id);
	// entity_id is INTEGER: rows keyed by text, like settings, log it as null.
	const entityId = 'number' === typeof write.id ? write.id : null;
	const event = { ...write, action: 'EDITED', before, after, now, entityId };
	return [update, eventStatement(db, event)];
}
