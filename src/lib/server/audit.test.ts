import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import type { Actor } from './actor';
import { auditedInsert, auditedUpdate, diffFields } from './audit';

const manager: Actor = { username: 'gerente', employeeId: 1, roles: ['MANAGER'], kind: 'user' };

let database: DatabaseSync;

// Just enough of D1 for the helpers: prepare().bind(), run here in order like db.batch().
const db = {
	prepare: (sql: string) => ({ bind: (...params: SQLInputValue[]) => ({ sql, params }) })
} as unknown as D1Database;

function runBatch(statements: D1PreparedStatement[]): void {
	for (const statement of statements as unknown as { sql: string; params: SQLInputValue[] }[]) {
		database.prepare(statement.sql).run(...statement.params);
	}
}

function readEvents() {
	return database.prepare('select * from events order by id').all();
}

beforeEach(() => {
	database = new DatabaseSync(':memory:');
	const files = readdirSync('migrations')
		.filter((file) => file.endsWith('.sql'))
		.sort();
	for (const file of files) {
		database.exec(readFileSync(`migrations/${file}`, 'utf8'));
	}
	// A table with an INTEGER id, like every table after settings.
	database.exec(
		'create table products (id integer primary key, name text not null, created_at integer not null, created_by text not null, updated_at integer not null, updated_by text not null)'
	);
});

test('an insert fills all four audit columns, with updated_* equal to created_*', () => {
	runBatch(
		auditedInsert(db, {
			table: 'products',
			entityType: 'PRODUCT',
			actor: manager,
			values: { name: 'Silla' }
		})
	);
	const row = database.prepare('select * from products').get();
	expect(row).toMatchObject({ name: 'Silla', created_by: 'gerente', updated_by: 'gerente' });
	expect(row?.created_at).toBeTypeOf('number');
	expect(row?.updated_at).toBe(row?.created_at);
});

test('an insert logs CREATED with the new id and a null before', () => {
	database.exec("insert into products values (7, 'Mesa', 0, 'system', 0, 'system')");
	runBatch(
		auditedInsert(db, {
			table: 'products',
			entityType: 'PRODUCT',
			actor: manager,
			values: { name: 'Silla' }
		})
	);
	expect(readEvents()).toEqual([
		expect.objectContaining({
			entity_type: 'PRODUCT',
			entity_id: 8,
			action: 'CREATED',
			actor_username: 'gerente',
			actor_kind: 'user',
			before: null,
			after: '{"name":"Silla"}'
		})
	]);
});

test('an update logs before and after with only the changed fields', () => {
	database.exec(
		"insert into settings values ('PAYROLL_PENSION_RATE', '4', 0, 'system', 0, 'system')"
	);
	runBatch(
		auditedUpdate(db, {
			table: 'settings',
			entityType: 'SETTINGS',
			actor: manager,
			idColumn: 'key',
			id: 'PAYROLL_PENSION_RATE',
			current: { key: 'PAYROLL_PENSION_RATE', value: '4' },
			changes: { key: 'PAYROLL_PENSION_RATE', value: '5' }
		})
	);
	expect(database.prepare('select value, created_by, updated_by from settings').get()).toEqual({
		value: '5',
		created_by: 'system',
		updated_by: 'gerente'
	});
	expect(readEvents()).toEqual([
		expect.objectContaining({
			action: 'EDITED',
			entity_id: null,
			before: '{"value":"4"}',
			after: '{"value":"5"}'
		})
	]);
});

test('an update that changes nothing writes nothing', () => {
	const statements = auditedUpdate(db, {
		table: 'products',
		entityType: 'PRODUCT',
		actor: manager,
		id: 1,
		current: { name: 'Silla' },
		changes: { name: 'Silla' }
	});
	expect(statements).toEqual([]);
});

test('diffFields reports a column missing from current as null before', () => {
	expect(diffFields({ name: 'Silla' }, { name: 'Silla', color: 'blanco' })).toEqual({
		before: { color: null },
		after: { color: 'blanco' }
	});
});

test('a column name that is not a plain identifier is rejected', () => {
	expect(() =>
		auditedInsert(db, {
			table: 'products',
			entityType: 'PRODUCT',
			actor: manager,
			values: { 'name) values (1); --': 'x' }
		})
	).toThrow(/identifier/);
});
