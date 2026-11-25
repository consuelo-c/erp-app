import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import type { Actor, Role } from '../actor';
import { actorWith, ADMIN, createFixture, DRIVER, MANAGER, SALES, WAREHOUSE } from '../db/fixture';
import { recordOffset } from './cash';
import { getContact } from './contacts';
import {
	advanceOrder,
	cancelOrder,
	checkOrderSchedule,
	clientAttributesSchema,
	createExtension,
	deliveryAttributesSchema,
	getAvailability,
	getDespachosPaymentEntry,
	getOrder,
	getOrderBilling,
	getOrderChange,
	getOrderDetail,
	getOrderPrintout,
	getOrderTimeline,
	getOrderWarnings,
	getPaymentOptions,
	getPublicToken,
	listOrders,
	ORDERS_PAGE_SIZE,
	orderItemsSchema,
	offeredPaymentConcepts,
	recordOrderPayment,
	updateOrder,
	type OrderStatus
} from './orders';
import { convertQuote } from './quotes';
import { readOwedOnReceivable } from '$lib/orders';
import { reportIncident, reverseIncident } from './incidents';
import { getReceivableDetail, issueReceivable, recordReceivablePayment } from './receivables';
import { getCashStatement } from './cash-handovers';

let db: D1Database;
let database: DatabaseSync;
let fixture: ReturnType<typeof createFixture>;

let LUZ_MARINA: number;
let WILSON: number;
let ABURRA: number;
let JORGE: number;
let CHAIRS: number;
let TABLES: number;
let GLASSES: number;
let INACTIVE_TABLECLOTH: number;

const address = { address_1: 'Calle 10 # 43-12, El Poblado', address_2: 'Salón Los Arrayanes' };

// The Design Brief's order #1043.
function designBrief() {
	return {
		client_id: LUZ_MARINA,
		client_name: 'Luz Marina Restrepo',
		client_phone: '310 442 8890',
		event_date: '2026-08-15',
		delivery_date: '2026-08-14',
		pickup_date: '2026-08-16',
		rental_days: 2,
		delivery_attributes: { method: 'COMPANY_DELIVERY', time: '14:00', ...address },
		pickup_attributes: { method: 'COMPANY_PICKUP', time: '09:00', ...address },
		order_items: [
			{ product_id: CHAIRS, qty: 120, unit_price: 2500 },
			{ product_id: TABLES, qty: 12, unit_price: 12000 },
			{ product_id: GLASSES, qty: 120, unit_price: 900 }
		],
		discount: 104000,
		transport_cost: 180000,
		deposit_amount: 200000
	};
}

// The Design Brief's #1043 edited: another client, a later pickup by a carrier, lines and money.
function editedBrief() {
	return {
		...designBrief(),
		client_id: JORGE,
		client_name: 'Jorge Iván Betancur',
		pickup_date: '2026-08-17',
		rental_days: 3,
		pickup_attributes: {
			...address,
			method: 'EXTERNAL_CARRIER',
			time: '09:00',
			carrier_id: WILSON
		},
		order_items: [
			{ product_id: CHAIRS, qty: 100, unit_price: 2500 },
			{ product_id: GLASSES, qty: 120, unit_price: 1000 }
		],
		transport_cost: 150000,
		notes: 'Portón blanco después del puente'
	};
}

// Some of #1043's chairs, kept three more days. Any delivery date sent is ignored.
function extensionOfBrief() {
	return {
		...designBrief(),
		delivery_date: '2026-08-01',
		pickup_date: '2026-08-19',
		rental_days: 3,
		order_items: [{ product_id: CHAIRS, qty: 100, unit_price: 2500 }],
		discount: 0,
		transport_cost: 60000,
		deposit_amount: 0
	};
}

let order1043: ReturnType<typeof designBrief>;
let edited1043: ReturnType<typeof editedBrief>;
let extension: ReturnType<typeof extensionOfBrief>;

beforeEach(async () => {
	fixture = createFixture();
	({ db, database } = fixture);
	LUZ_MARINA = await fixture.contact({ full_name: 'Luz Marina Restrepo', phone: '310 442 8890' });
	WILSON = await fixture.contact({
		full_name: 'Wilson Muñoz',
		phone: '311 908 5512',
		labels: ['TRANSPORTER']
	});
	ABURRA = await fixture.contact({
		full_name: 'Transportes Aburrá',
		phone: '300 555 0101',
		labels: ['TRANSPORTER']
	});
	JORGE = await fixture.contact({ full_name: 'Jorge Iván Betancur', phone: '300 771 2043' });
	const stocked = { category: 'CHAIRS_TABLES', total_quantity: '500' };
	CHAIRS = await fixture.product({
		...stocked,
		name: 'Silla Tiffany dorada',
		rental_price: '2.500'
	});
	TABLES = await fixture.product({
		...stocked,
		name: 'Mesa redonda 10 puestos',
		rental_price: '12.000'
	});
	GLASSES = await fixture.product({
		...stocked,
		name: 'Copa para vino tinto',
		rental_price: '900'
	});
	INACTIVE_TABLECLOTH = await fixture.product({
		...stocked,
		name: 'Mantel blanco',
		rental_price: '8.000',
		active: 'off'
	});
	order1043 = designBrief();
	edited1043 = editedBrief();
	extension = extensionOfBrief();
});

// The Design Brief's #1043, with `fields` typed over it, born from its quote and moved to `status`.
function create(fields: Record<string, unknown> = {}): Promise<number> {
	return fixture.order({ ...order1043, ...fields });
}

// «Guardar pedido» on a quote's form, as `actor`: the order's own validation answers.
async function convert(input: object, actor: Actor = SALES) {
	const quote = await fixture.quote();
	return convertQuote(db, { quote, order: { transport_cost: 0, ...input }, force: true }, actor);
}

async function read(id: number) {
	const order = await getOrder(db, id, SALES);
	if (null === order) {
		throw new Error(`Order ${id} not found`);
	}
	return order;
}

function orderEvents() {
	return database
		.prepare("select action, before, after from events where entity_type = 'ORDER' order by id")
		.all()
		.map((event) => ({
			action: event.action,
			before: null === event.before ? null : JSON.parse(String(event.before)),
			after: JSON.parse(String(event.after))
		}));
}

test('creating stores the snapshots and works out the totals, ignoring any sent', async () => {
	const id = await create({ ...order1043, items_total: 1, order_total: 1 });
	const order = await read(id);
	expect(order).toMatchObject({
		status: 'CONFIRMED',
		hasIncident: false,
		client: { name: 'Luz Marina Restrepo', phone: '573104428890' },
		itemsTotal: 1104000,
		discount: 104000,
		transportCost: 180000,
		orderTotal: 1180000,
		depositAmount: 200000,
		notes: null,
		parentOrderId: null
	});
	expect(order.items[0]).toEqual({
		product_id: CHAIRS,
		name: 'Silla Tiffany dorada',
		qty: 120,
		list_price: 2500,
		unit_price: 2500,
		line_total: 600000
	});
	expect(order.items.map((item) => item.line_total)).toEqual([600000, 288000, 216000]);
	expect(order.delivery).toEqual({
		method: 'COMPANY_DELIVERY',
		time: '14:00',
		...address,
		carrier: null,
		notes: null
	});
});

test('a client carrying Vetado saves an order like any other, with no extra step', async () => {
	await fixture.editContact(LUZ_MARINA, { labels: ['BANNED'] });
	expect((await read(await create())).clientId).toBe(LUZ_MARINA);
});

test('the public token is 13 base36 characters, kept out of the CREATED event', async () => {
	const id = await create();
	const { public_token } = database.prepare('select public_token from orders').get() ?? {};
	expect(String(public_token)).toMatch(/^[0-9a-z]{13}$/);
	const [created] = orderEvents();
	expect(created).toMatchObject({ action: 'CREATED', before: null });
	expect(created.after).toMatchObject({ status: 'CONFIRMED', order_total: 1180000 });
	expect(created.after).not.toHaveProperty('public_token');
	expect(created.after).not.toHaveProperty('has_incident');
	expect((await read(id)).hasIncident).toBe(false);
});

test("the client's link token: in any status, never for WAREHOUSE or DRIVER", async () => {
	const id = await create();
	const { public_token } = database.prepare('select public_token from orders').get() ?? {};
	expect(await getPublicToken(db, id, SALES)).toBe(public_token);
	expect(await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, SALES)).toMatchObject(
		{
			ok: true
		}
	);
	expect(await getPublicToken(db, id, SALES)).toBe(public_token);
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		await expect(getPublicToken(db, id, actorWith(role))).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
	}
});

test('renaming the client or a product, or repricing it, changes no saved order, an edit included', async () => {
	const id = await create();
	await fixture.editContact(LUZ_MARINA, { full_name: 'Luz Marina Restrepo de Gil' });
	await fixture.editProduct(CHAIRS, { name: 'Silla Tiffany', rental_price: '3.000' });
	expect((await read(id)).client.name).toBe('Luz Marina Restrepo');
	await updateOrder(db, { ...order1043, id, rental_days: 3 }, SALES);
	const edited = await read(id);
	expect(edited.client.name).toBe('Luz Marina Restrepo');
	expect(edited.items[0]).toMatchObject({ name: 'Silla Tiffany dorada', list_price: 2500 });
});

test('a line added in an edit takes the catalog name and price of that moment', async () => {
	const id = await create();
	const redTablecloth = await fixture.product({ name: 'Mantel rojo', rental_price: '7.000' });
	await fixture.editProduct(redTablecloth, { rental_price: '7.500' });
	const items = [
		...order1043.order_items,
		{ product_id: redTablecloth, qty: 12, unit_price: 7000 }
	];
	await updateOrder(db, { ...order1043, id, order_items: items }, SALES);
	expect((await read(id)).items[3]).toEqual({
		product_id: redTablecloth,
		name: 'Mantel rojo',
		qty: 12,
		list_price: 7500,
		unit_price: 7000,
		line_total: 168000
	});
});

test('lines: an empty list, a repeated product, a qty of 0 and an unknown key are refused', async () => {
	const [chairs, tables] = order1043.order_items;
	const refused = [
		[[], 'order_items'],
		[[chairs, { ...tables, product_id: CHAIRS }], 'order_items'],
		[[{ ...chairs, qty: 0 }], 'order_items.0.qty'],
		[[{ ...chairs, line_total: 1 }], 'order_items.0']
	] as const;
	for (const [lines, field] of refused) {
		const result = await convert({ ...order1043, order_items: lines });
		expect(result).toMatchObject({ ok: false, errors: { [field]: expect.any(String) } });
	}
	const stored = [{ product_id: 1, name: 'Silla', qty: 1, list_price: 0, unit_price: 0 }];
	expect(orderItemsSchema.safeParse(stored).success).toBe(false);
	const withExtraKey = [{ ...stored[0], line_total: 0, discount: 0 }];
	expect(orderItemsSchema.safeParse(withExtraKey).success).toBe(false);
	expect(orderItemsSchema.safeParse([{ ...stored[0], line_total: 0 }]).success).toBe(true);
});

test('a $0 line is a valid courtesy', async () => {
	const lines = [{ product_id: GLASSES, qty: 10, unit_price: 0 }];
	const id = await create({ ...order1043, order_items: lines, discount: 0 });
	expect((await read(id)).items[0]).toMatchObject({
		list_price: 900,
		unit_price: 0,
		line_total: 0
	});
});

test("an inactive product can't be added; a line holding one deactivated since stays", async () => {
	const inactive = [
		...order1043.order_items,
		{ product_id: INACTIVE_TABLECLOTH, qty: 1, unit_price: 0 }
	];
	const refused = await convert({ ...order1043, order_items: inactive });
	expect(refused).toMatchObject({
		ok: false,
		errors: { 'order_items.3.product_id': expect.any(String) }
	});
	const id = await create();
	await fixture.editProduct(CHAIRS, { active: 'off' });
	const result = await updateOrder(db, { ...order1043, id, rental_days: 3 }, SALES);
	expect(result).toEqual({ ok: true, id });
	expect((await read(id)).items[0]).toMatchObject({ product_id: CHAIRS, line_total: 900000 });
});

test('a discount above the subtotal is refused on its field; equal to it, the total is the transport', async () => {
	const above = await convert({ ...order1043, discount: 1104001 });
	expect(above).toMatchObject({ ok: false, errors: { discount: expect.any(String) } });
	const id = await create({ ...order1043, discount: 1104000 });
	expect((await read(id)).orderTotal).toBe(180000);
	for (const field of ['discount', 'transport_cost', 'deposit_amount']) {
		const result = await convert({ ...order1043, [field]: -1 });
		expect(result).toMatchObject({ ok: false, errors: { [field]: expect.any(String) } });
	}
});

test('rental days are at least 1; a delivery after the pickup fails on its field; the event date is free', async () => {
	const noDays = await convert({ ...order1043, rental_days: 0 });
	expect(noDays).toMatchObject({ ok: false, errors: { rental_days: expect.any(String) } });
	const early = await convert({ ...order1043, pickup_date: '2026-08-13' });
	expect(early).toMatchObject({ ok: false, errors: { delivery_date: expect.any(String) } });
	const sameDay = { ...order1043, pickup_date: '2026-08-14', event_date: '2026-09-01' };
	expect(await convert(sameDay)).toEqual({ ok: true, id: expect.any(Number) });
});

test('an external carrier is required, must exist and be a transporter; each direction may have its own', async () => {
	const external = { ...order1043.delivery_attributes, method: 'EXTERNAL_CARRIER' };
	for (const carrierId of [undefined, 99, JORGE]) {
		const delivery = { ...external, carrier_id: carrierId };
		const result = await convert({ ...order1043, delivery_attributes: delivery });
		expect(result).toMatchObject({
			ok: false,
			errors: { 'delivery_attributes.carrier_id': expect.any(String) }
		});
	}
	const id = await create({
		...order1043,
		delivery_attributes: { ...external, carrier_id: WILSON },
		pickup_attributes: { ...external, method: 'EXTERNAL_CARRIER', carrier_id: ABURRA }
	});
	const order = await read(id);
	expect(order.delivery.carrier).toEqual({
		id: WILSON,
		name: 'Wilson Muñoz',
		phone: '573119085512',
		whatsapp: null
	});
	expect(order.pickup.carrier).toEqual({
		id: ABURRA,
		name: 'Transportes Aburrá',
		phone: '573005550101',
		whatsapp: null
	});
});

