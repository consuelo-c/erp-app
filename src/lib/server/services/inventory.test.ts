import type { DatabaseSync } from 'node:sqlite';
import { isHttpError } from '@sveltejs/kit';
import { beforeEach, expect, test } from 'vitest';
import { createFixture, DRIVER, MANAGER, SALES, WAREHOUSE } from '../db/fixture';
import { reportIncident, reverseIncident } from './incidents';
import {
	approveCount,
	getCount,
	inventoryItemsSchema,
	listCounts,
	previewApproval,
	getSuggestedProducts,
	getUnitsOnRent,
	listCountableProducts,
	rejectCount,
	reverseCount,
	submitAndApproveCount,
	submitCount
} from './inventory';
import { nextOperationalStatus } from '$lib/orders';
import { advanceOrder, createExtension, getOrder, type OrderStatus } from './orders';
import { getProduct, updateProduct } from './products';

let db: D1Database;
let database: DatabaseSync;
let fixture: ReturnType<typeof createFixture>;
let LUZ_MARINA: number;
let CHAIR: number;
let TABLECLOTH: number;

beforeEach(async () => {
	fixture = createFixture();
	({ db, database } = fixture);
	CHAIR = await fixture.product({
		name: 'Silla Tiffany dorada',
		rental_price: '1.000',
		total_quantity: '800'
	});
	TABLECLOTH = await fixture.product({
		name: 'Mantel blanco 3×3',
		rental_price: '1.000',
		total_quantity: '120',
		active: 'off'
	});
	LUZ_MARINA = await fixture.contact({ full_name: 'Luz Marina Restrepo' });
});

function stock(id: number): number {
	const row = database.prepare('select total_quantity from products where id = ?').get(id);
	return Number(row?.total_quantity);
}

function countRows(): number {
	return Number(database.prepare('select count(*) as count from inventory_counts').get()?.count);
}

function countProductEvents(): number {
	const row = database.prepare(
		"select count(*) as count from events where entity_type = 'PRODUCT'"
	);
	return Number(row.get()?.count);
}

// Productos › Editar as the manager saves it: the product as it is, with `changes` typed over it.
async function editProduct(id: number, changes: Record<string, string>) {
	const current = await getProduct(db, id, MANAGER);
	const form = {
		id,
		name: current?.name,
		category: current?.category,
		rental_price: String(current?.rentalPrice),
		active: current?.isActive ? 'on' : 'off',
		...changes
	};
	const result = await updateProduct(db, form, MANAGER);
	if (!result.ok) {
		throw new Error(result.message);
	}
}

// Moves an order forward one legal transition at a time, as the status button does.
async function advanceTo(id: number, target: OrderStatus) {
	for (let order = await read(id); target !== order.status; order = await read(id)) {
		const to = nextOperationalStatus({
			from: order.status,
			deliveryMethod: order.delivery.method,
			returnMethod: order.pickup.method
		});
		const result = null === to ? null : await advanceOrder(db, { id, status: to }, MANAGER);
		if (!result?.ok) {
			throw new Error(`Order ${id} can't reach ${target} from ${order.status}`);
		}
	}
}

async function read(id: number) {
	const order = await getOrder(db, id, MANAGER);
	if (null === order) {
		throw new Error(`Order ${id} not found`);
	}
	return order;
}

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
	expect(valid([{ ...item, corrected_qty: 808, applied: true }])).toBe(true);
	expect(valid([{ ...item, corrected_qty: -1 }])).toBe(false);
	expect(valid([{ ...item, removed: true, applied: false }])).toBe(true);
	expect(valid([{ ...item, removed: false }])).toBe(false);
});

test('a warehouse login sends a count pending approval, changing no product', async () => {
	const items = [
		{ product_id: CHAIR, counted_qty: 792 },
		{ product_id: TABLECLOTH, counted_qty: 120 }
	];
	const productEvents = countProductEvents();
	const result = await submitCount(db, { items }, WAREHOUSE);
	expect(result).toEqual({ ok: true, id: expect.any(Number) });
	const id = result.ok ? result.id : 0;
	expect(countProductEvents()).toBe(productEvents);
	await editProduct(CHAIR, { name: 'Silla Tiffany oro' });
	expect(count(id)).toMatchObject({
		status: 'PENDING_APPROVAL',
		review_note: null,
		reviewed_by: null,
		reviewed_at: null,
		reversal_reason: null,
		reversed_by: null,
		reversed_at: null,
		created_by: 'warehouse',
		updated_by: 'warehouse'
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
			entity_id: id,
			action: 'CREATED',
			actor_username: 'warehouse',
			before: null,
			after: JSON.stringify({ status: 'PENDING_APPROVAL', inventory_items: row?.inventory_items })
		}
	]);
});

