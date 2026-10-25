import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import type { Actor, Role } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { movementStatements } from './cash';
import {
	advanceOrder,
	cancelOrder,
	confirmOrder,
	createOrder,
	getAvailability,
	getOrder,
	getOrderDetail,
	getOrderWarnings,
	listOrders,
	ORDERS_PAGE_SIZE,
	orderItemsSchema,
	previewConfirmation,
	updateOrder
} from './orders';

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
		status: 'DRAFT',
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
	expect(created.after).toMatchObject({ status: 'DRAFT', order_total: 1180000 });
	expect(created.after).not.toHaveProperty('public_token');
	expect(created.after).not.toHaveProperty('has_incident');
	expect((await read(id)).hasIncident).toBe(false);
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

test('rental days are at least 1; a pickup before the delivery fails on its field; the event date is free', async () => {
	const noDays = await createOrder(db, { ...order1043, rental_days: 0 }, sales);
	expect(noDays).toMatchObject({ ok: false, errors: { rental_days: expect.any(String) } });
	const early = await createOrder(db, { ...order1043, pickup_date: '2026-08-13' }, sales);
	expect(early).toMatchObject({ ok: false, errors: { pickup_date: expect.any(String) } });
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
		phone: '573119085512'
	});
	expect(order.pickup.carrier).toEqual({
		id: ABURRA,
		name: 'Transportes Aburrá',
		phone: '573005550101'
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
	await updateOrder(db, { ...order1043, id, client_id: JORGE }, sales);
	expect(await read(id)).toMatchObject({
		clientId: JORGE,
		client: { name: 'Jorge Iván Betancur', phone: '573007712043' }
	});
	const edited = orderEvents()[1];
	expect(Object.keys(edited.after).sort()).toEqual(['client_attributes', 'client_id']);
	const unknown = await updateOrder(db, { ...order1043, id, client_id: 99 }, sales);
	expect(unknown).toMatchObject({ ok: false, errors: { client_id: expect.any(String) } });
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

test('only orders holding their products subtract: not a draft, a cancelled or a completed one', async () => {
	for (const status of ['DRAFT', 'CANCELLED', 'COMPLETED']) {
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
		{ trip: 'PICKUP', orderId: id, clientName: 'Luz Marina Restrepo' }
	]);
	const atItsPickup = {
		delivery_date: '2026-08-16',
		delivery_time: '09:00',
		pickup_date: '2026-08-18'
	};
	expect((await getOrderWarnings(db, { ...trips, ...atItsPickup }, sales)).clashes).toEqual([
		{ trip: 'DELIVERY', orderId: id, clientName: 'Luz Marina Restrepo' }
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

test('confirming needs no payment, and writes a STATUS_CHANGED event with the status', async () => {
	const id = await create();
	expect(await confirmOrder(db, { id }, sales)).toEqual({ ok: true, id });
	expect(await status(id)).toBe('CONFIRMED');
	expect(orderEvents()[1]).toEqual({
		action: 'STATUS_CHANGED',
		before: { status: 'DRAFT' },
		after: { status: 'CONFIRMED' }
	});
});

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
		before: '{"status":"DRAFT"}',
		after: '{"status":"CANCELLED"}',
		reason: 'El cliente aplazó el evento'
	});
	expect(await updateOrder(db, { ...order1043, id }, sales)).toMatchObject({ ok: false });
	expect(await confirmOrder(db, { id }, sales)).toMatchObject({ ok: false });
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
	await confirmOrder(db, { id }, sales);
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

test('DRIVER cannot confirm or cancel an order', async () => {
	const id = await create();
	for (const attempt of [
		confirmOrder(db, { id }, driver),
		cancelOrder(db, { id, reason: 'No contesta' }, driver)
	]) {
		await expect(attempt).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	}
	expect(await status(id)).toBe('DRAFT');
});

test('the operational path cannot confirm or cancel, whoever asks', async () => {
	const id = await create();
	for (const target of ['CONFIRMED', 'CANCELLED', 'DRAFT']) {
		const result = await advanceOrder(db, { id, status: target }, admin);
		expect(result).toMatchObject({ ok: false, errors: { status: expect.any(String) } });
	}
	expect(await status(id)).toBe('DRAFT');
});

test('an illegal transition fails for every role, and writes nothing', async () => {
	const id = await create();
	await confirmOrder(db, { id }, sales);
	for (const actor of [admin, sales, warehouse]) {
		expect(await advanceOrder(db, { id, status: 'DELIVERED' }, actor)).toMatchObject({ ok: false });
	}
	expect(await confirmOrder(db, { id }, admin)).toMatchObject({ ok: false });
	expect(await status(id)).toBe('CONFIRMED');
	expect(orderEvents()).toHaveLength(2);
	expect(await advanceOrder(db, { id: 99, status: 'PICKED' }, admin)).toMatchObject({ ok: false });
});

test('a client pickup and return goes picked → delivered → completed', async () => {
	const atWarehouse = { ...address, time: null };
	const id = await create({
		...order1043,
		delivery_attributes: { ...atWarehouse, method: 'CLIENT_PICKUP' },
		pickup_attributes: { ...atWarehouse, method: 'CLIENT_RETURN' }
	});
	await confirmOrder(db, { id }, sales);
	await advanceOrder(db, { id, status: 'PICKED' }, warehouse);
	expect(await advanceOrder(db, { id, status: 'OUT_FOR_DELIVERY' }, driver)).toMatchObject({
		ok: false
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

function setAdvancePercentage(percentage: number) {
	database
		.prepare(
			`insert into settings (key, value, created_at, created_by, updated_at, updated_by) values ('ORDERS_SUGGESTED_ADVANCE_PCT', ?, ${AUDIT})`
		)
		.run(String(percentage));
}

test('the confirmation names the products short and by how much, and still confirms', async () => {
	setAdvancePercentage(50);
	await book({ status: 'CONFIRMED', delivery: '2026-08-15', pickup: '2026-08-15', qty: 430 });
	const id = await create();
	expect(await previewConfirmation(db, { id }, sales)).toEqual({
		shortages: [{ productId: 1, name: 'Silla Tiffany dorada', short: 50 }],
		suggestedAdvance: 590000
	});
	expect(await confirmOrder(db, { id }, sales)).toEqual({ ok: true, id });
	// Once confirmed, its own lines still don't count against it.
	expect((await previewConfirmation(db, { id }, sales))?.shortages).toHaveLength(1);
});

test('the suggested advance rounds to the peso and validates nothing', async () => {
	setAdvancePercentage(50);
	const id = await create({ ...order1043, transport_cost: 180001 });
	expect((await previewConfirmation(db, { id }, sales))?.suggestedAdvance).toBe(590001);
	expect(await previewConfirmation(db, { id: 99 }, sales)).toBeNull();
});

async function listIds(input: Record<string, string> = {}): Promise<number[]> {
	return (await listOrders(db, input, sales)).orders.map(({ id }) => id);
}

// Three orders: Luz Marina's on Aug 15, Jorge's on Aug 22 (a client pickup) and Luz Marina's on Sep 5.
async function createThree(): Promise<[number, number, number]> {
	const luzMarina = await create();
	const atWarehouse = { ...order1043.delivery_attributes, method: 'CLIENT_PICKUP' };
	const jorge = await create({
		...order1043,
		client_id: JORGE,
		event_date: '2026-08-22',
		delivery_attributes: atWarehouse,
		discount: 0
	});
	const september = await create({ ...order1043, event_date: '2026-09-05', transport_cost: 0 });
	return [luzMarina, jorge, september];
}

test('the list shows every order by event date, latest first, with its summary', async () => {
	const [luzMarina, jorge, september] = await createThree();
	const page = await listOrders(db, {}, sales);
	expect(page.orders.map(({ id }) => id)).toEqual([september, jorge, luzMarina]);
	expect(page.total).toBe(3);
	expect(page.orders[1]).toEqual({
		id: jorge,
		clientName: 'Jorge Iván Betancur',
		eventDate: '2026-08-22',
		status: 'DRAFT',
		hasIncident: false,
		deliveryMethod: 'CLIENT_PICKUP',
		orderTotal: 1284000,
		balanceDue: 1284000
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
	expect((await listOrders(db, {}, sales)).orders[0].balanceDue).toBe(680000);
});

test('the filters combine, each over the order snapshot', async () => {
	const [luzMarina, jorge, september] = await createThree();
	database.exec(
		"update contacts set full_name = 'Otro nombre', phone = '573000000000' where id = 1"
	);
	expect(await listIds({ phone: '442 88' })).toEqual([september, luzMarina]);
	expect(await listIds({ phone: '44' })).toHaveLength(3);
	expect(await listIds({ name: 'BETANCUR' })).toEqual([jorge]);
	expect(await listIds({ from: '2026-08-22', to: '2026-08-22' })).toEqual([jorge]);
	expect(await listIds({ from: '2026-08-16' })).toEqual([september, jorge]);
	expect(await listIds({ to: '2026-08-31', name: 'luz' })).toEqual([luzMarina]);
	expect(await listIds({ min: '$1.200.000' })).toEqual([jorge]);
	expect(await listIds({ max: '1.100.000' })).toEqual([september]);
	setStatus(luzMarina, 'CONFIRMED');
	expect(await listIds({ status: 'CONFIRMED' })).toEqual([luzMarina]);
});

test('incidents only is its own filter, in SQL', async () => {
	const [luzMarina] = await createThree();
	database.exec(`update orders set has_incident = 1 where id = ${luzMarina}`);
	expect(await listIds({ hasIncident: '1' })).toEqual([luzMarina]);
	expect((await listOrders(db, { hasIncident: '1' }, sales)).orders[0].hasIncident).toBe(true);
});

test('an empty or tampered value is ignored, not an error', async () => {
	await createThree();
	const page = await listOrders(
		db,
		{ status: 'FOO', from: 'ayer', min: 'mucho', hasIncident: 'sí', phone: '' },
		sales
	);
	expect(page.orders).toHaveLength(3);
	expect(page.filters).toEqual({ page: 1 });
});

test('the list is paginated in SQL, a page past the last showing the last', async () => {
	for (let i = 0; i <= ORDERS_PAGE_SIZE; i += 1) {
		await create();
	}
	const first = await listOrders(db, {}, sales);
	expect(first.orders).toHaveLength(ORDERS_PAGE_SIZE);
	expect(first).toMatchObject({ total: ORDERS_PAGE_SIZE + 1, pageCount: 2 });
	const second = await listOrders(db, { page: '2' }, sales);
	expect(second.orders.map(({ id }) => id)).toEqual([1]);
	expect(second.filters.page).toBe(2);
	const beyond = await listOrders(db, { page: '9' }, sales);
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
		`update orders set client_attributes = '{"name":"ÁNGELA MARÍA NÚÑEZ ARGÜELLO","phone":"573000000000"}' where id = ${luzMarina}`
	);
	expect(await listIds({ name: 'ivan     betancur' })).toEqual([jorge]);
	expect(await listIds({ name: '  BETANCUR   jorge ' })).toEqual([jorge]);
	expect(await listIds({ name: 'Iván Betancur' })).toEqual([jorge]);
	expect(await listIds({ name: 'angela nunez arguello' })).toEqual([luzMarina]);
	expect(await listIds({ name: 'maría núñez' })).toEqual([luzMarina]);
	expect(await listIds({ name: 'jorge restrepo' })).toEqual([]);
	expect((await listOrders(db, { name: 'ivan     betancur' }, sales)).filters.name).toBe(
		'ivan betancur'
	);
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
			receiptNumber: 2
		},
		{
			id: 1,
			movementDate: '2026-08-10',
			concept: 'SECURITY_DEPOSIT',
			amount: 200000,
			method: 'TRANSFER',
			otherMethod: null,
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

test('an unknown or malformed id has no detail; WAREHOUSE and DRIVER get a 403', async () => {
	const id = await create();
	expect(await getOrderDetail(db, '99', sales)).toBeNull();
	expect(await getOrderDetail(db, 'abc', sales)).toBeNull();
	for (const actor of [warehouse, driver]) {
		await expect(getOrderDetail(db, id, actor)).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
	}
});
