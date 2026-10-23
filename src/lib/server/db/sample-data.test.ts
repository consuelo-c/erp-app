import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import { rolesSchema } from '../actor';
import { verifyPassword } from '../password';
import { contactAttributesSchema, servicesSchema } from '../services/contacts';

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

test('loads two clients, a transporter, a decorator and a client with a US number', () => {
	const contacts = readAll('contacts');
	expect(contacts.map((contact) => [contact.full_name, contact.phone, contact.services])).toEqual([
		['Luz Marina Restrepo', '573104428890', '[]'],
		['Jorge Iván Betancur', '573007712043', '[]'],
		['Wilson Muñoz', '573119085512', '["TRANSPORTER"]'],
		['Paula Andrea Ríos', '573125557788', '["DECORATOR"]'],
		['Emily Carter', '13055550142', '[]']
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
	const tables = () => [readAll('products'), readAll('contacts'), readAll('users')];
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
	for (const row of [...readAll('products'), ...readAll('contacts'), ...readAll('users')]) {
		expect([row.created_by, row.updated_by]).toEqual(['system', 'system']);
	}
	expect(database.prepare('select count(*) as count from events').get()).toEqual({ count: 0 });
});