test('a driver sends one too; sales gets a 403 and saves nothing', async () => {
	const items = [{ product_id: CHAIR, counted_qty: 800 }];
	expect(await submitCount(db, { items }, DRIVER)).toMatchObject({ ok: true });
	const refused = await submitCount(db, { items }, SALES).catch((error: unknown) => error);
	expect(isHttpError(refused, 403)).toBe(true);
	expect(countRows()).toBe(1);
});

test('no rows, a repeated product or one that does not exist save nothing', async () => {
	expect(await submitCount(db, { items: [] }, WAREHOUSE)).toMatchObject({
		ok: false,
		errors: { items: expect.any(String) }
	});
	const twice = [
		{ product_id: CHAIR, counted_qty: 1 },
		{ product_id: CHAIR, counted_qty: 2 }
	];
	expect(await submitCount(db, { items: twice }, WAREHOUSE)).toMatchObject({ ok: false });
	const missing = [{ product_id: 99, counted_qty: 1 }];
	expect(await submitCount(db, { items: missing }, WAREHOUSE)).toMatchObject({
		ok: false,
		errors: { 'items.0.product_id': expect.any(String) }
	});
	expect(countRows()).toBe(0);
});

// Sends a count as warehouse: `[product, counted]` pairs.
async function send(...counted: [number, number][]): Promise<number> {
	const items = counted.map(([product, qty]) => ({ product_id: product, counted_qty: qty }));
	const result = await submitCount(db, { items }, WAREHOUSE);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.id;
}

const address = { address_1: 'Calle 10 # 43-12, El Poblado', address_2: null };

// Luz Marina's order of `qty` chairs, as typed: also what an extension of it types.
function chairsOrder(qty: number) {
	return {
		client_id: LUZ_MARINA,
		client_name: 'Luz Marina Restrepo',
		event_date: '2026-08-15',
		delivery_date: '2026-08-14',
		pickup_date: '2026-08-16',
		rental_days: 2,
		delivery_attributes: { method: 'COMPANY_DELIVERY', time: '14:00', ...address },
		pickup_attributes: { method: 'COMPANY_PICKUP', time: '09:00', ...address },
		order_items: [{ product_id: CHAIR, qty, unit_price: 2500 }],
		transport_cost: 0
	};
}

// An order renting `qty` chairs, in `status`.
function rentChairs(qty = 120, status: OrderStatus = 'DELIVERED'): Promise<number> {
	return fixture.order({ ...chairsOrder(qty), status });
}

// A delivered order with 120 chairs and an incident losing `lost` of them, or finding them damaged.
async function loseChairs(lost: number, outcome = 'LOST'): Promise<number> {
	return reportOn(await rentChairs(), lost, outcome);
}

// An incident on `order` losing `lost` chairs, or finding them damaged.
async function reportOn(order: number, lost: number, outcome = 'LOST'): Promise<number> {
	const incident = await reportIncident(
		db,
		{
			order_id: order,
			incident_description: 'No volvieron',
			items: [{ product_id: CHAIR, qty: lost, outcome }]
		},
		DRIVER
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
	expect(await approveCount(db, { id, note: '  Revisado con Juan ' }, MANAGER)).toEqual({
		ok: true,
		id
	});
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([792, 120]);
	expect(count(id)).toMatchObject({
		status: 'APPROVED',
		review_note: 'Revisado con Juan',
		reviewed_by: 'manager',
		reviewed_at: expect.any(Number),
		reversed_by: null,
		updated_by: 'manager'
	});
	expect(applied(id)).toEqual([true, true]);
	expect(events('INVENTORY_COUNT', 'APPROVED')).toEqual([
		expect.objectContaining({
			entity_id: id,
			actor_username: 'manager',
			reason: 'Revisado con Juan'
		})
	]);
	expect(events('PRODUCT', 'INVENTORY_ADJUSTED')).toEqual([
		{
			entity_id: CHAIR,
			actor_username: 'manager',
			before: JSON.stringify({ total_quantity: 800 }),
			after: JSON.stringify({ total_quantity: 792 }),
			reason: null
		}
	]);
});

