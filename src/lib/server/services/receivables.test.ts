import { isHttpError } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { getCashBook, getReceipt, recordOffset } from './cash';
import { getOrderTimeline, MODIFIED_AFTER_STAGING_AT } from './orders';
import {
	getReceivableDetail,
	getReceivableEditForm,
	getReceivableIssueForm,
	getReceivablePrintout,
	issueReceivable,
	listReceivables,
	receivableAttributesSchema,
	recordReceivablePayment,
	updateReceivable
} from './receivables';

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

type OrderSeed = { clientId?: number; status?: string; attributes?: string; total?: number };

function insertOrder(id: number, seed: OrderSeed = {}) {
	const { clientId = POSTOBON, status = 'COMPLETED', attributes = '{}', total = 0 } = seed;
	database.exec(
		`insert into orders (id, public_token, client_id, status, event_date, delivery_date, pickup_date, rental_days, client_attributes, delivery_attributes, pickup_attributes, order_items, items_total, order_total, attributes, created_at, created_by, updated_at, updated_by)
		values (${id}, 'token-${id}', ${clientId}, '${status}', '2026-10-10', '2026-10-09', '2026-10-11', 2, '{}', '{"method":"COMPANY_DELIVERY"}', '{"method":"COMPANY_PICKUP"}', '[]', ${total}, ${total}, '${attributes}', ${AUDIT})`
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

type MovementSeed = {
	concept?: string;
	amount: number;
	entityType?: string;
	entityId: number;
	date?: string;
	reversesId?: number;
};

let nextMovementId = 1;

function insertMovement(seed: MovementSeed): number {
	const { concept = 'INSTALLMENT', amount, entityType = 'ORDER', entityId } = seed;
	const { date = '2026-11-01', reversesId = null } = seed;
	const id = nextMovementId++;
	database.exec(
		`insert into cash_movements (id, concept, payment_method, amount, movement_date, entity_type, entity_id, payee, reverses_id, receipt_number, created_at, created_by, updated_at, updated_by)
		values (${id}, '${concept}', 'CASH', ${amount}, '${date}', '${entityType}', ${entityId}, 'Postobón S.A.', ${reversesId}, ${id}, ${AUDIT})`
	);
	return id;
}

async function detailOf(id: number) {
	const detail = await getReceivableDetail(db, id, manager);
	if (null === detail) {
		throw new Error(`No receivable ${id}`);
	}
	return detail;
}

// Two orders of $860.000 and $500.000, billed together.
async function billedPair(): Promise<number> {
	insertOrder(1070, { total: 860000 });
	insertOrder(1071, { total: 500000 });
	return issued([1070, 1071]);
}

// The clock on Sunday 1 November 2026, 10:00 a.m. in Bogotá.
const NOVEMBER_1 = new Date('2026-11-01T15:00:00Z');

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOVEMBER_1);
	nextMovementId = 1;
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

test("the balance is the orders' total less their advance and the cuenta's payment", async () => {
	const id = await billedPair();
	insertMovement({ amount: 100000, entityId: 1070 });
	insertMovement({ amount: 600000, entityType: 'RECEIVABLE', entityId: id });
	expect(await detailOf(id)).toMatchObject({ total: 1360000, paid: 700000, balance: 660000 });
});

test("an offset cancels the cuenta's payment, and an order's refund counts", async () => {
	const id = await billedPair();
	const payment = insertMovement({ amount: 600000, entityType: 'RECEIVABLE', entityId: id });
	insertMovement({ amount: -600000, entityType: 'RECEIVABLE', entityId: id, reversesId: payment });
	expect((await detailOf(id)).balance).toBe(1360000);
	insertMovement({ amount: 100000, entityId: 1070 });
	insertMovement({ concept: 'INSTALLMENT_REFUND', amount: -40000, entityId: 1070 });
	expect((await detailOf(id)).balance).toBe(1300000);
});

test('deposits and carrier payments stay out of the balance and the payments', async () => {
	const id = await billedPair();
	insertMovement({ concept: 'SECURITY_DEPOSIT', amount: 200000, entityId: 1070 });
	insertMovement({ concept: 'DEPOSIT_REFUND', amount: -200000, entityId: 1070 });
	insertMovement({ concept: 'CARRIER_PAYMENT', amount: -50000, entityId: 1071 });
	expect(await detailOf(id)).toMatchObject({ paid: 0, balance: 1360000, payments: [] });
});

test("another order's payments and another cuenta's stay out", async () => {
	const id = await billedPair();
	const other = await issued([1060]);
	insertMovement({ amount: 100000, entityId: 1061 });
	insertMovement({ amount: 100000, entityId: 1060 });
	insertMovement({ amount: 100000, entityType: 'RECEIVABLE', entityId: other });
	expect((await detailOf(id)).paid).toBe(0);
});

test("paying over the total leaves a negative balance, the client's credit", async () => {
	const id = await billedPair();
	insertMovement({ amount: 1410000, entityType: 'RECEIVABLE', entityId: id });
	expect((await detailOf(id)).balance).toBe(-50000);
});

test('the balance follows an order leaving the cuenta, its advance with it', async () => {
	const id = await billedPair();
	insertMovement({ amount: 100000, entityId: 1071 });
	await edit(id, [1070]);
	expect(await detailOf(id)).toMatchObject({ total: 860000, paid: 0, balance: 860000 });
});

test("the payments go oldest first, an order's marked with it, the cuenta's with none", async () => {
	const id = await billedPair();
	insertMovement({ amount: 600000, entityType: 'RECEIVABLE', entityId: id, date: '2026-10-30' });
	insertMovement({ amount: 100000, entityId: 1070, date: '2026-10-06' });
	const { payments } = await detailOf(id);
	expect(payments).toMatchObject([
		{ amount: 100000, movementDate: '2026-10-06', orderId: 1070, concept: 'INSTALLMENT' },
		{ amount: 600000, movementDate: '2026-10-30', orderId: null, concept: 'INSTALLMENT' }
	]);
});

test('the detail carries its fields and orders, and hides an automatic document', async () => {
	const id = await billedPair();
	expect(await detailOf(id)).toMatchObject({
		id,
		issueDate: '2026-11-01',
		paymentTerms: 'Contado',
		client: { name: 'Postobón S.A.', phone: '573000000001', documentId: null },
		orders: [
			{ id: 1070, eventDate: '2026-10-10', orderTotal: 860000 },
			{ id: 1071, eventDate: '2026-10-10', orderTotal: 500000 }
		]
	});
	database.exec(`update contacts set document_id = '8909039395' where id = ${POSTOBON}`);
	expect((await detailOf(id)).client.documentId).toBe('8909039395');
});

test('a cuenta that does not exist, or a tampered id, reads as none', async () => {
	expect(await getReceivableDetail(db, 4794, manager)).toBeNull();
	expect(await getReceivableDetail(db, 'abc', manager)).toBeNull();
});

test('SALES, WAREHOUSE and DRIVER get a 403 reading the detail; MANAGER passes', async () => {
	const id = await issued([1043]);
	for (const actor of [sales, warehouse, driver]) {
		const caught = await getReceivableDetail(db, id, actor).catch((error) => error);
		expect(isHttpError(caught, 403), actor.username).toBe(true);
	}
	expect((await detailOf(id)).id).toBe(id);
});

async function listIds(input: Record<string, string> = {}): Promise<number[]> {
	return (await listReceivables(db, input, manager)).receivables.map(({ id }) => id);
}

// Postobón's cuenta, then Luz Marina's: $500.000 each.
async function issuedForTwoClients(): Promise<[number, number]> {
	insertOrder(2001, { total: 500000 });
	insertOrder(2002, { clientId: LUZ_MARINA, total: 500000 });
	return [await issued([2001]), await issued([2002])];
}

test('the list goes newest first, with the client, date, total and balance of each', async () => {
	const [postobon, luzMarina] = await issuedForTwoClients();
	insertMovement({ amount: 200000, entityType: 'RECEIVABLE', entityId: postobon });
	const page = await listReceivables(db, {}, manager);
	expect(page.receivables.map(({ id }) => id)).toEqual([luzMarina, postobon]);
	expect(page.total).toBe(2);
	expect(page.receivables[1]).toEqual({
		id: postobon,
		clientName: 'Postobón S.A.',
		issueDate: '2026-11-01',
		total: 500000,
		balance: 300000
	});
});

test('?texto= finds the contact by a name in another word order, or digits of the phone', async () => {
	const [postobon, luzMarina] = await issuedForTwoClients();
	expect(await listIds({ text: 'restrepo LUZ' })).toEqual([luzMarina]);
	expect(await listIds({ text: 'postobon' })).toEqual([postobon]);
	expect(await listIds({ text: '002' })).toEqual([luzMarina]);
	expect(await listIds({ text: 'Betancur' })).toEqual([]);
});

test('?pendiente=1 keeps a balance above 0, leaving out the paid and the credit', async () => {
	const [paid, pending] = await issuedForTwoClients();
	insertOrder(2003, { total: 500000 });
	const credit = await issued([2003]);
	insertMovement({ amount: 500000, entityType: 'RECEIVABLE', entityId: paid });
	insertMovement({ amount: 600000, entityType: 'RECEIVABLE', entityId: credit });
	expect(await listIds({ hasBalance: '1' })).toEqual([pending]);
	expect(await listIds()).toEqual([credit, pending, paid]);
});

test('the filters combine', async () => {
	const [postobon, luzMarina] = await issuedForTwoClients();
	insertMovement({ amount: 500000, entityType: 'RECEIVABLE', entityId: postobon });
	expect(await listIds({ text: 'postobon', hasBalance: '1' })).toEqual([]);
	expect(await listIds({ text: 'luz', hasBalance: '1' })).toEqual([luzMarina]);
});

test('the list pages 20 at a time, in SQL, and a page past the last shows the last', async () => {
	for (let i = 0; i < 23; i++) {
		insertOrder(3000 + i);
		await issued([3000 + i]);
	}
	const first = await listReceivables(db, {}, manager);
	expect(first).toMatchObject({ total: 23, pageCount: 2, filters: { page: 1 } });
	expect(first.receivables).toHaveLength(20);
	const beyond = await listReceivables(db, { page: '9' }, manager);
	expect(beyond.filters.page).toBe(2);
	expect(beyond.receivables).toHaveLength(3);
	expect((await listReceivables(db, { page: 'dos' }, manager)).filters.page).toBe(1);
});

test('an empty list has one page', async () => {
	expect(await listReceivables(db, {}, manager)).toMatchObject({
		receivables: [],
		total: 0,
		pageCount: 1
	});
});

test('SALES, WAREHOUSE and DRIVER get a 403 on the list', async () => {
	for (const actor of [sales, warehouse, driver]) {
		const caught = await listReceivables(db, {}, actor).catch((error) => error);
		expect(isHttpError(caught, 403), actor.username).toBe(true);
	}
});

test('the issue form lists the client eligible orders with the starting one checked', async () => {
	insertOrder(1070, { total: 360000 });
	insertOrder(1071, { status: 'DELIVERED' });
	insertOrder(1072, { clientId: LUZ_MARINA });
	await issued([1043]);

	const form = await getReceivableIssueForm(db, '1061', manager);

	expect(form?.orders.map(({ id }) => id)).toEqual([1060, 1061, 1070]);
	expect(form?.orders[2]).toEqual({ id: 1070, eventDate: '2026-10-10', orderTotal: 360000 });
	expect(form?.checkedOrderIds).toEqual([1061]);
	expect(form?.paymentTerms).toBe('Contado');
	expect(form?.client.name).toBe('Postobón S.A.');
	expect(form?.client.documentId).toBeNull();
});

test('an order that cannot start a cuenta has no issue form', async () => {
	insertOrder(1070, { status: 'DELIVERED' });
	insertOrder(1071, { status: 'OUT_FOR_PICKUP' });
	await issued([1043]);

	for (const orderId of [1043, 1070, 1071, 99, null, '', 'abc']) {
		expect(await getReceivableIssueForm(db, orderId, manager), String(orderId)).toBeNull();
	}
});

test('the edit form checks the cuenta orders and leaves the other eligible ones unchecked', async () => {
	insertOrder(1070);
	await issued([1070]);
	const id = await issued([1043, 1060]);
	await edit(id, [1043, 1060], 'Crédito 30 días');

	const form = await getReceivableEditForm(db, id, manager);

	expect(form?.orders.map((order) => order.id)).toEqual([1043, 1060, 1061]);
	expect(form?.checkedOrderIds).toEqual([1043, 1060]);
	expect(form?.paymentTerms).toBe('Crédito 30 días');
	expect(await getReceivableEditForm(db, 99, manager)).toBeNull();
});

test('only ADMIN and MANAGER read the form', async () => {
	for (const actor of [sales, warehouse, driver]) {
		for (const read of [getReceivableIssueForm, getReceivableEditForm]) {
			const caught = await read(db, 1, actor).catch((error) => error);
			expect(isHttpError(caught, 403), actor.username).toBe(true);
		}
	}
});

function typedPayment(id: number, fields: Record<string, string> = {}) {
	return {
		id: String(id),
		payment_method: 'CASH',
		amount: '$600.000',
		movement_date: '2026-11-01',
		notes: '',
		...fields
	};
}

async function paid(id: number, fields?: Record<string, string>): Promise<number> {
	const result = await recordReceivablePayment(db, typedPayment(id, fields), manager);
	if (!result.ok) {
		throw new Error(JSON.stringify(result));
	}
	return result.id;
}

function readMovement(id: number) {
	return database.prepare('select * from cash_movements where id = ?').get(id);
}

test('a payment links the cuenta as an INSTALLMENT, whatever concept is posted, and counts', async () => {
	const id = await billedPair();
	const movementId = await paid(id, { concept: 'INSTALLMENT_REFUND' });
	expect(readMovement(movementId)).toMatchObject({
		concept: 'INSTALLMENT',
		amount: 600000,
		entity_type: 'RECEIVABLE',
		entity_id: id,
		created_by: 'gerente'
	});
	expect((await detailOf(id)).balance).toBe(760000);
});

test("payee is the client's name when recorded: a later rename leaves it", async () => {
	const id = await billedPair();
	const movementId = await paid(id);
	database.exec(`update contacts set full_name = 'Otro nombre' where id = ${POSTOBON}`);
	expect(readMovement(movementId)).toMatchObject({ payee: 'Postobón S.A.' });
});

test('an amount above the balance saves, and leaves the client a credit', async () => {
	const id = await billedPair();
	await paid(id, { amount: '$1.410.000' });
	expect((await detailOf(id)).balance).toBe(-50000);
});

test("a payment takes the entry's checks, and a cuenta that exists", async () => {
	const id = await billedPair();
	const transfer = typedPayment(id, { payment_method: 'TRANSFER' });
	expect(await recordReceivablePayment(db, transfer, manager)).toMatchObject({
		ok: false,
		errors: { bank_account: 'Escribe el banco' }
	});
	expect(await recordReceivablePayment(db, typedPayment(99), manager)).toMatchObject({ ok: false });
});

test('only MANAGER and ADMIN record a payment on a cuenta', async () => {
	const id = await billedPair();
	for (const actor of [sales, warehouse, driver]) {
		const caught = await recordReceivablePayment(db, typedPayment(id), actor).catch(
			(error) => error
		);
		expect(isHttpError(caught, 403), actor.username).toBe(true);
	}
	const admin: Actor = { ...manager, roles: ['ADMIN'] };
	expect(await recordReceivablePayment(db, typedPayment(id), admin)).toMatchObject({ ok: true });
});

test("the cash book links a cuenta's movement, found by its client and not by «Pedido»", async () => {
	const id = await billedPair();
	const movementId = await paid(id);
	const period = { from: '2026-11-01', to: '2026-11-30' };
	const found = await getCashBook(db, { ...period, text: 'postobón' }, manager);
	expect(found.entries).toMatchObject([{ id: movementId, receivableId: id, orderId: null }]);
	const byOrder = await getCashBook(db, { ...period, order: '1070' }, manager);
	expect(byOrder.entries).toEqual([]);
});

test("a cuenta's receipt names its orders, for the manager and never for SALES", async () => {
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	const id = await billedPair();
	const movementId = await paid(id);
	expect(await getReceipt(db, movementId, manager)).toMatchObject({
		movement: { receivableId: id, orderId: null },
		receivableOrderIds: [1070, 1071]
	});
	const caught = await getReceipt(db, movementId, sales).catch((error) => error);
	expect(isHttpError(caught, 403)).toBe(true);
});

test("the cuenta's offsetting movement, made from Caja, keeps its link and cancels it", async () => {
	const id = await billedPair();
	const movementId = await paid(id);
	const result = await recordOffset(
		db,
		{
			reverses_id: String(movementId),
			payment_method: 'CASH',
			movement_date: '2026-11-01'
		},
		manager
	);
	if (!result.ok) {
		throw new Error(JSON.stringify(result));
	}
	expect(readMovement(result.id)).toMatchObject({
		concept: 'INSTALLMENT',
		amount: -600000,
		entity_type: 'RECEIVABLE',
		entity_id: id,
		reverses_id: movementId
	});
	expect((await detailOf(id)).balance).toBe(1360000);
});

test('the printout reads the client live, and each order with its lines, by number', async () => {
	const lines = JSON.stringify([
		{ product_id: 1, name: 'Silla', qty: 2, list_price: 10, unit_price: 10, line_total: 20 }
	]);
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	insertOrder(1071, { total: 500 });
	insertOrder(1070, { total: 300 });
	database.exec(`update orders set order_items = '${lines}'`);
	const id = await issued([1071, 1070]);
	database.exec(
		`update contacts set full_name = 'Postobón S.A.', document_id = '8909039395',
		attributes = '{"address_1":"Calle 52","address_2":"Medellín"}' where id = ${POSTOBON}`
	);
	const printout = await getReceivablePrintout(db, id, manager);
	expect(printout?.client).toMatchObject({
		name: 'Postobón S.A.',
		documentId: '8909039395',
		address: 'Calle 52, Medellín'
	});
	expect(printout?.orders.map((order) => order.id)).toEqual([1070, 1071]);
	expect(printout?.orders[0].items[0].name).toBe('Silla');
	expect(printout?.total).toBe(800);
});

test('the printout of a cuenta that does not exist is null, and SALES is refused', async () => {
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	expect(await getReceivablePrintout(db, 999, manager)).toBeNull();
	await expect(getReceivablePrintout(db, 999, sales)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 403)
	);
});
