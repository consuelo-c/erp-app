import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import { rolesSchema } from '../actor';
import { verifyPassword } from '../password';
import { calculateOrderTotals } from '$lib/orders';
import { contactAttributesSchema, servicesSchema } from '../services/contacts';
import {
	clientAttributesSchema,
	deliveryAttributesSchema,
	orderAttributesSchema,
	orderItemsSchema,
	pickupAttributesSchema
} from '../services/orders';

const sampleData = readFileSync('scripts/sample-data.sql', 'utf8');

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

test('loads three clients, a transporter, a decorator and a client with a US number', () => {
	const contacts = readAll('contacts');
	expect(contacts.map((contact) => [contact.full_name, contact.phone, contact.services])).toEqual([
		['Luz Marina Restrepo', '573104428890', '[]'],
		['Jorge Iván Betancur', '573007712043', '[]'],
		['Wilson Muñoz', '573119085512', '["TRANSPORTER"]'],
		['Paula Andrea Ríos', '573125557788', '["DECORATOR"]'],
		['Emily Carter', '13055550142', '[]'],
		['Diana Zuluaga', '573006152290', '[]']
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
		readAll('users'),
		readAll('orders')
	];
	const before = tables();
	database.exec(sampleData);
	expect(tables()).toEqual(before);
});

test('loads a login per role, with no employee and no password', async () => {
	const logins = readAll('users');
	expect(logins.map((login) => [login.username, login.roles, login.employee_id])).toEqual([
		['gerente', '["MANAGER"]', null],
		['representante', '["SALES"]', null],
		['bodega', '["WAREHOUSE"]', null]
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
	const tables = ['products', 'contacts', 'users', 'orders'];
	for (const row of tables.flatMap(readAll)) {
		expect([row.created_by, row.updated_by]).toEqual(['system', 'system']);
	}
	expect(database.prepare('select count(*) as count from events').get()).toEqual({ count: 0 });
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

test("loads the Design Brief's #1043 and #1051, #1047 delivered, and enough for a second page", () => {
	const orders = readAll('orders');
	expect(orders).toHaveLength(30);
	expect(new Set(orders.map((order) => order.status)).size).toBe(8);
	expect(orders.every((order) => 0 === order.has_incident)).toBe(true);
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
	expect(readAll('cash_movements')).toEqual([]);
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
