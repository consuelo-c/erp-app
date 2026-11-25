import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import { createFixture, DRIVER, SALES } from '../db/fixture';
import { getDispatchDay } from './dispatch';
import { createExtension, updateOrder, type OrderStatus } from './orders';

const TODAY = '2026-08-14';

let db: D1Database;
let fixture: ReturnType<typeof createFixture>;
let LUZ_MARINA: number;
let CHAIRS: number;

beforeEach(async () => {
	fixture = createFixture();
	({ db } = fixture);
	// 8 p.m. in Bogotá: already the next day in UTC.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(`${TODAY}T20:00:00-05:00`));
	onTestFinished(() => {
		vi.useRealTimers();
	});
	LUZ_MARINA = await fixture.contact({ full_name: 'Luz Marina Restrepo' });
	CHAIRS = await fixture.product({ name: 'Silla Tiffany dorada', rental_price: '2.500' });
});

const address = { address_1: 'Calle 10 # 43-12, El Poblado', address_2: 'Salón Los Arrayanes' };

type Trips = {
	delivery?: object;
	pickup?: object;
	delivery_date?: string;
	pickup_date?: string;
};

function orderInput(trips: Trips = {}) {
	return {
		client_id: LUZ_MARINA,
		client_name: 'Luz Marina Restrepo',
		event_date: TODAY,
		delivery_date: trips.delivery_date ?? TODAY,
		// Two days on: a delivery's test isn't crowded by its own pickup.
		pickup_date: trips.pickup_date ?? '2026-08-16',
		rental_days: 1,
		delivery_attributes: {
			method: 'COMPANY_DELIVERY',
			time: '14:00',
			...address,
			...trips.delivery
		},
		pickup_attributes: { method: 'COMPANY_PICKUP', time: '09:00', ...address, ...trips.pickup },
		order_items: [{ product_id: CHAIRS, qty: 10, unit_price: 2500 }]
	};
}

async function create(status: OrderStatus, trips: Trips = {}): Promise<number> {
	return fixture.order({ ...orderInput(trips), status });
}

async function rows(date?: string) {
	return (await getDispatchDay(db, date, DRIVER)).rows;
}

async function trips(date?: string) {
	return (await rows(date)).map((row) => `${row.direction} ${row.id}`);
}

test("at 8 p.m. in Bogotá it's still that day: tomorrow's order doesn't show", async () => {
	const today = await create('CONFIRMED');
	await create('CONFIRMED', { delivery_date: '2026-08-15' });
	const day = await getDispatchDay(db, null, DRIVER);
	expect([day.today, day.date]).toEqual([TODAY, TODAY]);
	expect(day.rows.map((row) => row.id)).toEqual([today]);
});

test('a day holds every method and every state but a cancelled one', async () => {
	const client = await create('PICKED', { delivery: { method: 'CLIENT_PICKUP', time: '08:00' } });
	const returned = await create('COMPLETED', {
		delivery_date: '2026-08-12',
		pickup_date: TODAY,
		pickup: { method: 'CLIENT_RETURN', time: '10:00' }
	});
	const delivered = await create('DELIVERED');
	await create('CANCELLED', { pickup_date: TODAY });
	await fixture.order({
		...orderInput({ pickup_date: TODAY }),
		status: 'CANCELLED',
		cancelledFrom: 'OUT_FOR_DELIVERY',
		reason: 'Llegó tarde'
	});
	expect(await trips()).toEqual([
		`delivery ${client}`,
		`pickup ${returned}`,
		`delivery ${delivered}`
	]);
});

test('deliveries and pickups mix by time; at the same time, an order delivers first', async () => {
	const both = await create('CONFIRMED', { delivery: { time: '09:00' }, pickup_date: TODAY });
	const pickup = await create('DELIVERED', { delivery_date: '2026-08-13', pickup_date: TODAY });
	const delivery = await create('CONFIRMED');
	expect(await trips()).toEqual([
		`delivery ${both}`,
		`pickup ${both}`,
		`pickup ${pickup}`,
		`delivery ${delivery}`
	]);
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
			client_id: LUZ_MARINA,
			client_name: 'Luz Marina Restrepo',
			event_date: TODAY,
			delivery_date: TODAY,
			pickup_date: TODAY,
			rental_days: 1,
			delivery_attributes: { method: 'COMPANY_DELIVERY', time: null, ...address },
			pickup_attributes: { method: 'COMPANY_PICKUP', time: null, ...address },
			order_items: [{ product_id: CHAIRS, qty: 4, unit_price: 2500 }],
			transport_cost: 0
		},
		SALES
	);
	if (!result.ok) {
		throw new Error(JSON.stringify(result.errors));
	}
	expect(
		(await rows()).map((row) => [row.direction, row.id, row.isLate, row.extensionIds])
	).toEqual([
		['pickup', parent, true, [result.id]],
		['pickup', result.id, false, []]
	]);
});