test('a lost incident between the count and its approval makes its item stale: skipped, the rest applied', async () => {
	const id = await send([CHAIR, 790], [TABLECLOTH, 118]);
	await loseChairs(4);
	expect(await previewApproval(db, { id }, MANAGER)).toEqual({
		changes: [
			{ product_id: TABLECLOTH, name: 'Mantel blanco 3×3', from: 120, to: 118, isCorrected: false }
		],
		stale: [{ product_id: CHAIR, name: 'Silla Tiffany dorada', system_qty: 800, current: 796 }],
		removed: [],
		overlaps: []
	});
	expect(await approveCount(db, { id }, MANAGER)).toMatchObject({ ok: true });
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([796, 118]);
	expect(applied(id)).toEqual([false, true]);
	const adjusted = events('PRODUCT', 'INVENTORY_ADJUSTED').filter(
		(event) => 'manager' === event.actor_username
	);
	expect(adjusted.map((event) => event.entity_id)).toEqual([TABLECLOTH]);
});

test('an incident reversed before the approval leaves the item applicable', async () => {
	const id = await send([CHAIR, 790]);
	const incident = await loseChairs(4);
	await reverseIncident(db, { id: incident, reason: 'Aparecieron' }, MANAGER);
	expect(await approveCount(db, { id }, MANAGER)).toMatchObject({ ok: true });
	expect(stock(CHAIR)).toBe(790);
	expect(applied(id)).toEqual([true]);
});

test('overlapping counts warn; approving one makes the other stale only where it changed the product', async () => {
	const first = await send([CHAIR, 790], [TABLECLOTH, 118]);
	const second = await send([CHAIR, 800], [TABLECLOTH, 110]);
	const preview = await previewApproval(db, { id: second }, MANAGER);
	expect(preview).toMatchObject({
		overlaps: [
			{
				id: first,
				createdBy: 'warehouse',
				products: ['Silla Tiffany dorada', 'Mantel blanco 3×3']
			}
		]
	});
	expect(await approveCount(db, { id: second }, MANAGER)).toMatchObject({ ok: true });
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([800, 110]);
	// The chairs landed on the first count's system_qty: still applicable.
	expect(await previewApproval(db, { id: first }, MANAGER)).toEqual({
		changes: [
			{ product_id: CHAIR, name: 'Silla Tiffany dorada', from: 800, to: 790, isCorrected: false }
		],
		stale: [{ product_id: TABLECLOTH, name: 'Mantel blanco 3×3', system_qty: 120, current: 110 }],
		removed: [],
		overlaps: []
	});
	expect(await approveCount(db, { id: first }, MANAGER)).toMatchObject({ ok: true });
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([790, 110]);
	expect(applied(first)).toEqual([true, false]);
});

test('a count whose items are all stale is not approved and writes nothing; it can be rejected', async () => {
	const id = await send([CHAIR, 790]);
	await loseChairs(4);
	const written = Number(database.prepare('select count(*) as count from events').get()?.count);
	expect(await approveCount(db, { id }, MANAGER)).toMatchObject({ ok: false });
	expect(count(id)).toMatchObject({ status: 'PENDING_APPROVAL', reviewed_by: null });
	expect(database.prepare('select count(*) as count from events').get()).toEqual({
		count: written
	});
	expect(await rejectCount(db, { id, note: 'Contar de nuevo' }, MANAGER)).toEqual({ ok: true, id });
	expect(stock(CHAIR)).toBe(796);
	expect(count(id)).toMatchObject({
		status: 'REJECTED',
		review_note: 'Contar de nuevo',
		reviewed_by: 'manager',
		reviewed_at: expect.any(Number)
	});
	expect(applied(id)).toEqual([undefined]);
	expect(events('INVENTORY_COUNT', 'REJECTED')).toEqual([
		expect.objectContaining({ entity_id: id, reason: 'Contar de nuevo' })
	]);
});

