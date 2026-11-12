import { isHttpError } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import type { Actor, Role } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { movementStatements, recordOffset } from './cash';
import {
	advanceOrder,
	cancelOrder,
	checkOrderSchedule,
	clientAttributesSchema,
	createExtension,
	deliveryAttributesSchema,
	getAvailability,
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
	updateOrder
} from './orders';
import { createOrder } from '../db/test-orders';
import { readOwedOnReceivable } from '$lib/orders';
import { getReceivableDetail, issueReceivable, recordReceivablePayment } from './receivables';

const sales: Actor = { username: 'ventas', employeeId: null, roles: ['SALES'], kind: 'user' };

let db: D1Database;
let database: DatabaseSync;

const AUDIT = "0, 'admin', 0, 'admin'";

function insertContact(fullName: string, phone: string, services: string[] = []) {
	database
		.prepare(
			`insert into contacts (phone, full_name, document_id, services, created_at, created_by, updated_at, updated_by) values (?, ?, ?, ?, ${AUDIT})`
		)
		.run(phone, fullName, `@${phone}`, JSON.stringify(services));
}

function insertProduct(name: string, rentalPrice: number, active = 1) {
	database
		.prepare(
			`insert into products (name, category, rental_price, total_quantity, active, created_at, created_by, updated_at, updated_by) values (?, 'CHAIRS_TABLES', ?, 500, ?, ${AUDIT})`
		)
		.run(name, rentalPrice, active);
}

beforeEach(() => {
	({ db, database } = createMemoryD1());
	insertContact('Luz Marina Restrepo', '573104428890');
	insertContact('Wilson Muñoz', '573119085512', ['TRANSPORTER']);
	insertContact('Transportes Aburrá', '573005550101', ['TRANSPORTER']);
	insertContact('Jorge Iván Betancur', '573007712043');
	insertProduct('Silla Tiffany dorada', 2500);
	insertProduct('Mesa redonda 10 puestos', 12000);
	insertProduct('Copa para vino tinto', 900);
	insertProduct('Mantel blanco', 8000, 0);
});

const LUZ_MARINA = 1;
const WILSON = 2;
const ABURRA = 3;
const JORGE = 4;
const INACTIVE_TABLECLOTH = 4;

const address = { address_1: 'Calle 10 # 43-12, El Poblado', address_2: 'Salón Los Arrayanes' };

// The Design Brief's order #1043.
const order1043 = {
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
		{ product_id: 1, qty: 120, unit_price: 2500 },
		{ product_id: 2, qty: 12, unit_price: 12000 },
		{ product_id: 3, qty: 120, unit_price: 900 }
	],
	discount: 104000,
	transport_cost: 180000,
	deposit_amount: 200000
};

async function create(input: object = order1043): Promise<number> {
	const result = await createOrder(db, input, sales);
	if (!result.ok) {
		throw new Error(JSON.stringify(result.errors));
	}
	return result.id;
}

async function read(id: number) {
	const order = await getOrder(db, id, sales);
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

function setStatus(id: number, status: string) {
	database.prepare('update orders set status = ? where id = ?').run(status, id);
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
		product_id: 1,
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

test('the public token is a UUID kept out of the CREATED event', async () => {
	const id = await create();
	const { public_token } = database.prepare('select public_token from orders').get() ?? {};
	expect(String(public_token)).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
	);
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
	expect(await getPublicToken(db, id, sales)).toBe(public_token);
	setStatus(id, 'CANCELLED');
	expect(await getPublicToken(db, id, sales)).toBe(public_token);
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		await expect(getPublicToken(db, id, { ...sales, roles: [role] })).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
	}
});

test('renaming the client or a product, or repricing it, changes no saved order, an edit included', async () => {
	const id = await create();
	database.exec("update contacts set full_name = 'Luz Marina Restrepo de Gil' where id = 1");
	database.exec("update products set name = 'Silla Tiffany', rental_price = 3000 where id = 1");
	expect((await read(id)).client.name).toBe('Luz Marina Restrepo');
	await updateOrder(db, { ...order1043, id, rental_days: 3 }, sales);
	const edited = await read(id);
	expect(edited.client.name).toBe('Luz Marina Restrepo');
	expect(edited.items[0]).toMatchObject({ name: 'Silla Tiffany dorada', list_price: 2500 });
});

