import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ADMIN, createFixture, DRIVER, MANAGER, SALES, WAREHOUSE } from '../db/fixture';
import { getCashBook, getReceipt, recordOffset } from './cash';
import {
	cancelOrder,
	createExtension,
	getOrder,
	getOrderTimeline,
	MODIFIED_AFTER_STAGING_AT,
	type OrderStatus
} from './orders';
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

let db: D1Database;
let database: DatabaseSync;
let fixture: ReturnType<typeof createFixture>;

// Postobón came in as «Cliente nuevo», so its document is still the automatic one.
let POSTOBON: number;
let LUZ_MARINA: number;
// Three of Postobón's orders, none billed.
let ORDER_A: number;
let ORDER_B: number;
let ORDER_C: number;

const ADDRESS = 'Calle 10 # 43-12';

type OrderSeed = {
	clientId?: number;
	status?: OrderStatus;
	/** The order's total: one line of a product of its own, one day. */
	total?: number;
	[field: string]: unknown;
};

// An order of 9 to 11 October, its event on the 10th.
async function orderFor({
	clientId = POSTOBON,
	status = 'CONFIRMED',
	total = 10000,
	...fields
}: OrderSeed = {}): Promise<number> {
	const line = { product_id: await fixture.product(), qty: 1, unit_price: total };
	return fixture.order({
		client_id: clientId,
		status,
		event_date: '2026-10-10',
		delivery_date: '2026-10-09',
		pickup_date: '2026-10-11',
		order_items: [line],
		...fields
	});
}

function issue(orders: unknown[], paymentTerms = 'Contado') {
	return issueReceivable(db, { orders, payment_terms: paymentTerms }, MANAGER);
}

async function issued(orders: number[]): Promise<number> {
	const result = await issue(orders);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.id;
}

function edit(id: number, orders: unknown[], paymentTerms = 'Contado') {
	return updateReceivable(db, { id, orders, payment_terms: paymentTerms }, MANAGER);
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

// What billing writes on an order: the rest of its events are its own life's.
function receivableLinks() {
	return database
		.prepare(
			"select id from events where entity_type = 'ORDER' and action in ('RECEIVABLE_LINKED', 'RECEIVABLE_UNLINKED')"
		)
		.all();
}

async function cancel(orderId: number): Promise<void> {
	const result = await cancelOrder(db, { id: orderId, reason: 'El cliente canceló' }, MANAGER);
	if (!result.ok) {
		throw new Error(JSON.stringify(result));
	}
}

// Postobón's NIT: a contact whose document is still automatic can't be saved without it.
const REAL_DOCUMENT = { document_id: '8909039395' };

// A «Pago» on the order before it's billed: its advance.
async function advance(orderId: number, amount: string, fields: Record<string, string> = {}) {
	await fixture.payment(orderId, { amount, ...fields });
}

async function detailOf(id: number) {
	const detail = await getReceivableDetail(db, id, MANAGER);
	if (null === detail) {
		throw new Error(`No receivable ${id}`);
	}
	return detail;
}

// Two orders of $860.000 and $500.000.
async function orderPair(
	firstFields: OrderSeed = {},
	secondFields: OrderSeed = {}
): Promise<[number, number]> {
	return [
		await orderFor({ total: 860000, ...firstFields }),
		await orderFor({ total: 500000, ...secondFields })
	];
}

// The pair, billed together.
async function billedPair(firstFields: OrderSeed = {}, secondFields: OrderSeed = {}) {
	const [first, second] = await orderPair(firstFields, secondFields);
	return { id: await issued([first, second]), first, second };
}

// The clock on Sunday 1 November 2026, 10:00 a.m. in Bogotá.
const NOVEMBER_1 = new Date('2026-11-01T15:00:00Z');

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOVEMBER_1);
	fixture = createFixture();
	({ db, database } = fixture);
	// Its client_id overrides the default one, still unknown.
	ORDER_A = await orderFor({
		client_id: null,
		client_name: 'Postobón S.A.',
		client_phone: '310 442 8890'
	});
	POSTOBON = (await getOrder(db, ORDER_A, MANAGER))!.clientId;
	LUZ_MARINA = await fixture.contact({ full_name: 'Luz Marina Restrepo', phone: '315 777 0020' });
	ORDER_B = await orderFor();
	ORDER_C = await orderFor();
});

afterEach(() => {
	vi.useRealTimers();
});

test('issuing links every checked order to the new cuenta and stores its fields', async () => {
	const id = await issued([ORDER_A, ORDER_B]);
	expect(linkOf(ORDER_A)).toBe(id);
	expect(linkOf(ORDER_B)).toBe(id);
	expect(linkOf(ORDER_C)).toBeNull();
	expect(readReceivable(id)).toMatchObject({
		client_id: POSTOBON,
		issue_date: '2026-11-01',
		attributes: '{"payment_terms":"Contado"}',
		created_by: 'manager',
		updated_by: 'manager'
	});
});

test("the issue date is Bogotá's: 11:30 p.m. on 30 November, already December in UTC", async () => {
	vi.setSystemTime(new Date('2026-12-01T04:30:00Z'));
	const id = await issued([ORDER_A]);
	expect(readReceivable(id)?.issue_date).toBe('2026-11-30');
});