test('a count is reviewed once: approving twice or rejecting after changes nothing more', async () => {
	const id = await send([CHAIR, 792]);
	expect(await approveCount(db, { id }, MANAGER)).toMatchObject({ ok: true });
	// The chairs move on: a second approval would land them back on 792.
	await loseChairs(8);
	expect(await approveCount(db, { id }, MANAGER)).toMatchObject({ ok: false });
	expect(await rejectCount(db, { id }, MANAGER)).toMatchObject({ ok: false });
	expect(stock(CHAIR)).toBe(784);
	expect(count(id).status).toBe('APPROVED');
	expect(events('INVENTORY_COUNT', 'APPROVED')).toHaveLength(1);
	expect(await previewApproval(db, { id }, MANAGER)).toMatchObject({
		ok: false,
		message: 'Ese conteo ya fue revisado'
	});
	expect(await previewApproval(db, { id: 99 }, MANAGER)).toMatchObject({
		ok: false,
		message: 'Ese conteo no existe'
	});
	expect(await approveCount(db, { id: 99 }, MANAGER)).toMatchObject({ ok: false });
});

test('«Guardar y aprobar» sends and approves one count, both events on its id', async () => {
	const pending = await send([CHAIR, 790]);
	const items = [{ product_id: CHAIR, counted_qty: 795 }];
	expect(await previewApproval(db, { items }, MANAGER)).toMatchObject({
		changes: [{ product_id: CHAIR, from: 800, to: 795 }],
		stale: [],
		overlaps: [{ id: pending, products: ['Silla Tiffany dorada'] }]
	});
	const result = await submitAndApproveCount(db, { items, note: 'Conteo de cierre' }, MANAGER);
	expect(result).toEqual({ ok: true, id: expect.any(Number) });
	const id = result.ok ? result.id : 0;
	expect(stock(CHAIR)).toBe(795);
	expect(count(id)).toMatchObject({
		status: 'APPROVED',
		created_by: 'manager',
		reviewed_by: 'manager'
	});
	const logged = database
		.prepare(
			"select entity_id, action from events where entity_type = 'INVENTORY_COUNT' order by id"
		)
		.all();
	expect(logged).toEqual([
		{ entity_id: pending, action: 'CREATED' },
		{ entity_id: id, action: 'CREATED' },
		{ entity_id: id, action: 'APPROVED' }
	]);
});

test('a corrected quantity is applied and what was counted is kept beside it', async () => {
	const id = await send([CHAIR, 110], [TABLECLOTH, 118]);
	const edits = [{ product_id: CHAIR, corrected_qty: 808 }];
	expect(await previewApproval(db, { id, edits }, MANAGER)).toEqual({
		changes: [
			{ product_id: CHAIR, name: 'Silla Tiffany dorada', from: 800, to: 808, isCorrected: true },
			{ product_id: TABLECLOTH, name: 'Mantel blanco 3×3', from: 120, to: 118, isCorrected: false }
		],
		stale: [],
		removed: [],
		overlaps: []
	});
	expect(await approveCount(db, { id, edits }, MANAGER)).toEqual({ ok: true, id });
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([808, 118]);
	expect(count(id).inventory_items).toEqual([
		{
			product_id: CHAIR,
			name: 'Silla Tiffany dorada',
			system_qty: 800,
			counted_qty: 110,
			corrected_qty: 808,
			applied: true
		},
		{
			product_id: TABLECLOTH,
			name: 'Mantel blanco 3×3',
			system_qty: 120,
			counted_qty: 118,
			applied: true
		}
	]);
	const [approval] = events('INVENTORY_COUNT', 'APPROVED');
	expect(JSON.parse(String(approval.before)).inventory_items).not.toContain('corrected_qty');
	expect(JSON.parse(String(approval.after)).inventory_items).toContain('"corrected_qty":808');
});