test('any other method saves no carrier, even when one is sent', async () => {
	const delivery = { ...order1043.delivery_attributes, carrier_id: WILSON };
	const id = await create({ ...order1043, delivery_attributes: delivery });
	expect((await read(id)).delivery.carrier).toBeNull();
});

test('an order is edited through DELIVERED; on its way back, completed or cancelled the save is refused', async () => {
	const id = await create({ status: 'DELIVERED' });
	expect(await updateOrder(db, { ...order1043, id, rental_days: 3 }, SALES)).toEqual({
		ok: true,
		id
	});
	const refuses = async (orderId: number) => {
		const result = await updateOrder(db, { ...order1043, id: orderId, rental_days: 4 }, SALES);
		expect(result).toMatchObject({ ok: false });
	};
	await fixture.advanceTo(id, 'OUT_FOR_PICKUP');
	await refuses(id);
	await fixture.advanceTo(id, 'COMPLETED');
	await refuses(id);
	const cancelled = await create({ status: 'CANCELLED' });
	await refuses(cancelled);
	expect((await read(id)).rentalDays).toBe(3);
	expect((await read(cancelled)).rentalDays).toBe(2);
	expect(await updateOrder(db, { ...order1043, id: 99 }, SALES)).toMatchObject({ ok: false });
});

test('an edit logs only the changed fields; a save with no change logs nothing', async () => {
	const id = await create();
	await updateOrder(db, { ...order1043, id }, SALES);
	expect(orderEvents()).toHaveLength(1);
	await updateOrder(db, { ...order1043, id, rental_days: 3 }, SALES);
	const edited = orderEvents()[1];
	expect(edited.action).toBe('EDITED');
	expect(Object.keys(edited.after).sort()).toEqual([
		'items_total',
		'order_items',
		'order_total',
		'rental_days'
	]);
	expect(edited.before).toMatchObject({ rental_days: 2, items_total: 1104000 });
	expect(edited.after).toMatchObject({ rental_days: 3, items_total: 1656000 });
});

test('changing the client changes client_id and its snapshot together, both logged', async () => {
	const id = await create();
	const jorge = { client_id: JORGE, client_name: 'Jorge Iván Betancur' };
	await updateOrder(db, { ...order1043, id, ...jorge }, SALES);
	expect(await read(id)).toMatchObject({
		clientId: JORGE,
		client: { name: 'Jorge Iván Betancur', phone: '573007712043' }
	});
	const edited = orderEvents()[1];
	expect(Object.keys(edited.after).sort()).toEqual(['client_attributes', 'client_id']);
	const unknown = await updateOrder(db, { ...order1043, id, client_id: 99 }, SALES);
	expect(unknown).toMatchObject({ ok: false, errors: { client_id: expect.any(String) } });
});

// The order at `status`, billed in a new cuenta de cobro with `others`.
async function billed(
	status: OrderStatus = 'CONFIRMED',
	others: number[] = []
): Promise<[number, number]> {
	const id = await create({ status });
	const result = await issueReceivable(
		db,
		{ orders: [id, ...others], payment_terms: 'Contado' },
		SALES
	);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return [id, result.id];
}

function receivableEvents() {
	return database
		.prepare("select action, entity_id, before, after from events where entity_type = 'RECEIVABLE'")
		.all()
		.map((event) => ({
			action: event.action,
			entityId: event.entity_id,
			before: null === event.before ? null : JSON.parse(String(event.before)),
			after: JSON.parse(String(event.after))
		}));
}

function receivableClient(id: number) {
	return database.prepare('select client_id from receivables where id = ?').get(id)?.client_id;
}

const jorgeAsClient = () => ({ client_id: JORGE, client_name: 'Jorge Iván Betancur' });

test.each(['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED'] satisfies OrderStatus[])(
	'a billed %s order saves an edit of its lines, and its cuenta reads the new total',
	async (status) => {
		const [id, receivableId] = await billed(status);
		const totalOf = async () => (await getReceivableDetail(db, receivableId, SALES))?.total;
		expect(await totalOf()).toBe(1180000);
		const lines = [{ product_id: CHAIRS, qty: 100, unit_price: 2500 }];
		const result = await updateOrder(db, { ...order1043, id, order_items: lines }, SALES);
		expect(result).toEqual({ ok: true, id });
		expect(await totalOf()).toBe(100 * 2500 * 2 - 104000 + 180000);
	}
);

test('a billed COMPLETED order stays read-only', async () => {
	const [id] = await billed('COMPLETED');
	const result = await updateOrder(db, { ...order1043, id, rental_days: 3 }, SALES);
	expect(result).toMatchObject({ ok: false });
});

test("the cuenta's only order changes the cuenta's client in the same save, logged", async () => {
	const [id, receivableId] = await billed();
	expect(await updateOrder(db, { ...order1043, id, ...jorgeAsClient() }, SALES)).toEqual({
		ok: true,
		id
	});
	expect((await read(id)).clientId).toBe(JORGE);
	expect(receivableClient(receivableId)).toBe(JORGE);
	expect(receivableEvents().at(-1)).toEqual({
		action: 'EDITED',
		entityId: receivableId,
		before: { client_id: LUZ_MARINA },
		after: { client_id: JORGE }
	});
	const detail = await getReceivableDetail(db, receivableId, SALES);
	expect(detail?.client.name).toBe('Jorge Iván Betancur');
	expect(database.prepare('select count(*) as count from receivables').get()?.count).toBe(1);
});

test("«Cliente nuevo» on the cuenta's only order becomes the cuenta's client", async () => {
	const [id, receivableId] = await billed();
	const newClient = { client_id: null, client_name: 'Gloria Patiño', client_phone: '3001234567' };
	expect(await updateOrder(db, { ...order1043, id, ...newClient }, SALES)).toEqual({
		ok: true,
		id
	});
	const { clientId } = await read(id);
	expect(clientId).not.toBe(LUZ_MARINA);
	expect(receivableClient(receivableId)).toBe(clientId);
	expect(receivableEvents().at(-1)).toMatchObject({
		action: 'EDITED',
		before: { client_id: LUZ_MARINA },
		after: { client_id: clientId }
	});
});

test("an edit that keeps a billed order's client leaves its cuenta untouched", async () => {
	const [id, receivableId] = await billed();
	await updateOrder(db, { ...order1043, id, rental_days: 3 }, SALES);
	expect(receivableClient(receivableId)).toBe(LUZ_MARINA);
	expect(receivableEvents().map(({ action }) => action)).toEqual(['CREATED']);
});

test("a cuenta's order with others keeps its client: the change is refused", async () => {
	const other = await create();
	const [id, receivableId] = await billed('CONFIRMED', [other]);
	const result = await updateOrder(
		db,
		{ ...order1043, id, ...jorgeAsClient(), rental_days: 3 },
		SALES
	);
	expect(result).toEqual({
		ok: false,
		message: expect.any(String),
		errors: {
			client_id: `Retire el pedido de la cuenta de cobro Nº ${receivableId} antes de cambiar el cliente.`
		}
	});
	expect(await read(id)).toMatchObject({ clientId: LUZ_MARINA, rentalDays: 2 });
	expect(receivableClient(receivableId)).toBe(LUZ_MARINA);
	const kept = await updateOrder(db, { ...order1043, id, rental_days: 3 }, SALES);
	expect(kept).toEqual({ ok: true, id });
});

test("the order form's billing: the cuenta's number, and whether it bills other orders", async () => {
	const alone = await create();
	expect(await getOrderBilling(db, await read(alone), SALES)).toBeNull();
	const [id, receivableId] = await billed();
	expect(await getOrderBilling(db, await read(id), SALES)).toEqual({
		receivableId,
		clientId: LUZ_MARINA,
		hasOtherOrders: false
	});
	const [shared, sharedId] = await billed('CONFIRMED', [alone]);
	expect(await getOrderBilling(db, await read(shared), SALES)).toMatchObject({
		receivableId: sharedId,
		hasOtherOrders: true
	});
	await expect(getOrderBilling(db, await read(id), WAREHOUSE)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 403)
	);
});

test('WAREHOUSE and DRIVER get a 403 creating, editing or reading an order', async () => {
	const id = await create();
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const actor = actorWith(role);
		const refusals = await Promise.all([
			convert(order1043, actor).catch((caught: unknown) => caught),
			updateOrder(db, { ...order1043, id }, actor).catch((caught: unknown) => caught),
			getOrder(db, id, actor).catch((caught: unknown) => caught)
		]);
		for (const refusal of refusals) {
			expect(isHttpError(refusal, 403)).toBe(true);
		}
	}
});

type Booking = {
	status: OrderStatus;
	delivery: string;
	pickup: string;
	qty: number;
	force?: boolean;
};

// An order of `qty` Tiffany chairs at `status`, refused on a shortage unless `force` saves it anyway.
function book({ status, delivery, pickup, qty, force = false }: Booking): Promise<number> {
	const lines = [{ product_id: CHAIRS, qty, unit_price: 2500 }];
	const dates = { delivery_date: delivery, pickup_date: pickup, event_date: delivery };
	return create({ ...dates, order_items: lines, discount: 0, status, force });
}

async function chairsAvailable(range: object): Promise<number | undefined> {
	const availability = await getAvailability(db, { ...range, product_ids: [CHAIRS] }, SALES);
	return availability.find(({ productId }) => CHAIRS === productId)?.available;
}

test('only orders holding their products subtract: not a cancelled or a completed one', async () => {
	for (const status of ['CANCELLED', 'COMPLETED'] satisfies OrderStatus[]) {
		await book({ status, delivery: '2026-08-14', pickup: '2026-08-16', qty: 100 });
	}
	const range = { delivery_date: '2026-08-15', pickup_date: '2026-08-15' };
	expect(await chairsAvailable(range)).toBe(500);
	await book({ status: 'CONFIRMED', delivery: '2026-08-14', pickup: '2026-08-16', qty: 100 });
	expect(await chairsAvailable(range)).toBe(400);
});

test('an order subtracts on its delivery day and on its pickup day, both included', async () => {
	await book({ status: 'PICKED', delivery: '2026-08-14', pickup: '2026-08-16', qty: 100 });
	const day = (date: string) => chairsAvailable({ delivery_date: date, pickup_date: date });
	expect(await day('2026-08-13')).toBe(500);
	expect(await day('2026-08-14')).toBe(400);
	expect(await day('2026-08-16')).toBe(400);
	expect(await day('2026-08-17')).toBe(500);
});

test("a range's availability is its tightest day, and an overbooked product comes back negative", async () => {
	await book({ status: 'CONFIRMED', delivery: '2026-08-10', pickup: '2026-08-12', qty: 300 });
	const overbooking = { delivery: '2026-08-12', pickup: '2026-08-14', qty: 250, force: true };
	await book({ status: 'DELIVERED', ...overbooking });
	const range = { delivery_date: '2026-08-08', pickup_date: '2026-08-20' };
	expect(await chairsAvailable(range)).toBe(-50);
	const availability = await getAvailability(
		db,
		{ ...range, product_ids: [CHAIRS, TABLES] },
		SALES
	);
	expect(availability).toEqual([
		{ productId: CHAIRS, available: -50 },
		{ productId: TABLES, available: 500 }
	]);
});

test('the order being edited leaves its own lines out', async () => {
	const id = await book({
		status: 'CONFIRMED',
		delivery: '2026-08-14',
		pickup: '2026-08-16',
		qty: 120
	});
	const range = { delivery_date: '2026-08-14', pickup_date: '2026-08-16' };
	expect(await chairsAvailable(range)).toBe(380);
	expect(await chairsAvailable({ ...range, order_id: String(id) })).toBe(500);
});

// A holiday in the default settings, the only one from August 9 to 25, 2026.
const ASSUMPTION = { date: '2026-08-17', label: 'La Asunción de la Virgen' };

const trips = {
	delivery_date: '2026-08-14',
	delivery_time: '14:00',
	pickup_date: '2026-08-16',
	pickup_time: '09:00'
};

test('a delivery or a pickup on a holiday warns; an event on one shows nothing', async () => {
	const warnings = (input: object) => getOrderWarnings(db, { ...trips, ...input }, SALES);
	expect((await warnings({})).holidays).toEqual([]);
	expect((await warnings({ pickup_date: '2026-08-17' })).holidays).toEqual([
		{ trip: 'PICKUP', ...ASSUMPTION }
	]);
	const onDelivery = { delivery_date: '2026-08-17', pickup_date: '2026-08-18' };
	expect((await warnings(onDelivery)).holidays).toEqual([{ trip: 'DELIVERY', ...ASSUMPTION }]);
	// The event date isn't part of the input: only the trucks' days count.
	expect((await warnings({ event_date: '2026-08-17' })).holidays).toEqual([]);
});

test("a trip at another order's delivery or pickup date and time clashes; a cancelled one doesn't", async () => {
	const id = await create();
	const atItsDelivery = {
		pickup_date: '2026-08-14',
		pickup_time: '14:00',
		delivery_date: '2026-08-13'
	};
	expect((await getOrderWarnings(db, { ...trips, ...atItsDelivery }, SALES)).clashes).toEqual([
		{
			trip: 'PICKUP',
			theirTrip: 'DELIVERY',
			orderId: id,
			clientName: 'Luz Marina Restrepo',
			date: '2026-08-14',
			time: '14:00'
		}
	]);
	const atItsPickup = {
		delivery_date: '2026-08-16',
		delivery_time: '09:00',
		pickup_date: '2026-08-18'
	};
	expect((await getOrderWarnings(db, { ...trips, ...atItsPickup }, SALES)).clashes).toEqual([
		{
			trip: 'DELIVERY',
			theirTrip: 'PICKUP',
			orderId: id,
			clientName: 'Luz Marina Restrepo',
			date: '2026-08-16',
			time: '09:00'
		}
	]);
	await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, SALES);
	expect((await getOrderWarnings(db, trips, SALES)).clashes).toEqual([]);
});

