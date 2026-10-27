import type { DatabaseSync } from 'node:sqlite';
import { isHttpError } from '@sveltejs/kit';
import { beforeEach, expect, test } from 'vitest';
import type { Actor, Role } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import {
	incidentItemsSchema,
	listIncidents,
	reportIncident,
	reverseIncident,
	setResponsibleParty
} from './incidents';
import { advanceOrder, confirmOrder, createOrder, getOrderDetail } from './orders';

const sales: Actor = { username: 'ventas', employeeId: null, roles: ['SALES'], kind: 'user' };
const warehouse: Actor = { ...sales, username: 'bodega', roles: ['WAREHOUSE'] };
const driver: Actor = { ...sales, username: 'conductor', roles: ['DRIVER'] };
const manager: Actor = { ...sales, username: 'gerente', roles: ['MANAGER'] };

let db: D1Database;
let database: DatabaseSync;

const AUDIT = "0, 'admin', 0, 'admin'";

beforeEach(() => {
	({ db, database } = createMemoryD1());
	database
		.prepare(
			`insert into contacts (phone, full_name, document_id, services, created_at, created_by, updated_at, updated_by) values ('573104428890', 'Luz Marina Restrepo', '@1', '[]', ${AUDIT})`
		)
		.run();
	for (const name of ['Silla Tiffany dorada', 'Mesa redonda 10 puestos', 'Mantel blanco']) {
		database
			.prepare(
				`insert into products (name, category, rental_price, total_quantity, created_at, created_by, updated_at, updated_by) values (?, 'CHAIRS_TABLES', 1000, 500, ${AUDIT})`
			)
			.run(name);
	}
});

const CHAIR = 1;
const TABLE = 2;
const TABLECLOTH = 3;

const address = { address_1: 'Calle 10 # 43-12, El Poblado', address_2: null };

async function createOrderIn(status: string): Promise<number> {
	const result = await createOrder(
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
			order_items: [
				{ product_id: CHAIR, qty: 120, unit_price: 2500 },
				{ product_id: TABLE, qty: 12, unit_price: 12000 }
			]
		},
		sales
	);
	if (!result.ok) {
		throw new Error(JSON.stringify(result.errors));
	}
	database.prepare('update orders set status = ? where id = ?').run(status, result.id);
	return result.id;
}

function stock(id: number): number {
	const row = database.prepare('select total_quantity from products where id = ?').get(id);
	return Number(row?.total_quantity);
}

function hasIncident(orderId: number): number {
	const row = database.prepare('select has_incident from orders where id = ?').get(orderId);
	return Number(row?.has_incident);
}

function events(entityType: string, action: string) {
	return database
		.prepare(
			'select entity_id, actor_username, before, after, reason from events where entity_type = ? and action = ? order by id'
		)
		.all(entityType, action)
		.map((event) => ({
			entityId: event.entity_id,
			actor: event.actor_username,
			...(null === event.reason ? {} : { reason: event.reason }),
			before: null === event.before ? null : JSON.parse(String(event.before)),
			after: JSON.parse(String(event.after))
		}));
}

function report(orderId: number, items: object[], actor: Actor = warehouse) {
	const input = { order_id: String(orderId), incident_description: ' Llegaron mojadas ', items };
	return reportIncident(db, input, actor);
}

test('the database rejects an unknown status or responsible party', () => {
	const insert = (party: string, status: string) =>
		database
			.prepare(
				`insert into incidents (order_id, incident_items, incident_description, responsible_party, status, created_at, created_by, updated_at, updated_by) values (1, '[]', 'x', ?, ?, ${AUDIT})`
			)
			.run(party, status);
	expect(() => insert('NEIGHBOR', 'ACTIVE')).toThrow(/CHECK constraint failed/);
	expect(() => insert('UNDETERMINED', 'CLOSED')).toThrow(/CHECK constraint failed/);
});