test('a removed row is never applied and overlaps no other count', async () => {
	const other = await send([TABLECLOTH, 115]);
	const id = await send([CHAIR, 790], [TABLECLOTH, 118]);
	const edits = [{ product_id: TABLECLOTH, removed: true }];
	expect(await previewApproval(db, { id }, MANAGER)).toMatchObject({
		overlaps: [{ id: other, products: ['Mantel blanco 3×3'] }]
	});
	expect(await previewApproval(db, { id, edits }, MANAGER)).toEqual({
		changes: [
			{ product_id: CHAIR, name: 'Silla Tiffany dorada', from: 800, to: 790, isCorrected: false }
		],
		stale: [],
		removed: [{ product_id: TABLECLOTH, name: 'Mantel blanco 3×3' }],
		overlaps: []
	});
	expect(await approveCount(db, { id, edits }, MANAGER)).toMatchObject({ ok: true });
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([790, 120]);
	expect(count(id).inventory_items[1]).toEqual({
		product_id: TABLECLOTH,
		name: 'Mantel blanco 3×3',
		system_qty: 120,
		counted_qty: 118,
		removed: true,
		applied: false
	});
	// Nothing verified it: the other count's tablecloths still apply.
	expect(await approveCount(db, { id: other }, MANAGER)).toMatchObject({ ok: true });
	expect(stock(TABLECLOTH)).toBe(115);
});

test('a stale row only takes a removal: a correction to it is refused and saves nothing', async () => {
	const id = await send([CHAIR, 790], [TABLECLOTH, 118]);
	await loseChairs(4);
	const edits = [{ product_id: CHAIR, corrected_qty: 792 }];
	const refusal = {
		ok: false,
		message: 'Silla Tiffany dorada está desactualizado: solo se puede eliminar'
	};
	expect(await previewApproval(db, { id, edits }, MANAGER)).toMatchObject(refusal);
	expect(await approveCount(db, { id, edits }, MANAGER)).toMatchObject(refusal);
	expect(count(id).status).toBe('PENDING_APPROVAL');
	expect(stock(CHAIR)).toBe(796);
	const removal = [{ product_id: CHAIR, removed: true }];
	expect(await previewApproval(db, { id, edits: removal }, MANAGER)).toMatchObject({
		stale: [],
		removed: [{ product_id: CHAIR }]
	});
	expect(await approveCount(db, { id, edits: removal }, MANAGER)).toMatchObject({ ok: true });
	expect(stock(CHAIR)).toBe(796);
	expect(applied(id)).toEqual([false, true]);
});

test("edits name the count's products once, each corrected or removed", async () => {
	const id = await send([CHAIR, 790]);
	for (const edits of [
		[{ product_id: TABLECLOTH, removed: true }],
		[{ product_id: CHAIR, corrected_qty: -1 }],
		[{ product_id: CHAIR, corrected_qty: 1, removed: true }],
		[
			{ product_id: CHAIR, removed: true },
			{ product_id: CHAIR, corrected_qty: 4 }
		]
	]) {
		expect(await approveCount(db, { id, edits }, MANAGER)).toMatchObject({ ok: false });
	}
	expect(count(id).status).toBe('PENDING_APPROVAL');
	// A correction equal to what was counted changes nothing.
	const edits = [{ product_id: CHAIR, corrected_qty: 790 }];
	expect(await approveCount(db, { id, edits }, MANAGER)).toMatchObject({ ok: true });
	expect(count(id).inventory_items[0]).not.toHaveProperty('corrected_qty');
});

test('a count whose rows are all stale or removed can only be rejected, and rejecting ignores edits', async () => {
	const id = await send([CHAIR, 790], [TABLECLOTH, 118]);
	await loseChairs(4);
	const edits = [{ product_id: TABLECLOTH, removed: true }];
	expect(await approveCount(db, { id, edits }, MANAGER)).toMatchObject({
		ok: false,
		message:
			'Ningún producto se aplica: todos están desactualizados o eliminados. Este conteo solo se puede rechazar'
	});
	expect(count(id).status).toBe('PENDING_APPROVAL');
	expect(await rejectCount(db, { id, edits }, MANAGER)).toEqual({ ok: true, id });
	expect(count(id).inventory_items).toEqual([
		{ product_id: CHAIR, name: 'Silla Tiffany dorada', system_qty: 800, counted_qty: 790 },
		{ product_id: TABLECLOTH, name: 'Mantel blanco 3×3', system_qty: 120, counted_qty: 118 }
	]);
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([796, 120]);
});

async function approved(...counted: [number, number][]): Promise<number> {
	const id = await send(...counted);
	expect(await approveCount(db, { id }, MANAGER)).toMatchObject({ ok: true });
	return id;
}

const BLOCKED = 'Silla Tiffany dorada ya tuvo otro movimiento de inventario después de este conteo';

