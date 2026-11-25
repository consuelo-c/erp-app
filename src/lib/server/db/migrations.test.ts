import { timingSafeEqual } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import { hashPassword, PASSWORD_ITERATIONS } from '../password';
import { logIn } from '../services/auth';
import { correctIncident, reportIncident, reverseIncident } from '../services/incidents';
import { reverseCount, submitAndApproveCount } from '../services/inventory';
import { getProduct } from '../services/products';
import { getQuote } from '../services/quotes';
import { issueReceivable } from '../services/receivables';
import { getAuditLog } from '../services/reports';
import { getSystemSettings, updateSystemSettings } from '../services/settings';
import { createFixture, DRIVER, MANAGER, SALES, TEST_PASSWORD, TEST_PEPPER } from './fixture';

// Workers adds timingSafeEqual to crypto.subtle; Node doesn't, so the tests lend it node:crypto's.
Object.assign(crypto.subtle, { timingSafeEqual });

let database: DatabaseSync;

const MIGRATION_FILES = readdirSync('migrations')
	.filter((file) => file.endsWith('.sql'))
	.sort();

function applyMigrations(files: string[]) {
	for (const file of files) {
		database.exec(readFileSync(`migrations/${file}`, 'utf8'));
	}
}

beforeEach(() => {
	database = new DatabaseSync(':memory:');
	applyMigrations(MIGRATION_FILES);
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

function insertContact(documentId: string) {
	database.exec(
		`insert into contacts (phone, full_name, document_id, created_at, created_by, updated_at, updated_by) values ('573104428890', 'Ana Pérez', '${documentId}', ${AUDIT})`
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
		'cash_handovers',
		'cash_movements',
		'contacts',
		'employees',
		'events',
		'incidents',
		'inventory_counts',
		'orders',
		'payroll_runs',
		'products',
		'quotes',
		'receivables',
		'sessions',
		'settings',
		'timesheets',
		'users'
	]);
});

