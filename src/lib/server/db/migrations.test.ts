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

function listColumns(table: string): string[] {
	const rows = database.prepare(`select name from pragma_table_info('${table}')`).all();
	return rows.map((row) => String(row.name));
}

const AUDIT = "0, 'admin', 0, 'admin'";

function insertEmployee(idNumber: string) {
	database.exec(
		`insert into employees (full_name, id_number, created_at, created_by, updated_at, updated_by) values ('Ana Pérez', '${idNumber}', ${AUDIT})`
	);
}

function insertUser(username: string, employeeId: number | null) {
	database.exec(
		`insert into users (username, roles, employee_id, password_hash, password_salt, password_iterations, created_at, created_by, updated_at, updated_by) values ('${username}', '["SALES"]', ${employeeId}, 'hash', 'salt', 1, ${AUDIT})`
	);
}

test('creates exactly settings, events, employees, users, sessions and timesheets', () => {
	expect(listTables()).toEqual([
		'employees',
		'events',
		'sessions',
		'settings',
		'timesheets',
		'users'
	]);
});

test('users: username is unique, employee_id is unique but may be null on many rows', () => {
	insertEmployee('1036452118');
	insertUser('admin', null);
	insertUser('gerente', null);
	insertUser('ventas', 1);
	expect(() => insertUser('admin', null)).toThrow(/UNIQUE/);
	expect(() => insertUser('bodega', 1)).toThrow(/UNIQUE/);
});

test('users has no email, id_number or attributes', () => {
	const forbidden = ['email', 'id_number', 'attributes'];
	expect(listColumns('users').filter((column) => forbidden.includes(column))).toEqual([]);
});

test('employees: id_number is required and unique, attributes defaults to {}, no active', () => {
	insertEmployee('71384902');
	expect(() => insertEmployee('71384902')).toThrow(/UNIQUE/);
	expect(() =>
		database.exec(
			`insert into employees (full_name, created_at, created_by, updated_at, updated_by) values ('Sin cédula', ${AUDIT})`
		)
	).toThrow(/NOT NULL/);
	expect(database.prepare('select attributes from employees').get()?.attributes).toBe('{}');
	expect(listColumns('employees')).not.toContain('active');
});

test('users, employees and sessions carry the audit columns', () => {
	const audit = ['created_at', 'created_by', 'updated_at', 'updated_by'];
	for (const table of ['users', 'employees', 'sessions']) {
		expect(listColumns(table)).toEqual(expect.arrayContaining(audit));
	}
});

test('sessions are indexed by user_id', () => {
	const indexedColumns = database
		.prepare(
			"select info.name from pragma_index_list('sessions') as list, pragma_index_info(list.name) as info"
		)
		.all()
		.map((row) => row.name);
	expect(indexedColumns).toContain('user_id');
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
