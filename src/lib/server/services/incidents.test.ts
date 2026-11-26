import { isHttpError } from '@sveltejs/kit';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import type { Role } from '$lib/roles';
import type { Actor } from '../actor';
import { actorWith, createFixture, DRIVER, MANAGER, SALES, WAREHOUSE } from '../db/fixture';
import {
	correctIncident,
	incidentItemsSchema,
	listActiveIncidents,
	listIncidents,
	reportIncident,
	reverseIncident,
	setResponsibleParty
} from './incidents';
import { approveCount, reverseCount, submitAndApproveCount, submitCount } from './inventory';
import { advanceOrder, getOrderDetail, type OrderStatus } from './orders';
import { getProduct, updateProduct } from './products';

let db: D1Database;
let fixture: ReturnType<typeof createFixture>;
let CHAIR: number;
let TABLE: number;
let TABLECLOTH: number;

beforeEach(async () => {
	fixture = createFixture();
	({ db } = fixture);
	const stocked = (name: string) => fixture.product({ name, total_quantity: '500' });
	CHAIR = await stocked('Silla Tiffany dorada');
	TABLE = await stocked('Mesa redonda 10 puestos');
	TABLECLOTH = await stocked('Mantel blanco');
});

const LINES = () => [
	{ product_id: CHAIR, qty: 120, unit_price: 2500 },
	{ product_id: TABLE, qty: 12, unit_price: 12000 }
];

function createOrderIn(status: OrderStatus): Promise<number> {
	return fixture.order({ order_items: LINES(), status });
}

function stock(id: number): number {
	const row = fixture.database.prepare('select total_quantity from products where id = ?').get(id);
	return Number(row?.total_quantity);
}

function hasIncident(orderId: number): number {
	const row = fixture.database.prepare('select has_incident from orders where id = ?').get(orderId);
	return Number(row?.has_incident);
}

function events(entityType: string, action: string) {
	return fixture.database
		.prepare(
			'select entity_id, actor_username, before, after, reason from events where entity_type = ? and action = ? order by id'
		)
		.all(entityType, action)
		.map((event) => ({
			entityId: event.entity_id,
			actor: event.actor_username,
			...(null === event.reason ? {} : { reason: event.reason }),
			before: null === event.before ? null : JSON.parse(String(event.before)),
			after: JSON.parse(String(event.after))
		}));
}

function report(orderId: number, items: object[], actor: Actor = WAREHOUSE) {
	const input = { order_id: String(orderId), incident_description: ' Llegaron mojadas ', items };
	return reportIncident(db, input, actor);
}

// A report that must be taken: its incident's id.
async function reported(orderId: number, items: object[], actor: Actor = WAREHOUSE) {
	const result = await report(orderId, items, actor);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.id;
}

function incidentRow(id: number) {
	return fixture.database.prepare('select * from incidents where id = ?').get(id);
}

// Productos › Editar with «Activo» off, the rest as it is.
async function deactivate(id: number) {
	const current = await getProduct(db, id, MANAGER);
	const form = {
		id,
		name: current?.name,
		category: current?.category,
		rental_price: String(current?.rentalPrice),
		active: 'off'
	};
	const result = await updateProduct(db, form, MANAGER);
	if (!result.ok) {
		throw new Error(result.message);
	}
}

function incidentCount() {
	return fixture.database.prepare('select count(*) as count from incidents').get();
}

test('the items: at least one, whole quantities, known outcomes and keys, a product once per outcome', () => {
	const item = { product_id: CHAIR, name: 'Silla Tiffany dorada', qty: 4, outcome: 'LOST' };
	expect(incidentItemsSchema.safeParse([]).success).toBe(false);
	expect(incidentItemsSchema.safeParse([{ ...item, qty: 0 }]).success).toBe(false);
	expect(incidentItemsSchema.safeParse([{ ...item, outcome: 'STOLEN' }]).success).toBe(false);
	expect(incidentItemsSchema.safeParse([{ ...item, photo: 'x.jpg' }]).success).toBe(false);
	const lostAndRecoverable = [item, { ...item, qty: 3, outcome: 'RECOVERABLE' }];
	expect(incidentItemsSchema.safeParse(lostAndRecoverable).success).toBe(true);
	expect(incidentItemsSchema.safeParse([item, { ...item, qty: 3 }]).success).toBe(false);
});

