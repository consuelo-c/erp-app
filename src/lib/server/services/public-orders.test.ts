import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { movementStatements } from './cash';
import { createOrder } from './orders';
import { findOrderIdByToken, getPublicOrder, getWhatsAppHref, lookupOrders } from './public-orders';

const sales: Actor = { username: 'ventas', employeeId: null, roles: ['SALES'], kind: 'user' };

const AUDIT = "0, 'admin', 0, 'admin'";

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
	const contact = database.prepare(
		`insert into contacts (phone, full_name, document_id, services, created_at, created_by, updated_at, updated_by) values (?, ?, ?, ?, ${AUDIT})`
	);
	contact.run('573104428890', 'Luz Marina Restrepo', '@luz', '[]');
	contact.run('573119085512', 'Wilson Muñoz', '@wilson', '["TRANSPORTER"]');
	const product = database.prepare(
		`insert into products (name, category, rental_price, total_quantity, active, created_at, created_by, updated_at, updated_by) values (?, 'CHAIRS_TABLES', ?, 500, 1, ${AUDIT})`
	);
	product.run('Silla Tiffany dorada', 2500);
	product.run('Mesa redonda 10 puestos', 12000);
	product.run('Copa para vino tinto', 900);
	// Saturday 17 October 2026, 9 a.m. in Bogotá: #1043's event day.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-17T14:00:00Z'));
	onTestFinished(() => {
		vi.useRealTimers();
	});
});

const WILSON = 2;
const address = { address_1: 'Cra 43A #18-95, El Poblado', address_2: 'Salón Social Torre Verde' };