test('an extension bills with its original', async () => {
	const line = { product_id: await fixture.product(), qty: 1, unit_price: 10000 };
	const original = await orderFor({ status: 'DELIVERED', order_items: [line] });
	const extension = await createExtension(
		db,
		{
			client_id: POSTOBON,
			client_name: 'Postobón S.A.',
			event_date: '2026-10-10',
			pickup_date: '2026-10-14',
			rental_days: 1,
			delivery_attributes: { time: null, address_1: ADDRESS, method: 'COMPANY_DELIVERY' },
			pickup_attributes: { time: null, address_1: ADDRESS, method: 'COMPANY_PICKUP' },
			order_items: [line],
			discount: 0,
			transport_cost: 0,
			deposit_amount: 0,
			parent_order_id: original
		},
		SALES
	);
	if (!extension.ok) {
		throw new Error(JSON.stringify(extension));
	}
	const id = await issued([original, extension.id]);
	expect(linkOf(extension.id)).toBe(id);
});

test('an order checked twice joins once', async () => {
	await issued([ORDER_A, ORDER_A]);
	expect(events('ORDER', 'RECEIVABLE_LINKED')).toHaveLength(1);
});

const NOT_ELIGIBLE_ORDERS: [string, () => Promise<number>][] = [
	["that doesn't exist", async () => 9999],
	["of another client's", () => orderFor({ clientId: LUZ_MARINA })],
	['CANCELLED', () => orderFor({ status: 'CANCELLED' })]
];

const BILLABLE_STATUSES: OrderStatus[] = [
	'CONFIRMED',
	'PICKED',
	'OUT_FOR_DELIVERY',
	'DELIVERED',
	'OUT_FOR_PICKUP',
	'COMPLETED'
];

test.each(BILLABLE_STATUSES)('a %s order is billed, on issue and on edit', async (status) => {
	const first = await orderFor({ status });
	const second = await orderFor({ status });
	expect(await getReceivableIssueForm(db, first, MANAGER)).not.toBeNull();
	const id = await issued([first]);
	expect(linkOf(first)).toBe(id);
	expect(await edit(id, [first, second])).toEqual({ ok: true, id });
	expect(linkOf(second)).toBe(id);
});

test.each(NOT_ELIGIBLE_ORDERS)('issuing with an order %s is refused', async (_, seed) => {
	const result = await issue([ORDER_A, await seed()]);
	expect(result).toMatchObject({ ok: false, errors: { orders: expect.any(String) } });
	expect(linkOf(ORDER_A)).toBeNull();
	expect(events('RECEIVABLE')).toHaveLength(0);
});

test.each(NOT_ELIGIBLE_ORDERS)('editing with an order %s is refused', async (_, seed) => {
	const orderId = await seed();
	const receivable = await issued([ORDER_A]);
	expect(await edit(receivable, [ORDER_A, orderId])).toMatchObject({ ok: false });
	expect(events('RECEIVABLE')).toHaveLength(1);
});

test('a partly paid CONFIRMED order starts a cuenta, is listed and billed, on issue and on edit', async () => {
	const first = await orderFor({ total: 500000 });
	const second = await orderFor({ total: 500000 });
	await advance(first, '100.000');
	await advance(second, '200.000');
	const form = await getReceivableIssueForm(db, first, MANAGER);
	expect(form?.orders.map(({ id }) => id)).toEqual([ORDER_A, ORDER_B, ORDER_C, first, second]);
	expect(form?.orders.find(({ id }) => first === id)).toEqual({
		id: first,
		eventDate: '2026-10-10',
		orderTotal: 500000,
		isCancelled: false
	});
	const id = await issued([ORDER_A, first]);
	expect(linkOf(first)).toBe(id);
	expect(await edit(id, [ORDER_A, first, second])).toEqual({ ok: true, id });
	expect(linkOf(second)).toBe(id);
});

test('an order partly paid before the cuenta stays in it', async () => {
	const [first, second] = await orderPair();
	await advance(first, '100.000');
	const id = await issued([first, second]);
	expect(await edit(id, [first, second], 'A 30 días')).toEqual({ ok: true, id });
});

test('issuing starting from an order that does not exist or is CANCELLED is refused', async () => {
	const cancelled = await orderFor({ status: 'CANCELLED' });
	expect(await issue([9999, ORDER_A])).toMatchObject({ ok: false });
	expect(await issue([cancelled, ORDER_A])).toMatchObject({ ok: false });
	expect(linkOf(ORDER_A)).toBeNull();
});

test('an order already in another cuenta, billed meanwhile, is refused on issue and on edit', async () => {
	const first = await issued([ORDER_A]);
	const second = await issued([ORDER_B]);
	expect(await issue([ORDER_A, ORDER_C])).toMatchObject({ ok: false });
	expect(await edit(second, [ORDER_B, ORDER_A])).toMatchObject({ ok: false });
	expect(linkOf(ORDER_A)).toBe(first);
	expect(linkOf(ORDER_C)).toBeNull();
});

test('a cuenta always has an order: an empty checklist is refused with a message', async () => {
	expect(await issue([])).toMatchObject({ ok: false, errors: { orders: expect.any(String) } });
	const id = await issued([ORDER_A]);
	expect(await edit(id, [])).toMatchObject({ ok: false, errors: { orders: expect.any(String) } });
	expect(linkOf(ORDER_A)).toBe(id);
});