test('a line added in an edit takes the catalog name and price of that moment', async () => {
	const id = await create();
	insertProduct('Mantel rojo', 7000);
	database.exec('update products set rental_price = 7500 where id = 5');
	const items = [...order1043.order_items, { product_id: 5, qty: 12, unit_price: 7000 }];
	await updateOrder(db, { ...order1043, id, order_items: items }, sales);
	expect((await read(id)).items[3]).toEqual({
		product_id: 5,
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
		[[chairs, { ...tables, product_id: 1 }], 'order_items'],
		[[{ ...chairs, qty: 0 }], 'order_items.0.qty'],
		[[{ ...chairs, line_total: 1 }], 'order_items.0']
	] as const;
	for (const [lines, field] of refused) {
		const result = await createOrder(db, { ...order1043, order_items: lines }, sales);
		expect(result).toMatchObject({ ok: false, errors: { [field]: expect.any(String) } });
	}
	const stored = [{ product_id: 1, name: 'Silla', qty: 1, list_price: 0, unit_price: 0 }];
	expect(orderItemsSchema.safeParse(stored).success).toBe(false);
	const withExtraKey = [{ ...stored[0], line_total: 0, discount: 0 }];
	expect(orderItemsSchema.safeParse(withExtraKey).success).toBe(false);
	expect(orderItemsSchema.safeParse([{ ...stored[0], line_total: 0 }]).success).toBe(true);
});

test('a $0 line is a valid courtesy', async () => {
	const lines = [{ product_id: 3, qty: 10, unit_price: 0 }];
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
	const refused = await createOrder(db, { ...order1043, order_items: inactive }, sales);
	expect(refused).toMatchObject({
		ok: false,
		errors: { 'order_items.3.product_id': expect.any(String) }
	});
	const id = await create();
	database.exec('update products set active = 0 where id = 1');
	const result = await updateOrder(db, { ...order1043, id, rental_days: 3 }, sales);
	expect(result).toEqual({ ok: true, id });
	expect((await read(id)).items[0]).toMatchObject({ product_id: 1, line_total: 900000 });
});

test('a discount above the subtotal is refused on its field; equal to it, the total is the transport', async () => {
	const above = await createOrder(db, { ...order1043, discount: 1104001 }, sales);
	expect(above).toMatchObject({ ok: false, errors: { discount: expect.any(String) } });
	const id = await create({ ...order1043, discount: 1104000 });
	expect((await read(id)).orderTotal).toBe(180000);
	for (const field of ['discount', 'transport_cost', 'deposit_amount']) {
		const result = await createOrder(db, { ...order1043, [field]: -1 }, sales);
		expect(result).toMatchObject({ ok: false, errors: { [field]: expect.any(String) } });
	}
});

test('rental days are at least 1; a delivery after the pickup fails on its field; the event date is free', async () => {
	const noDays = await createOrder(db, { ...order1043, rental_days: 0 }, sales);
	expect(noDays).toMatchObject({ ok: false, errors: { rental_days: expect.any(String) } });
	const early = await createOrder(db, { ...order1043, pickup_date: '2026-08-13' }, sales);
	expect(early).toMatchObject({ ok: false, errors: { delivery_date: expect.any(String) } });
	expect(await create({ ...order1043, pickup_date: '2026-08-14', event_date: '2026-09-01' })).toBe(
		1
	);
});

test('an external carrier is required, must exist and be a transporter; each direction may have its own', async () => {
	const external = { ...order1043.delivery_attributes, method: 'EXTERNAL_CARRIER' };
	for (const carrierId of [undefined, 99, JORGE]) {
		const delivery = { ...external, carrier_id: carrierId };
		const result = await createOrder(db, { ...order1043, delivery_attributes: delivery }, sales);
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
	const id = await create();
	setStatus(id, 'DELIVERED');
	expect(await updateOrder(db, { ...order1043, id, rental_days: 3 }, sales)).toEqual({
		ok: true,
		id
	});
	for (const status of ['OUT_FOR_PICKUP', 'COMPLETED', 'CANCELLED']) {
		setStatus(id, status);
		const result = await updateOrder(db, { ...order1043, id, rental_days: 4 }, sales);
		expect(result).toMatchObject({ ok: false });
	}
	expect((await read(id)).rentalDays).toBe(3);
	expect(await updateOrder(db, { ...order1043, id: 99 }, sales)).toMatchObject({ ok: false });
});

test('an edit logs only the changed fields; a save with no change logs nothing', async () => {
	const id = await create();
	await updateOrder(db, { ...order1043, id }, sales);
	expect(orderEvents()).toHaveLength(1);
	await updateOrder(db, { ...order1043, id, rental_days: 3 }, sales);
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
	await updateOrder(db, { ...order1043, id, ...jorge }, sales);
	expect(await read(id)).toMatchObject({
		clientId: JORGE,
		client: { name: 'Jorge Iván Betancur', phone: '573007712043' }
	});
	const edited = orderEvents()[1];
	expect(Object.keys(edited.after).sort()).toEqual(['client_attributes', 'client_id']);
	const unknown = await updateOrder(db, { ...order1043, id, client_id: 99 }, sales);
	expect(unknown).toMatchObject({ ok: false, errors: { client_id: expect.any(String) } });
});

// The order, billed in a new cuenta de cobro with `others`, moved to `status` by hand.
async function billed(status = 'CONFIRMED', others: number[] = []): Promise<[number, number]> {
	const id = await create();
	const result = await issueReceivable(
		db,
		{ orders: [id, ...others], payment_terms: 'Contado' },
		sales
	);
	if (!result.ok) {
		throw new Error(result.message);
	}
	setStatus(id, status);
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

const jorge = { client_id: JORGE, client_name: 'Jorge Iván Betancur' };

test.each(['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED'])(
	'a billed %s order saves an edit of its lines, and its cuenta reads the new total',
	async (status) => {
		const [id, receivableId] = await billed(status);
		const totalOf = async () => (await getReceivableDetail(db, receivableId, sales))?.total;
		expect(await totalOf()).toBe(1180000);
		const lines = [{ product_id: 1, qty: 100, unit_price: 2500 }];
		const result = await updateOrder(db, { ...order1043, id, order_items: lines }, sales);
		expect(result).toEqual({ ok: true, id });
		expect(await totalOf()).toBe(100 * 2500 * 2 - 104000 + 180000);
	}
);

test('a billed COMPLETED order stays read-only', async () => {
	const [id] = await billed('COMPLETED');
	const result = await updateOrder(db, { ...order1043, id, rental_days: 3 }, sales);
	expect(result).toMatchObject({ ok: false });
});

test("the cuenta's only order changes the cuenta's client in the same save, logged", async () => {
	const [id, receivableId] = await billed();
	expect(await updateOrder(db, { ...order1043, id, ...jorge }, sales)).toEqual({ ok: true, id });
	expect((await read(id)).clientId).toBe(JORGE);
	expect(receivableClient(receivableId)).toBe(JORGE);
	expect(receivableEvents().at(-1)).toEqual({
		action: 'EDITED',
		entityId: receivableId,
		before: { client_id: LUZ_MARINA },
		after: { client_id: JORGE }
	});
	const detail = await getReceivableDetail(db, receivableId, sales);
	expect(detail?.client.name).toBe('Jorge Iván Betancur');
	expect(database.prepare('select count(*) as count from receivables').get()?.count).toBe(1);
});

test("«Cliente nuevo» on the cuenta's only order becomes the cuenta's client", async () => {
	const [id, receivableId] = await billed();
	const newClient = { client_id: null, client_name: 'Gloria Patiño', client_phone: '3001234567' };
	expect(await updateOrder(db, { ...order1043, id, ...newClient }, sales)).toEqual({
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
	await updateOrder(db, { ...order1043, id, rental_days: 3 }, sales);
	expect(receivableClient(receivableId)).toBe(LUZ_MARINA);
	expect(receivableEvents().map(({ action }) => action)).toEqual(['CREATED']);
});

test("a cuenta's order with others keeps its client: the change is refused", async () => {
	const other = await create();
	const [id, receivableId] = await billed('CONFIRMED', [other]);
	const result = await updateOrder(db, { ...order1043, id, ...jorge, rental_days: 3 }, sales);
	expect(result).toEqual({
		ok: false,
		message: expect.any(String),
		errors: {
			client_id: `Retire el pedido de la cuenta de cobro Nº ${receivableId} antes de cambiar el cliente.`
		}
	});
	expect(await read(id)).toMatchObject({ clientId: LUZ_MARINA, rentalDays: 2 });
	expect(receivableClient(receivableId)).toBe(LUZ_MARINA);
	const kept = await updateOrder(db, { ...order1043, id, rental_days: 3 }, sales);
	expect(kept).toEqual({ ok: true, id });
});

test("the order form's billing: the cuenta's number, and whether it bills other orders", async () => {
	const alone = await create();
	expect(await getOrderBilling(db, await read(alone), sales)).toBeNull();
	const [id, receivableId] = await billed();
	expect(await getOrderBilling(db, await read(id), sales)).toEqual({
		receivableId,
		clientId: LUZ_MARINA,
		hasOtherOrders: false
	});
	const [shared, sharedId] = await billed('CONFIRMED', [alone]);
	expect(await getOrderBilling(db, await read(shared), sales)).toMatchObject({
		receivableId: sharedId,
		hasOtherOrders: true
	});
	const warehouse: Actor = { ...sales, roles: ['WAREHOUSE'] };
	await expect(getOrderBilling(db, await read(id), warehouse)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 403)
	);
});

test('WAREHOUSE and DRIVER get a 403 creating, editing or reading an order', async () => {
	const id = await create();
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const actor: Actor = { ...sales, roles: [role] };
		const refusals = await Promise.all([
			createOrder(db, order1043, actor).catch((caught: unknown) => caught),
			updateOrder(db, { ...order1043, id }, actor).catch((caught: unknown) => caught),
			getOrder(db, id, actor).catch((caught: unknown) => caught)
		]);
		for (const refusal of refusals) {
			expect(isHttpError(refusal, 403)).toBe(true);
		}
	}
});

type Booking = { status: string; delivery: string; pickup: string; qty: number };

// An order of `qty` Tiffany chairs, moved to `status` by hand: transitions are their own unit.
async function book({ status, delivery, pickup, qty }: Booking): Promise<number> {
	const lines = [{ product_id: 1, qty, unit_price: 2500 }];
	const dates = { delivery_date: delivery, pickup_date: pickup, event_date: delivery };
	const id = await create({ ...order1043, ...dates, order_items: lines, discount: 0 });
	setStatus(id, status);
	return id;
}

async function chairsAvailable(range: object): Promise<number | undefined> {
	const availability = await getAvailability(db, { ...range, product_ids: [1] }, sales);
	return availability.find(({ productId }) => 1 === productId)?.available;
}

test('only orders holding their products subtract: not a cancelled or a completed one', async () => {
	for (const status of ['CANCELLED', 'COMPLETED']) {
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
	await book({ status: 'DELIVERED', delivery: '2026-08-12', pickup: '2026-08-14', qty: 250 });
	const range = { delivery_date: '2026-08-08', pickup_date: '2026-08-20' };
	expect(await chairsAvailable(range)).toBe(-50);
	const availability = await getAvailability(db, { ...range, product_ids: [1, 2] }, sales);
	expect(availability).toEqual([
		{ productId: 1, available: -50 },
		{ productId: 2, available: 500 }
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

const ASSUMPTION = { date: '2026-08-17', label: 'La Asunción de la Virgen' };

function setHolidays() {
	database
		.prepare(
			`insert into settings (key, value, created_at, created_by, updated_at, updated_by) values ('PAYROLL_HOLIDAYS', ?, ${AUDIT})`
		)
		.run(JSON.stringify([ASSUMPTION]));
}

const trips = {
	delivery_date: '2026-08-14',
	delivery_time: '14:00',
	pickup_date: '2026-08-16',
	pickup_time: '09:00'
};

test('a delivery or a pickup on a holiday warns; an event on one shows nothing', async () => {
	setHolidays();
	const warnings = (input: object) => getOrderWarnings(db, { ...trips, ...input }, sales);
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
	setHolidays();
	const id = await create();
	const atItsDelivery = {
		pickup_date: '2026-08-14',
		pickup_time: '14:00',
		delivery_date: '2026-08-13'
	};
	expect((await getOrderWarnings(db, { ...trips, ...atItsDelivery }, sales)).clashes).toEqual([
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
	expect((await getOrderWarnings(db, { ...trips, ...atItsPickup }, sales)).clashes).toEqual([
		{
			trip: 'DELIVERY',
			theirTrip: 'PICKUP',
			orderId: id,
			clientName: 'Luz Marina Restrepo',
			date: '2026-08-16',
			time: '09:00'
		}
	]);
	setStatus(id, 'CANCELLED');
	expect((await getOrderWarnings(db, trips, sales)).clashes).toEqual([]);
});

test('an order never clashes with itself, and a time left empty never clashes', async () => {
	setHolidays();
	const id = await create();
	expect((await getOrderWarnings(db, { ...trips, order_id: id }, sales)).clashes).toEqual([]);
	const noTimes = { ...trips, delivery_time: null, pickup_time: null };
	expect((await getOrderWarnings(db, noTimes, sales)).clashes).toEqual([]);
	expect((await getOrderWarnings(db, trips, sales)).clashes).toHaveLength(2);
});

test('an order saves overbooked, on a holiday and clashing, all at once', async () => {
	setHolidays();
	await book({ status: 'CONFIRMED', delivery: '2026-08-17', pickup: '2026-08-18', qty: 450 });
	const lines = [{ product_id: 1, qty: 100, unit_price: 2500 }];
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
		sales
	);
	expect(warnings.holidays).toHaveLength(1);
	expect(warnings.clashes).toHaveLength(2);
	expect((await read(id)).items[0].qty).toBe(100);
});

test('WAREHOUSE and DRIVER get a 403 asking for availability or warnings', async () => {
	for (const role of ['WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const actor: Actor = { ...sales, roles: [role] };
		const range = { delivery_date: '2026-08-14', pickup_date: '2026-08-16', product_ids: [1] };
		await expect(getAvailability(db, range, actor)).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
		await expect(getOrderWarnings(db, range, actor)).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
	}
});

const warehouse: Actor = { ...sales, username: 'bodega', roles: ['WAREHOUSE'] };
const driver: Actor = { ...sales, username: 'conductor', roles: ['DRIVER'] };
const admin: Actor = { ...sales, username: 'admin', roles: ['ADMIN'] };

async function status(id: number): Promise<string> {
	return (await read(id)).status;
}

test('cancelling asks for a reason, kept in its CANCELLED event; the cancelled order is read-only', async () => {
	const id = await create();
	const noReason = await cancelOrder(db, { id, reason: '  ' }, sales);
	expect(noReason).toMatchObject({ ok: false, errors: { reason: expect.any(String) } });
	expect(await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, sales)).toEqual({
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
	expect(await updateOrder(db, { ...order1043, id }, sales)).toMatchObject({ ok: false });
});

test('a delivered order can no longer be cancelled', async () => {
	const id = await create();
	setStatus(id, 'DELIVERED');
	const result = await cancelOrder(db, { id, reason: 'Ya no lo quiere' }, admin);
	expect(result).toMatchObject({ ok: false });
	expect(await status(id)).toBe('DELIVERED');
});

test('WAREHOUSE marks PICKED: operational transitions are open to every role', async () => {
	const id = await create();
	expect(await advanceOrder(db, { id, status: 'PICKED' }, warehouse)).toEqual({ ok: true, id });
	expect(await advanceOrder(db, { id, status: 'OUT_FOR_DELIVERY' }, driver)).toEqual({
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
	for (const actor of [warehouse, driver]) {
		const attempt = cancelOrder(db, { id, reason: 'No contesta' }, actor);
		await expect(attempt).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	}
	expect(await status(id)).toBe('CONFIRMED');
});

test('the operational path cannot cancel, whoever asks', async () => {
	const id = await create();
	for (const target of ['CONFIRMED', 'CANCELLED']) {
		const result = await advanceOrder(db, { id, status: target }, admin);
		expect(result).toMatchObject({ ok: false, errors: { status: expect.any(String) } });
	}
	expect(await status(id)).toBe('CONFIRMED');
});

test('an order cancels from CONFIRMED, PICKED and OUT_FOR_DELIVERY', async () => {
	for (const from of ['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY']) {
		const id = await create();
		setStatus(id, from);
		const result = await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, sales);
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
	await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, sales);
	expect(await chairsAvailable(range)).toBe(500);
	for (const target of ['PICKED', 'CONFIRMED']) {
		expect(await advanceOrder(db, { id, status: target }, admin)).toMatchObject({ ok: false });
	}
	expect(await status(id)).toBe('CANCELLED');
});

test('an illegal transition fails for every role, and writes nothing', async () => {
	const id = await create();
	for (const actor of [admin, sales, warehouse]) {
		expect(await advanceOrder(db, { id, status: 'DELIVERED' }, actor)).toMatchObject({ ok: false });
	}
	expect(await status(id)).toBe('CONFIRMED');
	expect(orderEvents()).toHaveLength(1);
	expect(await advanceOrder(db, { id: 99, status: 'PICKED' }, admin)).toMatchObject({ ok: false });
});

test('a client pickup and return goes picked → delivered → completed', async () => {
	const atWarehouse = { ...address, time: null };
	const id = await create({
		...order1043,
		delivery_attributes: { ...atWarehouse, method: 'CLIENT_PICKUP' },
		pickup_attributes: { ...atWarehouse, method: 'CLIENT_RETURN' }
	});
	await advanceOrder(db, { id, status: 'PICKED', notes: 'Listo en bodega' }, warehouse);
	const skipped = { id, status: 'OUT_FOR_DELIVERY', notes: 'Salió' };
	expect(await advanceOrder(db, skipped, driver)).toMatchObject({ ok: false });
	expect(await read(id)).toMatchObject({
		status: 'PICKED',
		delivery: { notes: 'Listo en bodega' }
	});
	expect(await advanceOrder(db, { id, status: 'DELIVERED' }, warehouse)).toMatchObject({
		ok: true
	});
	expect(await advanceOrder(db, { id, status: 'OUT_FOR_PICKUP' }, driver)).toMatchObject({
		ok: false
	});
	expect(await advanceOrder(db, { id, status: 'COMPLETED' }, warehouse)).toMatchObject({
		ok: true
	});
	expect(await status(id)).toBe('COMPLETED');
});

test('DRIVER marks DELIVERED with a note: one STATUS_CHANGED carries it, no EDITED', async () => {
	const id = await create();
	setStatus(id, 'OUT_FOR_DELIVERY');
	const input = { id, status: 'DELIVERED', notes: '  Recibió el celador. Cobré $20.000  ' };
	expect(await advanceOrder(db, input, driver)).toEqual({ ok: true, id });
	expect(orderEvents().slice(1)).toEqual([
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
	const id = await create();
	setStatus(id, 'DELIVERED');
	await advanceOrder(db, { id, status: 'OUT_FOR_PICKUP', notes: 'Llamar antes' }, driver);
	expect(await read(id)).toMatchObject({
		delivery: { notes: null },
		pickup: { notes: 'Llamar antes' }
	});
	await advanceOrder(db, { id, status: 'COMPLETED', notes: '   ' }, driver);
	expect((await read(id)).pickup.notes).toBeNull();
	setStatus(id, 'DELIVERED');
	await advanceOrder(db, { id, status: 'OUT_FOR_PICKUP', notes: '' }, driver);
	expect(orderEvents().at(-1)).toEqual({
		action: 'STATUS_CHANGED',
		before: { status: 'DELIVERED' },
		after: { status: 'OUT_FOR_PICKUP' }
	});
});

test('SALES marks DELIVERED on an external carrier order', async () => {
	const id = await create({
		...order1043,
		delivery_attributes: { ...address, method: 'EXTERNAL_CARRIER', time: null, carrier_id: WILSON }
	});
	setStatus(id, 'OUT_FOR_DELIVERY');
	expect(await advanceOrder(db, { id, status: 'DELIVERED', notes: '' }, sales)).toEqual({
		ok: true,
		id
	});
	expect(await status(id)).toBe('DELIVERED');
});

test('two people marking the same transition: the second is illegal and writes nothing', async () => {
	const id = await create();
	setStatus(id, 'CONFIRMED');
	expect(await advanceOrder(db, { id, status: 'PICKED', notes: 'Todo' }, warehouse)).toMatchObject({
		ok: true
	});
	const second = { id, status: 'PICKED', notes: 'Falta un mantel' };
	expect(await advanceOrder(db, second, sales)).toMatchObject({ ok: false });
	expect((await read(id)).delivery.notes).toBe('Todo');
	expect(orderEvents()).toHaveLength(2);
});

// Every delivery date unless the test says otherwise: the list's default is this week's.
async function listIds(input: Record<string, string> = {}): Promise<number[]> {
	return (await listOrders(db, { delivery: 'ALL', ...input }, sales)).orders.map(({ id }) => id);
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
	const page = await listOrders(db, { delivery: 'ALL' }, sales);
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
	const payment = {
		payment_method: 'TRANSFER',
		movement_date: '2026-08-01',
		entity_type: 'ORDER',
		entity_id: id,
		attributes: {}
	} as const;
	await db.batch([
		...movementStatements(db, sales, { ...payment, concept: 'INSTALLMENT', amount: 500000 }),
		...movementStatements(db, sales, { ...payment, concept: 'SECURITY_DEPOSIT', amount: 200000 })
	]);
	expect((await listOrders(db, { delivery: 'ALL' }, sales)).orders[0].balanceDue).toBe(680000);
});

test('the filters combine, each over the order snapshot', async () => {
	const [luzMarina, jorge, september] = await createThree();
	database.exec(
		"update contacts set full_name = 'Otro nombre', phone = '573000000000' where id = 1"
	);
	expect(await listIds({ text: '442 88' })).toEqual([september, luzMarina]);
	expect(await listIds({ text: '44' })).toHaveLength(3);
	expect(await listIds({ text: 'BETANCUR' })).toEqual([jorge]);
	expect(await listIds({ from: '2026-08-22', to: '2026-08-22' })).toEqual([jorge]);
	expect(await listIds({ from: '2026-08-16' })).toEqual([september, jorge]);
	expect(await listIds({ to: '2026-08-31', text: 'luz' })).toEqual([luzMarina]);
	setStatus(luzMarina, 'PICKED');
	expect(await listIds({ status: 'PICKED' })).toEqual([luzMarina]);
});

test("letters also find the snapshot's username, without the @ and ignoring case", async () => {
	const [, jorge] = await createThree();
	database.exec(
		`update orders set client_attributes = json_set(client_attributes, '$.whatsapp', 'LuzMarinaR')
		where id = ${jorge}`
	);
	database.exec("update contacts set whatsapp = 'LuzMarinaR' where id = 1");
	expect(await listIds({ text: 'luzma' })).toEqual([jorge]);
	expect(await listIds({ text: '@LUZMA' })).toEqual([jorge]);
	expect(await listIds({ text: '@luzmarinar betancur' })).toEqual([]);
});

test('incidents only is its own filter, in SQL', async () => {
	const [luzMarina] = await createThree();
	database.exec(`update orders set has_incident = 1 where id = ${luzMarina}`);
	expect(await listIds({ hasIncident: '1' })).toEqual([luzMarina]);
	expect(await listIds({ hasIncident: '1' })).toHaveLength(1);
});

test('an empty or tampered value is ignored, not an error', async () => {
	await createThree();
	const page = await listOrders(
		db,
		{ delivery: 'ALL', status: 'FOO', from: 'ayer', hasIncident: 'sí', text: '  ' },
		sales
	);
	expect(page.orders).toHaveLength(3);
	expect(page.filters).toEqual({ delivery: 'ALL', page: 1 });
});

test('the list is paginated in SQL, a page past the last showing the last', async () => {
	for (let i = 0; i <= ORDERS_PAGE_SIZE; i += 1) {
		await create();
	}
	const first = await listOrders(db, { delivery: 'ALL' }, sales);
	expect(first.orders).toHaveLength(ORDERS_PAGE_SIZE);
	expect(first).toMatchObject({ total: ORDERS_PAGE_SIZE + 1, pageCount: 2 });
	const second = await listOrders(db, { delivery: 'ALL', page: '2' }, sales);
	expect(second.orders.map(({ id }) => id)).toEqual([1]);
	expect(second.filters.page).toBe(2);
	const beyond = await listOrders(db, { delivery: 'ALL', page: '9' }, sales);
	expect(beyond.orders.map(({ id }) => id)).toEqual([1]);
	expect(beyond.filters.page).toBe(2);
	expect((await listOrders(db, { page: 'dos' }, sales)).filters.page).toBe(1);
});

test('no order at all is one empty page', async () => {
	expect(await listOrders(db, {}, sales)).toMatchObject({ orders: [], total: 0, pageCount: 1 });
});

test('the name search ignores accents, tildes, case and extra spaces, every word in any order', async () => {
	const [luzMarina, jorge] = await createThree();
	database.exec(
		`update orders set client_attributes = '{"name":"ÁNGELA MARÍA NÚÑEZ ARGÜELLO","phone":"573000000000","whatsapp":null}' where id = ${luzMarina}`
	);
	expect(await listIds({ text: 'ivan     betancur' })).toEqual([jorge]);
	expect(await listIds({ text: '  BETANCUR   jorge ' })).toEqual([jorge]);
	expect(await listIds({ text: 'Iván Betancur' })).toEqual([jorge]);
	expect(await listIds({ text: 'angela nunez arguello' })).toEqual([luzMarina]);
	expect(await listIds({ text: 'maría núñez' })).toEqual([luzMarina]);
	expect(await listIds({ text: 'jorge restrepo' })).toEqual([]);
	expect((await listOrders(db, { text: 'ivan     betancur' }, sales)).filters.text).toBe(
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
	expect((await listOrders(db, {}, sales)).orders.map(({ id }) => id)).toEqual(thisWeek);
	const tampered = await listOrders(db, { delivery: 'FOO' }, sales);
	expect(tampered.orders.map(({ id }) => id)).toEqual(thisWeek);
	expect(tampered.filters.delivery).toBe('THIS_WEEK');
});

test('WAREHOUSE and DRIVER get a 403 on the list', async () => {
	for (const actor of [warehouse, driver]) {
		await expect(listOrders(db, {}, actor)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	}
});

type Payment = { concept: string; amount: number; reversesId?: number; date?: string };

// Through the cash service's single insert, as every module records money.
async function pay(orderId: number, payments: Payment[]) {
	const statements = payments.flatMap(({ concept, amount, reversesId, date }) =>
		movementStatements(db, admin, {
			concept: concept as 'INSTALLMENT',
			amount,
			payment_method: 'TRANSFER',
			movement_date: date ?? '2026-08-01',
			entity_type: 'ORDER',
			entity_id: orderId,
			reverses_id: reversesId ?? null,
			attributes: {}
		})
	);
	await db.batch(statements);
}

async function detail(id: number) {
	const found = await getOrderDetail(db, String(id), sales);
	if (null === found) {
		throw new Error(`Order ${id} not found`);
	}
	return found;
}

test('two installments and a refund: what was paid, and the balance left', async () => {
	const id = await create();
	await pay(id, [
		{ concept: 'INSTALLMENT', amount: 500000 },
		{ concept: 'INSTALLMENT', amount: 300000 },
		{ concept: 'INSTALLMENT_REFUND', amount: -100000 }
	]);
	expect(await detail(id)).toMatchObject({ paid: 700000, balanceDue: 480000, depositHeld: 0 });
});

test('an installment offset from Caja counts as a negative one', async () => {
	const id = await create();
	await pay(id, [{ concept: 'INSTALLMENT', amount: 500000 }]);
	const [original] = (await detail(id)).payments;
	await pay(id, [{ concept: 'INSTALLMENT', amount: -500000, reversesId: original.id }]);
	expect(await detail(id)).toMatchObject({ paid: 0, balanceDue: 1180000 });
});

test('a deposit and its partial refund are held apart, never lowering the balance', async () => {
	const id = await create();
	await pay(id, [
		{ concept: 'SECURITY_DEPOSIT', amount: 200000 },
		{ concept: 'DEPOSIT_REFUND', amount: -150000 }
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
	await pay(id, [{ concept: 'CARRIER_PAYMENT', amount: -120000 }]);
	expect(await detail(id)).toMatchObject({ paid: 0, balanceDue: 1180000, orderTotal: 1180000 });
});

test("an overpaid order's balance comes back negative: the client's credit", async () => {
	const id = await create();
	await pay(id, [{ concept: 'INSTALLMENT', amount: 1200000 }]);
	expect((await detail(id)).balanceDue).toBe(-20000);
});

test('the detail lists the order movements oldest first, and says who cancelled it and why', async () => {
	const id = await create();
	await pay(id, [
		{ concept: 'SECURITY_DEPOSIT', amount: 200000, date: '2026-08-10' },
		{ concept: 'INSTALLMENT', amount: 500000, date: '2026-08-02' }
	]);
	const other = await create();
	await pay(other, [{ concept: 'INSTALLMENT', amount: 1000 }]);
	const order = await detail(id);
	expect(order.payments).toEqual([
		{
			id: 2,
			movementDate: '2026-08-02',
			concept: 'INSTALLMENT',
			amount: 500000,
			method: 'TRANSFER',
			otherMethod: null,
			payee: null,
			receiptNumber: 2
		},
		{
			id: 1,
			movementDate: '2026-08-10',
			concept: 'SECURITY_DEPOSIT',
			amount: 200000,
			method: 'TRANSFER',
			otherMethod: null,
			payee: null,
			receiptNumber: 1
		}
	]);
	expect(order.cancellation).toBeNull();
	await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, sales);
	expect((await detail(id)).cancellation).toMatchObject({
		cancelledBy: 'ventas',
		reason: 'El cliente aplazó el evento'
	});
});

test('an unknown or malformed id has no detail; WAREHOUSE and DRIVER read it, for Despachos', async () => {
	const id = await create();
	expect(await getOrderDetail(db, '99', sales)).toBeNull();
	expect(await getOrderDetail(db, 'abc', sales)).toBeNull();
	for (const actor of [warehouse, driver]) {
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
	const contact = database.prepare('select full_name from contacts where id = 1').get();
	expect(contact?.full_name).toBe('Luz Marina Restrepo');
});

function contactsByPhone(phone: string) {
	return database
		.prepare(
			'select id, full_name, document_id, services, attributes from contacts where phone = ?'
		)
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
	const [contact] = contactsByPhone('573152207781');
	expect(contact).toMatchObject({
		full_name: 'Gloria Patricia Henao',
		services: '[]',
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
	expect(created).toEqual([
		{ entity_type: 'CONTACT', entity_id: contact.id },
		{ entity_type: 'ORDER', entity_id: id }
	]);
});

test('«Cliente nuevo» needs a typed phone that normalizes, and writes nothing otherwise', async () => {
	const fresh = { ...order1043, client_id: null, client_name: 'Gloria', client_phone: '12' };
	const result = await createOrder(db, fresh, sales);
	expect(result).toMatchObject({ ok: false, errors: { client_phone: expect.any(String) } });
	expect(database.prepare('select count(*) as count from contacts').get()).toEqual({ count: 4 });
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
	const contact = database
		.prepare("select id, phone, whatsapp from contacts where full_name = 'Gloria Patricia Henao'")
		.get();
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
	const saved = database
		.prepare(
			"select phone, whatsapp from contacts where full_name in ('Mayra Castaño', 'Andrés Gil') order by id"
		)
		.all();
	expect(saved).toEqual([
		{ phone: null, whatsapp: 'MayC47' },
		{ phone: null, whatsapp: null }
	]);
});

test("«Cliente nuevo» refuses a username that isn't one, and writes nothing", async () => {
	const fresh = { ...order1043, client_id: null, client_name: 'Gloria', client_whatsapp: 'may-c' };
	const result = await createOrder(db, fresh, sales);
	expect(result).toMatchObject({
		ok: false,
		errors: { client_whatsapp: 'Escriba el usuario como aparece en WhatsApp, por ejemplo @mayc47.' }
	});
	expect(database.prepare('select count(*) as count from contacts').get()).toEqual({ count: 4 });
});

test("picking a contact freezes its phone and username, not the typed ones, and later edits don't reach the order", async () => {
	database.exec("update contacts set whatsapp = 'LuzMarinaR' where id = 1");
	const typed = { ...order1043, client_phone: '300 000 0000', client_whatsapp: '@otro_usuario' };
	const id = await create(typed);
	expect((await read(id)).client).toEqual({
		name: 'Luz Marina Restrepo',
		phone: '573104428890',
		whatsapp: 'LuzMarinaR'
	});
	database.exec("update contacts set phone = null, whatsapp = 'LuzMa' where id = 1");
	expect((await read(id)).client).toMatchObject({ phone: '573104428890', whatsapp: 'LuzMarinaR' });
	expect(await updateOrder(db, { ...typed, id, client_whatsapp: '' }, sales)).toEqual({
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
	database.exec(
		`insert into contacts (phone, whatsapp, full_name, document_id, services, created_at, created_by, updated_at, updated_by)
		values (null, 'WilsonMudanzas', 'Wilson Mudanzas', '71555444', '["TRANSPORTER"]', ${AUDIT})`
	);
	const carrierId = Number(
		database.prepare("select id from contacts where document_id = '71555444'").get()?.id
	);
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
	expect(await updateOrder(db, { ...order1043, id, ...fresh }, sales)).toEqual({ ok: true, id });
	const [contact] = contactsByPhone('573152207781');
	expect(await read(id)).toMatchObject({
		clientId: contact.id,
		client: { name: 'Gloria Patricia Henao' }
	});
	const contactLuz = database.prepare('select full_name, phone from contacts where id = 1').get();
	expect(contactLuz).toEqual({ full_name: 'Luz Marina Restrepo', phone: '573104428890' });
});

test('with no product list, availability covers the whole catalog', async () => {
	await book({ status: 'CONFIRMED', delivery: '2026-08-14', pickup: '2026-08-16', qty: 100 });
	const range = { delivery_date: '2026-08-15', pickup_date: '2026-08-15' };
	expect(await getAvailability(db, range, sales)).toEqual([
		{ productId: 1, available: 400 },
		{ productId: 2, available: 500 },
		{ productId: 3, available: 500 },
		{ productId: 4, available: 500 }
	]);
});

test("the form's live check brings the catalog's availability and the warnings, or nothing for half-typed dates", async () => {
	setHolidays();
	const id = await create();
	const schedule = await checkOrderSchedule(db, { ...trips, pickup_date: '2026-08-17' }, sales);
	expect(schedule?.availability).toHaveLength(4);
	expect(schedule?.warnings.holidays).toEqual([{ trip: 'PICKUP', ...ASSUMPTION }]);
	expect(schedule?.warnings.clashes.map(({ orderId }) => orderId)).toEqual([id]);
	expect(await checkOrderSchedule(db, { ...trips, pickup_date: '2026-08' }, sales)).toBeNull();
	expect(await checkOrderSchedule(db, { ...trips, pickup_date: '2026-08-01' }, sales)).toBeNull();
});

const manager: Actor = { ...sales, username: 'gerente', roles: ['MANAGER'] };

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

async function recordPayment(orderId: number, fields: Record<string, string>, actor = manager) {
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
	const installment = await recordPayment(id, { payee: 'Otro nombre' }, sales);
	expect(installment).toMatchObject({
		concept: 'INSTALLMENT',
		amount: 300000,
		entity_type: 'ORDER',
		entity_id: id,
		payee: 'Luz Marina Restrepo',
		created_by: 'ventas'
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
	const result = await recordOrderPayment(db, typedPayment(99), manager);
	expect(result).toMatchObject({ ok: false, message: 'Ese pedido no existe.' });
	expect(database.prepare('select count(*) as count from cash_movements').get()).toEqual({
		count: 0
	});
});

test('a billed order refuses a «Pago», and still takes a refund', async () => {
	const id = await create();
	database.exec(
		`insert into receivables (id, client_id, issue_date, created_at, created_by, updated_at, updated_by)
		select 4794, client_id, '2026-08-01', 0, 'admin', 0, 'admin' from orders where id = ${id}`
	);
	database.exec(`update orders set receivable_id = 4794 where id = ${id}`);
	expect(await recordOrderPayment(db, typedPayment(id), manager)).toEqual({
		ok: false,
		message: 'El pago va en la cuenta de cobro Nº 4794.',
		errors: {}
	});
	const refund = await recordPayment(id, { concept: 'INSTALLMENT_REFUND' });
	expect(refund).toMatchObject({ amount: -300000, entity_type: 'ORDER' });
});

test('SALES records money in only; WAREHOUSE and DRIVER record nothing: a 403', async () => {
	const id = await create(withCarriers(WILSON, null));
	for (const concept of ['INSTALLMENT_REFUND', 'DEPOSIT_REFUND', 'CARRIER_PAYMENT']) {
		await expect(recordOrderPayment(db, typedPayment(id, { concept }), sales)).rejects.toSatisfy(
			(thrown) => isHttpError(thrown, 403)
		);
	}
	for (const actor of [warehouse, driver]) {
		await expect(recordOrderPayment(db, typedPayment(id), actor)).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
	}
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT' }, sales);
});

test('a carrier payment needs an order with a carrier, and goes to its name, editable', async () => {
	const without = await create();
	const refused = await recordOrderPayment(
		db,
		typedPayment(without, { concept: 'CARRIER_PAYMENT' }),
		manager
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
		manager
	);
	expect(unpicked).toMatchObject({ ok: false, errors: { trip: 'Escoge a cuál transportador' } });
	const paid = await recordPayment(id, { concept: 'CARRIER_PAYMENT', trip: 'DELIVERY' });
	expect(paid.payee).toBe('Transportes Aburrá');
	const same = await create(withCarriers(WILSON, WILSON));
	expect((await recordPayment(same, { concept: 'CARRIER_PAYMENT' })).payee).toBe('Wilson Muñoz');
});

test('payments are recorded on a cancelled order too', async () => {
	const id = await create();
	await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, sales);
	await recordPayment(id, { concept: 'INSTALLMENT_REFUND' });
	expect((await detail(id)).balanceDue).toBe(1480000);
});

test('a transfer out needs the account, a copy the contact or order never change', async () => {
	const id = await create();
	const transfer = { concept: 'DEPOSIT_REFUND', payment_method: 'TRANSFER' };
	const missing = await recordOrderPayment(db, typedPayment(id, transfer), manager);
	expect(missing).toMatchObject({
		ok: false,
		errors: { bank_account: 'Escribe la cuenta de destino' }
	});
	const account = 'Bancolombia ahorros 052-334198-07';
	const refund = await recordPayment(id, { ...transfer, bank_account: account });
	database.exec(
		`update contacts set attributes = '{"bank_account":"Otra cuenta"}', full_name = 'Otra' where id = 1`
	);
	const edited = { ...order1043, client_id: JORGE, client_name: 'Jorge Iván Betancur' };
	expect(await updateOrder(db, { ...edited, id }, sales)).toMatchObject({ ok: true });
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
	await recordPayment(id, { amount: '1.180.000' }, sales);
	const again = await recordOrderPayment(db, typedPayment(id), sales);
	expect(again).toMatchObject({ ok: false, message: 'Este pedido ya está pagado.' });
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT' }, sales);
	await recordPayment(id, { concept: 'INSTALLMENT_REFUND', amount: '10.000' });
	expect(await recordOrderPayment(db, typedPayment(id), sales)).toMatchObject({ ok: true });
});

test.each(['INSTALLMENT', 'SECURITY_DEPOSIT', 'INSTALLMENT_REFUND'])(
	'a %s never changes the status',
	async (concept) => {
		const id = await create();
		await recordPayment(id, { concept, amount: '10.000' });
		expect(await detail(id)).toMatchObject({ status: 'CONFIRMED' });
		const cancelled = await create();
		await cancelOrder(db, { id: cancelled, reason: 'Cambió de fecha' }, sales);
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
	expect(await offeredTo(sales)).toEqual(['INSTALLMENT', 'SECURITY_DEPOSIT']);
	await recordPayment(id, { amount: '1.180.000' }, sales);
	expect(await offeredTo(sales)).toEqual(['SECURITY_DEPOSIT']);
	const { depositAmount } = await detail(id);
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT', amount: String(depositAmount) }, sales);
	expect(await offeredTo(sales)).toEqual([]);
	expect(await offeredTo(manager)).toEqual(['INSTALLMENT_REFUND', 'DEPOSIT_REFUND']);
});

// The planning's example: a $1.500.000 order, $800.000 paid and a $300.000 deposit, cancelled.
async function cancelledWithMoney(): Promise<number> {
	const id = await create({ ...order1043, transport_cost: 500000 });
	await recordPayment(id, { amount: '800.000' }, sales);
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT', amount: '300.000' }, sales);
	await cancelOrder(db, { id, reason: 'El camión llegó tarde' }, sales);
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
		const result = await recordOrderPayment(db, typedPayment(id, fee(source, amount)), manager);
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
	await recordPayment(id, { amount: '500.000' }, sales);
	const issued = await issueReceivable(db, { orders: [id], payment_terms: 'Contado' }, sales);
	if (!issued.ok) {
		throw new Error(issued.message);
	}
	const payment = { id: String(issued.id), payment_method: 'TRANSFER', amount: '1.000.000' };
	const paid = await recordReceivablePayment(
		db,
		{ ...payment, movement_date: '2026-08-10', notes: '', bank_account: 'Bancolombia' },
		sales
	);
	if (!paid.ok) {
		throw new Error(paid.message);
	}
	expect(await cancelOrder(db, { id, reason: 'Devolvieron el camión' }, sales)).toMatchObject({
		ok: true
	});
	return [id, issued.id];
}

test('a cancelled billed order stays in its cuenta, «Anulada», and is owed the cuenta credit', async () => {
	const [id, receivableId] = await cancelledInCuenta();
	expect(orderRow(id)).toMatchObject({ status: 'CANCELLED', receivable_id: receivableId });
	expect(await getReceivableDetail(db, receivableId, sales)).toMatchObject({
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
	await recordPayment(id, { concept: 'SECURITY_DEPOSIT', amount: '200.000' }, sales);
	expect((await detail(id)).owedToClient).toBe(1700000);
});

test("«Retener de los pagos» on a billed order goes up to its cuenta's credit", async () => {
	const [id, receivableId] = await cancelledInCuenta();
	const over = await recordOrderPayment(
		db,
		typedPayment(id, fee('INSTALLMENTS', '1.500.001')),
		manager
	);
	expect(over).toMatchObject({
		ok: false,
		errors: { amount: expect.stringContaining(`cuenta de cobro Nº ${receivableId}`) }
	});
	await recordPayment(id, fee('INSTALLMENTS', '1.500.000'));
	expect((await detail(id)).owedToClient).toBe(0);
	expect((await getReceivableDetail(db, receivableId, sales))?.balance).toBe(0);
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
		manager
	);
	expect(onConfirmed).toMatchObject({ ok: false });
	const id = await cancelledWithMoney();
	const bySales = recordOrderPayment(db, typedPayment(id, fee('NEW', '50.000')), sales);
	await expect(bySales).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	expect(offeredPaymentConcepts(await detail(id), manager)).toContain('CANCELLATION_FEE');
	expect(offeredPaymentConcepts(await detail(id), sales)).not.toContain('CANCELLATION_FEE');
	expect(offeredPaymentConcepts(await detail(confirmed), manager)).not.toContain(
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
	expect(await recordOffset(db, offset, manager)).toMatchObject({ ok: true });
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
	await recordPayment(id, { amount: '1.500.000' }, sales);
	await recordPayment(id, { concept: 'INSTALLMENT_REFUND', amount: '2.000.000' });
	await recordPayment(id, { concept: 'DEPOSIT_REFUND', amount: '100.000' });
	expect(await detail(id)).toMatchObject({ paid: -500000, depositHeld: -100000 });
});

test("the payment entry pre-fills from the client's and each carrier's saved account", async () => {
	database.exec(
		`update contacts set attributes = '{"bank_account":"Cuenta Luz"}' where id = ${LUZ_MARINA};
		update contacts set attributes = '{"bank_account":"Cuenta Wilson"}' where id = ${WILSON};`
	);
	const id = await create(withCarriers(ABURRA, WILSON));
	expect(await getPaymentOptions(db, await read(id), manager)).toEqual({
		clientBankAccount: 'Cuenta Luz',
		carriers: [
			{ trip: 'DELIVERY', name: 'Transportes Aburrá', bankAccount: null },
			{ trip: 'PICKUP', name: 'Wilson Muñoz', bankAccount: 'Cuenta Wilson' }
		]
	});
});

// The Design Brief's #1043 edited: another client, a later pickup by a carrier, lines and money.
const edited1043 = {
	...order1043,
	client_id: JORGE,
	client_name: 'Jorge Iván Betancur',
	pickup_date: '2026-08-17',
	rental_days: 3,
	pickup_attributes: { ...address, method: 'EXTERNAL_CARRIER', time: '09:00', carrier_id: WILSON },
	order_items: [
		{ product_id: 1, qty: 100, unit_price: 2500 },
		{ product_id: 3, qty: 120, unit_price: 1000 }
	],
	transport_cost: 150000,
	notes: 'Portón blanco después del puente'
};

async function timeline(id: number, actor: Actor = sales) {
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
	expect(await updateOrder(db, { ...edited1043, id }, sales)).toMatchObject({ ok: true });
	await advanceOrder(db, { id, status: 'PICKED' }, warehouse);
	await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, manager);
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
			actorUsername: 'gerente'
		},
		{ action: 'STATUS_CHANGED', status: 'PICKED', reason: null, actorUsername: 'bodega' },
		{ action: 'EDITED', status: null, reason: null, actorUsername: 'ventas' },
		{ action: 'CREATED', status: 'CONFIRMED', reason: null, actorUsername: 'ventas' }
	]);
	expect(entries[0].createdAt).toEqual(expect.any(Number));
	expect(entries[0]).not.toHaveProperty('before');
	expect(entries[0]).not.toHaveProperty('after');
	expect(await getOrderTimeline(db, 999, sales)).toBeNull();
});

test('an edit opens in its named, formatted changes, the client by name and lines per product', async () => {
	const id = await create();
	await updateOrder(db, { ...edited1043, id }, sales);
	expect(await getOrderChange(db, { order: id, event: await editId(id) }, sales)).toEqual([
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
	await updateOrder(db, { ...order1043, id }, sales);
	const changes = await getOrderChange(db, { order: id, event: await editId(id) }, sales);
	expect(changes).toEqual([
		{ label: 'Mesa redonda 10 puestos', change: 'Agregada: 12 × $12.000' },
		{ label: 'Copa para vino tinto', change: 'Agregada: 120 × $900' }
	]);
});

test('only an edit of that order opens, and only for whoever sees edits', async () => {
	const id = await create();
	const other = await create();
	await updateOrder(db, { ...edited1043, id }, sales);
	const event = await editId(id);
	const created = (await timeline(id)).at(-1)?.id;
	expect(await getOrderChange(db, { order: other, event }, sales)).toBeNull();
	expect(await getOrderChange(db, { order: id, event: created }, sales)).toBeNull();
	expect(await getOrderChange(db, { order: id, event: 'x' }, sales)).toBeNull();
	expect(await getOrderChange(db, { order: id, event }, warehouse)).toBeNull();
	expect(await getOrderChange(db, { order: id, event }, manager)).toHaveLength(11);
});

test('the warehouse and the driver see only status changes and cancellations', async () => {
	const id = await create();
	await updateOrder(db, { ...edited1043, id }, sales);
	await advanceOrder(db, { id, status: 'PICKED' }, warehouse);
	await cancelOrder(db, { id, reason: 'El cliente aplazó el evento' }, sales);
	for (const actor of [warehouse, driver]) {
		const actions = (await timeline(id, actor)).map(({ action }) => action);
		expect(actions).toEqual(['CANCELLED', 'STATUS_CHANGED']);
	}
});

test('the printout carries no carrier, and the company from its settings', async () => {
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	const external = { method: 'EXTERNAL_CARRIER', carrier_id: WILSON };
	const id = await create({
		...order1043,
		delivery_attributes: { ...order1043.delivery_attributes, ...external },
		pickup_attributes: { ...order1043.pickup_attributes, ...external }
	});
	const printout = await getOrderPrintout(db, String(id), sales);
	expect(printout?.company.COMPANY_NAME).toBe('Banquetes Consuelo C');
	expect(JSON.stringify(printout)).not.toMatch(/Wilson|573119085512/);
});

test('an unknown order has no printout; WAREHOUSE and DRIVER print it, for Despachos', async () => {
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	const id = await create();
	expect(await getOrderPrintout(db, '99', sales)).toBeNull();
	for (const actor of [warehouse, driver]) {
		expect((await getOrderPrintout(db, id, actor))?.order.id).toBe(id);
	}
});

// Some of #1043's chairs, kept three more days. Any delivery date sent is ignored.
const extension = {
	...order1043,
	delivery_date: '2026-08-01',
	pickup_date: '2026-08-19',
	rental_days: 3,
	order_items: [{ product_id: 1, qty: 100, unit_price: 2500 }],
	discount: 0,
	transport_cost: 60000,
	deposit_amount: 0
};

function extend(parent: number, input: object = extension, actor: Actor = sales) {
	return createExtension(db, { ...input, parent_order_id: String(parent) }, actor);
}

async function deliveredWithExtension(): Promise<{ parent: number; id: number }> {
	const parent = await create();
	setStatus(parent, 'DELIVERED');
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
	const parent = await create();
	setStatus(parent, 'DELIVERED');
	database.prepare("update products set name = 'Silla', rental_price = 3000 where id = 1").run();
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
				product_id: 1,
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
	const id = await create();
	for (const status of ['CONFIRMED', 'OUT_FOR_PICKUP', 'COMPLETED', 'CANCELLED']) {
		setStatus(id, status);
		expect(await extend(id)).toMatchObject({
			ok: false,
			message: 'Solo un pedido entregado se puede extender'
		});
	}
	expect(await extend(99)).toMatchObject({ ok: false, message: 'Ese pedido no existe' });
	expect(database.prepare('select count(*) as count from orders').get()).toEqual({ count: 1 });
});

test("an extension's lines are the original's products, each up to its quantity", async () => {
	const parent = await create();
	setStatus(parent, 'DELIVERED');
	const line = (productId: number, qty: number) => ({
		...extension,
		order_items: [{ product_id: productId, qty, unit_price: 900 }]
	});
	expect(await extend(parent, line(4, 1))).toMatchObject({
		ok: false,
		errors: { 'order_items.0.product_id': `No está en el pedido #${parent}` }
	});
	expect(await extend(parent, line(3, 121))).toMatchObject({
		ok: false,
		errors: { 'order_items.0.qty': `Máximo 120, lo que tiene el pedido #${parent}` }
	});
	expect(await extend(parent, line(3, 120))).toMatchObject({ ok: true });
});

test('an original on days 1–4 and its extension on 5–7 subtract the extended chairs once a day', async () => {
	const parent = await book({
		status: 'DELIVERED',
		delivery: '2026-08-01',
		pickup: '2026-08-04',
		qty: 100
	});
	const lines = [{ product_id: 1, qty: 60, unit_price: 2500 }];
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
	expect((await getOrderDetail(db, parent, sales))?.extensions).toEqual([
		{ id, status: 'DELIVERED', deliveryDate: '2026-08-17', pickupDate: '2026-08-19' }
	]);
	const edited = { ...extension, delivery_date: '2026-08-17', rental_days: 4, id };
	expect(await updateOrder(db, edited, sales)).toMatchObject({ ok: true });
	expect((await read(id)).parentOrderId).toBe(parent);
	for (const actor of [warehouse, driver]) {
		await expect(extend(parent, extension, actor)).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
	}
});

async function pickedOrder(): Promise<number> {
	const id = await create();
	await advanceOrder(db, { id, status: 'PICKED' }, warehouse);
	return id;
}

function editOrder(id: number, rentalDays: number) {
	return updateOrder(db, { ...order1043, id, rental_days: rentalDays }, sales);
}

async function modifiedAfterStagingAt(id: number) {
	return (await getOrderDetail(db, id, warehouse))?.modifiedAfterStagingAt;
}

type RawEvent = { entityType: string; entityId: number; action: string; after: object };

function insertEvent({ entityType, entityId, action, after }: RawEvent) {
	database
		.prepare(
			`insert into events (entity_type, entity_id, action, actor_username, actor_kind, after, created_at) values (?, ?, ?, 'conductor', 'user', ?, 0)`
		)
		.run(entityType, entityId, action, JSON.stringify(after));
}

test('an edit before picking is no modification after staging; one after picking is, with its time', async () => {
	const before = await create();
	await editOrder(before, 3);
	await advanceOrder(db, { id: before, status: 'PICKED' }, warehouse);
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
	await advanceOrder(db, { id, status: 'OUT_FOR_DELIVERY' }, driver);
	// What the transition's note writes: the delivery note rides on the STATUS_CHANGED event.
	insertEvent({
		entityType: 'ORDER',
		entityId: id,
		action: 'STATUS_CHANGED',
		after: { status: 'DELIVERED', delivery_attributes: { notes: 'Lo recibió el portero' } }
	});
	// What an incident writes: its own event, and has_incident with no ORDER event.
	insertEvent({ entityType: 'INCIDENT', entityId: 1, action: 'CREATED', after: { order_id: id } });
	database
		.prepare('update orders set status = ?, has_incident = 1 where id = ?')
		.run('DELIVERED', id);
	expect(await modifiedAfterStagingAt(id)).toBeNull();
});

test('an extension has no PICKED, and is never modified after staging', async () => {
	const { id } = await deliveredWithExtension();
	const edited = { ...extension, delivery_date: '2026-08-17', rental_days: 4, id };
	expect(await updateOrder(db, edited, sales)).toMatchObject({ ok: true });
	expect(await modifiedAfterStagingAt(id)).toBeNull();
});