test('an order never clashes with itself, and a time left empty never clashes', async () => {
	const id = await create();
	expect((await getOrderWarnings(db, { ...trips, order_id: id }, SALES)).clashes).toEqual([]);
	const noTimes = { ...trips, delivery_time: null, pickup_time: null };
	expect((await getOrderWarnings(db, noTimes, SALES)).clashes).toEqual([]);
	expect((await getOrderWarnings(db, trips, SALES)).clashes).toHaveLength(2);
});

test('an order saves overbooked, on a holiday and clashing, all at once', async () => {
	await book({ status: 'CONFIRMED', delivery: '2026-08-17', pickup: '2026-08-18', qty: 450 });
	const lines = [{ product_id: CHAIRS, qty: 100, unit_price: 2500 }];
	const dates = {
		delivery_date: '2026-08-17',
		pickup_date: '2026-08-18',
		event_date: '2026-08-17'
	};
	const id = await create({ ...order1043, ...dates, order_items: lines, discount: 0 });
	const range = { ...dates, order_id: id };
	expect(await chairsAvailable(range)).toBe(50);
	const warnings = await getOrderWarnings(
		db,
		{ ...range, delivery_time: '14:00', pickup_time: '09:00' },
		SALES
	);
	expect(warnings.holidays).toHaveLength(1);
	expect(warnings.clashes).toHaveLength(2);
	expect((await read(id)).items[0].qty).toBe(100);
});

test('WAREHOUSE and DRIVER get a 403 asking for availability or warnings', async () => {
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const actor = actorWith(role);
		const range = { delivery_date: '2026-08-14', pickup_date: '2026-08-16', product_ids: [CHAIRS] };
		await expect(getAvailability(db, range, actor)).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
		await expect(getOrderWarnings(db, range, actor)).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
	}
});

async function status(id: number): Promise<string> {
	return (await read(id)).status;
}

test('cancelling asks for a reason, kept in its CANCELLED event; the cancelled order is read-only', async () => {
	const id = await create();
	const noReason = await cancelOrder(db, { id, reason: '  ' }, SALES);
	expect(noReason).toMatchObject({ ok: false, errors: { reason: expect.any(String) } });
	expect(await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, SALES)).toEqual({
		ok: true,
		id
	});
	const cancelled = database
		.prepare("select action, before, after, reason from events where action = 'CANCELLED'")
		.get();
	expect(cancelled).toEqual({
		action: 'CANCELLED',
		before: '{"status":"CONFIRMED"}',
		after: '{"status":"CANCELLED"}',
		reason: 'El cliente aplazó el evento'
	});
	expect(await updateOrder(db, { ...order1043, id }, SALES)).toMatchObject({ ok: false });
});

test('a delivered order can no longer be cancelled', async () => {
	const id = await create({ status: 'DELIVERED' });
	const result = await cancelOrder(db, { id, reason: 'Ya no lo quiere' }, ADMIN);
	expect(result).toMatchObject({ ok: false });
	expect(await status(id)).toBe('DELIVERED');
});

test('WAREHOUSE marks PICKED: operational transitions are open to every role', async () => {
	const id = await create();
	expect(await advanceOrder(db, { id, status: 'PICKED' }, WAREHOUSE)).toEqual({ ok: true, id });
	expect(await advanceOrder(db, { id, status: 'OUT_FOR_DELIVERY' }, DRIVER)).toEqual({
		ok: true,
		id
	});
	expect(orderEvents().at(-1)).toMatchObject({
		action: 'STATUS_CHANGED',
		after: { status: 'OUT_FOR_DELIVERY' }
	});
});

test('WAREHOUSE and DRIVER cannot cancel an order', async () => {
	const id = await create();
	for (const actor of [WAREHOUSE, DRIVER]) {
		const attempt = cancelOrder(db, { id, reason: 'No contesta' }, actor);
		await expect(attempt).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	}
	expect(await status(id)).toBe('CONFIRMED');
});

test('the operational path cannot cancel, whoever asks', async () => {
	const id = await create();
	for (const target of ['CONFIRMED', 'CANCELLED']) {
		const result = await advanceOrder(db, { id, status: target }, ADMIN);
		expect(result).toMatchObject({ ok: false, errors: { status: expect.any(String) } });
	}
	expect(await status(id)).toBe('CONFIRMED');
});

test('an order cancels from CONFIRMED, PICKED and OUT_FOR_DELIVERY', async () => {
	for (const from of ['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY'] satisfies OrderStatus[]) {
		const id = await create({ status: from });
		const result = await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, SALES);
		expect(result).toEqual({ ok: true, id });
		expect(await status(id)).toBe('CANCELLED');
	}
});

test('a cancelled order holds nothing, and nothing takes it out of CANCELLED', async () => {
	const id = await book({
		status: 'CONFIRMED',
		delivery: '2026-08-14',
		pickup: '2026-08-16',
		qty: 100
	});
	const range = { delivery_date: '2026-08-15', pickup_date: '2026-08-15' };
	expect(await chairsAvailable(range)).toBe(400);
	await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, SALES);
	expect(await chairsAvailable(range)).toBe(500);
	for (const target of ['PICKED', 'CONFIRMED']) {
		expect(await advanceOrder(db, { id, status: target }, ADMIN)).toMatchObject({ ok: false });
	}
	expect(await status(id)).toBe('CANCELLED');
});

test('an illegal transition fails for every role, and writes nothing', async () => {
	const id = await create();
	for (const actor of [ADMIN, SALES, WAREHOUSE]) {
		expect(await advanceOrder(db, { id, status: 'DELIVERED' }, actor)).toMatchObject({ ok: false });
	}
	expect(await status(id)).toBe('CONFIRMED');
	expect(orderEvents()).toHaveLength(1);
	expect(await advanceOrder(db, { id: 99, status: 'PICKED' }, ADMIN)).toMatchObject({ ok: false });
});

test('a client pickup and return goes picked → delivered → completed', async () => {
	const atWarehouse = { ...address, time: null };
	const id = await create({
		...order1043,
		delivery_attributes: { ...atWarehouse, method: 'CLIENT_PICKUP' },
		pickup_attributes: { ...atWarehouse, method: 'CLIENT_RETURN' }
	});
	await advanceOrder(db, { id, status: 'PICKED', notes: 'Listo en bodega' }, WAREHOUSE);
	const skipped = { id, status: 'OUT_FOR_DELIVERY', notes: 'Salió' };
	expect(await advanceOrder(db, skipped, DRIVER)).toMatchObject({ ok: false });
	expect(await read(id)).toMatchObject({
		status: 'PICKED',
		delivery: { notes: 'Listo en bodega' }
	});
	expect(await advanceOrder(db, { id, status: 'DELIVERED' }, WAREHOUSE)).toMatchObject({
		ok: true
	});
	expect(await advanceOrder(db, { id, status: 'OUT_FOR_PICKUP' }, DRIVER)).toMatchObject({
		ok: false
	});
	expect(await advanceOrder(db, { id, status: 'COMPLETED' }, WAREHOUSE)).toMatchObject({
		ok: true
	});
	expect(await status(id)).toBe('COMPLETED');
});

test('DRIVER marks DELIVERED with a note: one STATUS_CHANGED carries it, no EDITED', async () => {
	const id = await create({ status: 'OUT_FOR_DELIVERY' });
	const earlier = orderEvents().length;
	const input = { id, status: 'DELIVERED', notes: '  Recibió el celador. Cobré $20.000  ' };
	expect(await advanceOrder(db, input, DRIVER)).toEqual({ ok: true, id });
	expect(orderEvents().slice(earlier)).toEqual([
		{
			action: 'STATUS_CHANGED',
			before: { status: 'OUT_FOR_DELIVERY', 'delivery_attributes.notes': null },
			after: {
				status: 'DELIVERED',
				'delivery_attributes.notes': 'Recibió el celador. Cobré $20.000'
			}
		}
	]);
	expect((await read(id)).pickup.notes).toBeNull();
});

test('a pickup transition writes the pickup note; blank clears it, unchanged logs nothing', async () => {
	const id = await create({ status: 'DELIVERED' });
	await advanceOrder(db, { id, status: 'OUT_FOR_PICKUP', notes: 'Llamar antes' }, DRIVER);
	expect(await read(id)).toMatchObject({
		delivery: { notes: null },
		pickup: { notes: 'Llamar antes' }
	});
	await advanceOrder(db, { id, status: 'COMPLETED', notes: '   ' }, DRIVER);
	expect((await read(id)).pickup.notes).toBeNull();
	const another = await create({ status: 'DELIVERED' });
	await advanceOrder(db, { id: another, status: 'OUT_FOR_PICKUP', notes: '' }, DRIVER);
	expect(orderEvents().at(-1)).toEqual({
		action: 'STATUS_CHANGED',
		before: { status: 'DELIVERED' },
		after: { status: 'OUT_FOR_PICKUP' }
	});
});

test('SALES marks DELIVERED on an external carrier order', async () => {
	const id = await create({
		...order1043,
		delivery_attributes: { ...address, method: 'EXTERNAL_CARRIER', time: null, carrier_id: WILSON },
		status: 'OUT_FOR_DELIVERY'
	});
	expect(await advanceOrder(db, { id, status: 'DELIVERED', notes: '' }, SALES)).toEqual({
		ok: true,
		id
	});
	expect(await status(id)).toBe('DELIVERED');
});

test('two people marking the same transition: the second is illegal and writes nothing', async () => {
	const id = await create();
	expect(await advanceOrder(db, { id, status: 'PICKED', notes: 'Todo' }, WAREHOUSE)).toMatchObject({
		ok: true
	});
	const second = { id, status: 'PICKED', notes: 'Falta un mantel' };
	expect(await advanceOrder(db, second, SALES)).toMatchObject({ ok: false });
	expect((await read(id)).delivery.notes).toBe('Todo');
	expect(orderEvents()).toHaveLength(2);
});

// Every delivery date unless the test says otherwise: the list's default is this week's.
async function listIds(input: Record<string, string> = {}): Promise<number[]> {
	return (await listOrders(db, { delivery: 'ALL', ...input }, SALES)).orders.map(({ id }) => id);
}

// Three orders: Luz Marina's on Aug 15, Jorge's on Aug 22 (a client pickup) and Luz Marina's on Sep 5.
async function createThree(): Promise<[number, number, number]> {
	const luzMarina = await create();
	const atWarehouse = { ...order1043.delivery_attributes, method: 'CLIENT_PICKUP' };
	const jorge = await create({
		...order1043,
		client_id: JORGE,
		client_name: 'Jorge Iván Betancur',
		event_date: '2026-08-22',
		delivery_attributes: atWarehouse,
		discount: 0
	});
	const september = await create({ ...order1043, event_date: '2026-09-05', transport_cost: 0 });
	return [luzMarina, jorge, september];
}

test('the list shows every order by event date, latest first, with its summary', async () => {
	const [luzMarina, jorge, september] = await createThree();
	const page = await listOrders(db, { delivery: 'ALL' }, SALES);
	expect(page.orders.map(({ id }) => id)).toEqual([september, jorge, luzMarina]);
	expect(page.total).toBe(3);
	expect(page.orders[1]).toEqual({
		id: jorge,
		clientName: 'Jorge Iván Betancur',
		eventDate: '2026-08-22',
		status: 'CONFIRMED',
		hasIncident: false,
		deliveryMethod: 'CLIENT_PICKUP',
		orderTotal: 1284000,
		balanceDue: 1284000,
		receivableId: null
	});
});

test("the balance is the total less the order's installments and refunds, not its deposit", async () => {
	const id = await create();
	await fixture.payment(id, { concept: 'INSTALLMENT', amount: '500.000' });
	await fixture.payment(id, { concept: 'SECURITY_DEPOSIT', amount: '200.000' });
	expect((await listOrders(db, { delivery: 'ALL' }, SALES)).orders[0].balanceDue).toBe(680000);
});

test('the filters combine, each over the order snapshot', async () => {
	const [luzMarina, jorge, september] = await createThree();
	await fixture.editContact(LUZ_MARINA, { full_name: 'Otro nombre', phone: '300 000 0000' });
	expect(await listIds({ text: '442 88' })).toEqual([september, luzMarina]);
	expect(await listIds({ text: '44' })).toHaveLength(3);
	expect(await listIds({ text: 'BETANCUR' })).toEqual([jorge]);
	expect(await listIds({ from: '2026-08-22', to: '2026-08-22' })).toEqual([jorge]);
	expect(await listIds({ from: '2026-08-16' })).toEqual([september, jorge]);
	expect(await listIds({ to: '2026-08-31', text: 'luz' })).toEqual([luzMarina]);
	await fixture.advanceTo(luzMarina, 'PICKED');
	expect(await listIds({ status: 'PICKED' })).toEqual([luzMarina]);
});

test("letters also find the snapshot's username, without the @ and ignoring case", async () => {
	await fixture.editContact(JORGE, { whatsapp: 'LuzMarinaR' });
	const [, jorge] = await createThree();
	await fixture.editContact(LUZ_MARINA, { whatsapp: 'LuzMarinaR' });
	expect(await listIds({ text: 'luzma' })).toEqual([jorge]);
	expect(await listIds({ text: '@LUZMA' })).toEqual([jorge]);
	expect(await listIds({ text: '@luzmarinar betancur' })).toEqual([]);
});

test('incidents only is its own filter, in SQL', async () => {
	const [luzMarina] = await createThree();
	await fixture.advanceTo(luzMarina, 'DELIVERED');
	expect(await reportLost(luzMarina)).toMatchObject({ ok: true });
	expect(await listIds({ hasIncident: '1' })).toEqual([luzMarina]);
	expect(await listIds({ hasIncident: '1' })).toHaveLength(1);
});