test('reversing sets each applied product back, records who and why, and logs what it restores', async () => {
	const id = await approved([CHAIR, 792], [TABLECLOTH, 118]);
	expect(await reverseCount(db, { id, reason: ' ' }, MANAGER)).toMatchObject({
		ok: false,
		errors: { reason: 'Escribe el motivo' }
	});
	expect(await reverseCount(db, { id, reason: 'Se contó la bodega equivocada' }, MANAGER)).toEqual({
		ok: true,
		id
	});
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([800, 120]);
	expect(count(id)).toMatchObject({
		status: 'REVERSED',
		reviewed_by: 'manager',
		reversal_reason: 'Se contó la bodega equivocada',
		reversed_by: 'manager',
		reversed_at: expect.any(Number)
	});
	expect(applied(id)).toEqual([true, true]);
	expect(events('INVENTORY_COUNT', 'REVERSED')).toEqual([
		expect.objectContaining({ entity_id: id, reason: 'Se contó la bodega equivocada' })
	]);
	expect(events('PRODUCT', 'INVENTORY_ADJUSTED').slice(2)).toEqual([
		expect.objectContaining({
			entity_id: CHAIR,
			before: '{"total_quantity":792}',
			after: '{"total_quantity":800}'
		}),
		expect.objectContaining({
			entity_id: TABLECLOTH,
			before: '{"total_quantity":118}',
			after: '{"total_quantity":120}'
		})
	]);
});

test('reversing a corrected approval restores the stock as it was before the count', async () => {
	const id = await send([CHAIR, 110], [TABLECLOTH, 118]);
	const edits = [
		{ product_id: CHAIR, corrected_qty: 808 },
		{ product_id: TABLECLOTH, removed: true }
	];
	expect(await approveCount(db, { id, edits }, MANAGER)).toMatchObject({ ok: true });
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([808, 120]);
	expect(await reverseCount(db, { id, reason: 'Error' }, MANAGER)).toMatchObject({ ok: true });
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([800, 120]);
	expect(count(id).inventory_items[0]).toMatchObject({ counted_qty: 110, corrected_qty: 808 });
});

test('a skipped stale item is left as it is: only the applied ones are restored', async () => {
	const id = await send([CHAIR, 790], [TABLECLOTH, 118]);
	await loseChairs(4);
	await approveCount(db, { id }, MANAGER);
	expect(await reverseCount(db, { id, reason: 'Error' }, MANAGER)).toMatchObject({ ok: true });
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([796, 120]);
	const restored = events('PRODUCT', 'INVENTORY_ADJUSTED').filter(
		(event) => 'manager' === event.actor_username
	);
	expect(restored.map((event) => event.entity_id)).toEqual([TABLECLOTH, TABLECLOTH]);
});

test('a lost incident on the same product after the approval blocks the reversal', async () => {
	const id = await approved([CHAIR, 790]);
	await loseChairs(4);
	expect(await reverseCount(db, { id, reason: 'Error' }, MANAGER)).toEqual({
		ok: false,
		message: BLOCKED,
		errors: {}
	});
	expect(count(id).status).toBe('APPROVED');
	expect(stock(CHAIR)).toBe(786);
});

test('a lost incident on another product, or a recoverable one on the same, allows it', async () => {
	const other = await approved([TABLECLOTH, 118]);
	await loseChairs(4);
	expect(await reverseCount(db, { id: other, reason: 'Error' }, MANAGER)).toMatchObject({
		ok: true
	});
	const same = await approved([CHAIR, 790]);
	await loseChairs(3, 'RECOVERABLE');
	expect(await reverseCount(db, { id: same, reason: 'Error' }, MANAGER)).toMatchObject({
		ok: true
	});
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([796, 120]);
});

test('another count applying the product blocks it when approved later, even reversed since', async () => {
	const first = await approved([CHAIR, 790]);
	const second = await approved([CHAIR, 795], [TABLECLOTH, 118]);
	expect(await reverseCount(db, { id: first, reason: 'Error' }, MANAGER)).toMatchObject({
		ok: false,
		message: BLOCKED
	});
	expect(await reverseCount(db, { id: second, reason: 'Error' }, MANAGER)).toMatchObject({
		ok: true
	});
	expect(await reverseCount(db, { id: first, reason: 'Error' }, MANAGER)).toMatchObject({
		ok: false
	});
});

