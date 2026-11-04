import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';

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
	status = 'DRAFT',
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
	expect(() => insertOrder({ deliveryMethod: 'CLIENT_RETURN' })).toThrow(/CHECK/);
	expect(() => insertOrder({ pickupMethod: 'CLIENT_PICKUP' })).toThrow(/CHECK/);
	expect(() => database.exec(`update orders set delivery_attributes = '{}' where id = 1`)).toThrow(
		/CHECK/
	);
	const order = database.prepare('select has_incident, discount, attributes from orders').get();
	expect(order).toEqual({ has_incident: 0, discount: 0, attributes: '{}' });
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

function insertQuote(transportCost: number | null, orderId: number | null = null) {
	const columns =
		'client_id, order_id, valid_until, rental_days, client_attributes, quote_items, items_total, transport_cost, quote_total, created_at, created_by, updated_at, updated_by';
	return database
		.prepare(
			`insert into quotes (${columns}) values (1, ?, '2026-12-01', 1, '{}', '[]', 0, ?, 0, ${AUDIT})`
		)
		.run(orderId, transportCost);
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
			`insert into quotes (client_id, valid_until, rental_days, client_attributes, quote_items, items_total, quote_total, created_at, created_by, updated_at, updated_by) values (99, '2026-12-01', 1, '{}', '[]', 0, 0, ${AUDIT})`
		)
	).toThrow(/FOREIGN KEY/);
});

test("quotes has no status, token, incident, deposit or trip: it isn't an order", () => {
	const columns = listColumns('quotes');
	const forbidden = ['status', 'public_token', 'has_incident', 'deposit_amount'];
	expect(columns.filter((column) => forbidden.includes(column))).toEqual([]);
	expect(columns.filter((column) => /delivery|pickup/.test(column))).toEqual([]);
	expect(columns).toEqual(
		expect.arrayContaining(['client_id', 'order_id', 'event_date', 'valid_until', 'quote_items'])
	);
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

const REBUILD_MIGRATION = '0005_curly_grey_gargoyle.sql';

test('the cash_movements rebuild keeps every row as it was, inside a transaction as on D1', () => {
	database = new DatabaseSync(':memory:');
	applyMigrations(MIGRATION_FILES.slice(0, MIGRATION_FILES.indexOf(REBUILD_MIGRATION)));
	insertMovement({ concept: 'INSTALLMENT', amount: 100, entityType: 'ORDER' });
	insertMovement({ concept: 'INSTALLMENT', amount: -100, entityType: 'ORDER', reversesId: 1 });
	insertMovement({ concept: 'SECURITY_DEPOSIT', amount: 50, entityType: 'ORDER' });
	insertMovement({ concept: 'INSTALLMENT_REFUND', amount: -30, entityType: 'ORDER' });
	insertMovement({ concept: 'DEPOSIT_REFUND', amount: -50, entityType: 'ORDER' });
	insertMovement({ concept: 'CARRIER_PAYMENT', amount: -20, entityType: 'ORDER' });
	insertMovement({ concept: 'PAYROLL', amount: -400, entityType: 'PAYROLL_RUN' });
	insertMovement({ concept: 'OTHER_INCOME', amount: 10 });
	insertMovement({ concept: 'OTHER_EXPENSE', amount: -10 });
	const before = database.prepare('select * from cash_movements order by id').all();
	database.exec('begin');
	applyMigrations([REBUILD_MIGRATION]);
	database.exec('commit');
	expect(database.prepare('select * from cash_movements order by id').all()).toEqual(before);
	expect(listTables()).not.toContain('__old_cash_movements');
	expect(indexedColumnsOf('cash_movements')).toEqual(
		expect.arrayContaining(['reverses_id', 'entity_type', 'entity_id', 'receipt_number'])
	);
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

test('events rejects an unknown actor_kind', () => {
	expect(() =>
		database.exec(
			"insert into events (entity_type, action, actor_username, actor_kind, created_at) values ('SETTINGS', 'EDITED', 'admin', 'robot', 0)"
		)
	).toThrow(/CHECK/);
});