test('the items: at least one, whole quantities, known outcomes and keys, a product once per outcome', () => {
	const item = { product_id: CHAIR, name: 'Silla Tiffany dorada', qty: 4, outcome: 'LOST' };
	expect(incidentItemsSchema.safeParse([]).success).toBe(false);
	expect(incidentItemsSchema.safeParse([{ ...item, qty: 0 }]).success).toBe(false);
	expect(incidentItemsSchema.safeParse([{ ...item, outcome: 'STOLEN' }]).success).toBe(false);
	expect(incidentItemsSchema.safeParse([{ ...item, photo: 'x.jpg' }]).success).toBe(false);
	const lostAndRecoverable = [item, { ...item, qty: 3, outcome: 'RECOVERABLE' }];
	expect(incidentItemsSchema.safeParse(lostAndRecoverable).success).toBe(true);
	expect(incidentItemsSchema.safeParse([item, { ...item, qty: 3 }]).success).toBe(false);
});

test('an order not yet with the client, or cancelled, takes no incident', async () => {
	for (const status of ['DRAFT', 'CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY', 'CANCELLED']) {
		const id = await createOrderIn(status);
		const result = await report(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }]);
		expect(result).toMatchObject({ ok: false });
		expect(hasIncident(id)).toBe(0);
	}
	expect(database.prepare('select count(*) as count from incidents').get()).toEqual({ count: 0 });
	expect(stock(CHAIR)).toBe(500);
});

test("only the order's products, up to each line's quantity across outcomes", async () => {
	const id = await createOrderIn('DELIVERED');
	const notOnOrder = await report(id, [{ product_id: TABLECLOTH, qty: 1, outcome: 'LOST' }]);
	expect(notOnOrder).toMatchObject({
		ok: false,
		errors: { 'items.0.product_id': expect.any(String) }
	});
	const tooMany = await report(id, [
		{ product_id: TABLE, qty: 10, outcome: 'LOST' },
		{ product_id: TABLE, qty: 3, outcome: 'RECOVERABLE' }
	]);
	expect(tooMany).toMatchObject({ ok: false, errors: { 'items.1.qty': expect.any(String) } });
	const repeated = await report(id, [
		{ product_id: TABLE, qty: 1, outcome: 'LOST' },
		{ product_id: TABLE, qty: 1, outcome: 'LOST' }
	]);
	expect(repeated).toMatchObject({ ok: false, errors: { items: expect.any(String) } });
	expect(hasIncident(id)).toBe(0);
});

test('an all-recoverable incident: born undetermined, flags the order, leaves inventory alone', async () => {
	const id = await createOrderIn('COMPLETED');
	const result = await report(id, [{ product_id: CHAIR, qty: 6, outcome: 'RECOVERABLE' }]);
	expect(result).toEqual({ ok: true, id: 1 });
	expect(database.prepare('select * from incidents').get()).toMatchObject({
		order_id: id,
		incident_description: 'Llegaron mojadas',
		responsible_party: 'UNDETERMINED',
		status: 'ACTIVE',
		reversal_reason: null,
		reversed_by: null,
		reversed_at: null,
		created_by: 'bodega',
		updated_by: 'bodega'
	});
	expect(stock(CHAIR)).toBe(500);
	expect(hasIncident(id)).toBe(1);
	expect(events('PRODUCT', 'INVENTORY_ADJUSTED')).toEqual([]);
});