test('an order not yet with the client, or cancelled, takes no incident', async () => {
	for (const status of ['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY', 'CANCELLED'] as const) {
		const id = await createOrderIn(status);
		const result = await report(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }]);
		expect(result).toMatchObject({ ok: false });
		expect(hasIncident(id)).toBe(0);
	}
	expect(incidentCount()).toEqual({ count: 0 });
	expect(stock(CHAIR)).toBe(500);
});

function cancelledFrom(status: 'CONFIRMED' | 'PICKED' | 'OUT_FOR_DELIVERY'): Promise<number> {
	return fixture.order({
		order_items: LINES(),
		status: 'CANCELLED',
		cancelledFrom: status,
		reason: 'El camión llegó tarde'
	});
}

test('an order cancelled on its way takes an incident like any other; from the warehouse, none', async () => {
	const onItsWay = await cancelledFrom('OUT_FOR_DELIVERY');
	const damaged = [{ product_id: CHAIR, qty: 3, outcome: 'UNRECOVERABLE' }];
	expect(await report(onItsWay, damaged, SALES)).toMatchObject({ ok: true });
	expect(hasIncident(onItsWay)).toBe(1);
	expect(stock(CHAIR)).toBe(497);
	for (const status of ['CONFIRMED', 'PICKED'] as const) {
		const id = await cancelledFrom(status);
		expect(await report(id, damaged, SALES)).toMatchObject({ ok: false });
	}
	const detail = await getOrderDetail(db, onItsWay, SALES);
	expect(detail?.cancellation).toMatchObject({ cancelledFrom: 'OUT_FOR_DELIVERY' });
});

test("only the order's products, up to each line's quantity across outcomes", async () => {
	const id = await createOrderIn('DELIVERED');
	const notOnOrder = await report(id, [{ product_id: TABLECLOTH, qty: 1, outcome: 'LOST' }]);
	expect(notOnOrder).toMatchObject({
		ok: false,
		errors: { 'items.0.product_id': expect.any(String) }
	});
	const tooMany = await report(id, [
		{ product_id: TABLE, qty: 10, outcome: 'LOST' },
		{ product_id: TABLE, qty: 3, outcome: 'RECOVERABLE' }
	]);
	expect(tooMany).toMatchObject({ ok: false, errors: { 'items.1.qty': expect.any(String) } });
	const repeated = await report(id, [
		{ product_id: TABLE, qty: 1, outcome: 'LOST' },
		{ product_id: TABLE, qty: 1, outcome: 'LOST' }
	]);
	expect(repeated).toMatchObject({ ok: false, errors: { items: expect.any(String) } });
	expect(hasIncident(id)).toBe(0);
});

test('an all-recoverable incident: born undetermined, flags the order, leaves inventory alone', async () => {
	const id = await createOrderIn('COMPLETED');
	const incident = await reported(id, [{ product_id: CHAIR, qty: 6, outcome: 'RECOVERABLE' }]);
	expect(incidentRow(incident)).toMatchObject({
		order_id: id,
		incident_description: 'Llegaron mojadas',
		responsible_party: 'UNDETERMINED',
		status: 'ACTIVE',
		reversal_reason: null,
		reversed_by: null,
		reversed_at: null,
		created_by: 'warehouse',
		updated_by: 'warehouse'
	});
	expect(stock(CHAIR)).toBe(500);
	expect(hasIncident(id)).toBe(1);
	expect(events('PRODUCT', 'INVENTORY_ADJUSTED')).toEqual([]);
});

