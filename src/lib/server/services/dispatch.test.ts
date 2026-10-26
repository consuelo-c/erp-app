import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { getDispatchDay, type DispatchList } from './dispatch';
import { createExtension, createOrder } from './orders';

const sales: Actor = { username: 'ventas', employeeId: null, roles: ['SALES'], kind: 'user' };
const driver: Actor = { ...sales, username: 'conductor', roles: ['DRIVER'] };

const TODAY = '2026-08-14';
const AUDIT = "0, 'admin', 0, 'admin'";
const WILSON = 2;

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
	const contact = database.prepare(
		`insert into contacts (phone, full_name, document_id, services, created_at, created_by, updated_at, updated_by) values (?, ?, ?, ?, ${AUDIT})`
	);
	contact.run('573104428890', 'Luz Marina Restrepo', '@luz', '[]');
	contact.run('573119085512', 'Wilson Muñoz', '@wilson', '["TRANSPORTER"]');
	database
		.prepare(
			`insert into products (name, category, rental_price, total_quantity, active, created_at, created_by, updated_at, updated_by) values ('Silla Tiffany dorada', 'CHAIRS_TABLES', 2500, 500, 1, ${AUDIT})`
		)
		.run();
	// 8 p.m. in Bogotá: already the next day in UTC.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(`${TODAY}T20:00:00-05:00`));
	onTestFinished(() => {
		vi.useRealTimers();
	});
});

const address = { address_1: 'Calle 10 # 43-12, El Poblado', address_2: 'Salón Los Arrayanes' };

type Trips = {
	delivery?: object;
	pickup?: object;
	delivery_date?: string;
	pickup_date?: string;
};

async function create(status: string, trips: Trips = {}): Promise<number> {
	const result = await createOrder(
		db,
		{
			client_id: 1,
			client_name: 'Luz Marina Restrepo',
			client_phone: '310 442 8890',
			event_date: TODAY,
			delivery_date: trips.delivery_date ?? TODAY,
			pickup_date: trips.pickup_date ?? TODAY,
			rental_days: 1,
			delivery_attributes: {
				method: 'COMPANY_DELIVERY',
				time: '14:00',
				...address,
				...trips.delivery
			},
			pickup_attributes: { method: 'COMPANY_PICKUP', time: '09:00', ...address, ...trips.pickup },
			order_items: [{ product_id: 1, qty: 10, unit_price: 2500 }],
			discount: 0,
			transport_cost: 0,
			deposit_amount: 0
		},
		sales
	);
	if (!result.ok) {
		throw new Error(JSON.stringify(result.errors));
	}
	database.prepare('update orders set status = ? where id = ?').run(status, result.id);
	return result.id;
}

async function ids(list: DispatchList) {
	const day = await getDispatchDay(db, list, driver);
	return {
		deliveries: day.deliveries.map((row) => row.id),
		pickups: day.pickups.map((row) => row.id)
	};
}

test("at 8 p.m. in Bogotá it's still that day: tomorrow's order doesn't show", async () => {
	const today = await create('CONFIRMED');
	await create('CONFIRMED', { delivery_date: '2026-08-15', pickup_date: '2026-08-16' });
	const day = await getDispatchDay(db, 'PREP', driver);
	expect(day.today).toBe(TODAY);
	expect(day.deliveries.map((row) => row.id)).toEqual([today]);
});

test('a client pickup is prepared and has no route, but the driver never takes it', async () => {
	const id = await create('PICKED', { delivery: { method: 'CLIENT_PICKUP' } });
	expect((await ids('PREP')).deliveries).toEqual([id]);
	expect((await ids('NO_ROUTE')).deliveries).toEqual([id]);
	expect((await ids('ROUTE')).deliveries).toEqual([]);
});

test("the company's pickup is on the route and prepared, never without a route", async () => {
	const id = await create('DELIVERED');
	expect((await ids('ROUTE')).pickups).toEqual([id]);
	expect((await ids('PREP')).pickups).toEqual([id]);
	expect((await ids('NO_ROUTE')).pickups).toEqual([]);
});

test('a draft, a cancelled and a completed order dated today never show', async () => {
	await create('DRAFT');
	await create('CANCELLED');
	await create('COMPLETED');
	expect(await ids('PREP')).toEqual({ deliveries: [], pickups: [] });
});

test('a delivered delivery drops off the deliveries and waits as a pickup', async () => {
	const id = await create('DELIVERED', { pickup_date: '2026-08-16' });
	expect(await ids('PREP')).toEqual({ deliveries: [], pickups: [] });
	database.prepare('update orders set pickup_date = ? where id = ?').run(TODAY, id);
	expect(await ids('PREP')).toEqual({ deliveries: [], pickups: [id] });
});