test('a mixed incident subtracts only the lost and unusable, each product once, with its events', async () => {
	const id = await createOrderIn('OUT_FOR_PICKUP');
	const items = [
		{ product_id: CHAIR, qty: 4, outcome: 'LOST' },
		{ product_id: CHAIR, qty: 3, outcome: 'RECOVERABLE' },
		{ product_id: CHAIR, qty: 2, outcome: 'UNRECOVERABLE' },
		{ product_id: TABLE, qty: 1, outcome: 'UNRECOVERABLE' }
	];
	expect(await report(id, items, driver)).toMatchObject({ ok: true });
	expect([stock(CHAIR), stock(TABLE)]).toEqual([494, 499]);
	expect(events('INCIDENT', 'CREATED')).toEqual([
		{
			entityId: 1,
			actor: 'conductor',
			before: null,
			after: {
				order_id: id,
				incident_items: JSON.stringify(
					items.map((item) => ({
						product_id: item.product_id,
						name: CHAIR === item.product_id ? 'Silla Tiffany dorada' : 'Mesa redonda 10 puestos',
						qty: item.qty,
						outcome: item.outcome
					}))
				),
				incident_description: 'Llegaron mojadas',
				responsible_party: 'UNDETERMINED',
				status: 'ACTIVE'
			}
		}
	]);
	expect(events('PRODUCT', 'INVENTORY_ADJUSTED')).toEqual([
		{
			entityId: CHAIR,
			actor: 'conductor',
			before: { total_quantity: 500 },
			after: { total_quantity: 494 }
		},
		{
			entityId: TABLE,
			actor: 'conductor',
			before: { total_quantity: 500 },
			after: { total_quantity: 499 }
		}
	]);
});

test('a deactivated product is still reported, and inventory may go negative', async () => {
	const id = await createOrderIn('DELIVERED');
	database.prepare('update products set active = 0, total_quantity = 2 where id = ?').run(CHAIR);
	expect(await report(id, [{ product_id: CHAIR, qty: 5, outcome: 'LOST' }])).toMatchObject({
		ok: true
	});
	expect(stock(CHAIR)).toBe(-3);
});

test('an incident on a staged order is no edit: it never reads as modified after staging', async () => {
	const id = await createOrderIn('DRAFT');
	await confirmOrder(db, { id }, sales);
	for (const status of ['PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
		await advanceOrder(db, { id, status }, driver);
	}
	await report(id, [{ product_id: CHAIR, qty: 1, outcome: 'LOST' }]);
	await report(id, [{ product_id: TABLE, qty: 1, outcome: 'RECOVERABLE' }], sales);
	expect(database.prepare('select count(*) as count from incidents').get()).toEqual({ count: 2 });
	expect(hasIncident(id)).toBe(1);
	expect(events('ORDER', 'EDITED')).toEqual([]);
	expect((await getOrderDetail(db, id, sales))?.modifiedAfterStagingAt).toBeNull();
});

function reverse(id: number, actor: Actor = manager) {
	return reverseIncident(db, { id: String(id), reason: ' Las sillas aparecieron ' }, actor);
}

test('reversing gives the lost and unusable back, records who, when and why, and its events', async () => {
	const id = await createOrderIn('COMPLETED');
	const items = [
		{ product_id: CHAIR, qty: 4, outcome: 'LOST' },
		{ product_id: CHAIR, qty: 3, outcome: 'RECOVERABLE' },
		{ product_id: TABLE, qty: 1, outcome: 'UNRECOVERABLE' }
	];
	await report(id, items);
	database.prepare('update products set total_quantity = 300 where id = ?').run(CHAIR);
	expect(await reverse(1)).toEqual({ ok: true, id: 1 });
	expect([stock(CHAIR), stock(TABLE)]).toEqual([304, 500]);
	expect(database.prepare('select * from incidents').get()).toMatchObject({
		status: 'REVERSED',
		reversal_reason: 'Las sillas aparecieron',
		reversed_by: 'gerente',
		reversed_at: expect.any(Number),
		updated_by: 'gerente'
	});
	expect(hasIncident(id)).toBe(0);
	expect(events('INCIDENT', 'REVERSED')).toEqual([
		{
			entityId: 1,
			actor: 'gerente',
			reason: 'Las sillas aparecieron',
			before: { status: 'ACTIVE', reversal_reason: null, reversed_by: null, reversed_at: null },
			after: {
				status: 'REVERSED',
				reversal_reason: 'Las sillas aparecieron',
				reversed_by: 'gerente',
				reversed_at: expect.any(Number)
			}
		}
	]);
	expect(events('PRODUCT', 'INVENTORY_ADJUSTED').slice(2)).toEqual([
		{
			entityId: CHAIR,
			actor: 'gerente',
			before: { total_quantity: 300 },
			after: { total_quantity: 304 }
		},
		{
			entityId: TABLE,
			actor: 'gerente',
			before: { total_quantity: 499 },
			after: { total_quantity: 500 }
		}
	]);
	const [incident] = await listIncidents(db, id, manager);
	expect(incident).toMatchObject({
		status: 'REVERSED',
		reversal: { reason: 'Las sillas aparecieron', reversedBy: 'gerente' }
	});
});

test('an all-recoverable incident reverses and changes no product', async () => {
	const id = await createOrderIn('DELIVERED');
	await report(id, [{ product_id: CHAIR, qty: 6, outcome: 'RECOVERABLE' }]);
	expect(await reverse(1)).toMatchObject({ ok: true });
	expect(stock(CHAIR)).toBe(500);
	expect(events('PRODUCT', 'INVENTORY_ADJUSTED')).toEqual([]);
});

test('incidents reverse in any order; the flag stays while one is active; twice is refused', async () => {
	const id = await createOrderIn('COMPLETED');
	await report(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }]);
	await report(id, [{ product_id: TABLE, qty: 1, outcome: 'LOST' }]);
	expect(await reverse(1)).toMatchObject({ ok: true });
	expect(hasIncident(id)).toBe(1);
	expect(await reverse(1)).toMatchObject({ ok: false });
	expect(stock(CHAIR)).toBe(500);
	expect(await reverse(2)).toMatchObject({ ok: true });
	expect(hasIncident(id)).toBe(0);
	expect((await listIncidents(db, id, manager)).map((incident) => incident.id)).toEqual([2, 1]);
});