test('a mixed incident subtracts only the lost and unusable, each product once, with its events', async () => {
	const id = await createOrderIn('OUT_FOR_PICKUP');
	const items = [
		{ product_id: CHAIR, qty: 4, outcome: 'LOST' },
		{ product_id: CHAIR, qty: 3, outcome: 'RECOVERABLE' },
		{ product_id: CHAIR, qty: 2, outcome: 'UNRECOVERABLE' },
		{ product_id: TABLE, qty: 1, outcome: 'UNRECOVERABLE' }
	];
	const incident = await reported(id, items, DRIVER);
	expect([stock(CHAIR), stock(TABLE)]).toEqual([494, 499]);
	expect(events('INCIDENT', 'CREATED')).toEqual([
		{
			entityId: incident,
			actor: 'driver',
			before: null,
			after: {
				order_id: id,
				incident_items: JSON.stringify(
					items.map((item) => ({
						product_id: item.product_id,
						name: CHAIR === item.product_id ? 'Silla Tiffany dorada' : 'Mesa redonda 10 puestos',
						qty: item.qty,
						outcome: item.outcome
					}))
				),
				incident_description: 'Llegaron mojadas',
				responsible_party: 'UNDETERMINED',
				status: 'ACTIVE'
			}
		}
	]);
	expect(events('PRODUCT', 'INVENTORY_ADJUSTED')).toEqual([
		{
			entityId: CHAIR,
			actor: 'driver',
			before: { total_quantity: 500 },
			after: { total_quantity: 494 }
		},
		{
			entityId: TABLE,
			actor: 'driver',
			before: { total_quantity: 500 },
			after: { total_quantity: 499 }
		}
	]);
});

test('a deactivated product is still reported, and inventory may go negative', async () => {
	const id = await createOrderIn('DELIVERED');
	await submitAndApproveCount(db, { items: [{ product_id: CHAIR, counted_qty: 2 }] }, MANAGER);
	await deactivate(CHAIR);
	expect(await getProduct(db, CHAIR, MANAGER)).toMatchObject({ isActive: false });
	expect(await report(id, [{ product_id: CHAIR, qty: 5, outcome: 'LOST' }])).toMatchObject({
		ok: true
	});
	expect(stock(CHAIR)).toBe(-3);
});

test('an incident on a staged order is no edit: it never reads as modified after staging', async () => {
	const id = await createOrderIn('CONFIRMED');
	for (const status of ['PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const) {
		await advanceOrder(db, { id, status }, DRIVER);
	}
	await report(id, [{ product_id: CHAIR, qty: 1, outcome: 'LOST' }]);
	await report(id, [{ product_id: TABLE, qty: 1, outcome: 'RECOVERABLE' }], SALES);
	expect(incidentCount()).toEqual({ count: 2 });
	expect(hasIncident(id)).toBe(1);
	expect(events('ORDER', 'EDITED')).toEqual([]);
	expect((await getOrderDetail(db, id, SALES))?.modifiedAfterStagingAt).toBeNull();
});

function reverse(id: number, actor: Actor = MANAGER) {
	return reverseIncident(db, { id: String(id), reason: ' Las sillas aparecieron ' }, actor);
}

test('reversing gives the lost and unusable back, records who, when and why, and its events', async () => {
	const id = await createOrderIn('COMPLETED');
	const items = [
		{ product_id: CHAIR, qty: 4, outcome: 'LOST' },
		{ product_id: CHAIR, qty: 3, outcome: 'RECOVERABLE' },
		{ product_id: TABLE, qty: 1, outcome: 'UNRECOVERABLE' }
	];
	const incident = await reported(id, items);
	// Another order loses chairs meanwhile: the reversal adds to the stock as it is now.
	const other = await fixture.order({
		order_items: [{ product_id: CHAIR, qty: 200, unit_price: 2500 }],
		status: 'COMPLETED'
	});
	await reported(other, [{ product_id: CHAIR, qty: 196, outcome: 'LOST' }]);
	expect(stock(CHAIR)).toBe(300);
	expect(await reverse(incident)).toEqual({ ok: true, id: incident });
	expect([stock(CHAIR), stock(TABLE)]).toEqual([304, 500]);
	expect(incidentRow(incident)).toMatchObject({
		status: 'REVERSED',
		reversal_reason: 'Las sillas aparecieron',
		reversed_by: 'manager',
		reversed_at: expect.any(Number),
		updated_by: 'manager'
	});
	expect(hasIncident(id)).toBe(0);
	expect(events('INCIDENT', 'REVERSED')).toEqual([
		{
			entityId: incident,
			actor: 'manager',
			reason: 'Las sillas aparecieron',
			before: { status: 'ACTIVE', reversal_reason: null, reversed_by: null, reversed_at: null },
			after: {
				status: 'REVERSED',
				reversal_reason: 'Las sillas aparecieron',
				reversed_by: 'manager',
				reversed_at: expect.any(Number)
			}
		}
	]);
	expect(events('PRODUCT', 'INVENTORY_ADJUSTED').slice(3)).toEqual([
		{
			entityId: CHAIR,
			actor: 'manager',
			before: { total_quantity: 300 },
			after: { total_quantity: 304 }
		},
		{
			entityId: TABLE,
			actor: 'manager',
			before: { total_quantity: 499 },
			after: { total_quantity: 500 }
		}
	]);
	const [listed] = await listIncidents(db, id, MANAGER);
	expect(listed).toMatchObject({
		status: 'REVERSED',
		reversal: { reason: 'Las sillas aparecieron', reversedBy: 'manager' }
	});
});

test('an all-recoverable incident reverses and changes no product', async () => {
	const id = await createOrderIn('DELIVERED');
	const incident = await reported(id, [{ product_id: CHAIR, qty: 6, outcome: 'RECOVERABLE' }]);
	expect(await reverse(incident)).toMatchObject({ ok: true });
	expect(stock(CHAIR)).toBe(500);
	expect(events('PRODUCT', 'INVENTORY_ADJUSTED')).toEqual([]);
});

test('incidents reverse in any order; the flag stays while one is active; twice is refused', async () => {
	const id = await createOrderIn('COMPLETED');
	const first = await reported(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }]);
	const second = await reported(id, [{ product_id: TABLE, qty: 1, outcome: 'LOST' }]);
	expect(await reverse(first)).toMatchObject({ ok: true });
	expect(hasIncident(id)).toBe(1);
	expect(await reverse(first)).toMatchObject({ ok: false });
	expect(stock(CHAIR)).toBe(500);
	expect(await reverse(second)).toMatchObject({ ok: true });
	expect(hasIncident(id)).toBe(0);
	expect((await listIncidents(db, id, MANAGER)).map((incident) => incident.id)).toEqual([
		second,
		first
	]);
});

