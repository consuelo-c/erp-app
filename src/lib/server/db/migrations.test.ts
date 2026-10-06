import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';

let database: DatabaseSync;

beforeEach(() => {
	database = new DatabaseSync(':memory:');
	const files = readdirSync('migrations')
		.filter((file) => file.endsWith('.sql'))
		.sort();
	for (const file of files) {
		database.exec(readFileSync(`migrations/${file}`, 'utf8'));
	}
});

function listTables(): string[] {
	const rows = database
		.prepare(
			"select name from sqlite_master where type = 'table' and name not glob 'sqlite_*' order by name"
		)
		.all();
	return rows.map((row) => String(row.name));
}

test('creates exactly settings and events', () => {
	expect(listTables()).toEqual(['events', 'settings']);
});

test('no column is REAL', () => {
	const realColumns = listTables().flatMap((table) =>
		database.prepare(`select name from pragma_table_info('${table}') where type = 'REAL'`).all()
	);
	expect(realColumns).toEqual([]);
});

test('events rejects UPDATE and DELETE', () => {
	database.exec(
		"insert into events (entity_type, action, actor_username, actor_kind, created_at) values ('SETTINGS', 'EDITED', 'admin', 'user', 0)"
	);
	expect(() => database.exec("update events set reason = 'x'")).toThrow(/append-only/);
	expect(() => database.exec('delete from events')).toThrow(/append-only/);
});

test('events rejects an unknown actor_kind', () => {
	expect(() =>
		database.exec(
			"insert into events (entity_type, action, actor_username, actor_kind, created_at) values ('SETTINGS', 'EDITED', 'admin', 'robot', 0)"
		)
	).toThrow(/CHECK/);
});