test('a blank «Forma de pago» is refused on its field', async () => {
	const errors = { payment_terms: 'Escribe la forma de pago' };
	expect(await issue([ORDER_A], '   ')).toMatchObject({ ok: false, errors });
	const id = await issued([ORDER_A]);
	expect(await edit(id, [ORDER_A], '')).toMatchObject({ ok: false, errors });
});

test('attributes hold payment_terms and no other key', () => {
	const parse = (attributes: unknown) => receivableAttributesSchema.safeParse(attributes).success;
	expect(parse({ payment_terms: 'Crédito 30 días' })).toBe(true);
	expect(parse({ payment_terms: 'Contado', total: 1 })).toBe(false);
	expect(parse({})).toBe(false);
});

test('editing adds an order and removes another, keeping number, client and issue date', async () => {
	const id = await issued([ORDER_A, ORDER_B]);
	vi.setSystemTime(new Date('2026-11-20T15:00:00Z'));
	expect(await edit(id, [ORDER_A, ORDER_C])).toEqual({ ok: true, id });
	expect(linkOf(ORDER_A)).toBe(id);
	expect(linkOf(ORDER_B)).toBeNull();
	expect(linkOf(ORDER_C)).toBe(id);
	expect(readReceivable(id)).toMatchObject({ client_id: POSTOBON, issue_date: '2026-11-01' });
});

test('an order left out of a cuenta can be billed again', async () => {
	const id = await issued([ORDER_A, ORDER_B]);
	await edit(id, [ORDER_A]);
	const second = await issued([ORDER_B]);
	expect(linkOf(ORDER_B)).toBe(second);
});

test('editing a cuenta that does not exist is refused', async () => {
	expect(await edit(9999, [ORDER_A])).toMatchObject({ ok: false });
	expect(linkOf(ORDER_A)).toBeNull();
});

test('issuing logs CREATED with the order ids and payment_terms', async () => {
	const id = await issued([ORDER_B, ORDER_A]);
	const [created] = events('RECEIVABLE');
	expect(created).toMatchObject({ entity_id: id, action: 'CREATED', actor_username: 'manager' });
	expect(created.after).toMatchObject({
		order_ids: JSON.stringify([ORDER_A, ORDER_B]),
		attributes: '{"payment_terms":"Contado"}'
	});
});

test('each order joining logs RECEIVABLE_LINKED with the cuenta', async () => {
	const id = await issued([ORDER_A, ORDER_B]);
	expect(events('ORDER', 'RECEIVABLE_LINKED')).toMatchObject([
		{ entity_id: ORDER_A, before: { receivable_id: null }, after: { receivable_id: id } },
		{ entity_id: ORDER_B, before: { receivable_id: null }, after: { receivable_id: id } }
	]);
});

test('editing logs only what changed, and each order that joined or left', async () => {
	const id = await issued([ORDER_A, ORDER_B]);
	await edit(id, [ORDER_A, ORDER_C]);
	const edited = events('RECEIVABLE', 'EDITED');
	expect(edited).toHaveLength(1);
	expect(edited[0].before).toEqual({ order_ids: JSON.stringify([ORDER_A, ORDER_B]) });
	expect(edited[0].after).toEqual({ order_ids: JSON.stringify([ORDER_A, ORDER_C]) });
	expect(events('ORDER', 'RECEIVABLE_UNLINKED')).toMatchObject([
		{ entity_id: ORDER_B, before: { receivable_id: id }, after: { receivable_id: null } }
	]);
	const joined = events('ORDER', 'RECEIVABLE_LINKED').at(-1);
	expect(joined).toMatchObject({ entity_id: ORDER_C, after: { receivable_id: id } });
});

test('changing only «Forma de pago» logs just it and touches no order', async () => {
	const id = await issued([ORDER_A]);
	await edit(id, [ORDER_A], 'Crédito 30 días');
	const [edited] = events('RECEIVABLE', 'EDITED');
	expect(edited.before).toEqual({ 'attributes.payment_terms': 'Contado' });
	expect(edited.after).toEqual({ 'attributes.payment_terms': 'Crédito 30 días' });
	expect(receivableLinks()).toHaveLength(1);
});

test('a save with no change writes no event', async () => {
	const id = await issued([ORDER_A, ORDER_B]);
	const before = readReceivable(id);
	expect(await edit(id, [ORDER_B, ORDER_A])).toEqual({ ok: true, id });
	expect(events('RECEIVABLE')).toHaveLength(1);
	expect(receivableLinks()).toHaveLength(2);
	expect(readReceivable(id)).toEqual(before);
});

test('updated_by comes from the actor, on the cuenta and on its orders', async () => {
	const id = await issued([ORDER_A]);
	const input = { id, orders: [ORDER_B], payment_terms: 'Contado' };
	expect(await updateReceivable(db, input, ADMIN)).toEqual({ ok: true, id });
	expect(readReceivable(id)).toMatchObject({ created_by: 'manager', updated_by: 'admin' });
	const order = database.prepare('select updated_by from orders where id = ?').get(ORDER_B);
	expect(order).toEqual({ updated_by: 'admin' });
});