// Sends a count of `[product, counted]` pairs; `approve` approves it too.
async function count(counted: [number, number][], approve = true): Promise<number> {
	const items = counted.map(([product, qty]) => ({ product_id: product, counted_qty: qty }));
	const result = await submitCount(db, { items }, WAREHOUSE);
	if (!result.ok) {
		throw new Error(result.message);
	}
	if (approve) {
		expect(await approveCount(db, { id: result.id }, MANAGER)).toMatchObject({ ok: true });
	}
	return result.id;
}

const FIXED = 'Un conteo aprobado después ya fijó Silla Tiffany dorada';

async function reversalBlock(orderId: number): Promise<string | null> {
	const [incident] = await listIncidents(db, orderId, MANAGER);
	return incident.reversalBlock;
}

test('a count that applied the lost product, approved after the incident, blocks its reversal', async () => {
	const id = await createOrderIn('COMPLETED');
	const incident = await reported(id, [
		{ product_id: CHAIR, qty: 4, outcome: 'LOST' },
		{ product_id: TABLE, qty: 1, outcome: 'RECOVERABLE' }
	]);
	await count([[CHAIR, 490]]);
	expect(await reversalBlock(id)).toBe(FIXED);
	expect(await reverse(incident)).toEqual({ ok: false, message: FIXED, errors: {} });
	expect(stock(CHAIR)).toBe(490);
	expect(hasIncident(id)).toBe(1);
});

test('the same count, reversed since, allows it', async () => {
	const id = await createOrderIn('COMPLETED');
	const incident = await reported(id, [{ product_id: CHAIR, qty: 4, outcome: 'LOST' }]);
	const counted = await count([[CHAIR, 490]]);
	await reverseCount(db, { id: counted, reason: 'Mal contado' }, MANAGER);
	expect(await reversalBlock(id)).toBeNull();
	expect(await reverse(incident)).toMatchObject({ ok: true });
	expect(stock(CHAIR)).toBe(500);
});

test('a count approved after it that applied only another product, or a stale skip, allows it', async () => {
	const id = await createOrderIn('COMPLETED');
	const stale = await count(
		[
			[CHAIR, 480],
			[TABLECLOTH, 497]
		],
		false
	);
	const incident = await reported(id, [{ product_id: CHAIR, qty: 4, outcome: 'LOST' }]);
	expect(await approveCount(db, { id: stale }, MANAGER)).toMatchObject({ ok: true });
	expect(await reversalBlock(id)).toBeNull();
	expect(await reverse(incident)).toMatchObject({ ok: true });
	expect([stock(CHAIR), stock(TABLECLOTH)]).toEqual([500, 497]);
});

