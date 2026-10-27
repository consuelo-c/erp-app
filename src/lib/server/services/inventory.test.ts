import type { DatabaseSync } from 'node:sqlite';
import { isHttpError } from '@sveltejs/kit';
import { beforeEach, expect, test } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { reportIncident, reverseIncident } from './incidents';
import {
	approveCount,
	inventoryItemsSchema,
	previewApproval,
	rejectCount,
	submitAndApproveCount,
	submitCount
} from './inventory';
import { createOrder } from './orders';

const sales: Actor = { username: 'ventas', employeeId: null, roles: ['SALES'], kind: 'user' };
const warehouse: Actor = { ...sales, username: 'bodega', roles: ['WAREHOUSE'] };
const driver: Actor = { ...sales, username: 'conductor', roles: ['DRIVER'] };
const manager: Actor = { ...sales, username: 'gerente', roles: ['MANAGER'] };

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
	database
		.prepare(
			`insert into contacts (phone, full_name, document_id, services, created_at, created_by, updated_at, updated_by) values ('573104428890', 'Luz Marina Restrepo', '@1', '[]', ${AUDIT})`
		)
		.run();
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

// Sends a count as warehouse: `[product, counted]` pairs.
async function send(...counted: [number, number][]): Promise<number> {
	const items = counted.map(([product, qty]) => ({ product_id: product, counted_qty: qty }));
	const result = await submitCount(db, { items }, warehouse);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.id;
}

// A delivered order with 120 chairs and an incident losing `lost` of them.
async function loseChairs(lost: number): Promise<number> {
	const address = { address_1: 'Calle 10 # 43-12, El Poblado', address_2: null };
	const order = await createOrder(
		db,
		{
			client_id: 1,
			client_name: 'Luz Marina Restrepo',
			event_date: '2026-08-15',
			delivery_date: '2026-08-14',
			pickup_date: '2026-08-16',
			rental_days: 2,
			delivery_attributes: { method: 'COMPANY_DELIVERY', time: '14:00', ...address },
			pickup_attributes: { method: 'COMPANY_PICKUP', time: '09:00', ...address },
			order_items: [{ product_id: CHAIR, qty: 120, unit_price: 2500 }]
		},
		sales
	);
	if (!order.ok) {
		throw new Error(order.message);
	}
	database.prepare("update orders set status = 'DELIVERED' where id = ?").run(order.id);
	const incident = await reportIncident(
		db,
		{
			order_id: order.id,
			incident_description: 'No volvieron',
			items: [{ product_id: CHAIR, qty: lost, outcome: 'LOST' }]
		},
		driver
	);
	if (!incident.ok) {
		throw new Error(incident.message);
	}
	return incident.id;
}

function count(id: number): Record<string, unknown> & { inventory_items: object[] } {
	const row = database.prepare('select * from inventory_counts where id = ?').get(id);
	return { ...row, inventory_items: JSON.parse(String(row?.inventory_items)) };
}

function applied(id: number): (boolean | undefined)[] {
	return count(id).inventory_items.map((item: { applied?: boolean }) => item.applied);
}

function events(entityType: string, action: string) {
	return database
		.prepare(
			'select entity_id, actor_username, before, after, reason from events where entity_type = ? and action = ? order by id'
		)
		.all(entityType, action);
}

test('approving applies each item, records who reviewed it and why, and logs only what changed', async () => {
	const id = await send([CHAIR, 792], [TABLECLOTH, 120]);
	expect(await approveCount(db, { id, note: '  Revisado con Juan ' }, manager)).toEqual({
		ok: true,
		id
	});
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([792, 120]);
	expect(count(id)).toMatchObject({
		status: 'APPROVED',
		review_note: 'Revisado con Juan',
		reviewed_by: 'gerente',
		reviewed_at: expect.any(Number),
		reversed_by: null,
		updated_by: 'gerente'
	});
	expect(applied(id)).toEqual([true, true]);
	expect(events('INVENTORY_COUNT', 'APPROVED')).toEqual([
		expect.objectContaining({
			entity_id: id,
			actor_username: 'gerente',
			reason: 'Revisado con Juan'
		})
	]);
	expect(events('PRODUCT', 'INVENTORY_ADJUSTED')).toEqual([
		{
			entity_id: CHAIR,
			actor_username: 'gerente',
			before: JSON.stringify({ total_quantity: 800 }),
			after: JSON.stringify({ total_quantity: 792 }),
			reason: null
		}
	]);
});

test('a lost incident between the count and its approval makes its item stale: skipped, the rest applied', async () => {
	const id = await send([CHAIR, 790], [TABLECLOTH, 118]);
	await loseChairs(4);
	expect(await previewApproval(db, { id }, manager)).toEqual({
		changes: [{ product_id: TABLECLOTH, name: 'Mantel blanco 3×3', from: 120, to: 118 }],
		stale: [{ product_id: CHAIR, name: 'Silla Tiffany dorada', system_qty: 800, current: 796 }],
		overlaps: []
	});
	expect(await approveCount(db, { id }, manager)).toMatchObject({ ok: true });
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([796, 118]);
	expect(applied(id)).toEqual([false, true]);
	const adjusted = events('PRODUCT', 'INVENTORY_ADJUSTED').filter(
		(event) => 'gerente' === event.actor_username
	);
	expect(adjusted.map((event) => event.entity_id)).toEqual([TABLECLOTH]);
});