test('billing a PICKED order writes no ORDER EDITED and leaves it unmodified after staging', async () => {
	const picked = await orderFor({ status: 'PICKED' });
	const id = await issued([picked]);
	await edit(id, [ORDER_A]);
	expect(events('ORDER', 'EDITED')).toHaveLength(0);
	expect(events('ORDER', 'RECEIVABLE_LINKED')).toMatchObject([
		{ entity_id: picked },
		{ entity_id: ORDER_A }
	]);
	expect(events('ORDER', 'RECEIVABLE_UNLINKED')).toMatchObject([{ entity_id: picked }]);
	const row = database
		.prepare(`select ${MODIFIED_AFTER_STAGING_AT} as at from orders where id = ?`)
		.get(picked);
	expect(row).toEqual({ at: null });
});

test('the timeline names the cuenta an order joined and left, for those who see edits', async () => {
	const id = await issued([ORDER_A]);
	await edit(id, [ORDER_B]);
	const billing = async (actor: typeof MANAGER) =>
		((await getOrderTimeline(db, ORDER_A, actor)) ?? []).filter(({ action }) =>
			action.startsWith('RECEIVABLE_')
		);
	expect(await billing(MANAGER)).toMatchObject([
		{ action: 'RECEIVABLE_UNLINKED', receivableId: id },
		{ action: 'RECEIVABLE_LINKED', receivableId: id }
	]);
	expect(await billing(SALES)).toHaveLength(2);
	expect(await billing(WAREHOUSE)).toEqual([]);
	expect(await billing(DRIVER)).toEqual([]);
});

test('SALES issues and edits a cuenta; WAREHOUSE and DRIVER get a 403', async () => {
	const id = await issued([ORDER_A]);
	const input = { orders: [ORDER_B], payment_terms: 'Contado' };
	for (const actor of [WAREHOUSE, DRIVER]) {
		const attempts = [
			issueReceivable(db, input, actor),
			updateReceivable(db, { ...input, id }, actor)
		];
		for (const attempt of attempts) {
			const caught = await attempt.catch((error) => error);
			expect(isHttpError(caught, 403), actor.username).toBe(true);
		}
	}
	expect(linkOf(ORDER_B)).toBeNull();
	const own = await issueReceivable(db, input, SALES);
	expect(own).toMatchObject({ ok: true });
	expect(linkOf(ORDER_B)).toBe(own.ok ? own.id : null);
	const edited = { id, orders: [ORDER_A], payment_terms: 'Crédito 30 días' };
	expect(await updateReceivable(db, edited, SALES)).toEqual({ ok: true, id });
	expect(readReceivable(id)?.attributes).toContain('Crédito 30 días');
});

test("the balance is the orders' total less their advance and the cuenta's payment", async () => {
	const [first, second] = await orderPair();
	await advance(first, '100.000');
	const id = await issued([first, second]);
	expect(await detailOf(id)).toMatchObject({ total: 1360000, paid: 100000, balance: 1260000 });
	await paid(id, { amount: '$1.260.000' });
	expect(await detailOf(id)).toMatchObject({ total: 1360000, paid: 1360000, balance: 0 });
});

test("an offset cancels the cuenta's payment, and an order's refund counts", async () => {
	const [first, second] = await orderPair();
	await advance(first, '100.000');
	const id = await issued([first, second]);
	const payment = await paid(id, { amount: '$1.260.000' });
	const offset = { reverses_id: String(payment), payment_method: 'CASH' };
	await recordOffset(db, { ...offset, movement_date: '2026-11-01' }, MANAGER);
	expect((await detailOf(id)).balance).toBe(1260000);
	await fixture.payment(first, { concept: 'INSTALLMENT_REFUND', amount: '40.000' });
	expect((await detailOf(id)).balance).toBe(1300000);
});

test('deposits and carrier payments stay out of the balance and the payments', async () => {
	const carrier = await fixture.contact({ labels: ['TRANSPORTER'] });
	const delivery = {
		time: null,
		address_1: ADDRESS,
		method: 'EXTERNAL_CARRIER',
		carrier_id: carrier
	};
	const { id, first, second } = await billedPair(
		{ deposit_amount: 200000 },
		{ delivery_attributes: delivery }
	);
	await fixture.payment(first, { concept: 'SECURITY_DEPOSIT', amount: '200.000' });
	await fixture.payment(first, { concept: 'DEPOSIT_REFUND', amount: '200.000' });
	await fixture.payment(second, { concept: 'CARRIER_PAYMENT', amount: '50.000' });
	expect(await detailOf(id)).toMatchObject({ paid: 0, balance: 1360000, payments: [] });
});

test("another order's payments and another cuenta's stay out", async () => {
	const { id } = await billedPair();
	const otherOrder = await orderFor({ total: 500000 });
	await advance(otherOrder, '100.000');
	const other = await issued([otherOrder]);
	await paid(other, { amount: '$400.000' });
	await advance(ORDER_C, '100.000');
	expect((await detailOf(id)).paid).toBe(0);
});

test("paying over the total leaves a negative balance, the client's credit", async () => {
	const [first, second] = await orderPair();
	await advance(first, '900.000');
	await advance(second, '510.000');
	const id = await issued([first, second]);
	expect((await detailOf(id)).balance).toBe(-50000);
});