test("yesterday's delivery still on its way is late, ahead of today's by time, no time last", async () => {
	const noTime = await create('CONFIRMED', { delivery: { time: null } });
	const afternoon = await create('CONFIRMED', { delivery: { time: '15:00' } });
	const late = await create('OUT_FOR_DELIVERY', { delivery_date: '2026-08-13' });
	const morning = await create('CONFIRMED', { delivery: { time: '08:00' } });
	expect((await rows()).map((row) => [row.id, row.isLate])).toEqual([
		[late, true],
		[morning, false],
		[afternoon, false],
		[noTime, false]
	]);
});

test('today keeps what is still pending up to 4 days late, never what was done', async () => {
	const fourDays = await create('CONFIRMED', { delivery_date: '2026-08-10' });
	await create('CONFIRMED', { delivery_date: '2026-08-09' });
	const pickupFour = await create('DELIVERED', {
		delivery_date: '2026-08-08',
		pickup_date: '2026-08-10'
	});
	await create('OUT_FOR_PICKUP', { delivery_date: '2026-08-08', pickup_date: '2026-08-09' });
	await create('DELIVERED', { delivery_date: '2026-08-13' });
	await create('COMPLETED', { delivery_date: '2026-08-12', pickup_date: '2026-08-13' });
	expect(await trips()).toEqual([`pickup ${pickupFour}`, `delivery ${fourDays}`]);
});

test("an external carrier's row carries that direction's carrier", async () => {
	const wilson = await fixture.contact({
		full_name: 'Wilson Muñoz',
		phone: '311 908 5512',
		labels: ['TRANSPORTER']
	});
	const carrier = { method: 'EXTERNAL_CARRIER', carrier_id: wilson };
	const id = await create('CONFIRMED', { delivery: carrier });
	const [row] = (await getDispatchDay(db, null, SALES)).rows;
	expect(row).toMatchObject({
		id,
		clientName: 'Luz Marina Restrepo',
		direction: 'delivery',
		method: 'EXTERNAL_CARRIER',
		carrier: { name: 'Wilson Muñoz', phone: '573119085512' }
	});
});

test('another day holds only what is dated on it, none late, whatever its state', async () => {
	const SUNDAY = '2026-08-16';
	const stillConfirmed = await create('CONFIRMED', { delivery_date: '2026-08-15' });
	const delivery = await create('CONFIRMED', { delivery_date: SUNDAY, pickup_date: '2026-08-17' });
	await create('CANCELLED', { delivery_date: SUNDAY });
	await create('CONFIRMED', { delivery_date: '2026-08-13', pickup_date: '2026-08-15' });
	const day = await getDispatchDay(db, SUNDAY, DRIVER);
	expect(day.date).toBe(SUNDAY);
	expect(day.rows.map((row) => [row.direction, row.id, row.isLate])).toEqual([
		['pickup', stillConfirmed, false],
		['delivery', delivery, false]
	]);
	const completed = await create('COMPLETED', {
		delivery_date: '2026-08-10',
		pickup_date: '2026-08-10'
	});
	expect(await trips('2026-08-10')).toEqual([`pickup ${completed}`, `delivery ${completed}`]);
});

test('a malformed day is today', async () => {
	expect((await getDispatchDay(db, 'mañana', DRIVER)).date).toBe(TODAY);
});

test('a row says whether its order was modified after staging, both of its rows alike', async () => {
	const untouched = await create('CONFIRMED', { pickup_date: TODAY });
	const editedTrips = {
		delivery: { time: '15:00' },
		pickup: { time: '16:00' },
		pickup_date: TODAY
	};
	const edited = await create('PICKED', editedTrips);
	const edit = { ...orderInput(editedTrips), id: edited, rental_days: 3 };
	expect(await updateOrder(db, edit, SALES)).toEqual({ ok: true, id: edited });
	expect(
		(await rows()).map((row) => [`${row.direction} ${row.id}`, row.modifiedAfterStaging])
	).toEqual([
		[`pickup ${untouched}`, false],
		[`delivery ${untouched}`, false],
		[`delivery ${edited}`, true],
		[`pickup ${edited}`, true]
	]);
});