test('an empty or tampered value is ignored, not an error', async () => {
	await createThree();
	const page = await listOrders(
		db,
		{ delivery: 'ALL', status: 'FOO', from: 'ayer', hasIncident: 'sí', text: '  ' },
		SALES
	);
	expect(page.orders).toHaveLength(3);
	expect(page.filters).toEqual({ delivery: 'ALL', page: 1 });
});

test('the list is paginated in SQL, a page past the last showing the last', async () => {
	const ids = [];
	for (let i = 0; i <= ORDERS_PAGE_SIZE; i += 1) {
		ids.push(await create());
	}
	const first = await listOrders(db, { delivery: 'ALL' }, SALES);
	expect(first.orders).toHaveLength(ORDERS_PAGE_SIZE);
	expect(first).toMatchObject({ total: ORDERS_PAGE_SIZE + 1, pageCount: 2 });
	const second = await listOrders(db, { delivery: 'ALL', page: '2' }, SALES);
	expect(second.orders.map(({ id }) => id)).toEqual([ids[0]]);
	expect(second.filters.page).toBe(2);
	const beyond = await listOrders(db, { delivery: 'ALL', page: '9' }, SALES);
	expect(beyond.orders.map(({ id }) => id)).toEqual([ids[0]]);
	expect(beyond.filters.page).toBe(2);
	expect((await listOrders(db, { page: 'dos' }, SALES)).filters.page).toBe(1);
});

test('no order at all is one empty page', async () => {
	expect(await listOrders(db, {}, SALES)).toMatchObject({ orders: [], total: 0, pageCount: 1 });
});

test('the name search ignores accents, tildes, case and extra spaces, every word in any order', async () => {
	const [luzMarina, jorge] = await createThree();
	const renamed = { ...order1043, id: luzMarina, client_name: 'ÁNGELA MARÍA NÚÑEZ ARGÜELLO' };
	expect(await updateOrder(db, renamed, SALES)).toEqual({ ok: true, id: luzMarina });
	expect(await listIds({ text: 'ivan     betancur' })).toEqual([jorge]);
	expect(await listIds({ text: '  BETANCUR   jorge ' })).toEqual([jorge]);
	expect(await listIds({ text: 'Iván Betancur' })).toEqual([jorge]);
	expect(await listIds({ text: 'angela nunez arguello' })).toEqual([luzMarina]);
	expect(await listIds({ text: 'maría núñez' })).toEqual([luzMarina]);
	expect(await listIds({ text: 'jorge restrepo' })).toEqual([]);
	expect((await listOrders(db, { text: 'ivan     betancur' }, SALES)).filters.text).toBe(
		'ivan betancur'
	);
});

test("the list defaults to this week's deliveries, Monday to Sunday in Bogotá", async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	onTestFinished(() => {
		vi.useRealTimers();
	});
	// Wednesday Aug 12, 2026 at 8 p.m. in Bogotá, already Thursday in UTC.
	vi.setSystemTime(new Date('2026-08-13T01:00:00Z'));
	const deliveringOn = (delivery: string, pickup: string) =>
		create({ ...order1043, delivery_date: delivery, pickup_date: pickup, event_date: pickup });
	const today = await deliveringOn('2026-08-12', '2026-08-13');
	const sunday = await deliveringOn('2026-08-16', '2026-08-17');
	const nextMonday = await deliveringOn('2026-08-17', '2026-08-18');
	const later = await deliveringOn('2026-08-24', '2026-08-25');
	const lastSunday = await deliveringOn('2026-08-09', '2026-08-10');
	expect(await listIds({ delivery: 'TODAY' })).toEqual([today]);
	expect(await listIds({ delivery: 'THIS_WEEK' })).toEqual([sunday, today]);
	expect(await listIds({ delivery: 'NEXT_WEEK' })).toEqual([nextMonday]);
	expect(await listIds({ delivery: 'ALL' })).toEqual([
		later,
		nextMonday,
		sunday,
		today,
		lastSunday
	]);
	const thisWeek = [sunday, today];
	expect((await listOrders(db, {}, SALES)).orders.map(({ id }) => id)).toEqual(thisWeek);
	const tampered = await listOrders(db, { delivery: 'FOO' }, SALES);
	expect(tampered.orders.map(({ id }) => id)).toEqual(thisWeek);
	expect(tampered.filters.delivery).toBe('THIS_WEEK');
});

test('WAREHOUSE and DRIVER get a 403 on the list', async () => {
	for (const actor of [WAREHOUSE, DRIVER]) {
		await expect(listOrders(db, {}, actor)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	}
});

type Payment = { concept: string; amount: string; date?: string };

// Through the order's payment entry, by transfer: each movement with its receipt and event.
async function pay(orderId: number, payments: Payment[]): Promise<number[]> {
	const ids = [];
	for (const { concept, amount, date } of payments) {
		const id = await fixture.payment(orderId, {
			concept,
			amount,
			payment_method: 'TRANSFER',
			bank_account: 'Bancolombia ahorros 052-334198-07',
			movement_date: date ?? '2026-08-01'
		});
		ids.push(id);
	}
	return ids;
}

async function detail(id: number) {
	const found = await getOrderDetail(db, String(id), SALES);
	if (null === found) {
		throw new Error(`Order ${id} not found`);
	}
	return found;
}

test('two installments and a refund: what was paid, and the balance left', async () => {
	const id = await create();
	await pay(id, [
		{ concept: 'INSTALLMENT', amount: '500.000' },
		{ concept: 'INSTALLMENT', amount: '300.000' },
		{ concept: 'INSTALLMENT_REFUND', amount: '100.000' }
	]);
	expect(await detail(id)).toMatchObject({ paid: 700000, balanceDue: 480000, depositHeld: 0 });
});

test('an installment offset from Caja counts as a negative one', async () => {
	const id = await create();
	await pay(id, [{ concept: 'INSTALLMENT', amount: '500.000' }]);
	const [original] = (await detail(id)).payments;
	const offset = {
		reverses_id: String(original.id),
		payment_method: 'CASH',
		movement_date: '2026-08-01'
	};
	expect(await recordOffset(db, offset, MANAGER)).toMatchObject({ ok: true });
	expect(await detail(id)).toMatchObject({ paid: 0, balanceDue: 1180000 });
});

test('a deposit and its partial refund are held apart, never lowering the balance', async () => {
	const id = await create();
	await pay(id, [
		{ concept: 'SECURITY_DEPOSIT', amount: '200.000' },
		{ concept: 'DEPOSIT_REFUND', amount: '150.000' }
	]);
	expect(await detail(id)).toMatchObject({
		paid: 0,
		balanceDue: 1180000,
		depositHeld: 50000,
		depositAmount: 200000,
		orderTotal: 1180000
	});
});

test('a carrier payment changes neither the balance nor the total', async () => {
	const delivery = {
		...order1043.delivery_attributes,
		method: 'EXTERNAL_CARRIER',
		carrier_id: WILSON
	};
	const id = await create({ ...order1043, delivery_attributes: delivery });
	await pay(id, [{ concept: 'CARRIER_PAYMENT', amount: '120.000' }]);
	expect(await detail(id)).toMatchObject({ paid: 0, balanceDue: 1180000, orderTotal: 1180000 });
});

test("an overpaid order's balance comes back negative: the client's credit", async () => {
	const id = await create();
	await pay(id, [{ concept: 'INSTALLMENT', amount: '1.200.000' }]);
	expect((await detail(id)).balanceDue).toBe(-20000);
});

test('the detail lists the order movements oldest first, and says who cancelled it and why', async () => {
	const id = await create();
	const [deposit, installment] = await pay(id, [
		{ concept: 'SECURITY_DEPOSIT', amount: '200.000', date: '2026-08-10' },
		{ concept: 'INSTALLMENT', amount: '500.000', date: '2026-08-02' }
	]);
	const other = await create();
	await pay(other, [{ concept: 'INSTALLMENT', amount: '1.000' }]);
	const order = await detail(id);
	expect(order.payments).toEqual([
		{
			id: installment,
			movementDate: '2026-08-02',
			concept: 'INSTALLMENT',
			amount: 500000,
			method: 'TRANSFER',
			otherMethod: null,
			payee: 'Luz Marina Restrepo',
			receiptNumber: 2,
			description: null,
			pairedReceiptNumber: null
		},
		{
			id: deposit,
			movementDate: '2026-08-10',
			concept: 'SECURITY_DEPOSIT',
			amount: 200000,
			method: 'TRANSFER',
			otherMethod: null,
			payee: 'Luz Marina Restrepo',
			receiptNumber: 1,
			description: null,
			pairedReceiptNumber: null
		}
	]);
	expect(order.cancellation).toBeNull();
	await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, SALES);
	expect((await detail(id)).cancellation).toMatchObject({
		cancelledBy: 'sales',
		reason: 'El cliente aplazó el evento'
	});
});

test('an unknown or malformed id has no detail; WAREHOUSE and DRIVER read it, for Despachos', async () => {
	const id = await create();
	expect(await getOrderDetail(db, '99', SALES)).toBeNull();
	expect(await getOrderDetail(db, 'abc', SALES)).toBeNull();
	for (const actor of [WAREHOUSE, DRIVER]) {
		expect((await getOrderDetail(db, id, actor))?.orderTotal).toBeGreaterThan(0);
	}
});

test("the order's name is the one typed: it may say more than the contact, which stays as it is", async () => {
	const id = await create({ ...order1043, client_name: 'Luz Marina Restrepo — boda Gil' });
	expect((await read(id)).client).toEqual({
		name: 'Luz Marina Restrepo — boda Gil',
		phone: '573104428890',
		whatsapp: null
	});
	expect((await getContact(db, LUZ_MARINA, SALES))?.fullName).toBe('Luz Marina Restrepo');
});

function contactsNamed(fullName: string) {
	return database
		.prepare('select count(*) as count from contacts where full_name = ?')
		.get(fullName)?.count;
}

function contactsByPhone(phone: string) {
	return database
		.prepare('select id, full_name, document_id, labels, attributes from contacts where phone = ?')
		.all(phone);
}

test('«Cliente nuevo» makes the contact and the order in one batch, linked by its document', async () => {
	const fresh = {
		...order1043,
		client_id: null,
		client_name: 'Gloria Patricia Henao',
		client_phone: '315 220 7781'
	};
	const id = await create(fresh);
	// Its source quote, «Cliente nuevo» too, made a contact of its own first.
	const contact = contactsByPhone('573152207781').at(-1)!;
	expect(contact).toMatchObject({
		full_name: 'Gloria Patricia Henao',
		labels: '[]',
		attributes: '{}'
	});
	expect(String(contact.document_id)).toMatch(/^@[0-9A-HJKMNP-TV-Z]{8}$/);
	expect(await read(id)).toMatchObject({
		clientId: contact.id,
		client: { name: 'Gloria Patricia Henao', phone: '573152207781' }
	});
	const created = database
		.prepare("select entity_type, entity_id from events where action = 'CREATED' order by id")
		.all();
	expect(created.slice(-2)).toEqual([
		{ entity_type: 'CONTACT', entity_id: contact.id },
		{ entity_type: 'ORDER', entity_id: id }
	]);
});

test('«Cliente nuevo» capitalizes the name, and the order freezes the capitalized one', async () => {
	const fresh = { ...order1043, client_id: null, client_name: 'luz marina restrepo' };
	const id = await create({ ...fresh, client_phone: '315 220 7781' });
	const [contact] = contactsByPhone('573152207781');
	expect(contact.full_name).toBe('Luz Marina Restrepo');
	expect((await read(id)).client.name).toBe('Luz Marina Restrepo');
});

test('«Cliente nuevo» needs a typed phone that normalizes, and writes nothing otherwise', async () => {
	const fresh = { ...order1043, client_id: null, client_name: 'Gloria', client_phone: '12' };
	const result = await convert(fresh);
	expect(result).toMatchObject({ ok: false, errors: { client_phone: expect.any(String) } });
	expect(contactsNamed('Gloria')).toBe(0);
	expect(database.prepare('select count(*) as count from orders').get()).toEqual({ count: 0 });
});

test('«Cliente nuevo» saves the typed phone and username on the contact, in the same batch', async () => {
	const fresh = {
		...order1043,
		client_id: null,
		client_name: 'Gloria Patricia Henao',
		client_phone: '315 220 7781',
		client_whatsapp: ' @GloriaH '
	};
	const id = await create(fresh);
	// Its source quote, «Cliente nuevo» too, made a contact of its own first.
	const contact = database
		.prepare("select id, phone, whatsapp from contacts where full_name = 'Gloria Patricia Henao'")
		.all()
		.at(-1);
	expect(contact).toMatchObject({ phone: '573152207781', whatsapp: 'GloriaH' });
	expect(await read(id)).toMatchObject({
		clientId: contact?.id,
		client: { name: 'Gloria Patricia Henao', phone: '573152207781', whatsapp: 'GloriaH' }
	});
});

test('«Cliente nuevo» saves with only a username, or with neither', async () => {
	const onlyUsername = await create({
		...order1043,
		client_id: null,
		client_name: 'Mayra Castaño',
		client_phone: '',
		client_whatsapp: 'wa.me/MayC47'
	});
	expect((await read(onlyUsername)).client).toEqual({
		name: 'Mayra Castaño',
		phone: null,
		whatsapp: 'MayC47'
	});
	const neither = await create({
		...order1043,
		client_id: null,
		client_name: 'Andrés Gil',
		client_phone: undefined
	});
	expect((await read(neither)).client).toEqual({ name: 'Andrés Gil', phone: null, whatsapp: null });
	const saved = [
		await getContact(db, (await read(onlyUsername)).clientId, SALES),
		await getContact(db, (await read(neither)).clientId, SALES)
	];
	expect(saved).toMatchObject([
		{ fullName: 'Mayra Castaño', phone: null, whatsapp: 'MayC47' },
		{ fullName: 'Andrés Gil', phone: null, whatsapp: null }
	]);
});