test('the balance follows an order leaving the cuenta, its advance with it', async () => {
	const [first, second] = await orderPair();
	await advance(second, '100.000');
	const id = await issued([first, second]);
	await edit(id, [first]);
	expect(await detailOf(id)).toMatchObject({ total: 860000, paid: 0, balance: 860000 });
});

test("the payments go oldest first, an order's marked with it, the cuenta's with none", async () => {
	const [first, second] = await orderPair();
	await advance(first, '100.000', { movement_date: '2026-10-06' });
	const id = await issued([first, second]);
	await paid(id, { amount: '$1.260.000', movement_date: '2026-10-30' });
	const { payments } = await detailOf(id);
	expect(payments).toMatchObject([
		{ amount: 100000, movementDate: '2026-10-06', orderId: first, concept: 'INSTALLMENT' },
		{ amount: 1260000, movementDate: '2026-10-30', orderId: null, concept: 'INSTALLMENT' }
	]);
});

test('the detail carries its fields and orders, and hides an automatic document', async () => {
	const { id, first, second } = await billedPair();
	expect(await detailOf(id)).toMatchObject({
		id,
		issueDate: '2026-11-01',
		paymentTerms: 'Contado',
		client: { name: 'Postobón S.A.', phone: '573104428890', whatsapp: null, documentId: null },
		orders: [
			{ id: first, eventDate: '2026-10-10', orderTotal: 860000 },
			{ id: second, eventDate: '2026-10-10', orderTotal: 500000 }
		]
	});
	await fixture.editContact(POSTOBON, { document_id: '8909039395' });
	expect((await detailOf(id)).client.documentId).toBe('8909039395');
});

test("the detail reads the client's username live from the contact, phone or not", async () => {
	const { id } = await billedPair();
	await fixture.editContact(POSTOBON, { ...REAL_DOCUMENT, phone: '', whatsapp: 'PostobonSA' });
	expect((await detailOf(id)).client).toMatchObject({ phone: null, whatsapp: 'PostobonSA' });
});

test('a cuenta that does not exist, or a tampered id, reads as none', async () => {
	expect(await getReceivableDetail(db, 9999, MANAGER)).toBeNull();
	expect(await getReceivableDetail(db, 'abc', MANAGER)).toBeNull();
});

test('WAREHOUSE and DRIVER get a 403 reading the detail; SALES and MANAGER pass', async () => {
	const id = await issued([ORDER_A]);
	for (const actor of [WAREHOUSE, DRIVER]) {
		const caught = await getReceivableDetail(db, id, actor).catch((error) => error);
		expect(isHttpError(caught, 403), actor.username).toBe(true);
	}
	expect((await detailOf(id)).id).toBe(id);
	expect((await getReceivableDetail(db, id, SALES))?.id).toBe(id);
});

async function listIds(input: Record<string, string> = {}): Promise<number[]> {
	return (await listReceivables(db, input, MANAGER)).receivables.map(({ id }) => id);
}

// Postobón's cuenta, then Luz Marina's: $500.000 each.
async function issuedForTwoClients() {
	const postobonOrder = await orderFor({ total: 500000 });
	const luzMarinaOrder = await orderFor({ clientId: LUZ_MARINA, total: 500000 });
	const postobon = await issued([postobonOrder]);
	const luzMarina = await issued([luzMarinaOrder]);
	return { postobon, luzMarina, postobonOrder };
}

test('the list goes newest first, with the client, date, total and balance of each', async () => {
	const postobonOrder = await orderFor({ total: 500000 });
	await advance(postobonOrder, '200.000');
	const postobon = await issued([postobonOrder]);
	const luzMarina = await issued([await orderFor({ clientId: LUZ_MARINA, total: 500000 })]);
	const page = await listReceivables(db, {}, MANAGER);
	expect(page.receivables.map(({ id }) => id)).toEqual([luzMarina, postobon]);
	expect(page.total).toBe(2);
	expect(page.receivables[1]).toEqual({
		id: postobon,
		clientName: 'Postobón S.A.',
		issueDate: '2026-11-01',
		total: 500000,
		balance: 300000,
		isVoid: false
	});
});

test('?texto= finds the contact by a name in another word order, or digits of the phone', async () => {
	const { postobon, luzMarina } = await issuedForTwoClients();
	expect(await listIds({ text: 'restrepo LUZ' })).toEqual([luzMarina]);
	expect(await listIds({ text: 'postobon' })).toEqual([postobon]);
	expect(await listIds({ text: '002' })).toEqual([luzMarina]);
	expect(await listIds({ text: 'Betancur' })).toEqual([]);
});

test("?texto= with letters also finds the contact's username, without the @, ignoring case", async () => {
	const { postobon } = await issuedForTwoClients();
	await fixture.editContact(POSTOBON, { ...REAL_DOCUMENT, whatsapp: 'LuzMarinaR' });
	expect(await listIds({ text: 'luzma' })).toEqual([postobon]);
	expect(await listIds({ text: '@LUZMA' })).toEqual([postobon]);
});