test('users: username is unique, employee_id is unique but may be null on many rows', () => {
	insertContact('1036452118');
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
	insertContact('1036452118');
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

type OrderInsert = {
	status?: string;
	deliveryMethod?: string;
	pickupMethod?: string;
	clientId?: number;
};

let publicToken = 0;

// Each row gets a token of its own, so only the constraint under test can refuse it.
function insertOrder({
	status = 'CONFIRMED',
	deliveryMethod = 'COMPANY_DELIVERY',
	pickupMethod = 'COMPANY_PICKUP',
	clientId = 1
}: OrderInsert) {
	publicToken += 1;
	const columns =
		'public_token, client_id, status, event_date, delivery_date, pickup_date, rental_days, client_attributes, delivery_attributes, pickup_attributes, order_items, items_total, order_total, created_at, created_by, updated_at, updated_by';
	database
		.prepare(
			`insert into orders (${columns}) values (?, ?, ?, '2026-08-15', '2026-08-14', '2026-08-16', 2, '{}', ?, ?, '[]', 0, 0, ${AUDIT})`
		)
		.run(
			String(publicToken),
			clientId,
			status,
			JSON.stringify({ method: deliveryMethod }),
			JSON.stringify({ method: pickupMethod })
		);
}

test('orders: the database rejects an unknown status, delivery method or return method', () => {
	insertContact('1036452118');
	insertOrder({});
	insertOrder({
		status: 'DELIVERED',
		deliveryMethod: 'CLIENT_PICKUP',
		pickupMethod: 'CLIENT_RETURN'
	});
	expect(() => insertOrder({ status: 'LOST' })).toThrow(/CHECK/);
	expect(() => insertOrder({ status: 'DRAFT' })).toThrow(/CHECK/);
	expect(() => insertOrder({ deliveryMethod: 'CLIENT_RETURN' })).toThrow(/CHECK/);
	expect(() => insertOrder({ pickupMethod: 'CLIENT_PICKUP' })).toThrow(/CHECK/);
	expect(() => database.exec(`update orders set delivery_attributes = '{}' where id = 1`)).toThrow(
		/CHECK/
	);
	const order = database.prepare('select has_incident, discount, attributes from orders').get();
	expect(order).toEqual({ has_incident: 0, discount: 0, attributes: '{}' });
});

test('incidents: the database rejects an unknown status or responsible party', () => {
	insertContact('1036452118');
	insertOrder({});
	const insert = (party: string, status: string) =>
		database
			.prepare(
				`insert into incidents (order_id, incident_items, incident_description, responsible_party, status, created_at, created_by, updated_at, updated_by) values (1, '[]', 'x', ?, ?, ${AUDIT})`
			)
			.run(party, status);
	expect(() => insert('NEIGHBOR', 'ACTIVE')).toThrow(/CHECK constraint failed/);
	expect(() => insert('UNDETERMINED', 'CLOSED')).toThrow(/CHECK constraint failed/);
});

test('inventory_counts: the database rejects an unknown status', () => {
	const insert = (status: string) =>
		database
			.prepare(
				`insert into inventory_counts (status, inventory_items, created_at, created_by, updated_at, updated_by) values (?, '[]', ${AUDIT})`
			)
			.run(status);
	expect(() => insert('WITHDRAWN')).toThrow(/CHECK constraint failed/);
	expect(() => insert('PENDING_APPROVAL')).not.toThrow();
});

test('orders: public_token is unique and client_id must be a contact', () => {
	insertContact('1036452118');
	insertOrder({});
	publicToken -= 1;
	expect(() => insertOrder({})).toThrow(/UNIQUE/);
	expect(() => insertOrder({ clientId: 99 })).toThrow(/FOREIGN KEY/);
});

test('orders are indexed by its three dates, status and client_id', () => {
	const indexedColumns = database
		.prepare(
			"select info.name from pragma_index_list('orders') as list, pragma_index_info(list.name) as info"
		)
		.all()
		.map((row) => row.name);
	expect(indexedColumns).toEqual(
		expect.arrayContaining(['delivery_date', 'pickup_date', 'event_date', 'status', 'client_id'])
	);
	expect(indexedColumns).not.toContain('order_items');
});

let quoteToken = 0;

function insertQuote(transportCost: number | null, orderId: number | null = null) {
	quoteToken += 1;
	const columns =
		'public_token, client_id, order_id, valid_until, rental_days, client_attributes, quote_items, items_total, transport_cost, quote_total, created_at, created_by, updated_at, updated_by';
	return database
		.prepare(
			`insert into quotes (${columns}) values (?, 1, ?, '2026-12-01', 1, '{}', '[]', 0, ?, 0, ${AUDIT})`
		)
		.run(String(quoteToken), orderId, transportCost);
}

test('quotes: numbered from 1, transport NULL is «por acordar» and 0 stays 0', () => {
	insertContact('8909039395');
	expect(insertQuote(null).lastInsertRowid).toBe(1);
	insertQuote(0);
	const rows = database.prepare('select transport_cost, discount, attributes from quotes').all();
	expect(rows).toEqual([
		{ transport_cost: null, discount: 0, attributes: '{}' },
		{ transport_cost: 0, discount: 0, attributes: '{}' }
	]);
});

test('quotes: order_id is optional, a real order, and comes from one quote at most', () => {
	insertContact('8909039395');
	insertOrder({});
	insertQuote(null, 1);
	expect(() => insertQuote(null, 1)).toThrow(/UNIQUE/);
	expect(() => insertQuote(null, 99)).toThrow(/FOREIGN KEY/);
	expect(() =>
		database.exec(
			`insert into quotes (public_token, client_id, valid_until, rental_days, client_attributes, quote_items, items_total, quote_total, created_at, created_by, updated_at, updated_by) values ('t', 99, '2026-12-01', 1, '{}', '[]', 0, 0, ${AUDIT})`
		)
	).toThrow(/FOREIGN KEY/);
});

test('quotes: public_token is required and unique', () => {
	insertContact('8909039395');
	insertQuote(null);
	quoteToken -= 1;
	expect(() => insertQuote(null)).toThrow(/UNIQUE/);
	expect(() =>
		database.exec(
			`insert into quotes (client_id, valid_until, rental_days, client_attributes, quote_items, items_total, quote_total, created_at, created_by, updated_at, updated_by) values (1, '2026-12-01', 1, '{}', '[]', 0, 0, ${AUDIT})`
		)
	).toThrow(/NOT NULL/);
});

test("quotes has no status, incident, deposit or trip: it isn't an order", () => {
	const columns = listColumns('quotes');
	const forbidden = ['status', 'has_incident', 'deposit_amount'];
	expect(columns.filter((column) => forbidden.includes(column))).toEqual([]);
	expect(columns.filter((column) => /delivery|pickup/.test(column))).toEqual([]);
	expect(columns).toEqual(
		expect.arrayContaining(['client_id', 'order_id', 'event_date', 'valid_until', 'quote_items'])
	);
});

test('quotes: «Quién transporta» is the company or the client, and quotes saved before it are the company', () => {
	database = new DatabaseSync(':memory:');
	const [first, ...later] = MIGRATION_FILES;
	applyMigrations([first]);
	insertContact('8909039395');
	insertOrder({});
	insertQuote(180000, 1);
	applyMigrations(later);
	const row = database.prepare('select order_id, transport_cost, transported_by from quotes').get();
	expect(row).toEqual({ order_id: 1, transport_cost: 180000, transported_by: 'COMPANY' });
	expect(() => database.exec("update quotes set transported_by = 'EXTERNAL_CARRIER'")).toThrow(
		/CHECK/
	);
	database.exec("update quotes set transported_by = 'CLIENT'");
});

test('quotes are indexed by client_id, valid_until and the unique order_id', () => {
	const indexedColumns = database
		.prepare(
			"select info.name from pragma_index_list('quotes') as list, pragma_index_info(list.name) as info"
		)
		.all()
		.map((row) => row.name);
	expect(indexedColumns).toEqual(expect.arrayContaining(['client_id', 'valid_until', 'order_id']));
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

test('cash_movements: an INSTALLMENT links to an order or a cuenta de cobro, nothing else does', () => {
	insertMovement({ concept: 'INSTALLMENT', amount: 100, entityType: 'RECEIVABLE' });
	insertMovement({ concept: 'INSTALLMENT', amount: -100, entityType: 'RECEIVABLE', reversesId: 1 });
	insertMovement({ concept: 'INSTALLMENT', amount: 100, entityType: 'ORDER' });
	const refused = [
		{ concept: 'SECURITY_DEPOSIT', amount: 100, entityType: 'RECEIVABLE' },
		{ concept: 'INSTALLMENT_REFUND', amount: -100, entityType: 'RECEIVABLE' },
		{ concept: 'CARRIER_PAYMENT', amount: -100, entityType: 'RECEIVABLE' },
		{ concept: 'INSTALLMENT', amount: -100, entityType: 'RECEIVABLE' },
		{ concept: 'INSTALLMENT', amount: 100, entityType: 'PAYROLL_RUN' }
	];
	for (const movement of refused) {
		expect(() => insertMovement(movement)).toThrow(/CHECK/);
	}
});

test('cash_movements: a CANCELLATION_FEE is money in on an order, offset with reverses_id', () => {
	insertMovement({ concept: 'CANCELLATION_FEE', amount: 100, entityType: 'ORDER' });
	insertMovement({ concept: 'CANCELLATION_FEE', amount: -100, entityType: 'ORDER', reversesId: 1 });
	const refused = [
		{ concept: 'CANCELLATION_FEE', amount: -100, entityType: 'ORDER' },
		{ concept: 'CANCELLATION_FEE', amount: 100, entityType: 'RECEIVABLE' },
		{ concept: 'CANCELLATION_FEE', amount: 100 }
	];
	for (const movement of refused) {
		expect(() => insertMovement(movement)).toThrow(/CHECK/);
	}
});

function insertReceivable(clientId: number) {
	return database
		.prepare(
			`insert into receivables (client_id, issue_date, created_at, created_by, updated_at, updated_by) values (?, '2026-11-04', ${AUDIT})`
		)
		.run(clientId);
}

function indexedColumnsOf(table: string): unknown[] {
	return database
		.prepare(
			`select info.name from pragma_index_list('${table}') as list, pragma_index_info(list.name) as info`
		)
		.all()
		.map((row) => row.name);
}

test('receivables: client_id must be a contact, attributes defaults to {}, indexed by client_id', () => {
	insertContact('8909039395');
	insertReceivable(1);
	expect(() => insertReceivable(99)).toThrow(/FOREIGN KEY/);
	expect(database.prepare('select attributes from receivables').get()?.attributes).toBe('{}');
	expect(listColumns('receivables')).toEqual([
		'id',
		'client_id',
		'issue_date',
		'attributes',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	]);
	expect(indexedColumnsOf('receivables')).toContain('client_id');
});

test('orders: receivable_id is NULL until billed, a real cuenta de cobro, and indexed', () => {
	insertContact('8909039395');
	insertOrder({});
	insertReceivable(1);
	expect(database.prepare('select receivable_id from orders').get()?.receivable_id).toBeNull();
	database.exec('update orders set receivable_id = 1 where id = 1');
	expect(() => database.exec('update orders set receivable_id = 99 where id = 1')).toThrow(
		/FOREIGN KEY/
	);
	expect(indexedColumnsOf('orders')).toContain('receivable_id');
});

test('users, employees, sessions, products, orders, quotes and receivables carry the audit columns', () => {
	const audit = ['created_at', 'created_by', 'updated_at', 'updated_by'];
	const tables = ['users', 'employees', 'sessions', 'products', 'orders', 'quotes', 'receivables'];
	for (const table of tables) {
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

test('events: an event never carries both an id and a key', () => {
	expect(() =>
		database.exec(
			"insert into events (entity_type, entity_id, entity_key, action, actor_username, actor_kind, created_at) values ('SETTINGS', 1, 'COMPANY_NAME', 'EDITED', 'admin', 'user', 0)"
		)
	).toThrow(/CHECK constraint failed/);
});

test('contacts: document_id is required and unique', () => {
	insertContact('1036452118');
	expect(() => insertContact('1036452118')).toThrow(/UNIQUE/);
	expect(() =>
		database.exec(
			`insert into contacts (phone, full_name, created_at, created_by, updated_at, updated_by) values ('13055550142', 'Tourist', ${AUDIT})`
		)
	).toThrow(/NOT NULL/);
});

test('events rejects an unknown actor_kind', () => {
	expect(() =>
		database.exec(
			"insert into events (entity_type, action, actor_username, actor_kind, created_at) values ('SETTINGS', 'EDITED', 'admin', 'robot', 0)"
		)
	).toThrow(/CHECK/);
});

function readSchema(): string[] {
	return database
		.prepare(
			"select type, name, tbl_name, sql from sqlite_master where name not glob 'sqlite_*' order by name"
		)
		.all()
		.map((row) => `${row.type} ${row.name} ${row.tbl_name} ${row.sql}`);
}

test("the new cash concepts' migration keeps every row, the receipt index and the self reference", () => {
	const index = MIGRATION_FILES.findIndex((file) => file.startsWith('0004_'));
	database = new DatabaseSync(':memory:');
	applyMigrations(MIGRATION_FILES.slice(0, index));
	insertMovement({ concept: 'OTHER_EXPENSE', amount: -100 });
	insertMovement({ concept: 'INSTALLMENT', amount: 100, entityType: 'ORDER' });
	insertMovement({ concept: 'OTHER_EXPENSE', amount: 100, reversesId: 1 });
	const rows = database.prepare('select * from cash_movements order by id').all();
	const before = readSchema();
	// D1 runs a migration in a transaction with foreign keys on: `foreign_keys=OFF` does nothing there.
	database.exec('PRAGMA foreign_keys = ON');
	database.exec('begin');
	applyMigrations(MIGRATION_FILES.slice(index, index + 1));
	database.exec('commit');
	expect(database.prepare('select * from cash_movements order by id').all()).toEqual(rows);
	const changed = readSchema().filter((entry) => !before.includes(entry));
	expect(changed).toHaveLength(1);
	expect(changed[0]).toMatch(/^table cash_movements cash_movements CREATE TABLE `cash_movements`/);
	expect(changed[0]).not.toContain('__old_');
	expect(changed[0]).toContain("'DAMAGE_CHARGE'");
	const { receipt_number } = database
		.prepare('select receipt_number from cash_movements where id = 1')
		.get()!;
	expect(() =>
		database.exec(
			`insert into cash_movements (concept, payment_method, amount, movement_date, receipt_number, created_at, created_by, updated_at, updated_by) values ('OTHER_EXPENSE', 'CASH', -50, '2026-10-17', ${receipt_number}, ${AUDIT})`
		)
	).toThrow(/UNIQUE/);
	expect(() => insertMovement({ concept: 'OTHER_INCOME', amount: -100, reversesId: 99 })).toThrow(
		/FOREIGN KEY/
	);
});

test('cash_movements: the three new expense concepts go out on no link, like OTHER_EXPENSE', () => {
	for (const concept of ['TRANSPORT_EXPENSE', 'SUPPLIES_EXPENSE', 'RENT']) {
		insertMovement({ concept, amount: -100 });
		expect(() => insertMovement({ concept, amount: 100 })).toThrow(/CHECK/);
		expect(() => insertMovement({ concept, amount: -100, entityType: 'ORDER' })).toThrow(/CHECK/);
	}
});

// Rows only an older version of the app left behind: no service writes them anymore.

test('a successful login re-hashes a password stored with a lower iteration count', async () => {
	const fixture = createFixture();
	await fixture.employee({ roles: ['MANAGER'], username: 'gerente' });
	const older = await hashPassword(TEST_PASSWORD, TEST_PEPPER, 1000);
	fixture.database
		.prepare(
			"update users set password_hash = ?, password_salt = ?, password_iterations = ? where username = 'gerente'"
		)
		.run(older.hash, older.salt, older.iterations);
	const attempt = () =>
		logIn(
			fixture.db,
			{ username: 'gerente', password: TEST_PASSWORD },
			{
				secrets: { pepper: TEST_PEPPER, adminPassword: 'clave-admin' },
				request: { ip: '203.0.113.7', userAgent: 'Prueba/1.0' }
			}
		);
	expect(await attempt()).not.toBeNull();
	const row = fixture.database
		.prepare("select password_iterations from users where username = 'gerente'")
		.get();
	expect(row?.password_iterations).toBe(PASSWORD_ITERATIONS);
	expect(await attempt()).not.toBeNull();
});

test('General loads and saves with the retired ORDERS_SUGGESTED_ADVANCE_PCT row still stored', async () => {
	const { db, database: stored } = createFixture();
	stored.exec(
		"insert into settings (key, value, created_at, created_by, updated_at, updated_by) values ('ORDERS_SUGGESTED_ADVANCE_PCT', '50', 0, 'system', 0, 'system')"
	);
	const readValue = (key: string) =>
		stored.prepare('select value, updated_by from settings where key = ?').get(key);
	const modules = ['COMPANY', 'QUOTES'] as const;
	const values = await getSystemSettings(db, [...modules], MANAGER);
	expect(values).not.toHaveProperty('ORDERS_SUGGESTED_ADVANCE_PCT');
	// General has no clock times: the form posts each value as it was read.
	const form = { ...values, COMPANY_NAME: 'Banquetes C' };
	expect(await updateSystemSettings(db, { modules: [...modules], values: form }, MANAGER)).toEqual({
		ok: true
	});
	expect(readValue('COMPANY_NAME')).toMatchObject({ value: 'Banquetes C' });
	expect(readValue('ORDERS_SUGGESTED_ADVANCE_PCT')).toEqual({ value: '50', updated_by: 'system' });
});

test('a quote saved before «Quién transporta» existed reads as the company', async () => {
	const fixture = createFixture();
	const clientId = await fixture.contact({
		full_name: 'Luz Marina Restrepo',
		phone: '573104428890'
	});
	const productId = await fixture.product({ name: 'Silla Tiffany dorada' });
	fixture.database.exec(
		`insert into quotes (public_token, client_id, valid_until, rental_days, client_attributes,
		quote_items, items_total, quote_total, created_at, created_by, updated_at, updated_by)
		values ('legacyquote01', ${clientId}, '2026-12-01', 1,
		'{"name":"Luz Marina Restrepo","phone":"573104428890","whatsapp":null}',
		'[{"product_id":${productId},"name":"Silla Tiffany dorada","qty":10,"list_price":2500,"unit_price":2500,"line_total":25000}]',
		25000, 25000, 0, 'admin', 0, 'admin')`
	);
	const { id } = fixture.database
		.prepare("select id from quotes where public_token = 'legacyquote01'")
		.get() as { id: number };
	expect((await getQuote(fixture.db, id, SALES))?.transportedBy).toBe('COMPANY');
});

test('a stored replacement cost that is not whole pesos above zero fails on read', async () => {
	const fixture = createFixture();
	const id = await fixture.product({ name: 'Silla Tiffany' });
	fixture.database
		.prepare('update products set attributes = ? where id = ?')
		.run('{"replacement_cost":-3}', id);
	await expect(getProduct(fixture.db, id, MANAGER)).rejects.toThrow();
});

test("an order's stale incident flag is worked out again by the next correction", async () => {
	const fixture = createFixture();
	const chairs = await fixture.product({ name: 'Silla Tiffany dorada', total_quantity: '500' });
	const id = await fixture.order({
		order_items: [{ product_id: chairs, qty: 120, unit_price: 2500 }],
		status: 'DELIVERED'
	});
	const lost = [{ product_id: chairs, qty: 2, outcome: 'LOST' }];
	const input = { order_id: String(id), incident_description: 'Llegaron mojadas', items: lost };
	const reported = await reportIncident(fixture.db, input, DRIVER);
	const incident = reported.ok ? reported.id : 0;
	fixture.database.prepare('update orders set has_incident = 0 where id = ?').run(id);
	const recoverable = [{ product_id: chairs, qty: 2, outcome: 'RECOVERABLE' }];
	const correction = {
		id: String(incident),
		incident_description: 'Llegaron rotas',
		items: recoverable
	};
	expect(await correctIncident(fixture.db, correction, DRIVER)).toMatchObject({ ok: true });
	const row = (column: string, table: string, rowId: number) =>
		Number(
			fixture.database.prepare(`select ${column} from ${table} where id = ?`).get(rowId)?.[column]
		);
	expect(row('has_incident', 'orders', id)).toBe(1);
	expect(row('total_quantity', 'products', chairs)).toBe(500);
});

test("an incident's reversal that lands after a count's approval blocks reversing that count", async () => {
	const fixture = createFixture();
	const chairs = await fixture.product({ name: 'Silla Tiffany dorada', total_quantity: '800' });
	const order = await fixture.order({
		order_items: [{ product_id: chairs, qty: 120, unit_price: 2500 }],
		status: 'DELIVERED'
	});
	const lost = [{ product_id: chairs, qty: 4, outcome: 'LOST' }];
	const input = { order_id: order, incident_description: 'No volvieron', items: lost };
	const reported = await reportIncident(fixture.db, input, DRIVER);
	const incident = reported.ok ? reported.id : 0;
	const counted = { items: [{ product_id: chairs, counted_qty: 790 }] };
	const approved = await submitAndApproveCount(fixture.db, counted, MANAGER);
	const id = approved.ok ? approved.id : 0;
	const reversal = { id: incident, reason: 'Aparecieron' };
	expect(await reverseIncident(fixture.db, reversal, MANAGER)).toMatchObject({ ok: false });
	// Nothing locks: a reversal checked just before the approval can still land after it.
	fixture.database
		.prepare(
			"insert into events (entity_type, entity_id, action, actor_username, actor_kind, created_at) values ('INCIDENT', ?, 'REVERSED', 'manager', 'user', 0)"
		)
		.run(incident);
	expect(await reverseCount(fixture.db, { id, reason: 'Error' }, MANAGER)).toMatchObject({
		ok: false,
		message: 'Silla Tiffany dorada ya tuvo otro movimiento de inventario después de este conteo'
	});
});

test('the cuenta de cobro number continues a sequence set by hand, and its orders find it', async () => {
	const fixture = createFixture();
	const orderId = await fixture.order();
	// Production's numbering was set straight in sqlite_sequence to follow the paper cuentas.
	fixture.database.exec("insert into sqlite_sequence (name, seq) values ('receivables', 4793)");
	const issued = { orders: [orderId], payment_terms: 'Contado' };
	expect(await issueReceivable(fixture.db, issued, MANAGER)).toEqual({ ok: true, id: 4794 });
	const order = fixture.database
		.prepare('select receivable_id from orders where id = ?')
		.get(orderId);
	expect(order).toEqual({ receivable_id: 4794 });
});

test("an Event whose record's row is gone still links, under its plain id", async () => {
	const fixture = createFixture();
	// Rows are never deleted: only a row lost outside the app leaves an Event pointing nowhere.
	fixture.database.exec(
		"insert into events (entity_type, entity_id, action, actor_username, actor_kind, created_at) values ('EMPLOYEE', 99, 'EDITED', 'manager', 'user', 0)"
	);
	const [event] = (await getAuditLog(fixture.db, {}, MANAGER)).events;
	expect(event.link).toEqual({ href: '/personal/99', label: '99' });
});
