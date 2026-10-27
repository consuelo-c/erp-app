import type { DatabaseSync } from 'node:sqlite';
import { isHttpError } from '@sveltejs/kit';
import { beforeEach, expect, test } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { inventoryItemsSchema, submitCount } from './inventory';

const sales: Actor = { username: 'ventas', employeeId: null, roles: ['SALES'], kind: 'user' };
const warehouse: Actor = { ...sales, username: 'bodega', roles: ['WAREHOUSE'] };
const driver: Actor = { ...sales, username: 'conductor', roles: ['DRIVER'] };

let db: D1Database;
let database: DatabaseSync;

const AUDIT = "0, 'admin', 0, 'admin'";

const CHAIR = 1;
const TABLECLOTH = 2;

beforeEach(() => {
	({ db, database } = createMemoryD1());
	for (const [name, quantity, active] of [
		['Silla Tiffany dorada', 800, 1],
		['Mantel blanco 3×3', 120, 0]
	]) {
		database
			.prepare(
				`insert into products (name, category, rental_price, total_quantity, active, created_at, created_by, updated_at, updated_by) values (?, 'CHAIRS_TABLES', 1000, ?, ?, ${AUDIT})`
			)
			.run(name, quantity, active);
	}
});

function stock(id: number): number {
	const row = database.prepare('select total_quantity from products where id = ?').get(id);
	return Number(row?.total_quantity);
}

function countRows(): number {
	return Number(database.prepare('select count(*) as count from inventory_counts').get()?.count);
}

test('the database rejects an unknown status', () => {
	const insert = (status: string) =>
		database
			.prepare(
				`insert into inventory_counts (status, inventory_items, created_at, created_by, updated_at, updated_by) values (?, '[]', ${AUDIT})`
			)
			.run(status);
	expect(() => insert('WITHDRAWN')).toThrow(/CHECK constraint failed/);
	expect(() => insert('PENDING_APPROVAL')).not.toThrow();
});

test('the items: at least one, whole counted quantities, known keys, a product once', () => {
	const item = {
		product_id: CHAIR,
		name: 'Silla Tiffany dorada',
		system_qty: 800,
		counted_qty: 792
	};
	const valid = (items: object[]) => inventoryItemsSchema.safeParse(items).success;
	expect(valid([item])).toBe(true);
	expect(valid([])).toBe(false);
	expect(valid([{ ...item, counted_qty: -1 }])).toBe(false);
	expect(valid([{ ...item, counted_qty: 1.5 }])).toBe(false);
	expect(valid([{ ...item, system_qty: -4 }])).toBe(true);
	expect(valid([{ ...item, note: 'mojadas' }])).toBe(false);
	expect(valid([item, { ...item, counted_qty: 790 }])).toBe(false);
	for (const applied of [true, false, null]) {
		expect(valid([{ ...item, applied }])).toBe(true);
	}
});

test('a warehouse login sends a count pending approval, changing no product', async () => {
	const items = [
		{ product_id: CHAIR, counted_qty: 792 },
		{ product_id: TABLECLOTH, counted_qty: 120 }
	];
	expect(await submitCount(db, { items }, warehouse)).toEqual({ ok: true, id: 1 });
	database.prepare("update products set name = 'Silla Tiffany oro' where id = ?").run(CHAIR);
	expect(database.prepare('select * from inventory_counts').get()).toMatchObject({
		status: 'PENDING_APPROVAL',
		review_note: null,
		reviewed_by: null,
		reviewed_at: null,
		reversal_reason: null,
		reversed_by: null,
		reversed_at: null,
		created_by: 'bodega',
		updated_by: 'bodega'
	});
	const row = database.prepare('select inventory_items from inventory_counts').get();
	expect(JSON.parse(String(row?.inventory_items))).toEqual([
		{ product_id: CHAIR, name: 'Silla Tiffany dorada', system_qty: 800, counted_qty: 792 },
		{ product_id: TABLECLOTH, name: 'Mantel blanco 3×3', system_qty: 120, counted_qty: 120 }
	]);
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([800, 120]);
	const events = database
		.prepare(
			"select entity_id, action, actor_username, before, after from events where entity_type = 'INVENTORY_COUNT'"
		)
		.all();
	expect(events).toEqual([
		{
			entity_id: 1,
			action: 'CREATED',
			actor_username: 'bodega',
			before: null,
			after: JSON.stringify({ status: 'PENDING_APPROVAL', inventory_items: row?.inventory_items })
		}
	]);
	expect(
		database.prepare("select count(*) as count from events where entity_type = 'PRODUCT'").get()
	).toEqual({ count: 0 });
});

test('a driver sends one too; sales gets a 403 and saves nothing', async () => {
	const items = [{ product_id: CHAIR, counted_qty: 800 }];
	expect(await submitCount(db, { items }, driver)).toMatchObject({ ok: true });
	const refused = await submitCount(db, { items }, sales).catch((error: unknown) => error);
	expect(isHttpError(refused, 403)).toBe(true);
	expect(countRows()).toBe(1);
});

test('no rows, a repeated product or one that does not exist save nothing', async () => {
	expect(await submitCount(db, { items: [] }, warehouse)).toMatchObject({
		ok: false,
		errors: { items: expect.any(String) }
	});
	const twice = [
		{ product_id: CHAIR, counted_qty: 1 },
		{ product_id: CHAIR, counted_qty: 2 }
	];
	expect(await submitCount(db, { items: twice }, warehouse)).toMatchObject({ ok: false });
	const missing = [{ product_id: 99, counted_qty: 1 }];
	expect(await submitCount(db, { items: missing }, warehouse)).toMatchObject({
		ok: false,
		errors: { 'items.0.product_id': expect.any(String) }
	});
	expect(countRows()).toBe(0);
});