test("an extension is never a delivery: it's a pickup on its own date, named by its original's", async () => {
	const parent = await create('DELIVERED', {
		delivery_date: '2026-08-10',
		pickup_date: '2026-08-13'
	});
	const result = await createExtension(
		db,
		{
			parent_order_id: String(parent),
			client_id: 1,
			client_name: 'Luz Marina Restrepo',
			client_phone: '310 442 8890',
			event_date: TODAY,
			delivery_date: TODAY,
			pickup_date: TODAY,
			rental_days: 1,
			delivery_attributes: { method: 'COMPANY_DELIVERY', time: null, ...address },
			pickup_attributes: { method: 'COMPANY_PICKUP', time: null, ...address },
			order_items: [{ product_id: 1, qty: 4, unit_price: 2500 }],
			discount: 0,
			transport_cost: 0,
			deposit_amount: 0
		},
		sales
	);
	if (!result.ok) {
		throw new Error(JSON.stringify(result.errors));
	}
	const day = await getDispatchDay(db, 'ROUTE', driver);
	expect(day.deliveries).toEqual([]);
	expect(day.pickups.map((row) => [row.id, row.isLate, row.extensionIds])).toEqual([
		[parent, true, [result.id]],
		[result.id, false, []]
	]);
});

test("yesterday's delivery still on its way is late, ahead of today's by time, no time last", async () => {
	const noTime = await create('CONFIRMED', { delivery: { time: null } });
	const afternoon = await create('CONFIRMED', { delivery: { time: '15:00' } });
	const late = await create('OUT_FOR_DELIVERY', { delivery_date: '2026-08-13' });
	const morning = await create('CONFIRMED', { delivery: { time: '08:00' } });
	const day = await getDispatchDay(db, 'ROUTE', driver);
	expect(day.deliveries.map((row) => [row.id, row.isLate])).toEqual([
		[late, true],
		[morning, false],
		[afternoon, false],
		[noTime, false]
	]);
});

test("an external carrier's row carries that direction's carrier", async () => {
	const carrier = { method: 'EXTERNAL_CARRIER', carrier_id: WILSON };
	const id = await create('CONFIRMED', { delivery: carrier });
	const [row] = (await getDispatchDay(db, 'NO_ROUTE', sales)).deliveries;
	expect(row).toMatchObject({
		id,
		clientName: 'Luz Marina Restrepo',
		method: 'EXTERNAL_CARRIER',
		carrier: { name: 'Wilson Muñoz', phone: '573119085512' }
	});
});

test('an unknown list is refused', async () => {
	await expect(getDispatchDay(db, 'TOMORROW', driver)).rejects.toThrow();
});

test('every list drops a row 5 or more days late, a delivery or a pickup', async () => {
	const fourDays = await create('CONFIRMED', { delivery_date: '2026-08-10' });
	await create('CONFIRMED', { delivery_date: '2026-08-09' });
	const clientFour = await create('PICKED', {
		delivery_date: '2026-08-10',
		delivery: { method: 'CLIENT_PICKUP' }
	});
	await create('PICKED', { delivery_date: '2026-08-09', delivery: { method: 'CLIENT_PICKUP' } });
	const pickupFour = await create('DELIVERED', {
		delivery_date: '2026-08-08',
		pickup_date: '2026-08-10'
	});
	await create('OUT_FOR_PICKUP', {
		delivery_date: '2026-08-08',
		pickup_date: '2026-08-09'
	});
	expect(await ids('ROUTE')).toEqual({ deliveries: [fourDays], pickups: [pickupFour] });
	expect(await ids('PREP')).toEqual({ deliveries: [fourDays, clientFour], pickups: [pickupFour] });
	expect(await ids('NO_ROUTE')).toEqual({ deliveries: [clientFour], pickups: [] });
});

test('the warehouse prepares only what is still to go out, and keeps what comes back', async () => {
	const confirmed = await create('CONFIRMED', { delivery: { time: '08:00' } });
	const picked = await create('PICKED', { delivery: { time: '09:00' } });
	const out = await create('OUT_FOR_DELIVERY', { delivery: { time: '10:00' } });
	const back = await create('OUT_FOR_PICKUP');
	expect(await ids('PREP')).toEqual({ deliveries: [confirmed, picked], pickups: [back] });
	expect((await ids('ROUTE')).deliveries).toEqual([confirmed, picked, out]);
});