// The Design Brief's order #1043.
const order1043 = {
	client_id: 1,
	client_name: 'Luz Marina Restrepo',
	event_date: '2026-10-17',
	delivery_date: '2026-10-16',
	pickup_date: '2026-10-18',
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

/** An order in `status`, and its client link's token. */
async function create(status = 'CONFIRMED', input: object = {}): Promise<string> {
	const result = await createOrder(db, { ...order1043, ...input }, sales);
	if (!result.ok) {
		throw new Error(JSON.stringify(result.errors));
	}
	database.prepare('update orders set status = ? where id = ?').run(status, result.id);
	const row = database.prepare('select public_token from orders where id = ?').get(result.id);
	return String(row?.public_token);
}

test("#1043's page: the printout's figures, and exactly the fields the client sees", async () => {
	const token = await create();
	await db.batch(
		movementStatements(db, sales, {
			concept: 'INSTALLMENT',
			amount: 500000,
			payment_method: 'TRANSFER',
			movement_date: '2026-10-10',
			entity_type: 'ORDER',
			entity_id: 1,
			reverses_id: null,
			attributes: {}
		})
	);
	expect(await getPublicOrder(db, token)).toEqual({
		id: 1,
		status: 'CONFIRMED',
		clientName: 'Luz Marina Restrepo',
		eventDate: '2026-10-17',
		deliveryDate: '2026-10-16',
		pickupDate: '2026-10-18',
		rentalDays: 2,
		delivery: { method: 'COMPANY_DELIVERY', ...address },
		pickup: { method: 'COMPANY_PICKUP' },
		items: [
			{ name: 'Silla Tiffany dorada', qty: 120, unit_price: 2500, line_total: 600000 },
			{ name: 'Mesa redonda 10 puestos', qty: 12, unit_price: 12000, line_total: 288000 },
			{ name: 'Copa para vino tinto', qty: 120, unit_price: 900, line_total: 216000 }
		],
		itemsTotal: 1104000,
		discount: 104000,
		transportCost: 180000,
		orderTotal: 1180000,
		depositAmount: 200000,
		paid: 500000,
		balanceDue: 680000
	});
});

test('never the carrier, times, notes, list prices, phone, incident or payments', async () => {
	const external = { method: 'EXTERNAL_CARRIER', carrier_id: WILSON, time: '14:00', ...address };
	const token = await create('DELIVERED', {
		delivery_attributes: external,
		pickup_attributes: { ...external, address_1: 'Finca La Esperanza' },
		notes: 'Cliente difícil'
	});
	database
		.prepare(
			"update orders set has_incident = 1, delivery_attributes = json_set(delivery_attributes, '$.notes', 'Portería cerrada')"
		)
		.run();
	const order = await getPublicOrder(db, token);
	const keys = JSON.stringify(order).match(/"\w+":/g) ?? [];
	for (const forbidden of [
		'carrier',
		'notes',
		'list_price',
		'client_id',
		'clientId',
		'phone',
		'has_incident',
		'hasIncident',
		'time',
		'payments'
	]) {
		expect(keys).not.toContain(`"${forbidden}":`);
	}
	const shown = JSON.stringify(order);
	for (const hidden of [
		'Wilson',
		'573119085512',
		'573104428890',
		'Cliente difícil',
		'Portería',
		'Finca La Esperanza',
		'14:00'
	]) {
		expect(shown).not.toContain(hidden);
	}
});

test('an unknown token, a draft, an event 8 days past or an id: no page', async () => {
	expect(await getPublicOrder(db, crypto.randomUUID())).toBeNull();
	expect(await getPublicOrder(db, await create('DRAFT'))).toBeNull();
	const eightDaysAgo = await create('COMPLETED', { event_date: '2026-10-09' });
	expect(await getPublicOrder(db, eightDaysAgo)).toBeNull();
	expect(await getPublicOrder(db, '1')).toBeNull();
	expect(await getPublicOrder(db, 1)).toBeNull();
});

test('an event 7 days past and a cancelled order still open', async () => {
	const sevenDaysAgo = await create('COMPLETED', { event_date: '2026-10-10' });
	expect(await getPublicOrder(db, sevenDaysAgo)).toMatchObject({ status: 'COMPLETED' });
	expect(await getPublicOrder(db, await create('CANCELLED'))).toMatchObject({
		status: 'CANCELLED'
	});
});

test("the staff's lookup finds any order by its token, draft or old, never by its id", async () => {
	const draft = await create('DRAFT');
	const old = await create('COMPLETED', { event_date: '2026-01-10' });
	expect(await findOrderIdByToken(db, draft)).toBe(1);
	expect(await findOrderIdByToken(db, old)).toBe(2);
	expect(await findOrderIdByToken(db, crypto.randomUUID())).toBeNull();
	expect(await findOrderIdByToken(db, '1')).toBeNull();
});

test('the WhatsApp link: none while COMPANY_WHATSAPP is empty, its text encoded otherwise', async () => {
	const setWhatsApp = (value: string) =>
		database
			.prepare(
				`insert or replace into settings (key, value, created_at, created_by, updated_at, updated_by) values ('COMPANY_WHATSAPP', ?, ${AUDIT})`
			)
			.run(value);
	setWhatsApp('');
	expect(await getWhatsAppHref(db, 'Hola.')).toBeNull();
	setWhatsApp('573105550142');
	const href = new URL(String(await getWhatsAppHref(db, 'Hola. ¿Y mi pedido #1043?')));
	expect(`${href.origin}${href.pathname}`).toBe('https://wa.me/573105550142');
	expect(href.searchParams.get('text')).toBe('Hola. ¿Y mi pedido #1043?');
	expect(href.search).toBe(`?text=${encodeURIComponent('Hola. ¿Y mi pedido #1043?')}`);
});

/** The tokens the lookup finds, on Wednesday 28 October 2026 in Bogotá. */
async function lookup(phone: string, eventDate: string): Promise<string[]> {
	vi.setSystemTime(new Date('2026-10-28T15:00:00Z'));
	const result = await lookupOrders(db, { phone, event_date: eventDate });
	if (!result.ok) {
		throw new Error(JSON.stringify(result.errors));
	}
	return result.matches.map(({ token }) => token);
}

test('the phone however it is typed, compared whole against the order, on its event date', async () => {
	const token = await create('CONFIRMED', { event_date: '2026-10-31' });
	for (const phone of ['310 442 8890', '3104428890', '+57 310 442 8890']) {
		expect(await lookup(phone, '2026-10-31')).toEqual([token]);
	}
	expect(await lookup('310 442 8890', '2026-10-30')).toEqual([]);
	expect(await lookup('310 442 8891', '2026-10-31')).toEqual([]);
});

test("the order's own phone, never the contact's", async () => {
	await create('CONFIRMED', { event_date: '2026-10-31' });
	database
		.prepare("update orders set client_attributes = json_set(client_attributes, '$.phone', ?)")
		.run('573007712043');
	expect(await lookup('310 442 8890', '2026-10-31')).toEqual([]);
	expect((await lookup('300 771 2043', '2026-10-31')).length).toBe(1);
});

test('events from 7 days past on, with no upper limit', async () => {
	const lastWeek = await create('COMPLETED', { event_date: '2026-10-21' });
	await create('COMPLETED', { event_date: '2026-10-20' });
	const nextYear = await create('CONFIRMED', { event_date: '2027-06-12' });
	expect(await lookup('3104428890', '2026-10-21')).toEqual([lastWeek]);
	expect(await lookup('3104428890', '2026-10-20')).toEqual([]);
	expect(await lookup('3104428890', '2027-06-12')).toEqual([nextYear]);
});

test('every status but a draft: a cancelled order is found', async () => {
	await create('DRAFT', { event_date: '2026-10-31' });
	expect(await lookup('3104428890', '2026-10-31')).toEqual([]);
	const cancelled = await create('CANCELLED', { event_date: '2026-11-07' });
	expect(await lookup('3104428890', '2026-11-07')).toEqual([cancelled]);
});

test('two orders on the same phone and event date, both by id', async () => {
	const first = await create('DELIVERED', { event_date: '2026-10-31' });
	const second = await create('CONFIRMED', { event_date: '2026-10-31' });
	const result = await lookupOrders(db, { phone: '3104428890', event_date: '2026-10-31' });
	expect(result).toEqual({
		ok: true,
		matches: [
			{ id: 1, status: 'DELIVERED', token: first },
			{ id: 2, status: 'CONFIRMED', token: second }
		]
	});
});

test('a phone the helper rejects is a field error and runs no query', async () => {
	const prepare = vi.spyOn(db, 'prepare');
	expect(await lookupOrders(db, { phone: '310 44', event_date: '2026-10-31' })).toEqual({
		ok: false,
		errors: { phone: 'Escriba el teléfono con el que hizo el pedido' }
	});
	expect(await lookupOrders(db, { phone: '3104428890', event_date: '' })).toEqual({
		ok: false,
		errors: { event_date: 'Escoja la fecha del evento' }
	});
	expect(prepare).not.toHaveBeenCalled();
});
