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

test('creates exactly the tables of the phases built so far', () => {
	expect(listTables()).toEqual([
		'cash_movements',
		'employees',
		'events',
		'payroll_runs',
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

function insertMovement(concept: string, amount: number, entityType: string | null) {
	const entityId = null === entityType ? 'null' : '1';
	const type = null === entityType ? 'null' : `'${entityType}'`;
	database.exec(
		`insert into cash_movements (concept, payment_method, amount, movement_date, entity_type, entity_id, created_at, created_by, updated_at, updated_by) values ('${concept}', 'CASH', ${amount}, '2026-10-17', ${type}, ${entityId}, ${AUDIT})`
	);
}

test('cash_movements has no link columns: it links by entity_type + entity_id', () => {
	expect(listColumns('cash_movements')).not.toContain('order_id');
	expect(listColumns('cash_movements')).not.toContain('payroll_run_id');
	expect(listColumns('cash_movements')).toEqual(
		expect.arrayContaining(['entity_type', 'entity_id'])
	);
});

test("cash_movements: each concept takes its entity_type and its amount's sign", () => {
	insertMovement('PAYROLL', -100, 'PAYROLL_RUN');
	insertMovement('INSTALLMENT', 100, 'ORDER');
	insertMovement('OTHER_EXPENSE', -100, null);
	expect(database.prepare('select attributes from cash_movements').get()?.attributes).toBe('{}');
	expect(() => insertMovement('PAYROLL', -100, null)).toThrow(/CHECK/);
	expect(() => insertMovement('PAYROLL', -100, 'ORDER')).toThrow(/CHECK/);
	expect(() => insertMovement('INSTALLMENT', 100, null)).toThrow(/CHECK/);
	expect(() => insertMovement('INSTALLMENT_REFUND', 100, 'ORDER')).toThrow(/CHECK/);
	expect(() => insertMovement('OTHER_EXPENSE', -100, 'ORDER')).toThrow(/CHECK/);
	expect(() => insertMovement('BOGUS', -100, null)).toThrow(/CHECK/);
	expect(() =>
		database.exec(
			`insert into cash_movements (concept, payment_method, amount, movement_date, entity_type, created_at, created_by, updated_at, updated_by) values ('PAYROLL', 'CASH', -100, '2026-10-17', 'PAYROLL_RUN', ${AUDIT})`
		)
	).toThrow(/CHECK/);
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