test('another count created later but approved earlier allows it: the order is by approval', async () => {
	const first = await send([CHAIR, 790]);
	const second = await send([CHAIR, 800]);
	await approveCount(db, { id: second }, MANAGER);
	await approveCount(db, { id: first }, MANAGER);
	expect(await reverseCount(db, { id: first, reason: 'Error' }, MANAGER)).toMatchObject({
		ok: true
	});
	expect(stock(CHAIR)).toBe(800);
	expect(await reverseCount(db, { id: second, reason: 'Error' }, MANAGER)).toMatchObject({
		ok: false,
		message: BLOCKED
	});
});

test('a pending, rejected, reversed or missing count is not reversed', async () => {
	const pending = await send([CHAIR, 790]);
	const rejected = await send([CHAIR, 790]);
	await rejectCount(db, { id: rejected }, MANAGER);
	const reversed = await approved([TABLECLOTH, 118]);
	await reverseCount(db, { id: reversed, reason: 'Error' }, MANAGER);
	for (const id of [pending, rejected, reversed]) {
		expect(await reverseCount(db, { id, reason: 'Error' }, MANAGER)).toMatchObject({
			ok: false,
			message: 'Solo se revierte un conteo aprobado'
		});
	}
	expect(await reverseCount(db, { id: 99, reason: 'Error' }, MANAGER)).toMatchObject({
		ok: false,
		message: 'Ese conteo no existe'
	});
	expect(events('INVENTORY_COUNT', 'REVERSED')).toHaveLength(1);
	expect(stock(CHAIR)).toBe(800);
});

test('the review list: pending first, then reviewed, each newest first, with stale items and overlaps', async () => {
	const reviewed = await approved([TABLECLOTH, 118]);
	const older = await send([CHAIR, 790]);
	const newer = await send([CHAIR, 795], [TABLECLOTH, 120]);
	const latest = await send([TABLECLOTH, 119]);
	await loseChairs(4);
	expect(await listCounts(db, MANAGER)).toEqual(
		[
			{ id: latest, status: 'PENDING_APPROVAL', staleCount: 0, overlapIds: [newer] },
			{ id: newer, status: 'PENDING_APPROVAL', staleCount: 1, overlapIds: [latest, older] },
			{ id: older, status: 'PENDING_APPROVAL', staleCount: 1, overlapIds: [newer] },
			{ id: reviewed, status: 'APPROVED', staleCount: 0, overlapIds: [] }
		].map((row) => ({
			...row,
			createdAt: expect.any(Number),
			createdBy: 'warehouse',
			productCount: count(row.id).inventory_items.length
		}))
	);
});

test('a count read: a pending one with what approving would do, an approved one with why it cannot be reversed', async () => {
	const first = await approved([CHAIR, 790]);
	expect(await getCount(db, String(first), MANAGER)).toMatchObject({
		status: 'APPROVED',
		reviewedBy: 'manager',
		preview: null,
		reversalBlock: null
	});
	const pending = await send([CHAIR, 780], [TABLECLOTH, 118]);
	await approved([CHAIR, 785]);
	expect(await getCount(db, first, MANAGER)).toMatchObject({ reversalBlock: BLOCKED });
	expect(await getCount(db, pending, MANAGER)).toMatchObject({
		status: 'PENDING_APPROVAL',
		createdBy: 'warehouse',
		reviewedAt: null,
		reversalBlock: null,
		preview: {
			changes: [{ product_id: TABLECLOTH, name: 'Mantel blanco 3×3', from: 120, to: 118 }],
			stale: [{ product_id: CHAIR, system_qty: 790, current: 785 }],
			overlaps: []
		}
	});
	expect(await getCount(db, 99, MANAGER)).toBeNull();
	expect(await getCount(db, 'abc', MANAGER)).toBeNull();
});

async function suggested(): Promise<number[]> {
	return (await getSuggestedProducts(db, WAREHOUSE)).map((row) => row.product_id);
}