test('an incident reversed before the approval leaves the item applicable', async () => {
	const id = await send([CHAIR, 790]);
	const incident = await loseChairs(4);
	await reverseIncident(db, { id: incident, reason: 'Aparecieron' }, manager);
	expect(await approveCount(db, { id }, manager)).toMatchObject({ ok: true });
	expect(stock(CHAIR)).toBe(790);
	expect(applied(id)).toEqual([true]);
});

test('overlapping counts warn; approving one makes the other stale only where it changed the product', async () => {
	const first = await send([CHAIR, 790], [TABLECLOTH, 118]);
	const second = await send([CHAIR, 800], [TABLECLOTH, 110]);
	const preview = await previewApproval(db, { id: second }, manager);
	expect(preview).toMatchObject({
		overlaps: [
			{
				id: first,
				createdBy: 'bodega',
				products: ['Silla Tiffany dorada', 'Mantel blanco 3×3']
			}
		]
	});
	expect(await approveCount(db, { id: second }, manager)).toMatchObject({ ok: true });
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([800, 110]);
	// The chairs landed on the first count's system_qty: still applicable.
	expect(await previewApproval(db, { id: first }, manager)).toEqual({
		changes: [{ product_id: CHAIR, name: 'Silla Tiffany dorada', from: 800, to: 790 }],
		stale: [{ product_id: TABLECLOTH, name: 'Mantel blanco 3×3', system_qty: 120, current: 110 }],
		overlaps: []
	});
	expect(await approveCount(db, { id: first }, manager)).toMatchObject({ ok: true });
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([790, 110]);
	expect(applied(first)).toEqual([true, false]);
});

test('a count whose items are all stale is not approved and writes nothing; it can be rejected', async () => {
	const id = await send([CHAIR, 790]);
	await loseChairs(4);
	const written = Number(database.prepare('select count(*) as count from events').get()?.count);
	expect(await approveCount(db, { id }, manager)).toMatchObject({ ok: false });
	expect(count(id)).toMatchObject({ status: 'PENDING_APPROVAL', reviewed_by: null });
	expect(database.prepare('select count(*) as count from events').get()).toEqual({
		count: written
	});
	expect(await rejectCount(db, { id, note: 'Contar de nuevo' }, manager)).toEqual({ ok: true, id });
	expect(stock(CHAIR)).toBe(796);
	expect(count(id)).toMatchObject({
		status: 'REJECTED',
		review_note: 'Contar de nuevo',
		reviewed_by: 'gerente',
		reviewed_at: expect.any(Number)
	});
	expect(applied(id)).toEqual([undefined]);
	expect(events('INVENTORY_COUNT', 'REJECTED')).toEqual([
		expect.objectContaining({ entity_id: id, reason: 'Contar de nuevo' })
	]);
});

test('a count is reviewed once: approving twice or rejecting after changes nothing more', async () => {
	const id = await send([CHAIR, 792]);
	expect(await approveCount(db, { id }, manager)).toMatchObject({ ok: true });
	database.prepare('update products set total_quantity = 800 where id = ?').run(CHAIR);
	expect(await approveCount(db, { id }, manager)).toMatchObject({ ok: false });
	expect(await rejectCount(db, { id }, manager)).toMatchObject({ ok: false });
	expect(stock(CHAIR)).toBe(800);
	expect(count(id).status).toBe('APPROVED');
	expect(events('INVENTORY_COUNT', 'APPROVED')).toHaveLength(1);
	expect(await previewApproval(db, { id }, manager)).toBeNull();
	expect(await approveCount(db, { id: 99 }, manager)).toMatchObject({ ok: false });
});

test('«Guardar y aprobar» sends and approves one count, both events on its id', async () => {
	const pending = await send([CHAIR, 790]);
	const items = [{ product_id: CHAIR, counted_qty: 795 }];
	expect(await previewApproval(db, { items }, manager)).toMatchObject({
		changes: [{ product_id: CHAIR, from: 800, to: 795 }],
		stale: [],
		overlaps: [{ id: pending, products: ['Silla Tiffany dorada'] }]
	});
	const result = await submitAndApproveCount(db, { items, note: 'Conteo de cierre' }, manager);
	expect(result).toEqual({ ok: true, id: 2 });
	expect(stock(CHAIR)).toBe(795);
	expect(count(2)).toMatchObject({
		status: 'APPROVED',
		created_by: 'gerente',
		reviewed_by: 'gerente'
	});
	const logged = database
		.prepare(
			"select entity_id, action from events where entity_type = 'INVENTORY_COUNT' order by id"
		)
		.all();
	expect(logged).toEqual([
		{ entity_id: pending, action: 'CREATED' },
		{ entity_id: 2, action: 'CREATED' },
		{ entity_id: 2, action: 'APPROVED' }
	]);
});

test('only ADMIN and MANAGER review: the others get a 403 and save nothing', async () => {
	const id = await send([CHAIR, 790]);
	const items = [{ product_id: CHAIR, counted_qty: 795 }];
	for (const actor of [warehouse, driver, sales]) {
		for (const call of [
			approveCount(db, { id }, actor),
			rejectCount(db, { id }, actor),
			previewApproval(db, { id }, actor),
			submitAndApproveCount(db, { items }, actor)
		]) {
			expect(isHttpError(await call.catch((error: unknown) => error), 403)).toBe(true);
		}
	}
	expect(countRows()).toBe(1);
	expect(count(id).status).toBe('PENDING_APPROVAL');
	expect(stock(CHAIR)).toBe(800);
});