test('?pendiente=1 keeps a balance above 0, leaving out the paid and the credit', async () => {
	const { postobon: isPaid, luzMarina: pending } = await issuedForTwoClients();
	const overpaid = await orderFor({ total: 500000 });
	await advance(overpaid, '600.000');
	const credit = await issued([overpaid]);
	await paid(isPaid, { amount: '$500.000' });
	expect(await listIds({ hasBalance: '1' })).toEqual([pending]);
	expect(await listIds()).toEqual([credit, pending, isPaid]);
});

test('the filters combine', async () => {
	const { postobon, luzMarina } = await issuedForTwoClients();
	await paid(postobon, { amount: '$500.000' });
	expect(await listIds({ text: 'postobon', hasBalance: '1' })).toEqual([]);
	expect(await listIds({ text: 'luz', hasBalance: '1' })).toEqual([luzMarina]);
});

test('the list pages 20 at a time, in SQL, and a page past the last shows the last', async () => {
	for (let i = 0; i < 23; i++) {
		await issued([await orderFor()]);
	}
	const first = await listReceivables(db, {}, MANAGER);
	expect(first).toMatchObject({ total: 23, pageCount: 2, filters: { page: 1 } });
	expect(first.receivables).toHaveLength(20);
	const beyond = await listReceivables(db, { page: '9' }, MANAGER);
	expect(beyond.filters.page).toBe(2);
	expect(beyond.receivables).toHaveLength(3);
	expect((await listReceivables(db, { page: 'dos' }, MANAGER)).filters.page).toBe(1);
});

test('an empty list has one page', async () => {
	expect(await listReceivables(db, {}, MANAGER)).toMatchObject({
		receivables: [],
		total: 0,
		pageCount: 1
	});
});

test('WAREHOUSE and DRIVER get a 403 on the list; SALES reads it', async () => {
	for (const actor of [WAREHOUSE, DRIVER]) {
		const caught = await listReceivables(db, {}, actor).catch((error) => error);
		expect(isHttpError(caught, 403), actor.username).toBe(true);
	}
	expect((await listReceivables(db, {}, SALES)).receivables).toEqual([]);
});

test('the issue form lists the client eligible orders with the starting one checked', async () => {
	const priced = await orderFor({ total: 360000 });
	const delivered = await orderFor({ status: 'DELIVERED' });
	await orderFor({ clientId: LUZ_MARINA });
	await orderFor({ status: 'CANCELLED' });
	await issued([ORDER_A]);

	const form = await getReceivableIssueForm(db, String(ORDER_C), MANAGER);

	expect(form?.orders.map(({ id }) => id)).toEqual([ORDER_B, ORDER_C, priced, delivered]);
	expect(form?.orders[2]).toMatchObject({
		id: priced,
		eventDate: '2026-10-10',
		orderTotal: 360000
	});
	expect(form?.checkedOrderIds).toEqual([ORDER_C]);
	expect(form?.paymentTerms).toBe('Contado');
	expect(form?.client.name).toBe('Postobón S.A.');
	expect(form?.client.documentId).toBeNull();
});

test('an order that cannot start a cuenta has no issue form', async () => {
	const cancelled = await orderFor({ status: 'CANCELLED' });
	await issued([ORDER_A]);

	for (const orderId of [ORDER_A, cancelled, 99, null, '', 'abc']) {
		expect(await getReceivableIssueForm(db, orderId, MANAGER), String(orderId)).toBeNull();
	}
});

test('the edit form checks the cuenta orders and leaves the other eligible ones unchecked', async () => {
	await issued([await orderFor()]);
	const id = await issued([ORDER_A, ORDER_B]);
	await edit(id, [ORDER_A, ORDER_B], 'Crédito 30 días');

	const form = await getReceivableEditForm(db, id, MANAGER);

	expect(form?.orders.map((order) => order.id)).toEqual([ORDER_A, ORDER_B, ORDER_C]);
	expect(form?.checkedOrderIds).toEqual([ORDER_A, ORDER_B]);
	expect(form?.paymentTerms).toBe('Crédito 30 días');
	expect(await getReceivableEditForm(db, 99, MANAGER)).toBeNull();
});

test('the edit form lists a cancelled order of the cuenta checked, as cancelled; one outside, never', async () => {
	await orderFor({ status: 'CANCELLED' });
	const id = await issued([ORDER_A, ORDER_B]);
	await cancel(ORDER_B);

	const form = await getReceivableEditForm(db, id, MANAGER);

	expect(form?.orders).toEqual([
		expect.objectContaining({ id: ORDER_A, isCancelled: false }),
		expect.objectContaining({ id: ORDER_B, isCancelled: true }),
		expect.objectContaining({ id: ORDER_C, isCancelled: false })
	]);
	expect(form?.checkedOrderIds).toEqual([ORDER_A, ORDER_B]);
	expect(
		(await getReceivableIssueForm(db, ORDER_C, MANAGER))?.orders.map(({ id: orderId }) => orderId)
	).toEqual([ORDER_C]);
});

test('a cancelled order of the cuenta saves checked, and can be unchecked; the last one stays', async () => {
	const id = await issued([ORDER_A, ORDER_B]);
	await cancel(ORDER_B);
	expect(await edit(id, [ORDER_A, ORDER_B], 'Crédito 30 días')).toEqual({ ok: true, id });
	expect(linkOf(ORDER_B)).toBe(id);
	expect(await edit(id, [ORDER_B])).toEqual({ ok: true, id });
	expect([linkOf(ORDER_A), linkOf(ORDER_B)]).toEqual([null, id]);
	expect(await edit(id, [])).toMatchObject({ ok: false, errors: { orders: expect.any(String) } });
	expect(linkOf(ORDER_B)).toBe(id);
	await cancel(ORDER_A);
	expect(await edit(id, [ORDER_A, ORDER_B])).toMatchObject({ ok: false });
});