test("«Cliente nuevo» refuses a username that isn't one, and writes nothing", async () => {
	const fresh = { ...order1043, client_id: null, client_name: 'Gloria', client_whatsapp: 'may-c' };
	const result = await convert(fresh);
	expect(result).toMatchObject({
		ok: false,
		errors: { client_whatsapp: 'Escriba el usuario como aparece en WhatsApp, por ejemplo @mayc47.' }
	});
	expect(contactsNamed('Gloria')).toBe(0);
});

test("picking a contact freezes its phone and username, not the typed ones, and later edits don't reach the order", async () => {
	await fixture.editContact(LUZ_MARINA, { whatsapp: 'LuzMarinaR' });
	const typed = { ...order1043, client_phone: '300 000 0000', client_whatsapp: '@otro_usuario' };
	const id = await create(typed);
	expect((await read(id)).client).toEqual({
		name: 'Luz Marina Restrepo',
		phone: '573104428890',
		whatsapp: 'LuzMarinaR'
	});
	await fixture.editContact(LUZ_MARINA, { phone: '', whatsapp: 'LuzMa' });
	expect((await read(id)).client).toMatchObject({ phone: '573104428890', whatsapp: 'LuzMarinaR' });
	expect(await updateOrder(db, { ...typed, id, client_whatsapp: '' }, SALES)).toEqual({
		ok: true,
		id
	});
	expect((await read(id)).client).toMatchObject({ phone: '573104428890', whatsapp: 'LuzMarinaR' });
});

test("the snapshots' Zod schemas require both the phone and the username, each a string or null", () => {
	const client = { name: 'Luz Marina Restrepo', phone: null, whatsapp: 'LuzMarinaR' };
	expect(clientAttributesSchema.safeParse(client).success).toBe(true);
	expect(clientAttributesSchema.safeParse({ name: 'Luz', phone: '573104428890' }).success).toBe(
		false
	);
	expect(clientAttributesSchema.safeParse({ name: 'Luz', whatsapp: null }).success).toBe(false);
	const trip = {
		method: 'EXTERNAL_CARRIER',
		time: null,
		address_1: 'Calle 10',
		address_2: null,
		notes: null
	};
	const carrier = { id: 2, name: 'Wilson Muñoz', phone: null, whatsapp: 'WilsonMudanzas' };
	expect(deliveryAttributesSchema.safeParse({ ...trip, carrier }).success).toBe(true);
	const noUsername = { id: 2, name: 'Wilson Muñoz', phone: null };
	expect(deliveryAttributesSchema.safeParse({ ...trip, carrier: noUsername }).success).toBe(false);
	const noPhone = { id: 2, name: 'Wilson Muñoz', whatsapp: 'WilsonMudanzas' };
	expect(deliveryAttributesSchema.safeParse({ ...trip, carrier: noPhone }).success).toBe(false);
});

test("picking an external carrier freezes his username with his phone, null when he hasn't one", async () => {
	const carrierId = await fixture.contact({
		full_name: 'Wilson Mudanzas',
		phone: '',
		whatsapp: 'WilsonMudanzas',
		labels: ['TRANSPORTER']
	});
	const delivery = { ...order1043.delivery_attributes, method: 'EXTERNAL_CARRIER' };
	const pickup = { ...order1043.pickup_attributes, method: 'EXTERNAL_CARRIER' };
	const id = await create({
		...order1043,
		delivery_attributes: { ...delivery, carrier_id: carrierId },
		pickup_attributes: { ...pickup, carrier_id: WILSON }
	});
	const order = await read(id);
	expect(order.delivery.carrier).toEqual({
		id: carrierId,
		name: 'Wilson Mudanzas',
		phone: null,
		whatsapp: 'WilsonMudanzas'
	});
	expect(order.pickup.carrier).toMatchObject({ phone: '573119085512', whatsapp: null });
});

test('«Cliente nuevo» on an edit makes the contact and moves the order to it', async () => {
	const id = await create();
	const fresh = {
		client_id: null,
		client_name: 'Gloria Patricia Henao',
		client_phone: '315 220 7781'
	};
	expect(await updateOrder(db, { ...order1043, id, ...fresh }, SALES)).toEqual({ ok: true, id });
	const [contact] = contactsByPhone('573152207781');
	expect(await read(id)).toMatchObject({
		clientId: contact.id,
		client: { name: 'Gloria Patricia Henao' }
	});
	expect(await getContact(db, LUZ_MARINA, SALES)).toMatchObject({
		fullName: 'Luz Marina Restrepo',
		phone: '573104428890'
	});
});

test('with no product list, availability covers the whole catalog', async () => {
	await book({ status: 'CONFIRMED', delivery: '2026-08-14', pickup: '2026-08-16', qty: 100 });
	const range = { delivery_date: '2026-08-15', pickup_date: '2026-08-15' };
	expect(await getAvailability(db, range, SALES)).toEqual([
		{ productId: CHAIRS, available: 400 },
		{ productId: TABLES, available: 500 },
		{ productId: GLASSES, available: 500 },
		{ productId: INACTIVE_TABLECLOTH, available: 500 }
	]);
});

test("the form's live check brings the catalog's availability and the warnings, or nothing for half-typed dates", async () => {
	const id = await create();
	const schedule = await checkOrderSchedule(db, { ...trips, pickup_date: '2026-08-17' }, SALES);
	expect(schedule?.availability).toHaveLength(4);
	expect(schedule?.warnings.holidays).toEqual([{ trip: 'PICKUP', ...ASSUMPTION }]);
	expect(schedule?.warnings.clashes.map(({ orderId }) => orderId)).toEqual([id]);
	expect(await checkOrderSchedule(db, { ...trips, pickup_date: '2026-08' }, SALES)).toBeNull();
	expect(await checkOrderSchedule(db, { ...trips, pickup_date: '2026-08-01' }, SALES)).toBeNull();
});

// The payment entry as it posts: every field as text, the order's id from the URL.
function typedPayment(orderId: number, fields: Record<string, string> = {}) {
	return {
		order_id: String(orderId),
		concept: 'INSTALLMENT',
		payment_method: 'CASH',
		amount: '$300.000',
		movement_date: '2026-08-01',
		notes: '',
		...fields
	};
}

async function recordPayment(orderId: number, fields: Record<string, string>, actor = MANAGER) {
	const result = await recordOrderPayment(db, typedPayment(orderId, fields), actor);
	if (!result.ok) {
		throw new Error(JSON.stringify(result));
	}
	return { ...database.prepare('select * from cash_movements where id = ?').get(result.id) };
}

function withCarriers(deliveryCarrier: number | null, pickupCarrier: number | null) {
	const trip = (method: string, carrier: number | null) =>
		null === carrier ? { method } : { method: 'EXTERNAL_CARRIER', carrier_id: carrier };
	return {
		...order1043,
		delivery_attributes: {
			...order1043.delivery_attributes,
			...trip('COMPANY_DELIVERY', deliveryCarrier)
		},
		pickup_attributes: { ...order1043.pickup_attributes, ...trip('COMPANY_PICKUP', pickupCarrier) }
	};
}

test("an order payment is linked to its order, signed by its concept, its payee the client's name", async () => {
	const id = await create();
	const installment = await recordPayment(id, { payee: 'Otro nombre' }, SALES);
	expect(installment).toMatchObject({
		concept: 'INSTALLMENT',
		amount: 300000,
		entity_type: 'ORDER',
		entity_id: id,
		payee: 'Luz Marina Restrepo',
		created_by: 'sales'
	});
	const refund = await recordPayment(id, { concept: 'INSTALLMENT_REFUND', amount: '50.000' });
	expect(refund).toMatchObject({ amount: -50000, payee: 'Luz Marina Restrepo' });
	const event = database
		.prepare("select action, entity_id from events where entity_type = 'CASH_MOVEMENT'")
		.all();
	expect(event).toEqual([
		{ action: 'CREATED', entity_id: installment.id },
		{ action: 'CREATED', entity_id: refund.id }
	]);
	expect(await detail(id)).toMatchObject({ paid: 250000, balanceDue: 930000 });
});

test('a payment on an order that does not exist is rejected, and writes nothing', async () => {
	const result = await recordOrderPayment(db, typedPayment(99), MANAGER);
	expect(result).toMatchObject({ ok: false, message: 'Ese pedido no existe.' });
	expect(database.prepare('select count(*) as count from cash_movements').get()).toEqual({
		count: 0
	});
});

test('a billed order refuses a «Pago», and still takes a refund', async () => {
	const id = await create();
	const receivableId = await bill(id);
	expect(await recordOrderPayment(db, typedPayment(id), MANAGER)).toEqual({
		ok: false,
		message: `El pago va en la cuenta de cobro Nº ${receivableId}.`,
		errors: {}
	});
	const refund = await recordPayment(id, { concept: 'INSTALLMENT_REFUND' });
	expect(refund).toMatchObject({ amount: -300000, entity_type: 'ORDER' });
});

test('SALES records money in only; WAREHOUSE records nothing: a 403', async () => {
	const id = await create(withCarriers(WILSON, null));
	for (const concept of ['INSTALLMENT_REFUND', 'DEPOSIT_REFUND', 'CARRIER_PAYMENT']) {
		await expect(recordOrderPayment(db, typedPayment(id, { concept }), SALES)).rejects.toSatisfy(
			(thrown) => isHttpError(thrown, 403)
		);
	}
	await expect(recordOrderPayment(db, typedPayment(id), WAREHOUSE)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 403)
	);
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT' }, SALES);
});

test('a carrier payment needs an order with a carrier, and goes to its name, editable', async () => {
	const without = await create();
	const refused = await recordOrderPayment(
		db,
		typedPayment(without, { concept: 'CARRIER_PAYMENT' }),
		MANAGER
	);
	expect(refused).toMatchObject({ ok: false, message: 'Este pedido no tiene transportador.' });
	const id = await create(withCarriers(null, WILSON));
	const paid = await recordPayment(id, { concept: 'CARRIER_PAYMENT', amount: '60.000' });
	expect(paid).toMatchObject({ amount: -60000, payee: 'Wilson Muñoz' });
	const edited = await recordPayment(id, { concept: 'CARRIER_PAYMENT', payee: 'Wilson M.' });
	expect(edited.payee).toBe('Wilson M.');
	expect(await detail(id)).toMatchObject({ paid: 0, balanceDue: 1180000 });
});

test('with two different carriers, the carrier payment says which one it pays', async () => {
	const id = await create(withCarriers(ABURRA, WILSON));
	const unpicked = await recordOrderPayment(
		db,
		typedPayment(id, { concept: 'CARRIER_PAYMENT' }),
		MANAGER
	);
	expect(unpicked).toMatchObject({ ok: false, errors: { trip: 'Escoge a cuál transportador' } });
	const paid = await recordPayment(id, { concept: 'CARRIER_PAYMENT', trip: 'DELIVERY' });
	expect(paid.payee).toBe('Transportes Aburrá');
	const same = await create(withCarriers(WILSON, WILSON));
	expect((await recordPayment(same, { concept: 'CARRIER_PAYMENT' })).payee).toBe('Wilson Muñoz');
});

test('payments are recorded on a cancelled order too', async () => {
	const id = await create();
	await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, SALES);
	await recordPayment(id, { concept: 'INSTALLMENT_REFUND' });
	expect((await detail(id)).balanceDue).toBe(1480000);
});

test('a transfer out needs the account, a copy the contact or order never change', async () => {
	const id = await create();
	const transfer = { concept: 'DEPOSIT_REFUND', payment_method: 'TRANSFER' };
	const missing = await recordOrderPayment(db, typedPayment(id, transfer), MANAGER);
	expect(missing).toMatchObject({
		ok: false,
		errors: { bank_account: 'Escribe la cuenta de destino' }
	});
	const account = 'Bancolombia ahorros 052-334198-07';
	const refund = await recordPayment(id, { ...transfer, bank_account: account });
	await fixture.editContact(LUZ_MARINA, { bank_account: 'Otra cuenta', full_name: 'Otra' });
	const edited = { ...order1043, client_id: JORGE, client_name: 'Jorge Iván Betancur' };
	expect(await updateOrder(db, { ...edited, id }, SALES)).toMatchObject({ ok: true });
	const stored = database.prepare('select payee, attributes from cash_movements').get();
	expect(stored).toEqual({
		payee: refund.payee,
		attributes: JSON.stringify({ bank_account: account })
	});
	const bank = { bank_account: 'Davivienda' };
	const inflow = await recordPayment(id, { payment_method: 'TRANSFER', ...bank });
	expect(inflow.attributes).toBe(JSON.stringify(bank));
});

test('a paid order takes no more «Pago»: its deposit and refunds stay, and a refund reopens it', async () => {
	const id = await create();
	await recordPayment(id, { amount: '1.180.000' }, SALES);
	const again = await recordOrderPayment(db, typedPayment(id), SALES);
	expect(again).toMatchObject({ ok: false, message: 'Este pedido ya está pagado.' });
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT' }, SALES);
	await recordPayment(id, { concept: 'INSTALLMENT_REFUND', amount: '10.000' });
	expect(await recordOrderPayment(db, typedPayment(id), SALES)).toMatchObject({ ok: true });
});

test.each(['INSTALLMENT', 'SECURITY_DEPOSIT', 'INSTALLMENT_REFUND'])(
	'a %s never changes the status',
	async (concept) => {
		const id = await create();
		await recordPayment(id, { concept, amount: '10.000' });
		expect(await detail(id)).toMatchObject({ status: 'CONFIRMED' });
		const cancelled = await create();
		await cancelOrder(db, { id: cancelled, reason: 'Cambió de fecha' }, SALES);
		await recordPayment(cancelled, { concept, amount: '10.000' });
		expect(await detail(cancelled)).toMatchObject({ status: 'CANCELLED' });
		const changes = database
			.prepare("select count(*) as count from events where action = 'STATUS_CHANGED'")
			.get();
		expect(changes).toEqual({ count: 0 });
	}
);