test('a count created after the incident but approved before it allows it: the order is by approval', async () => {
	const id = await createOrderIn('COMPLETED');
	// The count's clock runs a day ahead of the incident's: its timestamps read as later.
	vi.useFakeTimers({ toFake: ['Date'] });
	onTestFinished(() => {
		vi.useRealTimers();
	});
	vi.setSystemTime(new Date('2026-08-15T10:00:00-05:00'));
	await count([[CHAIR, 490]]);
	vi.setSystemTime(new Date('2026-08-14T10:00:00-05:00'));
	const incident = await reported(id, [{ product_id: CHAIR, qty: 4, outcome: 'LOST' }]);
	expect(await reversalBlock(id)).toBeNull();
	expect(await reverse(incident)).toMatchObject({ ok: true });
	expect(stock(CHAIR)).toBe(490);
});

test('an all-recoverable incident reverses with a count of its product approved after it', async () => {
	const id = await createOrderIn('COMPLETED');
	const incident = await reported(id, [{ product_id: CHAIR, qty: 4, outcome: 'RECOVERABLE' }]);
	await count([[CHAIR, 496]]);
	expect(await reversalBlock(id)).toBeNull();
	expect(await reverse(incident)).toMatchObject({ ok: true });
});

test('a reversal needs a reason', async () => {
	const id = await createOrderIn('DELIVERED');
	const incident = await reported(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }]);
	const result = await reverseIncident(db, { id: String(incident), reason: '  ' }, MANAGER);
	expect(result).toMatchObject({ ok: false, errors: { reason: expect.any(String) } });
	expect(hasIncident(id)).toBe(1);
});

test('the responsible party: changed on an active incident, logged, a save with no change logs nothing', async () => {
	const id = await createOrderIn('DELIVERED');
	const incident = await reported(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }]);
	const set = (party: string) =>
		setResponsibleParty(db, { id: String(incident), responsible_party: party }, MANAGER);
	expect(await set('CARRIER')).toEqual({ ok: true, id: incident });
	expect(await set('CARRIER')).toEqual({ ok: true, id: incident });
	expect(await set('NEIGHBOR')).toMatchObject({ ok: false });
	expect(events('INCIDENT', 'EDITED')).toEqual([
		{
			entityId: incident,
			actor: 'manager',
			before: { responsible_party: 'UNDETERMINED' },
			after: { responsible_party: 'CARRIER' }
		}
	]);
	await reverse(incident);
	expect(await set('CLIENT')).toMatchObject({ ok: false });
	expect((await listIncidents(db, id, MANAGER))[0].responsibleParty).toBe('CARRIER');
});

test('listing is open to every role, each incident with whether the actor may correct and reverse it', async () => {
	const id = await createOrderIn('DELIVERED');
	const reversed = await reported(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }], DRIVER);
	const frozen = await reported(
		id,
		[{ product_id: TABLE, qty: 1, outcome: 'RECOVERABLE' }],
		DRIVER
	);
	const bySales = await reported(
		id,
		[{ product_id: CHAIR, qty: 1, outcome: 'RECOVERABLE' }],
		SALES
	);
	await reverse(reversed);
	await setResponsibleParty(db, { id: frozen, responsible_party: 'CLIENT' }, MANAGER);
	const rights = async (actor: Actor) =>
		(await listIncidents(db, id, actor)).map((incident) => ({
			id: incident.id,
			isReportedByActor: incident.isReportedByActor,
			isFrozen: incident.isFrozen,
			canCorrect: incident.canCorrect,
			canReverse: incident.canReverse,
			canSetResponsibleParty: incident.canSetResponsibleParty
		}));
	expect(await rights(DRIVER)).toEqual([
		{
			id: bySales,
			isReportedByActor: false,
			isFrozen: false,
			canCorrect: false,
			canReverse: false,
			canSetResponsibleParty: false
		},
		{
			id: frozen,
			isReportedByActor: true,
			isFrozen: true,
			canCorrect: false,
			canReverse: false,
			canSetResponsibleParty: false
		},
		{
			id: reversed,
			isReportedByActor: true,
			isFrozen: false,
			canCorrect: false,
			canReverse: false,
			canSetResponsibleParty: false
		}
	]);
	expect(await rights(SALES)).toEqual([
		{
			id: bySales,
			isReportedByActor: true,
			isFrozen: false,
			canCorrect: true,
			canReverse: true,
			canSetResponsibleParty: false
		},
		{
			id: frozen,
			isReportedByActor: false,
			isFrozen: true,
			canCorrect: false,
			canReverse: false,
			canSetResponsibleParty: false
		},
		{
			id: reversed,
			isReportedByActor: false,
			isFrozen: false,
			canCorrect: false,
			canReverse: false,
			canSetResponsibleParty: false
		}
	]);
	expect(await rights(WAREHOUSE)).toEqual(
		(await rights(DRIVER)).map((incident) => ({ ...incident, isReportedByActor: false }))
	);
	expect(await rights(MANAGER)).toEqual([
		{
			id: bySales,
			isReportedByActor: false,
			isFrozen: false,
			canCorrect: true,
			canReverse: true,
			canSetResponsibleParty: true
		},
		{
			id: frozen,
			isReportedByActor: false,
			isFrozen: true,
			canCorrect: false,
			canReverse: true,
			canSetResponsibleParty: true
		},
		{
			id: reversed,
			isReportedByActor: false,
			isFrozen: false,
			canCorrect: false,
			canReverse: false,
			canSetResponsibleParty: false
		}
	]);
});