test('a cancelled order adds nothing to the total; its payments still count as paid', async () => {
	const [first, second] = await orderPair();
	await advance(second, '200.000');
	const id = await issued([first, second]);
	await cancel(second);
	expect(await detailOf(id)).toMatchObject({
		total: 860000,
		paid: 200000,
		balance: 660000,
		isVoid: false
	});
	expect((await detailOf(id)).orders[1]).toMatchObject({ id: second, isCancelled: true });
});

test('a cuenta whose orders are all cancelled reads «Anulada» and takes no payment', async () => {
	const { postobon: voided, luzMarina: open, postobonOrder } = await issuedForTwoClients();
	await paid(voided, { amount: '$500.000' });
	await cancel(postobonOrder);
	expect(await detailOf(voided)).toMatchObject({
		total: 0,
		paid: 500000,
		balance: -500000,
		isVoid: true
	});
	const summaries = (await listReceivables(db, {}, MANAGER)).receivables;
	expect(summaries.map(({ id, isVoid }) => [id, isVoid])).toEqual([
		[open, false],
		[voided, true]
	]);
	const refused = await recordReceivablePayment(db, typedPayment(voided), MANAGER);
	expect(refused).toMatchObject({ ok: false, message: 'Esta cuenta de cobro está anulada.' });
});

test('the printout leaves a cancelled order out, and an «Anulada» cuenta prints none', async () => {
	const { id, first, second } = await billedPair();
	await cancel(second);
	expect(await getReceivablePrintout(db, id, MANAGER)).toMatchObject({
		orders: [expect.objectContaining({ id: first })],
		total: 860000,
		isVoid: false
	});
	await cancel(first);
	expect(await getReceivablePrintout(db, id, MANAGER)).toMatchObject({
		orders: [],
		total: 0,
		isVoid: true
	});
});

