import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import { rolesSchema, type Actor } from '../actor';
import { verifyPassword } from '../password';
import { calculateOrderTotals } from '$lib/orders';
import { createMemoryD1 } from './memory-d1';
import { openWeek } from '../services/payroll';
import { movementSchema } from '../services/cash';
import { contactAttributesSchema, isAutoDocument, servicesSchema } from '../services/contacts';
import { employeeAttributesSchema } from '../services/employees';
import { inventoryItemsSchema, listCounts } from '../services/inventory';
import {
	clientAttributesSchema,
	deliveryAttributesSchema,
	orderAttributesSchema,
	orderItemsSchema,
	getOrderDetail,
	pickupAttributesSchema
} from '../services/orders';

const sampleData = readFileSync('scripts/sample-data.sql', 'utf8');
const manager: Actor = { username: 'gerente', employeeId: null, roles: ['MANAGER'], kind: 'user' };

let database: DatabaseSync;

beforeEach(() => {
	database = new DatabaseSync(':memory:');
	const files = readdirSync('migrations')
		.filter((file) => file.endsWith('.sql'))
		.sort();
	for (const file of files) {
		database.exec(readFileSync(`migrations/${file}`, 'utf8'));
	}
	database.exec(sampleData);
});

function readAll(table: string) {
	return database.prepare(`select * from ${table} order by id`).all();
}

test("loads the Design Brief's eight products and the four colors of one variant group", () => {
	const products = readAll('products');
	expect(products).toHaveLength(12);
	const variants = products.filter((product) => 'Mantel cuadrado 50×50' === product.variant_group);
	expect(variants.map((variant) => [variant.variant_name, variant.rental_price])).toEqual([
		['Dorado', 9500],
		['Rojo', 8000],
		['Verde', 8000],
		['Azul', 8000]
	]);
});

test('loads clients, two transporters, a decorator, one of each newer service and a client with a US number', () => {
	const contacts = database
		.prepare(
			'select * from contacts where id not in (select contact_id from employees) order by id'
		)
		.all();
	expect(contacts.map((contact) => [contact.full_name, contact.phone, contact.services])).toEqual([
		['Luz Marina Restrepo', '573104428890', '[]'],
		['Jorge Iván Betancur', '573007712043', '[]'],
		['Wilson Muñoz', '573119085512', '["TRANSPORTER"]'],
		['Paula Andrea Ríos', '573125557788', '["DECORATOR"]'],
		['Emily Carter', '13055550142', '[]'],
		['Diana Zuluaga', '573006152290', '[]'],
		['Carolina Gómez Vélez', '573128904417', '[]'],
		['Salón de Eventos Villa Fernanda', '573046671230', '[]'],
		['Andrés Felipe Cano', '573215508842', '[]'],
		['Colegio Monte Verde', '573017733905', '[]'],
		['Beatriz Elena Ochoa', '573164420981', '[]'],
		['Juan Camilo Arbeláez', '573105549217', '[]'],
		['Hernán Darío Zapata', '573122268804', '["TRANSPORTER"]'],
		['Sebastián Mejía', '573137724518', '["WAITER"]'],
		['Valentina Arango', '573158841203', '["WEDDING_PLANNER"]'],
		['Mateo Londoño', '573176630492', '["BARTENDER","BARISTA"]'],
		['Natalia Cardona', '573189952074', '["BARISTA"]']
	]);
	for (const contact of contacts) {
		expect(servicesSchema.safeParse(JSON.parse(String(contact.services))).success).toBe(true);
		const attributes = JSON.parse(String(contact.attributes));
		expect(contactAttributesSchema.safeParse(attributes).success, String(contact.full_name)).toBe(
			true
		);
	}
});

test('a second run duplicates nothing and keeps an edit', () => {
	database.exec("update products set rental_price = 3000 where name = 'Silla Tiffany dorada'");
	database.exec("update users set password_hash = 'set-by-admin' where username = 'gerente'");
	database.exec('update orders set rental_days = 3 where id = 1043');
	const tables = () => [
		readAll('products'),
		readAll('contacts'),
		readAll('employees'),
		readAll('users'),
		readAll('timesheets'),
		readAll('orders')
	];
	const before = tables();
	database.exec(sampleData);
	expect(tables()).toEqual(before);
});

test('loads a login per role, each on its employee, with no password', async () => {
	const logins = database
		.prepare(
			`select users.*, contacts.full_name from users
			join employees on employees.id = users.employee_id
			join contacts on contacts.id = employees.contact_id order by users.id`
		)
		.all();
	expect(logins.map((login) => [login.username, login.roles, login.full_name])).toEqual([
		['gerente', '["MANAGER"]', 'Gloria Patricia Arango'],
		['representante', '["SALES"]', 'Natalia Cardona'],
		['bodega', '["WAREHOUSE"]', 'Jhon Fredy Osorio'],
		['conductor', '["DRIVER"]', 'Luis Alberto Mejía']
	]);
	for (const login of logins) {
		expect(rolesSchema.safeParse(JSON.parse(String(login.roles))).success).toBe(true);
		const stored = {
			hash: String(login.password_hash),
			salt: String(login.password_salt),
			iterations: Number(login.password_iterations)
		};
		expect(await verifyPassword(String(login.username), 'pepper', stored)).toBe(false);
	}
});