test('the entry offers «Pago» while there is a balance, the deposit until complete, money out to the manager', async () => {
	const id = await create();
	const offeredTo = async (actor: Actor) => offeredPaymentConcepts(await detail(id), actor);
	expect(await offeredTo(SALES)).toEqual(['INSTALLMENT', 'SECURITY_DEPOSIT']);
	await recordPayment(id, { amount: '1.180.000' }, SALES);
	expect(await offeredTo(SALES)).toEqual(['SECURITY_DEPOSIT']);
	const { depositAmount } = await detail(id);
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT', amount: String(depositAmount) }, SALES);
	expect(await offeredTo(SALES)).toEqual([]);
	expect(await offeredTo(MANAGER)).toEqual(['INSTALLMENT_REFUND', 'DEPOSIT_REFUND']);
});

// The driver's payments (#605): on the road only, money in under the office's conditions, the
// whole deposit back at pickup while the order has no active incident.
function reportLost(orderId: number) {
	const items = [{ product_id: CHAIRS, qty: 2, outcome: 'LOST' }];
	const input = { order_id: String(orderId), incident_description: 'Se perdieron', items };
	return reportIncident(db, input, DRIVER);
}

// The order alone in a new cuenta de cobro: its number.
async function bill(orderId: number): Promise<number> {
	const issued = await issueReceivable(db, { orders: [orderId], payment_terms: 'Contado' }, SALES);
	if (!issued.ok) {
		throw new Error(issued.message);
	}
	return issued.id;
}

test('Despachos offers «Pago» and the deposit on the road, and the deposit back at pickup', async () => {
	const offered = async (id: number, actor: Actor = DRIVER) =>
		getDespachosPaymentEntry(await detail(id), actor).concepts;
	for (const status of ['CONFIRMED', 'PICKED', 'COMPLETED', 'CANCELLED'] satisfies OrderStatus[]) {
		const id = await create({ status });
		expect(await offered(id)).toEqual([]);
		expect(await offered(id, MANAGER)).toEqual([]);
		expect(await offered(id, SALES)).toEqual([]);
	}
	const onTheRoad = [];
	for (const status of [
		'OUT_FOR_DELIVERY',
		'DELIVERED',
		'OUT_FOR_PICKUP'
	] satisfies OrderStatus[]) {
		const id = await create({ status });
		expect(await offered(id)).toEqual(['INSTALLMENT', 'SECURITY_DEPOSIT']);
		onTheRoad.push(id);
	}
	const [, delivered, atPickup] = onTheRoad;
	const deposit = { concept: 'SECURITY_DEPOSIT', amount: '200.000' };
	await recordPayment(atPickup, deposit, SALES);
	expect(await offered(atPickup)).toEqual(['INSTALLMENT', 'DEPOSIT_REFUND']);
	await recordPayment(delivered, deposit, SALES);
	expect(await offered(delivered)).toEqual(['INSTALLMENT']);
	expect(await offered(atPickup, WAREHOUSE)).toEqual([]);
	expect(await reportLost(atPickup)).toMatchObject({ ok: true });
	expect(await offered(atPickup)).toEqual(['INSTALLMENT', 'DEPOSIT_REFUND', 'DAMAGE_CHARGE']);
	await bill(atPickup);
	expect(await offered(atPickup)).toEqual([]);
});

test('in Despachos the office gets the on-the-road set too, Sales without the refund', async () => {
	const id = await create({ ...withCarriers(null, WILSON), status: 'OUT_FOR_PICKUP' });
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT', amount: '200.000' }, SALES);
	const entryOf = async (actor: Actor) => getDespachosPaymentEntry(await detail(id), actor);
	expect((await entryOf(MANAGER)).concepts).toEqual(['INSTALLMENT', 'DEPOSIT_REFUND']);
	expect((await entryOf(ADMIN)).concepts).toEqual(['INSTALLMENT', 'DEPOSIT_REFUND']);
	expect((await entryOf(SALES)).concepts).toEqual(['INSTALLMENT']);
	const salesDriver = actorWith('SALES', 'DRIVER');
	expect((await entryOf(salesDriver)).concepts).toEqual(['INSTALLMENT', 'DEPOSIT_REFUND']);
	for (const actor of [DRIVER, MANAGER, SALES]) {
		expect((await entryOf(actor)).methods).toEqual(['CASH', 'TRANSFER']);
	}
	expect(offeredPaymentConcepts(await detail(id), DRIVER)).toEqual([]);
});

test("Despachos locks the refund to the whole deposit for whoever isn't the manager", async () => {
	const id = await create({ status: 'OUT_FOR_PICKUP' });
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT', amount: '200.000' }, SALES);
	const locksOf = async (actor: Actor) =>
		getDespachosPaymentEntry(await detail(id), actor).amountLocks;
	expect((await locksOf(DRIVER)).DEPOSIT_REFUND).toBe(
		'Se devuelve todo el depósito recibido. Una devolución parcial la hace la oficina.'
	);
	expect((await locksOf(DRIVER)).INSTALLMENT).toBeUndefined();
	expect((await locksOf(MANAGER)).DEPOSIT_REFUND).toBeUndefined();
});

test('with an active incident, the driver keeps part of the deposit and gives back the rest', async () => {
	const id = await create({ status: 'OUT_FOR_PICKUP' });
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT', amount: '200.000' }, SALES);
	expect(await reportLost(id)).toMatchObject({ ok: true });
	const offered = async () => getDespachosPaymentEntry(await detail(id), DRIVER).concepts;
	expect(await offered()).toEqual(expect.arrayContaining(['DAMAGE_CHARGE', 'DEPOSIT_REFUND']));
	const charge = await recordOrderPayment(
		db,
		typedPayment(id, damage('DEPOSIT', '120.000')),
		DRIVER
	);
	expect(charge).toMatchObject({ ok: true });
	expect((await detail(id)).depositHeld).toBe(80000);
	const rest = await recordOrderPayment(
		db,
		typedPayment(id, { concept: 'DEPOSIT_REFUND', amount: '80.000', payment_method: 'CASH' }),
		DRIVER
	);
	expect(rest).toMatchObject({ ok: true });
	expect((await detail(id)).depositHeld).toBe(0);
});

test('the cash hint shows only to whoever keeps an «Efectivo por entregar»', async () => {
	const id = await create({ status: 'DELIVERED' });
	const hintFor = async (actor: Actor) =>
		getDespachosPaymentEntry(await detail(id), actor).methodHints.CASH;
	const hint =
		'El efectivo queda en tu cuenta de «Efectivo por entregar» hasta que lo entregues en la oficina.';
	expect(await hintFor(DRIVER)).toBe(hint);
	expect(await hintFor(SALES)).toBe(hint);
	expect(await hintFor(MANAGER)).toBeUndefined();
	expect(await hintFor(actorWith('MANAGER', 'DRIVER'))).toBeUndefined();
});

test('the driver records «Pago» and the deposit on the road, in cash or by transfer, as its author', async () => {
	const id = await create({ status: 'OUT_FOR_DELIVERY' });
	const installment = await recordPayment(id, { amount: '680.000' }, DRIVER);
	expect(installment).toMatchObject({
		concept: 'INSTALLMENT',
		amount: 680000,
		payment_method: 'CASH',
		entity_id: id,
		payee: 'Luz Marina Restrepo',
		created_by: 'driver'
	});
	await fixture.advanceTo(id, 'DELIVERED');
	const transfer = { concept: 'SECURITY_DEPOSIT', payment_method: 'TRANSFER', amount: '200.000' };
	expect(await recordPayment(id, transfer, DRIVER)).toMatchObject({ created_by: 'driver' });
	await fixture.advanceTo(id, 'OUT_FOR_PICKUP');
	await recordPayment(id, { amount: '500.000' }, DRIVER);
	expect(await detail(id)).toMatchObject({ paid: 1180000, balanceDue: 0, depositHeld: 200000 });
});

test('the driver is refused off the road, with «Otro», a paid order and a complete deposit', async () => {
	const tryRecord = (orderId: number, fields: Record<string, string>) =>
		recordOrderPayment(db, typedPayment(orderId, fields), DRIVER);
	for (const status of ['CONFIRMED', 'PICKED', 'COMPLETED', 'CANCELLED'] satisfies OrderStatus[]) {
		expect(await tryRecord(await create({ status }), {})).toMatchObject({ ok: false });
	}
	const id = await create({ status: 'DELIVERED' });
	const other = await tryRecord(id, { payment_method: 'OTHER', other_method: 'Trueque' });
	expect(other).toMatchObject({ ok: false, errors: { payment_method: expect.any(String) } });
	await recordPayment(id, { amount: '1.180.000' }, DRIVER);
	expect(await tryRecord(id, {})).toMatchObject({
		ok: false,
		message: 'Este pedido ya está pagado.'
	});
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT', amount: '200.000' }, DRIVER);
	const deposit = await tryRecord(id, { concept: 'SECURITY_DEPOSIT' });
	expect(deposit).toMatchObject({ ok: false, message: 'El depósito ya está completo.' });
	expect(database.prepare('select count(*) as count from cash_movements').get()).toEqual({
		count: 2
	});
});

test('the driver gives back only the whole deposit, only at pickup', async () => {
	const id = await create({ status: 'DELIVERED' });
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT', amount: '200.000' }, SALES);
	const refund = (fields: Record<string, string> = {}) =>
		recordOrderPayment(
			db,
			typedPayment(id, { concept: 'DEPOSIT_REFUND', amount: '200.000', ...fields }),
			DRIVER
		);
	expect(await refund()).toMatchObject({ ok: false });
	await fixture.advanceTo(id, 'OUT_FOR_PICKUP');
	expect(await refund({ amount: '150.000' })).toMatchObject({
		ok: false,
		errors: { amount: expect.stringContaining('$200.000') }
	});
	const account = { payment_method: 'TRANSFER', bank_account: 'Bancolombia ahorros 052-334198-07' };
	expect(await refund(account)).toMatchObject({ ok: true });
	const [given] = database
		.prepare("select amount, created_by from cash_movements where concept = 'DEPOSIT_REFUND'")
		.all();
	expect(given).toEqual({ amount: -200000, created_by: 'driver' });
	expect((await detail(id)).depositHeld).toBe(0);
	expect(await refund()).toMatchObject({ ok: false });
});

test("a billed order allows the driver nothing, and the rest of the money out stays the manager's", async () => {
	const id = await create({ status: 'OUT_FOR_PICKUP' });
	for (const concept of ['INSTALLMENT_REFUND', 'CARRIER_PAYMENT', 'CANCELLATION_FEE']) {
		await expect(recordOrderPayment(db, typedPayment(id, { concept }), DRIVER)).rejects.toSatisfy(
			(thrown) => isHttpError(thrown, 403)
		);
	}
	const receivableId = await bill(id);
	for (const concept of ['INSTALLMENT', 'SECURITY_DEPOSIT']) {
		expect(await recordOrderPayment(db, typedPayment(id, { concept }), DRIVER)).toEqual({
			ok: false,
			message: `El pago va en la cuenta de cobro Nº ${receivableId}.`,
			errors: {}
		});
	}
});

test("the driver's refund by transfer is pre-filled with the client's account", async () => {
	await fixture.editContact(LUZ_MARINA, { bank_account: 'Cuenta Luz' });
	const id = await create();
	expect((await getPaymentOptions(db, await read(id), DRIVER)).clientBankAccount).toBe(
		'Cuenta Luz'
	);
	await expect(getPaymentOptions(db, await read(id), WAREHOUSE)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 403)
	);
});

// The planning's example: a $1.500.000 order, $800.000 paid and a $300.000 deposit, cancelled.
async function cancelledWithMoney(): Promise<number> {
	const id = await create({ ...order1043, transport_cost: 500000 });
	await recordPayment(id, { amount: '800.000' }, SALES);
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT', amount: '300.000' }, SALES);
	await cancelOrder(db, { id, reason: 'El camión llegó tarde' }, SALES);
	return id;
}

function movementsOf(id: number) {
	return database
		.prepare(
			"select concept, amount, movement_date, payee, reverses_id from cash_movements where entity_type = 'ORDER' and entity_id = ? order by id"
		)
		.all(id);
}

const fee = (source: string, amount: string) => ({
	concept: 'CANCELLATION_FEE',
	fee_source: source,
	amount
});

test('owed to the client: payments net of refunds plus the deposit held; a fee from payments lowers it', async () => {
	const id = await cancelledWithMoney();
	expect(await detail(id)).toMatchObject({
		orderTotal: 1500000,
		balanceDue: 700000,
		owedToClient: 1100000
	});
	await recordPayment(id, fee('INSTALLMENTS', '150.000'));
	expect((await detail(id)).owedToClient).toBe(950000);
	await recordPayment(id, { concept: 'INSTALLMENT_REFUND', amount: '650.000' });
	await recordPayment(id, { concept: 'DEPOSIT_REFUND', amount: '300.000' });
	expect((await detail(id)).owedToClient).toBe(0);
});

test('«Retener de los pagos» and «Retener del depósito» write a pair that nets to 0, same date', async () => {
	const id = await cancelledWithMoney();
	await recordPayment(id, fee('INSTALLMENTS', '150.000'));
	await recordPayment(id, fee('DEPOSIT', '100.000'));
	const pairs = movementsOf(id).slice(2);
	expect(pairs).toEqual([
		expect.objectContaining({ concept: 'INSTALLMENT_REFUND', amount: -150000 }),
		expect.objectContaining({ concept: 'CANCELLATION_FEE', amount: 150000 }),
		expect.objectContaining({ concept: 'DEPOSIT_REFUND', amount: -100000 }),
		expect.objectContaining({ concept: 'CANCELLATION_FEE', amount: 100000 })
	]);
	expect(pairs.reduce((sum, each) => sum + Number(each.amount), 0)).toBe(0);
	expect(new Set(pairs.map((each) => each.movement_date))).toEqual(new Set(['2026-08-01']));
	expect((await detail(id)).depositHeld).toBe(200000);
});

test('«Dinero nuevo» writes the fee alone, from the client', async () => {
	const id = await cancelledWithMoney();
	const written = await recordPayment(id, fee('NEW', '80.000'));
	expect(written).toMatchObject({
		concept: 'CANCELLATION_FEE',
		amount: 80000,
		payee: 'Luz Marina Restrepo'
	});
	expect(movementsOf(id)).toHaveLength(3);
	expect((await detail(id)).owedToClient).toBe(1100000);
});

