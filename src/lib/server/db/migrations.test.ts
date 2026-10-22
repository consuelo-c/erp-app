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

function insertContact(phone: string) {
	database.exec(
		`insert into contacts (phone, full_name, created_at, created_by, updated_at, updated_by) values ('${phone}', 'Ana Pérez', ${AUDIT})`
	);
}

function insertEmployee(contactId: number | null) {
	database.exec(
		`insert into employees (contact_id, created_at, created_by, updated_at, updated_by) values (${contactId}, ${AUDIT})`
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
		'contacts',
		'employees',
		'events',
		'payroll_runs',
		'products',
		'sessions',
		'settings',
		'timesheets',
		'users'
	]);
});

test('users: username is unique, employee_id is unique but may be null on many rows', () => {
	insertContact('573104428890');
	insertEmployee(1);
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

test('employees: contact_id is required and unique, attributes defaults to {}, no active', () => {
	insertContact('573104428890');
	insertEmployee(1);
	expect(() => insertEmployee(1)).toThrow(/UNIQUE/);
	expect(() => insertEmployee(null)).toThrow(/NOT NULL/);
	expect(database.prepare('select attributes from employees').get()?.attributes).toBe('{}');
	expect(listColumns('employees')).not.toContain('active');
});

test("employees has no name, phone or ID number: they are the contact's", () => {
	const forbidden = ['full_name', 'phone', 'id_number', 'document_id'];
	expect(listColumns('employees').filter((column) => forbidden.includes(column))).toEqual([]);
});

function insertProduct(category: string, variantGroup: string | null, variantName: string | null) {
	database
		.prepare(
			`insert into products (name, category, variant_group, variant_name, rental_price, total_quantity, created_at, created_by, updated_at, updated_by) values ('Mantel', ?, ?, ?, 8000, 10, ${AUDIT})`
		)
		.run(category, variantGroup, variantName);
}

test('products: the database rejects an unknown category', () => {
	insertProduct('LINENS', null, null);
	expect(() => insertProduct('FURNITURE', null, null)).toThrow(/CHECK/);
	expect(database.prepare('select active from products').get()?.active).toBe(1);
});

test('products: a variant name repeats in its group only by case, and products without variants never collide', () => {
	insertProduct('LINENS', 'Mantel cuadrado 50×50', 'Dorado');
	insertProduct('LINENS', 'Mantel cuadrado 50×50', 'Rojo');
	insertProduct('LINENS', null, null);
	insertProduct('LINENS', null, null);
	expect(() => insertProduct('LINENS', 'mantel CUADRADO 50×50', 'DORADO')).toThrow(/UNIQUE/);
});

type MovementInsert = {
	concept: string;
	amount: number;
	entityType?: string | null;
	reversesId?: number | null;
};

let receiptNumber = 0;

// Each row gets a receipt number of its own, so only the CHECK under test can refuse it.
function insertMovement({ concept, amount, entityType = null, reversesId = null }: MovementInsert) {
	receiptNumber += 1;
	const columns =
		'concept, payment_method, amount, movement_date, entity_type, entity_id, receipt_number, reverses_id, created_at, created_by, updated_at, updated_by';
	database
		.prepare(
			`insert into cash_movements (${columns}) values (?, 'CASH', ?, '2026-10-17', ?, ?, ?, ?, ${AUDIT})`
		)
		.run(concept, amount, entityType, null === entityType ? null : 1, receiptNumber, reversesId);
}

test('cash_movements has no link columns: it links by entity_type + entity_id', () => {
	expect(listColumns('cash_movements')).not.toContain('order_id');
	expect(listColumns('cash_movements')).not.toContain('payroll_run_id');
	expect(listColumns('cash_movements')).toEqual(
		expect.arrayContaining(['entity_type', 'entity_id'])
	);
});

test("cash_movements: each concept takes its entity_type and its amount's natural sign", () => {
	insertMovement({ concept: 'PAYROLL', amount: -100, entityType: 'PAYROLL_RUN' });
	insertMovement({ concept: 'INSTALLMENT', amount: 100, entityType: 'ORDER' });
	insertMovement({ concept: 'OTHER_EXPENSE', amount: -100 });
	insertMovement({ concept: 'OTHER_INCOME', amount: 100 });
	expect(database.prepare('select attributes from cash_movements').get()?.attributes).toBe('{}');
	const refused = [
		{ concept: 'OTHER_EXPENSE', amount: 0 },
		{ concept: 'OTHER_INCOME', amount: -100 },
		{ concept: 'OTHER_INCOME', amount: 100, entityType: 'ORDER' },
		{ concept: 'OTHER_EXPENSE', amount: -100, entityType: 'ORDER' },
		{ concept: 'PAYROLL', amount: 100, entityType: 'PAYROLL_RUN' },
		{ concept: 'PAYROLL', amount: -100 },
		{ concept: 'PAYROLL', amount: -100, entityType: 'ORDER' },
		{ concept: 'INSTALLMENT', amount: 100 },
		{ concept: 'INSTALLMENT_REFUND', amount: 100, entityType: 'ORDER' },
		{ concept: 'BOGUS', amount: -100 }
	];
	for (const movement of refused) {
		expect(() => insertMovement(movement)).toThrow(/CHECK/);
	}
	expect(() =>
		database.exec(
			`insert into cash_movements (concept, payment_method, amount, movement_date, entity_type, receipt_number, created_at, created_by, updated_at, updated_by) values ('PAYROLL', 'CASH', -100, '2026-10-17', 'PAYROLL_RUN', 99, ${AUDIT})`
		)
	).toThrow(/CHECK/);
});

test('an offsetting movement flips the sign: it points at the original with reverses_id', () => {
	insertMovement({ concept: 'PAYROLL', amount: -100, entityType: 'PAYROLL_RUN' });
	insertMovement({ concept: 'OTHER_INCOME', amount: 100 });
	insertMovement({ concept: 'PAYROLL', amount: 100, entityType: 'PAYROLL_RUN', reversesId: 1 });
	insertMovement({ concept: 'OTHER_INCOME', amount: -100, reversesId: 2 });
	// A movement is offset at most once.
	expect(() =>
		insertMovement({ concept: 'PAYROLL', amount: 100, entityType: 'PAYROLL_RUN', reversesId: 1 })
	).toThrow(/UNIQUE/);
	expect(() => insertMovement({ concept: 'OTHER_INCOME', amount: -100, reversesId: 99 })).toThrow(
		/FOREIGN KEY/
	);
});

test('receipt_number is required and unique per sign', () => {
	const insert = (amount: number, number: number | null) =>
		database.exec(
			`insert into cash_movements (concept, payment_method, amount, movement_date, receipt_number, created_at, created_by, updated_at, updated_by) values ('${0 < amount ? 'OTHER_INCOME' : 'OTHER_EXPENSE'}', 'CASH', ${amount}, '2026-10-17', ${number}, ${AUDIT})`
		);
	insert(-100, 1);
	insert(100, 1);
	expect(() => insert(-50, 1)).toThrow(/UNIQUE/);
	expect(() => insert(-50, null)).toThrow(/NOT NULL/);
});

test('users, employees, sessions and products carry the audit columns', () => {
	const audit = ['created_at', 'created_by', 'updated_at', 'updated_by'];
	for (const table of ['users', 'employees', 'sessions', 'products']) {
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
