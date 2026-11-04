import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { getOrderTimeline, MODIFIED_AFTER_STAGING_AT } from './orders';
import { issueReceivable, receivableAttributesSchema, updateReceivable } from './receivables';

const manager: Actor = { username: 'gerente', employeeId: null, roles: ['MANAGER'], kind: 'user' };
const sales: Actor = { ...manager, username: 'ventas', roles: ['SALES'] };
const warehouse: Actor = { ...manager, username: 'bodega', roles: ['WAREHOUSE'] };
const driver: Actor = { ...manager, username: 'conductor', roles: ['DRIVER'] };

const AUDIT = "0, 'admin', 0, 'admin'";
const POSTOBON = 1;
const LUZ_MARINA = 2;

let db: D1Database;
let database: DatabaseSync;

function insertContact(id: number, fullName: string) {
	database.exec(
		`insert into contacts (id, phone, full_name, document_id, created_at, created_by, updated_at, updated_by)
		values (${id}, '57300000000${id}', '${fullName}', '@${id}', ${AUDIT})`
	);
}

type OrderSeed = { clientId?: number; status?: string; attributes?: string };

function insertOrder(id: number, seed: OrderSeed = {}) {
	const { clientId = POSTOBON, status = 'COMPLETED', attributes = '{}' } = seed;
	database.exec(
		`insert into orders (id, public_token, client_id, status, event_date, delivery_date, pickup_date, rental_days, client_attributes, delivery_attributes, pickup_attributes, order_items, items_total, order_total, attributes, created_at, created_by, updated_at, updated_by)
		values (${id}, 'token-${id}', ${clientId}, '${status}', '2026-10-10', '2026-10-09', '2026-10-11', 2, '{}', '{"method":"COMPANY_DELIVERY"}', '{"method":"COMPANY_PICKUP"}', '[]', 0, 0, '${attributes}', ${AUDIT})`
	);
}

function issue(orders: unknown[], paymentTerms = 'Contado') {
	return issueReceivable(db, { orders, payment_terms: paymentTerms }, manager);
}

async function issued(orders: number[]): Promise<number> {
	const result = await issue(orders);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.id;
}

function edit(id: number, orders: unknown[], paymentTerms = 'Contado') {
	return updateReceivable(db, { id, orders, payment_terms: paymentTerms }, manager);
}

function linkOf(orderId: number) {
	const row = database.prepare('select receivable_id from orders where id = ?').get(orderId);
	return row?.receivable_id;
}

function readReceivable(id: number) {
	return database.prepare('select * from receivables where id = ?').get(id);
}

function events(entityType: string, action?: string) {
	const rows = database
		.prepare('select * from events where entity_type = ? order by id')
		.all(entityType)
		.filter((row) => undefined === action || action === row.action);
	return rows.map((row) => ({
		...row,
		before: JSON.parse(String(row.before)),
		after: JSON.parse(String(row.after))
	}));
}

// The clock on Sunday 1 November 2026, 10:00 a.m. in Bogotá.
const NOVEMBER_1 = new Date('2026-11-01T15:00:00Z');

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOVEMBER_1);
	({ db, database } = createMemoryD1());
	insertContact(POSTOBON, 'Postobón S.A.');
	insertContact(LUZ_MARINA, 'Luz Marina Restrepo');
	insertOrder(1043);
	insertOrder(1060);
	insertOrder(1061);
});

afterEach(() => {
	vi.useRealTimers();
});

test('issuing links every checked order to the new cuenta and stores its fields', async () => {
	const id = await issued([1043, 1060]);
	expect(linkOf(1043)).toBe(id);
	expect(linkOf(1060)).toBe(id);
	expect(linkOf(1061)).toBeNull();
	expect(readReceivable(id)).toMatchObject({
		client_id: POSTOBON,
		issue_date: '2026-11-01',
		attributes: '{"payment_terms":"Contado"}',
		created_by: 'gerente',
		updated_by: 'gerente'
	});
});

test('the number continues the sequence, and the orders still find it', async () => {
	database.exec("insert into sqlite_sequence (name, seq) values ('receivables', 4793)");
	expect(await issued([1043])).toBe(4794);
	expect(linkOf(1043)).toBe(4794);
});

test("the issue date is Bogotá's: 11:30 p.m. on 30 November, already December in UTC", async () => {
	vi.setSystemTime(new Date('2026-12-01T04:30:00Z'));
	const id = await issued([1043]);
	expect(readReceivable(id)?.issue_date).toBe('2026-11-30');
});

test('an extension bills with its original once COMPLETED', async () => {
	insertOrder(1070, { attributes: '{"parent_order_id":1043}' });
	const id = await issued([1043, 1070]);
	expect(linkOf(1070)).toBe(id);
});