test('the reporter reverses their own unfrozen incident, with a reason', async () => {
	const id = await createOrderIn('DELIVERED');
	const incident = await reported(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }], DRIVER);
	const blank = await reverseIncident(db, { id: String(incident), reason: ' ' }, DRIVER);
	expect(blank).toMatchObject({ ok: false, errors: { reason: expect.any(String) } });
	expect(await reverse(incident, DRIVER)).toEqual({ ok: true, id: incident });
	expect(stock(CHAIR)).toBe(500);
	expect(hasIncident(id)).toBe(0);
	expect(events('INCIDENT', 'REVERSED')[0]).toMatchObject({ actor: 'driver' });
});

test("a reporter can't reverse someone else's incident nor their own once frozen", async () => {
	const id = await createOrderIn('DELIVERED');
	const chairs = await reported(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }], DRIVER);
	const table = await reported(id, [{ product_id: TABLE, qty: 1, outcome: 'LOST' }], DRIVER);
	await setResponsibleParty(db, { id: table, responsible_party: 'CARRIER' }, MANAGER);
	expect(await reverse(chairs, SALES)).toMatchObject({ ok: false });
	expect(await reverse(table, DRIVER)).toEqual({
		ok: false,
		message: 'El Gerente ya le puso responsable: no se puede revertir.',
		errors: {}
	});
	expect([stock(CHAIR), stock(TABLE)]).toEqual([498, 499]);
	expect(events('INCIDENT', 'REVERSED')).toEqual([]);
});

test('the manager reverses any active incident, frozen or not', async () => {
	const id = await createOrderIn('DELIVERED');
	const chairs = await reported(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }], DRIVER);
	const table = await reported(id, [{ product_id: TABLE, qty: 1, outcome: 'LOST' }], SALES);
	await setResponsibleParty(db, { id: table, responsible_party: 'CLIENT' }, MANAGER);
	expect(await reverse(chairs)).toMatchObject({ ok: true });
	expect(await reverse(table)).toMatchObject({ ok: true });
	expect(hasIncident(id)).toBe(0);
});

test('SALES, WAREHOUSE and DRIVER get a 403 changing the responsible party', async () => {
	const id = await createOrderIn('DELIVERED');
	const incident = await reported(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }]);
	for (const role of ['SALES', 'WAREHOUSE', 'DRIVER'] satisfies Role[]) {
		const refusal = await setResponsibleParty(
			db,
			{ id: incident, responsible_party: 'CLIENT' },
			actorWith(role)
		).catch((caught: unknown) => caught);
		expect(isHttpError(refusal, 403)).toBe(true);
	}
	expect(await listIncidents(db, id, MANAGER)).toMatchObject([
		{ responsibleParty: 'UNDETERMINED' }
	]);
});

function correct(id: number, items: object[], actor: Actor = DRIVER) {
	const input = { id: String(id), incident_description: 'Llegaron rotas', items };
	return correctIncident(db, input, actor);
}