test('a reversal needs a reason', async () => {
	const id = await createOrderIn('DELIVERED');
	await report(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }]);
	const result = await reverseIncident(db, { id: '1', reason: '  ' }, manager);
	expect(result).toMatchObject({ ok: false, errors: { reason: expect.any(String) } });
	expect(hasIncident(id)).toBe(1);
});

test('the responsible party: changed on an active incident, logged, a save with no change logs nothing', async () => {
	const id = await createOrderIn('DELIVERED');
	await report(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }]);
	const set = (party: string) =>
		setResponsibleParty(db, { id: '1', responsible_party: party }, manager);
	expect(await set('CARRIER')).toEqual({ ok: true, id: 1 });
	expect(await set('CARRIER')).toEqual({ ok: true, id: 1 });
	expect(await set('NEIGHBOR')).toMatchObject({ ok: false });
	expect(events('INCIDENT', 'EDITED')).toEqual([
		{
			entityId: 1,
			actor: 'gerente',
			before: { responsible_party: 'UNDETERMINED' },
			after: { responsible_party: 'CARRIER' }
		}
	]);
	await reverse(1);
	expect(await set('CLIENT')).toMatchObject({ ok: false });
	expect((await listIncidents(db, id, manager))[0].responsibleParty).toBe('CARRIER');
});

test('SALES, WAREHOUSE and DRIVER get a 403 reversing, changing the responsible party or listing', async () => {
	const id = await createOrderIn('DELIVERED');
	await report(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }]);
	for (const role of ['SALES', 'WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const actor: Actor = { ...sales, roles: [role] };
		const refusals = await Promise.all([
			reverse(1, actor).catch((caught: unknown) => caught),
			setResponsibleParty(db, { id: 1, responsible_party: 'CLIENT' }, actor).catch(
				(caught: unknown) => caught
			),
			listIncidents(db, id, actor).catch((caught: unknown) => caught)
		]);
		for (const refusal of refusals) {
			expect(isHttpError(refusal, 403)).toBe(true);
		}
	}
	expect(hasIncident(id)).toBe(1);
});