test('a retention above what its side holds is refused, and writes nothing', async () => {
	const id = await cancelledWithMoney();
	for (const [source, amount] of [
		['INSTALLMENTS', '800.001'],
		['DEPOSIT', '300.001']
	]) {
		const result = await recordOrderPayment(db, typedPayment(id, fee(source, amount)), MANAGER);
		expect(result).toMatchObject({
			ok: false,
			errors: { amount: expect.stringContaining('Supera') }
		});
	}
	expect(movementsOf(id)).toHaveLength(2);
});

// The planning's example: #1043, $1.500.000 with a $500.000 advance, alone in its cuenta, the other
// $1.000.000 paid on the cuenta by transfer, and cancelled on its way.
async function cancelledInCuenta(): Promise<[number, number]> {
	const id = await create({ ...order1043, transport_cost: 500000 });
	await recordPayment(id, { amount: '500.000' }, SALES);
	const issued = await issueReceivable(db, { orders: [id], payment_terms: 'Contado' }, SALES);
	if (!issued.ok) {
		throw new Error(issued.message);
	}
	const payment = { id: String(issued.id), payment_method: 'TRANSFER', amount: '1.000.000' };
	const paid = await recordReceivablePayment(
		db,
		{ ...payment, movement_date: '2026-08-10', notes: '', bank_account: 'Bancolombia' },
		SALES
	);
	if (!paid.ok) {
		throw new Error(paid.message);
	}
	expect(await cancelOrder(db, { id, reason: 'Devolvieron el camión' }, SALES)).toMatchObject({
		ok: true
	});
	return [id, issued.id];
}

test('a cancelled billed order stays in its cuenta, «Anulada», and is owed the cuenta credit', async () => {
	const [id, receivableId] = await cancelledInCuenta();
	expect(orderRow(id)).toMatchObject({ status: 'CANCELLED', receivable_id: receivableId });
	expect(await getReceivableDetail(db, receivableId, SALES)).toMatchObject({
		total: 0,
		paid: 1500000,
		balance: -1500000,
		isVoid: true
	});
	const order = await detail(id);
	expect(order.owedToClient).toBe(1500000);
	expect(readOwedOnReceivable(order)?.text).toBe(
		`A favor del cliente · cuenta de cobro Nº ${receivableId}: $1.500.000`
	);
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT', amount: '200.000' }, SALES);
	expect((await detail(id)).owedToClient).toBe(1700000);
});

test("«Retener de los pagos» on a billed order goes up to its cuenta's credit", async () => {
	const [id, receivableId] = await cancelledInCuenta();
	const over = await recordOrderPayment(
		db,
		typedPayment(id, fee('INSTALLMENTS', '1.500.001')),
		MANAGER
	);
	expect(over).toMatchObject({
		ok: false,
		errors: { amount: expect.stringContaining(`cuenta de cobro Nº ${receivableId}`) }
	});
	await recordPayment(id, fee('INSTALLMENTS', '1.500.000'));
	expect((await detail(id)).owedToClient).toBe(0);
	expect((await getReceivableDetail(db, receivableId, SALES))?.balance).toBe(0);
});

test('an unbilled or uncancelled order has no «A favor del cliente» from a cuenta', async () => {
	const [billedId] = await billed();
	const unbilled = await cancelledWithMoney();
	expect(readOwedOnReceivable(await detail(billedId))).toBeNull();
	expect(readOwedOnReceivable(await detail(unbilled))).toBeNull();
	expect((await detail(unbilled)).owedToClient).toBe(1100000);
});

test('the fee is only for a cancelled order, and only for the manager', async () => {
	const confirmed = await create();
	const onConfirmed = await recordOrderPayment(
		db,
		typedPayment(confirmed, fee('NEW', '50.000')),
		MANAGER
	);
	expect(onConfirmed).toMatchObject({ ok: false });
	const id = await cancelledWithMoney();
	const bySales = recordOrderPayment(db, typedPayment(id, fee('NEW', '50.000')), SALES);
	await expect(bySales).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	expect(offeredPaymentConcepts(await detail(id), MANAGER)).toContain('CANCELLATION_FEE');
	expect(offeredPaymentConcepts(await detail(id), SALES)).not.toContain('CANCELLATION_FEE');
	expect(offeredPaymentConcepts(await detail(confirmed), MANAGER)).not.toContain(
		'CANCELLATION_FEE'
	);
});

test('each half of a pair is offset on its own from Caja', async () => {
	const id = await cancelledWithMoney();
	const feeHalf = await recordPayment(id, fee('INSTALLMENTS', '150.000'));
	const offset = {
		reverses_id: String(feeHalf.id),
		payment_method: 'CASH',
		movement_date: '2026-08-02'
	};
	expect(await recordOffset(db, offset, MANAGER)).toMatchObject({ ok: true });
	expect(movementsOf(id).slice(2)).toEqual([
		expect.objectContaining({ concept: 'INSTALLMENT_REFUND', amount: -150000, reverses_id: null }),
		expect.objectContaining({ concept: 'CANCELLATION_FEE', amount: 150000, reverses_id: null }),
		expect.objectContaining({
			concept: 'CANCELLATION_FEE',
			amount: -150000,
			reverses_id: feeHalf.id
		})
	]);
});

test('nothing blocks on the amounts: above the balance, what was paid, or the deposit held', async () => {
	const id = await create();
	await recordPayment(id, { amount: '1.500.000' }, SALES);
	await recordPayment(id, { concept: 'INSTALLMENT_REFUND', amount: '2.000.000' });
	await recordPayment(id, { concept: 'DEPOSIT_REFUND', amount: '100.000' });
	expect(await detail(id)).toMatchObject({ paid: -500000, depositHeld: -100000 });
});

test("the payment entry pre-fills from the client's and each carrier's saved account", async () => {
	await fixture.editContact(LUZ_MARINA, { bank_account: 'Cuenta Luz' });
	await fixture.editContact(WILSON, { bank_account: 'Cuenta Wilson' });
	const id = await create(withCarriers(ABURRA, WILSON));
	expect(await getPaymentOptions(db, await read(id), MANAGER)).toEqual({
		clientBankAccount: 'Cuenta Luz',
		carriers: [
			{ trip: 'DELIVERY', name: 'Transportes Aburrá', bankAccount: null },
			{ trip: 'PICKUP', name: 'Wilson Muñoz', bankAccount: 'Cuenta Wilson' }
		]
	});
});

async function timeline(id: number, actor: Actor = SALES) {
	const entries = await getOrderTimeline(db, id, actor);
	if (null === entries) {
		throw new Error(`Order ${id} not found`);
	}
	return entries;
}

async function editId(id: number): Promise<number> {
	const entry = (await timeline(id)).find(({ action }) => 'EDITED' === action);
	return entry?.id ?? 0;
}

test("the timeline lists the order's events newest first, who and when, without their fields", async () => {
	const id = await create();
	expect(await updateOrder(db, { ...edited1043, id }, SALES)).toMatchObject({ ok: true });
	await advanceOrder(db, { id, status: 'PICKED' }, WAREHOUSE);
	await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, MANAGER);
	const entries = await timeline(id);
	expect(
		entries.map(({ action, status, reason, actorUsername }) => ({
			action,
			status,
			reason,
			actorUsername
		}))
	).toEqual([
		{
			action: 'CANCELLED',
			status: 'CANCELLED',
			reason: 'El cliente aplazó el evento',
			actorUsername: 'manager'
		},
		{ action: 'STATUS_CHANGED', status: 'PICKED', reason: null, actorUsername: 'warehouse' },
		{ action: 'EDITED', status: null, reason: null, actorUsername: 'sales' },
		{ action: 'CREATED', status: 'CONFIRMED', reason: null, actorUsername: 'manager' }
	]);
	expect(entries[0].createdAt).toEqual(expect.any(Number));
	expect(entries[0]).not.toHaveProperty('before');
	expect(entries[0]).not.toHaveProperty('after');
	expect(await getOrderTimeline(db, 999, SALES)).toBeNull();
});

test('an edit opens in its named, formatted changes, the client by name and lines per product', async () => {
	const id = await create();
	await updateOrder(db, { ...edited1043, id }, SALES);
	expect(await getOrderChange(db, { order: id, event: await editId(id) }, SALES)).toEqual([
		{ label: 'Cliente', change: 'Luz Marina Restrepo → Jorge Iván Betancur' },
		{ label: 'Teléfono', change: '310 442 8890 → 300 771 2043' },
		{ label: 'Fecha de recogida', change: '16 ago 2026 → 17 ago 2026' },
		{ label: 'Días cobrados', change: '2 → 3' },
		{ label: 'Método de retorno', change: 'Recoge la empresa → Transportador externo' },
		{ label: 'Transportador del retorno', change: '— → Wilson Muñoz' },
		{ label: 'Silla Tiffany dorada', change: 'Cantidad 120 → 100' },
		{ label: 'Copa para vino tinto', change: 'Precio $900 → $1.000' },
		{ label: 'Mesa redonda 10 puestos', change: 'Quitada: 12 × $12.000' },
		{ label: 'Transporte', change: '$180.000 → $150.000' },
		{ label: 'Notas', change: '— → Portón blanco después del puente' }
	]);
});

test('a line added back reads as added, with its quantity and price', async () => {
	const id = await create({ ...order1043, order_items: order1043.order_items.slice(0, 1) });
	await updateOrder(db, { ...order1043, id }, SALES);
	const changes = await getOrderChange(db, { order: id, event: await editId(id) }, SALES);
	expect(changes).toEqual([
		{ label: 'Mesa redonda 10 puestos', change: 'Agregada: 12 × $12.000' },
		{ label: 'Copa para vino tinto', change: 'Agregada: 120 × $900' }
	]);
});

test('only an edit of that order opens, and only for whoever sees edits', async () => {
	const id = await create();
	const other = await create();
	await updateOrder(db, { ...edited1043, id }, SALES);
	const event = await editId(id);
	const created = (await timeline(id)).at(-1)?.id;
	expect(await getOrderChange(db, { order: other, event }, SALES)).toBeNull();
	expect(await getOrderChange(db, { order: id, event: created }, SALES)).toBeNull();
	expect(await getOrderChange(db, { order: id, event: 'x' }, SALES)).toBeNull();
	expect(await getOrderChange(db, { order: id, event }, WAREHOUSE)).toBeNull();
	expect(await getOrderChange(db, { order: id, event }, MANAGER)).toHaveLength(11);
});

test('the warehouse and the driver see only status changes and cancellations', async () => {
	const id = await create();
	await updateOrder(db, { ...edited1043, id }, SALES);
	await advanceOrder(db, { id, status: 'PICKED' }, WAREHOUSE);
	await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, SALES);
	for (const actor of [WAREHOUSE, DRIVER]) {
		const actions = (await timeline(id, actor)).map(({ action }) => action);
		expect(actions).toEqual(['CANCELLED', 'STATUS_CHANGED']);
	}
});

test('the printout carries no carrier, and the company from its settings', async () => {
	const external = { method: 'EXTERNAL_CARRIER', carrier_id: WILSON };
	const id = await create({
		...order1043,
		delivery_attributes: { ...order1043.delivery_attributes, ...external },
		pickup_attributes: { ...order1043.pickup_attributes, ...external }
	});
	const printout = await getOrderPrintout(db, String(id), SALES);
	expect(printout?.company.COMPANY_NAME).toBe('Banquetes Consuelo C');
	expect(JSON.stringify(printout)).not.toMatch(/Wilson|573119085512/);
});

test('an unknown order has no printout; WAREHOUSE and DRIVER print it, for Despachos', async () => {
	const id = await create();
	expect(await getOrderPrintout(db, '99', SALES)).toBeNull();
	for (const actor of [WAREHOUSE, DRIVER]) {
		expect((await getOrderPrintout(db, id, actor))?.order.id).toBe(id);
	}
});

function extend(parent: number, input: object = extension, actor: Actor = SALES) {
	return createExtension(db, { ...input, parent_order_id: String(parent) }, actor);
}

async function deliveredWithExtension(): Promise<{ parent: number; id: number }> {
	const parent = await create({ status: 'DELIVERED' });
	const result = await extend(parent);
	if (!result.ok) {
		throw new Error(JSON.stringify(result.errors));
	}
	return { parent, id: result.id };
}

function orderRow(id: number) {
	return database.prepare('select * from orders where id = ?').get(id);
}

test('an extension is born DELIVERED the day after the pickup, copying the original, which stays as it was', async () => {
	const parent = await create({ status: 'DELIVERED' });
	await fixture.editProduct(CHAIRS, { name: 'Silla', rental_price: '3.000' });
	const before = orderRow(parent);
	const result = await extend(parent);
	if (!result.ok) {
		throw new Error(JSON.stringify(result.errors));
	}
	expect(orderRow(parent)).toEqual(before);
	const original = await read(parent);
	expect(await read(result.id)).toMatchObject({
		status: 'DELIVERED',
		parentOrderId: parent,
		client: original.client,
		delivery: original.delivery,
		pickup: original.pickup,
		deliveryDate: '2026-08-17',
		pickupDate: '2026-08-19',
		rentalDays: 3,
		items: [
			{
				product_id: CHAIRS,
				name: 'Silla Tiffany dorada',
				qty: 100,
				list_price: 2500,
				unit_price: 2500,
				line_total: 750000
			}
		],
		transportCost: 60000,
		orderTotal: 810000
	});
	const events = database
		.prepare("select action from events where entity_type = 'ORDER' and entity_id = ?")
		.all(result.id);
	expect(events).toEqual([{ action: 'CREATED' }]);
});

test('only an order that exists and is DELIVERED gets an extension', async () => {
	for (const status of [
		'CONFIRMED',
		'OUT_FOR_PICKUP',
		'COMPLETED',
		'CANCELLED'
	] satisfies OrderStatus[]) {
		expect(await extend(await create({ status }))).toMatchObject({
			ok: false,
			message: 'Solo un pedido entregado se puede extender'
		});
	}
	expect(await extend(99)).toMatchObject({ ok: false, message: 'Ese pedido no existe' });
	expect(database.prepare('select count(*) as count from orders').get()).toEqual({ count: 4 });
});