test('the reporter corrects their own: stock moves by the difference, logged before and after', async () => {
	const id = await createOrderIn('DELIVERED');
	const incident = await reported(
		id,
		[
			{ product_id: CHAIR, qty: 4, outcome: 'LOST' },
			{ product_id: TABLE, qty: 1, outcome: 'UNRECOVERABLE' }
		],
		DRIVER
	);
	const corrected = [
		{ product_id: CHAIR, qty: 2, outcome: 'LOST' },
		{ product_id: CHAIR, qty: 2, outcome: 'RECOVERABLE' },
		{ product_id: TABLE, qty: 1, outcome: 'LOST' }
	];
	expect(await correct(incident, corrected)).toEqual({ ok: true, id: incident });
	expect([stock(CHAIR), stock(TABLE)]).toEqual([498, 499]);
	const row = incidentRow(incident);
	expect(row).toMatchObject({
		incident_description: 'Llegaron rotas',
		status: 'ACTIVE',
		created_by: 'driver',
		updated_by: 'driver'
	});
	expect(JSON.parse(String(row?.incident_items))).toEqual([
		{ product_id: CHAIR, name: 'Silla Tiffany dorada', qty: 2, outcome: 'LOST' },
		{ product_id: CHAIR, name: 'Silla Tiffany dorada', qty: 2, outcome: 'RECOVERABLE' },
		{ product_id: TABLE, name: 'Mesa redonda 10 puestos', qty: 1, outcome: 'LOST' }
	]);
	const [event] = events('INCIDENT', 'EDITED');
	expect(event).toMatchObject({
		entityId: incident,
		actor: 'driver',
		before: { incident_description: 'Llegaron mojadas' },
		after: { incident_description: 'Llegaron rotas' }
	});
	expect(JSON.parse(event.before.incident_items)).toHaveLength(2);
	expect(JSON.parse(event.after.incident_items)).toHaveLength(3);
	expect(events('PRODUCT', 'INVENTORY_ADJUSTED').slice(2)).toEqual([
		{
			entityId: CHAIR,
			actor: 'driver',
			before: { total_quantity: 496 },
			after: { total_quantity: 498 }
		}
	]);
});

test("a reporter can't correct someone else's incident nor their own once frozen", async () => {
	const id = await createOrderIn('DELIVERED');
	const chairs = await reported(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }], DRIVER);
	const table = await reported(id, [{ product_id: TABLE, qty: 1, outcome: 'LOST' }], DRIVER);
	await setResponsibleParty(db, { id: table, responsible_party: 'CARRIER' }, MANAGER);
	const more = [{ product_id: CHAIR, qty: 1, outcome: 'LOST' }];
	expect(await correct(chairs, more, SALES)).toEqual({
		ok: false,
		message: 'Solo quien la reportó o el Gerente puede corregirla.',
		errors: {}
	});
	expect(await correct(table, [{ product_id: TABLE, qty: 2, outcome: 'LOST' }])).toEqual({
		ok: false,
		message: 'El Gerente ya le puso responsable: no se puede corregir.',
		errors: {}
	});
	await reverse(chairs, DRIVER);
	expect(await correct(chairs, more)).toMatchObject({ ok: false });
	expect([stock(CHAIR), stock(TABLE)]).toEqual([500, 499]);
	expect(events('INCIDENT', 'EDITED')).toHaveLength(1);
});

test('the manager corrects any unfrozen incident, not a frozen one; the reporter stays', async () => {
	const id = await createOrderIn('DELIVERED');
	const chairs = await reported(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }], DRIVER);
	const table = await reported(id, [{ product_id: TABLE, qty: 1, outcome: 'LOST' }], SALES);
	await setResponsibleParty(db, { id: table, responsible_party: 'CLIENT' }, MANAGER);
	expect(await correct(chairs, [{ product_id: CHAIR, qty: 3, outcome: 'LOST' }], MANAGER)).toEqual({
		ok: true,
		id: chairs
	});
	expect(stock(CHAIR)).toBe(497);
	expect(incidentRow(chairs)).toMatchObject({ created_by: 'driver', updated_by: 'manager' });
	expect(
		await correct(table, [{ product_id: TABLE, qty: 2, outcome: 'LOST' }], MANAGER)
	).toMatchObject({ ok: false });
	expect(stock(TABLE)).toBe(499);
});