test('a recoverable incident suggests its product with its units and orders; reversed or lost-only ones do not', async () => {
	expect(await getSuggestedProducts(db, DRIVER)).toEqual([]);
	await loseChairs(4);
	const reversed = await loseChairs(2, 'RECOVERABLE');
	await reverseIncident(db, { id: reversed, reason: 'Error' }, MANAGER);
	expect(await suggested()).toEqual([]);
	const ten = await rentChairs();
	await reportOn(ten, 10, 'RECOVERABLE');
	const three = await rentChairs();
	await reportOn(three, 3, 'RECOVERABLE');
	expect(await getSuggestedProducts(db, WAREHOUSE)).toEqual([
		{
			product_id: CHAIR,
			name: 'Silla Tiffany dorada',
			total_quantity: 796,
			recoverable: 13,
			order_ids: [ten, three]
		}
	]);
});

test('a count that applied the product after the incident verifies it; reversing that count does not', async () => {
	await loseChairs(10, 'RECOVERABLE');
	const id = await approved([CHAIR, 800]);
	expect(await suggested()).toEqual([]);
	await reverseCount(db, { id, reason: 'Error' }, MANAGER);
	expect(await suggested()).toEqual([CHAIR]);
	await approved([CHAIR, 800]);
	await loseChairs(5, 'RECOVERABLE');
	expect(await getSuggestedProducts(db, WAREHOUSE)).toMatchObject([{ recoverable: 5 }]);
});

test('a count of another product, a stale skip, or a pending or rejected count verify nothing', async () => {
	await loseChairs(10, 'RECOVERABLE');
	await approved([TABLECLOTH, 118]);
	const stale = await send([CHAIR, 790], [TABLECLOTH, 120]);
	await loseChairs(4);
	await approveCount(db, { id: stale }, MANAGER);
	expect(applied(stale)).toEqual([false, true]);
	await send([CHAIR, 790]);
	await rejectCount(db, { id: await send([CHAIR, 790]) }, MANAGER);
	expect(await suggested()).toEqual([CHAIR]);
});

test('an inactive product with a recoverable incident is still suggested', async () => {
	await loseChairs(10, 'RECOVERABLE');
	await editProduct(CHAIR, { active: 'off' });
	expect(await suggested()).toEqual([CHAIR]);
});

test('«En alquiler» adds the orders out at events; an extension only once its original is back', async () => {
	await rentChairs(100, 'OUT_FOR_DELIVERY');
	const original = await rentChairs(200, 'DELIVERED');
	await rentChairs(300, 'OUT_FOR_PICKUP');
	for (const status of ['PICKED', 'CONFIRMED', 'COMPLETED'] as const) {
		await rentChairs(1000, status);
	}
	const extension = { ...chairsOrder(50), pickup_date: '2026-08-18', parent_order_id: original };
	expect(await createExtension(db, extension, SALES)).toMatchObject({ ok: true });
	expect(await getUnitsOnRent(db, WAREHOUSE)).toEqual({ [CHAIR]: 600 });
	await advanceTo(original, 'COMPLETED');
	expect(await getUnitsOnRent(db, DRIVER)).toEqual({ [CHAIR]: 450 });
});

test('«Buscar otro producto» offers the active products only', async () => {
	expect(await listCountableProducts(db, DRIVER)).toEqual([
		{ product_id: CHAIR, name: 'Silla Tiffany dorada', total_quantity: 800 }
	]);
});

test('sales reads neither the suggested list, «En alquiler» nor the products to count', async () => {
	for (const call of [
		getSuggestedProducts(db, SALES),
		getUnitsOnRent(db, SALES),
		listCountableProducts(db, SALES)
	]) {
		expect(isHttpError(await call.catch((error: unknown) => error), 403)).toBe(true);
	}
});

test('only ADMIN and MANAGER review: the others get a 403 and save nothing', async () => {
	const id = await send([CHAIR, 790]);
	const items = [{ product_id: CHAIR, counted_qty: 795 }];
	for (const actor of [WAREHOUSE, DRIVER, SALES]) {
		for (const call of [
			approveCount(db, { id }, actor),
			rejectCount(db, { id }, actor),
			previewApproval(db, { id }, actor),
			reverseCount(db, { id, reason: 'Error' }, actor),
			submitAndApproveCount(db, { items }, actor),
			listCounts(db, actor),
			getCount(db, id, actor)
		]) {
			expect(isHttpError(await call.catch((error: unknown) => error), 403)).toBe(true);
		}
	}
	expect(countRows()).toBe(1);
	expect(count(id).status).toBe('PENDING_APPROVAL');
	expect(stock(CHAIR)).toBe(800);
});
