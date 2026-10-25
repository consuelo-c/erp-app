import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import type { Actor, Role } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { createOrder, getOrder, orderItemsSchema, updateOrder } from './orders';

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