test('a correction is validated like a report', async () => {
	const id = await createOrderIn('DELIVERED');
	const incident = await reported(id, [{ product_id: CHAIR, qty: 2, outcome: 'LOST' }], DRIVER);
	expect(await correct(incident, [])).toMatchObject({
		ok: false,
		errors: { items: expect.any(String) }
	});
	const tablecloth = [{ product_id: TABLECLOTH, qty: 1, outcome: 'LOST' }];
	expect(await correct(incident, tablecloth)).toMatchObject({
		ok: false,
		errors: { 'items.0.product_id': 'Ese producto no está en el pedido' }
	});
	const tooMany = [
		{ product_id: TABLE, qty: 10, outcome: 'LOST' },
		{ product_id: TABLE, qty: 3, outcome: 'RECOVERABLE' }
	];
	expect(await correct(incident, tooMany)).toMatchObject({
		ok: false,
		errors: { 'items.1.qty': 'El pedido tiene 12: no se pueden reportar más' }
	});
	const twice = [
		{ product_id: CHAIR, qty: 1, outcome: 'LOST' },
		{ product_id: CHAIR, qty: 1, outcome: 'LOST' }
	];
	expect(await correct(incident, twice)).toMatchObject({ ok: false });
	const blankInput = {
		id: String(incident),
		incident_description: ' ',
		items: [{ product_id: CHAIR, qty: 1, outcome: 'LOST' }]
	};
	expect(await correctIncident(db, blankInput, DRIVER)).toMatchObject({
		ok: false,
		errors: { incident_description: expect.any(String) }
	});
	expect(stock(CHAIR)).toBe(498);
	expect(events('INCIDENT', 'EDITED')).toEqual([]);
});

const COUNT_BLOCK =
	'No se puede cambiar la cantidad perdida o inservible de Silla Tiffany dorada: un conteo aprobado ya la fijó. Puedes cambiar la descripción y lo recuperable.';

test("a count approved after it blocks changing that product's lost total, and only that", async () => {
	const id = await createOrderIn('COMPLETED');
	const incident = await reported(
		id,
		[
			{ product_id: CHAIR, qty: 4, outcome: 'LOST' },
			{ product_id: TABLE, qty: 1, outcome: 'LOST' }
		],
		DRIVER
	);
	await count([[CHAIR, 490]]);
	const moreChairs = [
		{ product_id: CHAIR, qty: 5, outcome: 'LOST' },
		{ product_id: TABLE, qty: 1, outcome: 'LOST' }
	];
	const blocked = { ok: false, message: COUNT_BLOCK, errors: {} };
	expect(await correct(incident, moreChairs)).toEqual(blocked);
	const noChairs = [{ product_id: TABLE, qty: 1, outcome: 'LOST' }];
	expect(await correct(incident, noChairs)).toEqual(blocked);
	const sameTotal = [
		{ product_id: CHAIR, qty: 2, outcome: 'LOST' },
		{ product_id: CHAIR, qty: 2, outcome: 'UNRECOVERABLE' },
		{ product_id: CHAIR, qty: 3, outcome: 'RECOVERABLE' },
		{ product_id: TABLE, qty: 2, outcome: 'LOST' }
	];
	expect(await correct(incident, sameTotal)).toEqual({ ok: true, id: incident });
	expect([stock(CHAIR), stock(TABLE)]).toEqual([490, 498]);
	expect(incidentRow(incident)).toMatchObject({ incident_description: 'Llegaron rotas' });
});

test('the active incidents a damage charge names: what was lost and whose fault, never a reversed one', async () => {
	const id = await createOrderIn('OUT_FOR_PICKUP');
	const chairs = await reported(id, [{ product_id: CHAIR, qty: 4, outcome: 'LOST' }]);
	const table = await reported(id, [{ product_id: TABLE, qty: 1, outcome: 'UNRECOVERABLE' }]);
	expect(await reverse(chairs)).toMatchObject({ ok: true });
	expect(await listActiveIncidents(db, id, DRIVER)).toEqual([
		{
			id: table,
			items: [
				{ product_id: TABLE, name: 'Mesa redonda 10 puestos', qty: 1, outcome: 'UNRECOVERABLE' }
			],
			responsibleParty: 'UNDETERMINED'
		}
	]);
});