test("an extension's lines are the original's products, each up to its quantity", async () => {
	const parent = await create({ status: 'DELIVERED' });
	const line = (productId: number, qty: number) => ({
		...extension,
		order_items: [{ product_id: productId, qty, unit_price: 900 }]
	});
	expect(await extend(parent, line(INACTIVE_TABLECLOTH, 1))).toMatchObject({
		ok: false,
		errors: { 'order_items.0.product_id': `No está en el pedido #${parent}` }
	});
	expect(await extend(parent, line(GLASSES, 121))).toMatchObject({
		ok: false,
		errors: { 'order_items.0.qty': `Máximo 120, lo que tiene el pedido #${parent}` }
	});
	expect(await extend(parent, line(GLASSES, 120))).toMatchObject({ ok: true });
});

test('an original on days 1–4 and its extension on 5–7 subtract the extended chairs once a day', async () => {
	const parent = await book({
		status: 'DELIVERED',
		delivery: '2026-08-01',
		pickup: '2026-08-04',
		qty: 100
	});
	const lines = [{ product_id: CHAIRS, qty: 60, unit_price: 2500 }];
	expect(
		await extend(parent, { ...extension, pickup_date: '2026-08-07', order_items: lines })
	).toMatchObject({ ok: true });
	for (const [day, available] of [
		['2026-08-01', 400],
		['2026-08-04', 400],
		['2026-08-05', 440],
		['2026-08-07', 440],
		['2026-08-08', 500]
	] as const) {
		expect(await chairsAvailable({ delivery_date: day, pickup_date: day })).toBe(available);
	}
});

test('the original lists its extensions, which keep their link when edited; WAREHOUSE and DRIVER extend nothing', async () => {
	const { parent, id } = await deliveredWithExtension();
	expect((await getOrderDetail(db, parent, SALES))?.extensions).toEqual([
		{ id, status: 'DELIVERED', deliveryDate: '2026-08-17', pickupDate: '2026-08-19' }
	]);
	const edited = { ...extension, delivery_date: '2026-08-17', rental_days: 4, id };
	expect(await updateOrder(db, edited, SALES)).toMatchObject({ ok: true });
	expect((await read(id)).parentOrderId).toBe(parent);
	for (const actor of [WAREHOUSE, DRIVER]) {
		await expect(extend(parent, extension, actor)).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
	}
});

async function pickedOrder(): Promise<number> {
	const id = await create();
	await advanceOrder(db, { id, status: 'PICKED' }, WAREHOUSE);
	return id;
}

function editOrder(id: number, rentalDays: number) {
	return updateOrder(db, { ...order1043, id, rental_days: rentalDays }, SALES);
}

async function modifiedAfterStagingAt(id: number) {
	return (await getOrderDetail(db, id, WAREHOUSE))?.modifiedAfterStagingAt;
}

test('an edit before picking is no modification after staging; one after picking is, with its time', async () => {
	const before = await create();
	await editOrder(before, 3);
	await advanceOrder(db, { id: before, status: 'PICKED' }, WAREHOUSE);
	expect(await modifiedAfterStagingAt(before)).toBeNull();

	const after = await pickedOrder();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-08-13T16:20:00-05:00'));
	onTestFinished(() => {
		vi.useRealTimers();
	});
	await editOrder(after, 3);
	expect(await modifiedAfterStagingAt(after)).toBe(Date.parse('2026-08-13T21:20:00Z') / 1000);
});

test("a later status change with the driver's note, or an incident, isn't a modification after staging", async () => {
	const id = await pickedOrder();
	await advanceOrder(db, { id, status: 'OUT_FOR_DELIVERY' }, DRIVER);
	// The delivery note rides on the STATUS_CHANGED event.
	const delivered = { id, status: 'DELIVERED', notes: 'Lo recibió el portero' };
	expect(await advanceOrder(db, delivered, DRIVER)).toEqual({ ok: true, id });
	// An incident writes its own event, and has_incident with no ORDER event.
	expect(await reportLost(id)).toMatchObject({ ok: true });
	expect((await read(id)).hasIncident).toBe(true);
	expect(await modifiedAfterStagingAt(id)).toBeNull();
});

test('an extension has no PICKED, and is never modified after staging', async () => {
	const { id } = await deliveredWithExtension();
	const edited = { ...extension, delivery_date: '2026-08-17', rental_days: 4, id };
	expect(await updateOrder(db, edited, SALES)).toMatchObject({ ok: true });
	expect(await modifiedAfterStagingAt(id)).toBeNull();
});

// «Cobro por novedad»: an order out at the client with $1.180.000 paid and a $200.000 deposit.
async function deliveredWithDeposit(): Promise<number> {
	const id = await create({ status: 'OUT_FOR_PICKUP' });
	await recordPayment(id, { amount: '1.180.000' }, SALES);
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT', amount: '200.000' }, SALES);
	return id;
}

const damage = (source: string, amount: string, fields: Record<string, string> = {}) => ({
	concept: 'DAMAGE_CHARGE',
	fee_source: source,
	amount,
	description: '2 sillas perdidas en el evento',
	...fields
});

function reverseOnlyIncident() {
	const [{ id }] = database.prepare('select id from incidents').all();
	return reverseIncident(db, { id: String(id), reason: 'Era de otro pedido' }, MANAGER);
}

test('a damage charge is refused while the order has no active incident, reversed ones included', async () => {
	const id = await deliveredWithDeposit();
	const tryCharge = () => recordOrderPayment(db, typedPayment(id, damage('NEW', '50.000')), SALES);
	const refused = {
		ok: false,
		message: 'El cobro por novedad necesita una novedad activa en el pedido.',
		errors: {}
	};
	expect(await tryCharge()).toEqual(refused);
	expect(offeredPaymentConcepts(await detail(id), SALES)).not.toContain('DAMAGE_CHARGE');
	expect(await reportLost(id)).toMatchObject({ ok: true });
	expect(await reverseOnlyIncident()).toMatchObject({ ok: true });
	expect(await tryCharge()).toEqual(refused);
	expect(movementsOf(id)).toHaveLength(2);
});

test('with an active incident, the office and the driver record a damage charge in new money', async () => {
	const id = await deliveredWithDeposit();
	expect(await reportLost(id)).toMatchObject({ ok: true });
	for (const actor of [ADMIN, MANAGER, SALES]) {
		expect(offeredPaymentConcepts(await detail(id), actor)).toContain('DAMAGE_CHARGE');
	}
	expect(getDespachosPaymentEntry(await detail(id), DRIVER).concepts).toContain('DAMAGE_CHARGE');
	const transfer = { payment_method: 'TRANSFER' };
	const other = { payment_method: 'OTHER', other_method: 'Trueque' };
	await recordPayment(id, damage('NEW', '10.000', transfer), ADMIN);
	await recordPayment(id, damage('NEW', '20.000', other), MANAGER);
	await recordPayment(id, damage('NEW', '30.000'), SALES);
	const byDriver = await recordPayment(id, damage('NEW', '40.000'), DRIVER);
	expect(byDriver).toMatchObject({
		concept: 'DAMAGE_CHARGE',
		amount: 40000,
		payment_method: 'CASH',
		payee: 'Luz Marina Restrepo',
		created_by: 'driver'
	});
	expect(JSON.parse(String(byDriver.attributes))).toMatchObject({
		description: '2 sillas perdidas en el evento'
	});
	expect(await detail(id)).toMatchObject({
		paid: 1180000,
		balanceDue: 0,
		depositHeld: 200000,
		damageCharged: 100000
	});
});

test('«Retener del depósito» writes the charge with its paired retention, no method, and the deposit held drops', async () => {
	const id = await deliveredWithDeposit();
	expect(await reportLost(id)).toMatchObject({ ok: true });
	const kept = await recordPayment(id, damage('DEPOSIT', '150.000'), DRIVER);
	expect(movementsOf(id).slice(2)).toEqual([
		expect.objectContaining({ concept: 'DEPOSIT_REFUND', amount: -150000, reverses_id: null }),
		expect.objectContaining({ concept: 'DAMAGE_CHARGE', amount: 150000, reverses_id: null })
	]);
	expect(kept).toMatchObject({ payment_method: 'OTHER', created_by: 'driver' });
	expect(JSON.parse(String(kept.attributes))).toMatchObject({
		other_method: 'Retenido del depósito'
	});
	expect(await detail(id)).toMatchObject({
		paid: 1180000,
		balanceDue: 0,
		depositHeld: 50000,
		damageCharged: 150000
	});
});

test('«Retener del depósito» is capped at the deposit held, and charging more takes new money', async () => {
	const id = await deliveredWithDeposit();
	expect(await reportLost(id)).toMatchObject({ ok: true });
	const over = await recordOrderPayment(
		db,
		typedPayment(id, damage('DEPOSIT', '200.001')),
		MANAGER
	);
	const message = 'Supera el depósito recibido ($200.000). Cobra el resto con «Dinero nuevo».';
	expect(over).toEqual({ ok: false, message, errors: { amount: message } });
	expect(movementsOf(id)).toHaveLength(2);
	await recordPayment(id, damage('DEPOSIT', '200.000'));
	await recordPayment(id, damage('NEW', '100.000'));
	expect(await detail(id)).toMatchObject({ depositHeld: 0, damageCharged: 300000 });
});

test('a damage charge needs a description, and never comes from the payments', async () => {
	const id = await deliveredWithDeposit();
	expect(await reportLost(id)).toMatchObject({ ok: true });
	const tryCharge = (fields: Record<string, string>) =>
		recordOrderPayment(db, typedPayment(id, { ...damage('NEW', '50.000'), ...fields }), SALES);
	expect(await tryCharge({ description: '  ' })).toMatchObject({
		ok: false,
		errors: { description: 'Escribe qué se cobra' }
	});
	expect(await tryCharge({ fee_source: 'INSTALLMENTS' })).toMatchObject({
		ok: false,
		errors: { fee_source: expect.any(String) }
	});
	expect(movementsOf(id)).toHaveLength(2);
});

test('the payment list pairs a deposit-sourced charge with its retention, and each half is offset on its own', async () => {
	const id = await deliveredWithDeposit();
	expect(await reportLost(id)).toMatchObject({ ok: true });
	const kept = await recordPayment(id, damage('DEPOSIT', '150.000'));
	const fresh = await recordPayment(id, damage('NEW', '30.000'));
	const payments = (await detail(id)).payments.slice(2);
	expect(payments).toEqual([
		expect.objectContaining({
			concept: 'DEPOSIT_REFUND',
			pairedReceiptNumber: kept.receipt_number
		}),
		expect.objectContaining({
			concept: 'DAMAGE_CHARGE',
			description: '2 sillas perdidas en el evento',
			pairedReceiptNumber: expect.any(Number)
		}),
		expect.objectContaining({ id: fresh.id, pairedReceiptNumber: null })
	]);
	const offset = {
		reverses_id: String(kept.id),
		payment_method: 'CASH',
		movement_date: '2026-08-02'
	};
	expect(await recordOffset(db, offset, MANAGER)).toMatchObject({ ok: true });
	expect((await detail(id)).damageCharged).toBe(30000);
});

test('a new-money charge right after an ordinary deposit refund of the same amount pairs with nothing', async () => {
	const id = await deliveredWithDeposit();
	expect(await reportLost(id)).toMatchObject({ ok: true });
	await recordPayment(id, { concept: 'DEPOSIT_REFUND', amount: '50.000' });
	await recordPayment(id, damage('NEW', '50.000'));
	const payments = (await detail(id)).payments.slice(2);
	expect(payments).toEqual([
		expect.objectContaining({ concept: 'DEPOSIT_REFUND', pairedReceiptNumber: null }),
		expect.objectContaining({ concept: 'DAMAGE_CHARGE', pairedReceiptNumber: null })
	]);
});

test('a damage charge stays out of Pagado, Saldo, what the client is owed and the cuenta de cobro', async () => {
	// Paid in part, the deposit given, and 2 chairs charged for: at pickup, and cancelled on its way.
	const charged = async (fields: Record<string, unknown>) => {
		const orderId = await create(fields);
		await recordPayment(orderId, { amount: '500.000' }, SALES);
		await recordPayment(orderId, { concept: 'SECURITY_DEPOSIT', amount: '200.000' }, SALES);
		expect(await reportLost(orderId)).toMatchObject({ ok: true });
		await recordPayment(orderId, damage('NEW', '90.000'), SALES);
		return orderId;
	};
	const id = await charged({ status: 'OUT_FOR_PICKUP' });
	expect(await detail(id)).toMatchObject({
		paid: 500000,
		balanceDue: 680000,
		damageCharged: 90000
	});
	const issued = await issueReceivable(db, { orders: [id], payment_terms: 'Contado' }, SALES);
	if (!issued.ok) {
		throw new Error(issued.message);
	}
	const receivable = await getReceivableDetail(db, issued.id, SALES);
	expect(receivable).toMatchObject({ paid: 500000, balance: 680000 });
	expect(receivable?.payments.map((payment) => payment.concept)).toEqual(['INSTALLMENT']);
	const cancelled = await charged({ status: 'CANCELLED', cancelledFrom: 'OUT_FOR_DELIVERY' });
	expect((await detail(cancelled)).owedToClient).toBe(700000);
});

test("cash from a damage charge counts on the driver's Efectivo por entregar; one kept from the deposit doesn't", async () => {
	const driver = await fixture.employee({ roles: ['DRIVER'] });
	const id = await deliveredWithDeposit();
	expect(await reportLost(id)).toMatchObject({ ok: true });
	await recordPayment(id, damage('NEW', '40.000'), driver);
	await recordPayment(id, damage('DEPOSIT', '100.000'), driver);
	const tab = { username: driver.username, from: '2026-08-01', to: '2026-08-01' };
	expect((await getCashStatement(db, tab, MANAGER)).pending).toBe(40000);
});