test('an order checked twice joins once', async () => {
	await issued([1043, 1043]);
	expect(events('ORDER', 'RECEIVABLE_LINKED')).toHaveLength(1);
});

const NOT_ELIGIBLE_ORDERS: [string, number, OrderSeed | null][] = [
	["that doesn't exist", 9999, null],
	["of another client's", 1100, { clientId: LUZ_MARINA }],
	['DELIVERED', 1101, { status: 'DELIVERED' }],
	['OUT_FOR_PICKUP', 1102, { status: 'OUT_FOR_PICKUP' }]
];

test.each(NOT_ELIGIBLE_ORDERS)('issuing with an order %s is refused', async (_, id, seed) => {
	if (null !== seed) {
		insertOrder(id, seed);
	}
	const result = await issue([1043, id]);
	expect(result).toMatchObject({ ok: false, errors: { orders: expect.any(String) } });
	expect(linkOf(1043)).toBeNull();
	expect(events('RECEIVABLE')).toHaveLength(0);
});

test.each(NOT_ELIGIBLE_ORDERS)('editing with an order %s is refused', async (_, id, seed) => {
	if (null !== seed) {
		insertOrder(id, seed);
	}
	const receivable = await issued([1043]);
	expect(await edit(receivable, [1043, id])).toMatchObject({ ok: false });
	expect(events('RECEIVABLE')).toHaveLength(1);
});

test('issuing starting from an order that does not exist or is not COMPLETED is refused', async () => {
	insertOrder(1101, { status: 'DELIVERED' });
	expect(await issue([9999, 1043])).toMatchObject({ ok: false });
	expect(await issue([1101, 1043])).toMatchObject({ ok: false });
	expect(linkOf(1043)).toBeNull();
});

test('a stale form that checks an order billed meanwhile is refused, on issue and on edit', async () => {
	const first = await issued([1043]);
	const second = await issued([1060]);
	expect(await issue([1043, 1061])).toMatchObject({ ok: false });
	expect(await edit(second, [1060, 1043])).toMatchObject({ ok: false });
	expect(linkOf(1043)).toBe(first);
	expect(linkOf(1061)).toBeNull();
});

test('a cuenta always has an order: an empty checklist is refused with a message', async () => {
	expect(await issue([])).toMatchObject({ ok: false, errors: { orders: expect.any(String) } });
	const id = await issued([1043]);
	expect(await edit(id, [])).toMatchObject({ ok: false, errors: { orders: expect.any(String) } });
	expect(linkOf(1043)).toBe(id);
});

test('a blank «Forma de pago» is refused on its field', async () => {
	const errors = { payment_terms: 'Escribe la forma de pago' };
	expect(await issue([1043], '   ')).toMatchObject({ ok: false, errors });
	const id = await issued([1043]);
	expect(await edit(id, [1043], '')).toMatchObject({ ok: false, errors });
});

test('attributes hold payment_terms and no other key', () => {
	const parse = (attributes: unknown) => receivableAttributesSchema.safeParse(attributes).success;
	expect(parse({ payment_terms: 'Crédito 30 días' })).toBe(true);
	expect(parse({ payment_terms: 'Contado', total: 1 })).toBe(false);
	expect(parse({})).toBe(false);
});

test('editing adds an order and removes another, keeping number, client and issue date', async () => {
	const id = await issued([1043, 1060]);
	vi.setSystemTime(new Date('2026-11-20T15:00:00Z'));
	expect(await edit(id, [1043, 1061])).toEqual({ ok: true, id });
	expect(linkOf(1043)).toBe(id);
	expect(linkOf(1060)).toBeNull();
	expect(linkOf(1061)).toBe(id);
	expect(readReceivable(id)).toMatchObject({ client_id: POSTOBON, issue_date: '2026-11-01' });
});

test('an order left out of a cuenta can be billed again', async () => {
	const id = await issued([1043, 1060]);
	await edit(id, [1043]);
	const second = await issued([1060]);
	expect(linkOf(1060)).toBe(second);
});

test('editing a cuenta that does not exist is refused', async () => {
	expect(await edit(9999, [1043])).toMatchObject({ ok: false });
	expect(linkOf(1043)).toBeNull();
});

test('issuing logs CREATED with the order ids and payment_terms', async () => {
	const id = await issued([1060, 1043]);
	const [created] = events('RECEIVABLE');
	expect(created).toMatchObject({ entity_id: id, action: 'CREATED', actor_username: 'gerente' });
	expect(created.after).toMatchObject({
		order_ids: '[1043,1060]',
		attributes: '{"payment_terms":"Contado"}'
	});
});