test('every row is created by system and writes no events', () => {
	const tables = [
		'products',
		'contacts',
		'employees',
		'users',
		'timesheets',
		'orders',
		'inventory_counts',
		'cash_movements'
	];
	for (const row of tables.flatMap(readAll)) {
		expect([row.created_by, row.updated_by]).toEqual(['system', 'system']);
	}
	expect(database.prepare('select count(*) as count from events').get()).toEqual({ count: 0 });
});

test('loads five employees on their own contacts: four employed with a login, one who left', () => {
	const employees = database
		.prepare(
			`select employees.attributes, contacts.document_id, users.username from employees
			join contacts on contacts.id = employees.contact_id
			left join users on users.employee_id = employees.id order by employees.id`
		)
		.all();
	expect(employees).toHaveLength(5);
	const isEmployed = employees.map((employee) => {
		const attributes = employeeAttributesSchema.parse(JSON.parse(String(employee.attributes)));
		expect(isAutoDocument(String(employee.document_id))).toBe(false);
		return null === attributes.employment.at(-1)?.end;
	});
	expect(isEmployed).toEqual([true, true, true, true, false]);
	expect(employees.map((employee) => employee.username)).toEqual([
		'gerente',
		'representante',
		'bodega',
		'conductor',
		null
	]);
});

test('punches the four from Saturday 10 to Sunday 18 October 2026 but Thursday 15', () => {
	const days = database
		.prepare(
			'select work_date, count(distinct employee_id) as employees from timesheets group by work_date order by work_date'
		)
		.all();
	expect(days.map((day) => day.work_date)).toEqual([
		'2026-10-10',
		'2026-10-11',
		'2026-10-12',
		'2026-10-13',
		'2026-10-14',
		'2026-10-16',
		'2026-10-17',
		'2026-10-18'
	]);
	const punched = database.prepare('select count(distinct employee_id) as count from timesheets');
	expect(punched.get()).toEqual({ count: 4 });
	expect(readAll('payroll_runs')).toEqual([]);
});

test("the week of 12 October's settlement fills each of the five overtime rows", async () => {
	const { db, database: memory } = createMemoryD1();
	memory.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	memory.exec(sampleData);
	const { employees } = await openWeek(db, { employeeId: null, week: '2026-10-12' }, manager);
	expect(employees).toHaveLength(4);
	const weeks = await Promise.all(
		employees.map(({ id }) => openWeek(db, { employeeId: id, week: '2026-10-12' }, manager))
	);
	const filled = weeks
		.flatMap(({ draft }) => draft?.earnings ?? [])
		.filter((earning) => (earning.derivedQty ?? 0) > 0)
		.map((earning) => earning.concept);
	expect([...new Set(filled)].sort()).toEqual([
		'HOLIDAY_OVERTIME_DAY',
		'HOLIDAY_OVERTIME_NIGHT',
		'NIGHT_SURCHARGE',
		'OVERTIME_DAY',
		'OVERTIME_NIGHT'
	]);
});

function parseOrder(order: Record<string, unknown>) {
	return {
		client: clientAttributesSchema.parse(JSON.parse(String(order.client_attributes))),
		delivery: deliveryAttributesSchema.parse(JSON.parse(String(order.delivery_attributes))),
		pickup: pickupAttributesSchema.parse(JSON.parse(String(order.pickup_attributes))),
		items: orderItemsSchema.parse(JSON.parse(String(order.order_items))),
		attributes: orderAttributesSchema.parse(JSON.parse(String(order.attributes)))
	};
}

test("loads the Design Brief's #1043 and #1051, #1047 delivered, and enough for a third page", () => {
	const orders = readAll('orders');
	expect(orders).toHaveLength(45);
	expect(new Set(orders.map((order) => order.status)).size).toBe(8);
	expect(orders.every((order) => 0 === order.has_incident)).toBe(true);
	expect(readAll('incidents')).toEqual([]);
	const byId = (id: number) => orders.find((order) => id === order.id) ?? {};
	expect([1043, 1047, 1051].map((id) => byId(id).status)).toEqual([
		'CONFIRMED',
		'DELIVERED',
		'DRAFT'
	]);
	const [order1043, order1051] = [byId(1043), byId(1051)].map(parseOrder);
	expect(order1043.client.name).toBe('Luz Marina Restrepo');
	expect(order1043.items.map((item) => item.line_total)).toEqual([600000, 288000, 216000]);
	expect(order1051.delivery).toMatchObject({
		method: 'CLIENT_PICKUP',
		time: '08:00',
		carrier: null
	});
	expect(order1051.pickup).toMatchObject({
		method: 'EXTERNAL_CARRIER',
		carrier: { name: 'Wilson Muñoz', phone: '573119085512' }
	});
});