test('SALES reads the form; WAREHOUSE and DRIVER get a 403', async () => {
	const id = await issued([ORDER_A]);
	expect((await getReceivableIssueForm(db, ORDER_B, SALES))?.checkedOrderIds).toEqual([ORDER_B]);
	expect((await getReceivableEditForm(db, id, SALES))?.checkedOrderIds).toEqual([ORDER_A]);
	for (const actor of [WAREHOUSE, DRIVER]) {
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
		amount: '$1.360.000',
		movement_date: '2026-11-01',
		notes: '',
		...fields
	};
}

async function paid(id: number, fields?: Record<string, string>): Promise<number> {
	const result = await recordReceivablePayment(db, typedPayment(id, fields), MANAGER);
	if (!result.ok) {
		throw new Error(JSON.stringify(result));
	}
	return result.id;
}

function readMovement(id: number) {
	return database.prepare('select * from cash_movements where id = ?').get(id);
}

test('a payment links the cuenta as an INSTALLMENT, whatever concept is posted, and counts', async () => {
	const { id } = await billedPair();
	const movementId = await paid(id, { concept: 'INSTALLMENT_REFUND' });
	expect(readMovement(movementId)).toMatchObject({
		concept: 'INSTALLMENT',
		amount: 1360000,
		entity_type: 'RECEIVABLE',
		entity_id: id,
		created_by: 'manager'
	});
	expect((await detailOf(id)).balance).toBe(0);
});

test("payee is the client's name when recorded: a later rename leaves it", async () => {
	const { id } = await billedPair();
	const movementId = await paid(id);
	await fixture.editContact(POSTOBON, { ...REAL_DOCUMENT, full_name: 'Otro nombre' });
	expect(readMovement(movementId)).toMatchObject({ payee: 'Postobón S.A.' });
});

test.each(['$600.000', '$1.410.000', ''])(
	'a cuenta is paid in full, not with %s',
	async (amount) => {
		const { id } = await billedPair();
		const result = await recordReceivablePayment(db, typedPayment(id, { amount }), MANAGER);
		expect(result).toMatchObject({ ok: false, message: expect.stringContaining('$1.360.000') });
		expect((await detailOf(id)).balance).toBe(1360000);
	}
);

test('a paid cuenta takes no more payments, until an offset opens it again', async () => {
	const { id } = await billedPair();
	const movementId = await paid(id);
	const again = await recordReceivablePayment(db, typedPayment(id), MANAGER);
	expect(again).toMatchObject({ ok: false, message: 'Esta cuenta de cobro ya está pagada.' });
	const offset = { reverses_id: String(movementId), payment_method: 'CASH' };
	await recordOffset(db, { ...offset, movement_date: '2026-11-01' }, MANAGER);
	expect(await recordReceivablePayment(db, typedPayment(id), MANAGER)).toMatchObject({ ok: true });
});

test("a payment takes the entry's checks, and a cuenta that exists", async () => {
	const { id } = await billedPair();
	const other = typedPayment(id, { payment_method: 'OTHER' });
	expect(await recordReceivablePayment(db, other, MANAGER)).toMatchObject({
		ok: false,
		errors: { other_method: 'Escribe el medio de pago' }
	});
	expect(await recordReceivablePayment(db, typedPayment(99), MANAGER)).toMatchObject({ ok: false });
});

test('SALES, MANAGER and ADMIN record a payment on a cuenta; WAREHOUSE and DRIVER get a 403', async () => {
	const { id } = await billedPair();
	for (const actor of [WAREHOUSE, DRIVER]) {
		const caught = await recordReceivablePayment(db, typedPayment(id), actor).catch(
			(error) => error
		);
		expect(isHttpError(caught, 403), actor.username).toBe(true);
	}
	expect(await recordReceivablePayment(db, typedPayment(id), ADMIN)).toMatchObject({ ok: true });
});

test('SALES records a cuenta payment with any method', async () => {
	const methods: Record<string, string>[] = [
		{ payment_method: 'CASH' },
		{ payment_method: 'TRANSFER' },
		{ payment_method: 'OTHER', other_method: 'Nequi' }
	];
	for (const fields of methods) {
		const id = await issued([await orderFor({ total: 1360000 })]);
		const result = await recordReceivablePayment(db, typedPayment(id, fields), SALES);
		if (!result.ok) {
			throw new Error(JSON.stringify(result));
		}
		expect(readMovement(result.id), fields.payment_method).toMatchObject({
			payment_method: fields.payment_method,
			entity_type: 'RECEIVABLE',
			entity_id: id,
			created_by: 'sales'
		});
	}
});

test("the cash book links a cuenta's movement, found by its client and not by «Pedido»", async () => {
	const { id, first } = await billedPair();
	const movementId = await paid(id);
	const period = { from: '2026-11-01', to: '2026-11-30' };
	const found = await getCashBook(db, { ...period, text: 'postobón' }, MANAGER);
	expect(found.entries).toMatchObject([{ id: movementId, receivableId: id, orderId: null }]);
	const byOrder = await getCashBook(db, { ...period, order: String(first) }, MANAGER);
	expect(byOrder.entries).toEqual([]);
});

test("a cuenta's receipt names its orders, for the manager and SALES; never WAREHOUSE", async () => {
	const { id, first, second } = await billedPair();
	const movementId = await paid(id);
	for (const actor of [MANAGER, SALES]) {
		expect(await getReceipt(db, movementId, actor), actor.username).toMatchObject({
			movement: { receivableId: id, orderId: null },
			receivableOrderIds: [first, second]
		});
	}
	const caught = await getReceipt(db, movementId, WAREHOUSE).catch((error) => error);
	expect(isHttpError(caught, 403)).toBe(true);
});

test("SALES can't offset a cuenta's payment: Caja's money out stays the manager's", async () => {
	const { id } = await billedPair();
	const movementId = await paid(id);
	const offset = {
		reverses_id: String(movementId),
		payment_method: 'CASH',
		movement_date: '2026-11-01'
	};
	const caught = await recordOffset(db, offset, SALES).catch((error) => error);
	expect(isHttpError(caught, 403)).toBe(true);
	const book = await getCashBook(db, {}, SALES).catch((error) => error);
	expect(isHttpError(book, 403)).toBe(true);
});

test("the cuenta's offsetting movement, made from Caja, keeps its link and cancels it", async () => {
	const { id } = await billedPair();
	const movementId = await paid(id);
	const result = await recordOffset(
		db,
		{
			reverses_id: String(movementId),
			payment_method: 'CASH',
			movement_date: '2026-11-01'
		},
		MANAGER
	);
	if (!result.ok) {
		throw new Error(JSON.stringify(result));
	}
	expect(readMovement(result.id)).toMatchObject({
		concept: 'INSTALLMENT',
		amount: -1360000,
		entity_type: 'RECEIVABLE',
		entity_id: id,
		reverses_id: movementId
	});
	expect((await detailOf(id)).balance).toBe(1360000);
});

test('the printout reads the client live, and each order with its lines, by number', async () => {
	const chair = await fixture.product({ name: 'Silla' });
	const lineOf = (total: number) => [{ product_id: chair, qty: 1, unit_price: total }];
	const lower = await orderFor({ order_items: lineOf(300) });
	const higher = await orderFor({ order_items: lineOf(500) });
	const id = await issued([higher, lower]);
	await fixture.editContact(POSTOBON, {
		document_id: '8909039395',
		address_1: 'Calle 52',
		address_2: 'Medellín'
	});
	const printout = await getReceivablePrintout(db, id, MANAGER);
	expect(printout?.client).toMatchObject({
		name: 'Postobón S.A.',
		documentId: '8909039395',
		address: 'Calle 52, Medellín'
	});
	expect(printout?.orders.map((order) => order.id)).toEqual([lower, higher]);
	expect(printout?.orders[0].items[0].name).toBe('Silla');
	expect(printout?.total).toBe(800);
});

test('the printout of a cuenta that does not exist is null, and WAREHOUSE is refused', async () => {
	expect(await getReceivablePrintout(db, 999, MANAGER)).toBeNull();
	expect(await getReceivablePrintout(db, 999, SALES)).toBeNull();
	await expect(getReceivablePrintout(db, 999, WAREHOUSE)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 403)
	);
});