test('each order joining logs RECEIVABLE_LINKED with the cuenta', async () => {
	const id = await issued([1043, 1060]);
	expect(events('ORDER', 'RECEIVABLE_LINKED')).toMatchObject([
		{ entity_id: 1043, before: { receivable_id: null }, after: { receivable_id: id } },
		{ entity_id: 1060, before: { receivable_id: null }, after: { receivable_id: id } }
	]);
});

test('editing logs only what changed, and each order that joined or left', async () => {
	const id = await issued([1043, 1060]);
	await edit(id, [1043, 1061]);
	const edited = events('RECEIVABLE', 'EDITED');
	expect(edited).toHaveLength(1);
	expect(edited[0].before).toEqual({ order_ids: '[1043,1060]' });
	expect(edited[0].after).toEqual({ order_ids: '[1043,1061]' });
	expect(events('ORDER', 'RECEIVABLE_UNLINKED')).toMatchObject([
		{ entity_id: 1060, before: { receivable_id: id }, after: { receivable_id: null } }
	]);
	const joined = events('ORDER', 'RECEIVABLE_LINKED').at(-1);
	expect(joined).toMatchObject({ entity_id: 1061, after: { receivable_id: id } });
});

test('changing only «Forma de pago» logs just it and touches no order', async () => {
	const id = await issued([1043]);
	await edit(id, [1043], 'Crédito 30 días');
	const [edited] = events('RECEIVABLE', 'EDITED');
	expect(edited.before).toEqual({ 'attributes.payment_terms': 'Contado' });
	expect(edited.after).toEqual({ 'attributes.payment_terms': 'Crédito 30 días' });
	expect(events('ORDER')).toHaveLength(1);
});

test('a save with no change writes no event', async () => {
	const id = await issued([1043, 1060]);
	const before = readReceivable(id);
	expect(await edit(id, [1060, 1043])).toEqual({ ok: true, id });
	expect(events('RECEIVABLE')).toHaveLength(1);
	expect(events('ORDER')).toHaveLength(2);
	expect(readReceivable(id)).toEqual(before);
});

test('updated_by comes from the actor, on the cuenta and on its orders', async () => {
	const admin: Actor = { ...manager, username: 'admin2', roles: ['ADMIN'] };
	const id = await issued([1043]);
	const input = { id, orders: [1060], payment_terms: 'Contado' };
	expect(await updateReceivable(db, input, admin)).toEqual({ ok: true, id });
	expect(readReceivable(id)).toMatchObject({ created_by: 'gerente', updated_by: 'admin2' });
	const order = database.prepare('select updated_by from orders where id = 1060').get();
	expect(order).toEqual({ updated_by: 'admin2' });
});

test('billing an order writes no ORDER EDITED and leaves it unmodified after staging', async () => {
	database.exec(
		`insert into events (entity_type, entity_id, action, actor_username, actor_kind, after, created_at)
		values ('ORDER', 1043, 'STATUS_CHANGED', 'bodega', 'user', '{"status":"PICKED"}', 0)`
	);
	const id = await issued([1043]);
	await edit(id, [1060]);
	expect(events('ORDER', 'EDITED')).toHaveLength(0);
	const row = database
		.prepare(`select ${MODIFIED_AFTER_STAGING_AT} as at from orders where id = 1043`)
		.get();
	expect(row).toEqual({ at: null });
});

test('the timeline names the cuenta an order joined and left, for those who see edits', async () => {
	const id = await issued([1043]);
	await edit(id, [1060]);
	const entries = await getOrderTimeline(db, 1043, manager);
	expect(entries).toMatchObject([
		{ action: 'RECEIVABLE_UNLINKED', receivableId: id },
		{ action: 'RECEIVABLE_LINKED', receivableId: id }
	]);
	expect(await getOrderTimeline(db, 1043, sales)).toHaveLength(2);
	expect(await getOrderTimeline(db, 1043, warehouse)).toEqual([]);
	expect(await getOrderTimeline(db, 1043, driver)).toEqual([]);
});

test('SALES gets a 403 issuing and editing; MANAGER passes', async () => {
	const id = await issued([1043]);
	const input = { orders: [1060], payment_terms: 'Contado' };
	const attempts = [
		issueReceivable(db, input, sales),
		updateReceivable(db, { ...input, id }, sales)
	];
	for (const attempt of attempts) {
		expect(isHttpError(await attempt.catch((caught) => caught), 403)).toBe(true);
	}
	expect(linkOf(1060)).toBeNull();
	expect(await updateReceivable(db, { ...input, id }, manager)).toEqual({ ok: true, id });
});