test('every order passes the Zod schemas, points to real rows and follows the totals formula', () => {
	for (const order of readAll('orders')) {
		const { items, delivery, pickup } = parseOrder(order);
		const totals = calculateOrderTotals({
			lines: items,
			rentalDays: Number(order.rental_days),
			discount: Number(order.discount),
			transportCost: Number(order.transport_cost)
		});
		expect(items.map((item) => item.line_total)).toEqual(totals.lineTotals);
		expect([order.items_total, order.order_total]).toEqual([totals.itemsTotal, totals.orderTotal]);
		expect(String(order.public_token)).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		);
		const client = database
			.prepare('select full_name from contacts where id = ?')
			.get(Number(order.client_id));
		expect(client?.full_name).toBe(parseOrder(order).client.name);
		for (const carrier of [delivery.carrier, pickup.carrier].filter((each) => null !== each)) {
			const row = database.prepare('select services from contacts where id = ?').get(carrier.id);
			expect(row?.services).toBe('["TRANSPORTER"]');
		}
		for (const item of items) {
			const product = database
				.prepare('select name, rental_price from products where id = ?')
				.get(item.product_id);
			expect(product).toEqual({ name: item.name, rental_price: item.list_price });
		}
	}
});

test('every trip falls from 1 to 18 October, each status as if today were Wednesday 14', () => {
	const today = '2026-10-14';
	for (const order of readAll('orders')) {
		const [delivery, pickup] = [String(order.delivery_date), String(order.pickup_date)];
		expect(['2026-10-01' <= delivery, delivery <= pickup, pickup <= '2026-10-18']).toEqual([
			true,
			true,
			true
		]);
		const fits = {
			DRAFT: today < delivery,
			CONFIRMED: today <= delivery,
			PICKED: today <= delivery,
			OUT_FOR_DELIVERY: today === delivery,
			DELIVERED: delivery <= today && today <= pickup,
			OUT_FOR_PICKUP: today === pickup,
			COMPLETED: pickup <= today,
			CANCELLED: true
		}[String(order.status)];
		expect(fits, String(order.id)).toBe(true);
	}
});

function openSeededD1() {
	const { db, database: memory } = createMemoryD1();
	memory.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	memory.exec(sampleData);
	return db;
}

test('loads two pending counts sharing a product, one stale, and a rejected one', async () => {
	for (const count of readAll('inventory_counts')) {
		expect(inventoryItemsSchema.safeParse(JSON.parse(String(count.inventory_items))).success).toBe(
			true
		);
	}
	const counts = await listCounts(openSeededD1(), manager);
	expect(
		counts.map(({ id, status, staleCount, overlapIds }) => [id, status, staleCount, overlapIds])
	).toEqual([
		[2, 'PENDING_APPROVAL', 1, [1]],
		[1, 'PENDING_APPROVAL', 0, [2]],
		[3, 'REJECTED', 0, []]
	]);
	const rejected = readAll('inventory_counts').find((count) => 'REJECTED' === count.status);
	expect([rejected?.reviewed_by, rejected?.reviewed_at, rejected?.review_note].every(Boolean)).toBe(
		true
	);
	expect(readAll('payroll_runs')).toEqual([]);
});

test("#1043 reads the Design Brief's paid, balance and deposit", async () => {
	const order = await getOrderDetail(openSeededD1(), 1043, manager);
	expect([order?.paid, order?.balanceDue, order?.depositHeld]).toEqual([500000, 680000, 200000]);
});

test('#1009, paid in two, and #1012, its deposit given back, owe and hold nothing', async () => {
	const db = openSeededD1();
	for (const id of [1009, 1012]) {
		const order = await getOrderDetail(db, id, manager);
		expect([order?.balanceDue, order?.depositHeld], String(id)).toEqual([0, 0]);
	}
});

test('every movement passes its Zod schema, each sign numbered 1, 2, 3… with one offset', () => {
	const movements = readAll('cash_movements');
	for (const movement of movements) {
		const parsed = movementSchema.safeParse({
			...movement,
			attributes: JSON.parse(String(movement.attributes))
		});
		expect(parsed.success, String(movement.id)).toBe(true);
	}
	for (const isInflow of [true, false]) {
		const numbers = movements
			.filter((movement) => isInflow === Number(movement.amount) > 0)
			.map((movement) => movement.receipt_number);
		expect(numbers).toEqual(numbers.map((_, index) => index + 1));
	}
	const concepts = new Set(movements.map((movement) => movement.concept));
	expect(concepts.has('PAYROLL')).toBe(false);
	expect(concepts.size).toBe(7);
	const offset = movements.find((movement) => null !== movement.reverses_id);
	const original = movements.find((movement) => offset?.reverses_id === movement.id);
	expect([original?.concept, original?.amount]).toEqual([offset?.concept, -Number(offset?.amount)]);
	const carrier = movements.find((movement) => 'CARRIER_PAYMENT' === movement.concept);
	expect(carrier?.entity_id).toBe(1051);
});
