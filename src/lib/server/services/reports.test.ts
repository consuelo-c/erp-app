import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Actor } from '../actor';
import { actorWith, ADMIN, createFixture, DRIVER, MANAGER, SALES, WAREHOUSE } from '../db/fixture';
import { logIn } from './auth';
import { recordMovement, recordOffset } from './cash';
import { createContact } from './contacts';
import { reportIncident, reverseIncident, setResponsibleParty } from './incidents';
import { submitCount } from './inventory';
import { advanceOrder, cancelOrder, getAvailability, type OrderStatus } from './orders';
import { openWeek, recordPayment } from './payroll';
import { createProduct } from './products';
import { issueReceivable, recordReceivablePayment } from './receivables';
import { getAuditLog, getProfitAndLoss, getSubLending, type SubLending } from './reports';
import { updateHelp } from './settings';
import type { SaveResult } from '../result';
import { saveEmployeePunch } from './timesheets';

let db: D1Database;
let database: DatabaseSync;
let fixture: ReturnType<typeof createFixture>;

function useFixture(options?: Parameters<typeof createFixture>[0]) {
	fixture = createFixture(options);
	({ db, database } = fixture);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(bogota('2026-11-22T10:00:00'));
	useFixture();
});

afterEach(() => {
	vi.useRealTimers();
});

/** A Bogotá wall-clock time. */
function bogota(dateTime: string): Date {
	return new Date(`${dateTime}-05:00`);
}

function idsOf(log: Awaited<ReturnType<typeof getAuditLog>>): number[] {
	return log.events.map((event) => event.id);
}

function lastEventId(): number {
	return Number(database.prepare('select max(id) as id from events').get()?.id);
}

function countEvents(): number {
	return Number(database.prepare('select count(*) as count from events').get()?.count);
}

let products = 0;

// Productos › Nuevo by `actor` at a Bogotá wall-clock time: one PRODUCT CREATED Event, its id.
async function productCreated(at = '2026-11-22T10:00:00', actor: Actor = MANAGER) {
	vi.setSystemTime(bogota(at));
	const form = {
		name: `Producto del registro ${++products}`,
		category: 'CHAIRS_TABLES',
		rental_price: '2.500',
		total_quantity: '10',
		active: 'on'
	};
	const result = await createProduct(db, form, actor);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return lastEventId();
}

const SECRETS = { pepper: 'test-pepper', adminPassword: 'clave-admin' };

// A login attempt with a password that isn't theirs: its LOGIN_FAILED Event.
async function failedLogin(username: string): Promise<void> {
	const request = { ip: '181.59.204.17', userAgent: 'Mozilla/5.0' };
	await logIn(db, { username, password: 'equivocada' }, { secrets: SECRETS, request });
}

async function refusal(actor: Actor): Promise<number | null> {
	try {
		await getAuditLog(db, {}, actor);
		return null;
	} catch (thrown) {
		return isHttpError(thrown) ? thrown.status : null;
	}
}

describe('getAuditLog', () => {
	test('lists the Events newest first, the latest of the same second on top', async () => {
		const older = await productCreated('2026-11-21T09:00:00');
		const sameSecondFirst = await productCreated('2026-11-22T10:00:00');
		const sameSecondLast = await productCreated('2026-11-22T10:00:00');
		const newest = await productCreated('2026-11-22T11:30:00');

		const log = await getAuditLog(db, {}, MANAGER);

		expect(idsOf(log)).toEqual([newest, sameSecondLast, sameSecondFirst, older]);
	});

	test('pages 20 at a time, with the total and the page count', async () => {
		for (let minute = 0; minute < 45; minute++) {
			await productCreated(`2026-11-22T10:${String(minute).padStart(2, '0')}:00`);
		}

		const first = await getAuditLog(db, {}, MANAGER);
		const third = await getAuditLog(db, { page: '3' }, ADMIN);

		expect(first).toMatchObject({ total: 45, pageCount: 3, filters: { page: 1 } });
		expect(first.events).toHaveLength(20);
		expect(third.events).toHaveLength(5);
		expect(third.filters.page).toBe(3);
	});

	test('a page past the last shows the last, and an unreadable one the first', async () => {
		await productCreated();

		expect((await getAuditLog(db, { page: '9' }, MANAGER)).filters.page).toBe(1);
		expect((await getAuditLog(db, { page: 'dos' }, MANAGER)).filters.page).toBe(1);
	});

	test('with no Events the page is empty, one page long', async () => {
		const log = await getAuditLog(db, {}, MANAGER);

		expect(log).toMatchObject({ events: [], total: 0, pageCount: 1 });
	});

	test('Desde and Hasta are inclusive Bogotá days: 11 p.m. belongs to its own day', async () => {
		const lateOnTheTwentieth = await productCreated('2026-11-20T23:59:00');
		const earlyOnTheTwentyFirst = await productCreated('2026-11-21T00:00:00');
		const lateOnTheTwentyFirst = await productCreated('2026-11-21T23:00:00');
		const onTheTwentySecond = await productCreated('2026-11-22T00:30:00');

		const oneDay = await getAuditLog(db, { from: '2026-11-21', to: '2026-11-21' }, MANAGER);
		const fromOnly = await getAuditLog(db, { from: '2026-11-21' }, MANAGER);
		const toOnly = await getAuditLog(db, { to: '2026-11-20' }, MANAGER);

		expect(idsOf(oneDay)).toEqual([lateOnTheTwentyFirst, earlyOnTheTwentyFirst]);
		expect(idsOf(fromOnly)).toEqual([
			onTheTwentySecond,
			lateOnTheTwentyFirst,
			earlyOnTheTwentyFirst
		]);
		expect(idsOf(toOnly)).toEqual([lateOnTheTwentieth]);
	});

	test('filters by the exact username', async () => {
		const byManager = await productCreated(undefined, MANAGER);
		// 'manager-admin' starts with 'manager': only the exact one is kept.
		await productCreated(undefined, actorWith('MANAGER', 'ADMIN'));
		await productCreated(undefined, ADMIN);

		const log = await getAuditLog(db, { username: 'manager' }, MANAGER);

		expect(idsOf(log)).toEqual([byManager]);
	});

	test('filters by Registro and by Acción, alone and combined with every other filter', async () => {
		// The real catalog writes no Events: its products are edited here with nothing before.
		useFixture({ catalog: true });
		const catalog = database.prepare('select id from products order by id limit 2').all();
		const [first, second] = catalog.map((row) => Number(row.id));
		const client = await fixture.contact();
		vi.setSystemTime(bogota('2026-11-21T08:00:00'));
		await fixture.editProduct(first, { rental_price: '9.999' });
		const productEdit = lastEventId();
		const productCreatedId = await productCreated();
		await fixture.editContact(client, { full_name: 'Diana Zuluaga' });
		const contactEdit = lastEventId();
		await fixture.editProduct(second, { rental_price: '9.999' }, ADMIN);

		const productEvents = await getAuditLog(db, { entityType: 'PRODUCT' }, MANAGER);
		const edits = await getAuditLog(db, { action: 'EDITED' }, MANAGER);
		const combined = await getAuditLog(
			db,
			{
				from: '2026-11-21',
				to: '2026-11-21',
				username: 'manager',
				entityType: 'PRODUCT',
				action: 'EDITED'
			},
			MANAGER
		);

		expect(idsOf(productEvents)).toHaveLength(3);
		expect(idsOf(productEvents)).toContain(productCreatedId);
		expect(idsOf(edits)).toHaveLength(3);
		expect(idsOf(edits)).toContain(contactEdit);
		expect(idsOf(combined)).toEqual([productEdit]);
	});

	test('a combination with no Events is an empty page, not a refusal', async () => {
		await updateHelp(db, { text: '## ¿Qué hago al llegar?' }, MANAGER);

		const log = await getAuditLog(db, { entityType: 'SETTINGS', action: 'LOGIN' }, MANAGER);

		expect(log).toMatchObject({ events: [], total: 0 });
	});

	test('unreadable filter values fall back to «all»', async () => {
		await productCreated();
		await productCreated();

		const log = await getAuditLog(
			db,
			{ from: '21/11/2026', to: 'ayer', entityType: 'PEDIDO', action: 'BORRADO', username: '' },
			MANAGER
		);

		expect(log.total).toBe(2);
		expect(log.filters).toMatchObject({
			from: undefined,
			to: undefined,
			entityType: undefined,
			action: undefined,
			username: undefined
		});
	});

	test('«Usuario» lists every username in the log, sorted, logins or not', async () => {
		const sold = { full_name: 'Diana Zuluaga', phone: '3157770020', document_id: '43210987' };
		await createContact(db, sold, SALES);
		await failedLogin('jperez');
		await createContact(db, { ...sold, phone: '3157770021', document_id: '43210988' }, SALES);
		vi.setSystemTime(bogota('2026-01-02T08:00:00'));
		const orderId = await fixture.order();
		await advanceOrder(db, { id: orderId, status: 'PICKED' }, DRIVER);

		const log = await getAuditLog(db, { username: 'driver' }, MANAGER);

		expect(log.usernames).toEqual(['driver', 'jperez', 'manager', 'sales']);
	});

	test('each changed field is a column with its raw value before and after', async () => {
		const id = await fixture.product({ rental_price: '2.500' });
		await fixture.editProduct(id, { rental_price: '2.800', replacement_cost: '95.000' });
		await fixture.payment(await fixture.order(), { amount: '680.000' });

		const [edit] = (await getAuditLog(db, { entityType: 'PRODUCT', action: 'EDITED' }, MANAGER))
			.events;
		const [creation] = (await getAuditLog(db, { entityType: 'CASH_MOVEMENT' }, MANAGER)).events;

		expect(edit.changes).toEqual([
			{ column: 'rental_price', before: 2500, after: 2800 },
			{ column: 'attributes.replacement_cost', before: null, after: 95000 }
		]);
		// A creation has no before: every column it wrote is a change from null.
		expect(creation.changes).toEqual(
			expect.arrayContaining([
				{ column: 'concept', before: null, after: 'INSTALLMENT' },
				{ column: 'amount', before: null, after: 680000 }
			])
		);
		expect(creation.changes.every(({ before }) => null === before)).toBe(true);
	});

	test('an Event carries its reason, and an access Event its IP and browser', async () => {
		await fixture.order({ status: 'CANCELLED', reason: 'El cliente canceló el evento' });
		const request = { ip: '181.59.204.17', userAgent: 'Mozilla/5.0 (Linux; Android 14)' };
		await logIn(db, { username: 'admin', password: 'clave-admin' }, { secrets: SECRETS, request });
		const admin = database.prepare("select id from users where username = 'admin'").get();

		const events = (await getAuditLog(db, {}, MANAGER)).events;
		const login = events.find((event) => 'LOGIN' === event.action);
		const cancellation = events.find((event) => 'CANCELLED' === event.action);

		expect(cancellation).toMatchObject({ reason: 'El cliente canceló el evento', ip: null });
		expect(login).toMatchObject({
			username: 'admin',
			entityType: 'USER',
			ip: '181.59.204.17',
			userAgent: 'Mozilla/5.0 (Linux; Android 14)',
			changes: [],
			link: { href: `/logins/${admin?.id}`, label: 'admin' }
		});
	});

	test('a record with a page links to it, readably where cheap; the rest link nowhere', async () => {
		const product = await createProduct(
			db,
			{
				name: 'Silla Tiffany dorada',
				category: 'CHAIRS_TABLES',
				rental_price: '2.500',
				total_quantity: '120',
				active: 'on'
			},
			MANAGER
		);
		const contact = await createContact(
			db,
			{ full_name: 'Luz Marina Restrepo', phone: '3104428890', document_id: '43210987' },
			MANAGER
		);
		if (!product.ok || !contact.ok) {
			throw new Error('seeding failed');
		}
		const orderId = await fixture.order();
		const quoteId = await fixture.quote();
		const billed = await issueReceivable(
			db,
			{ orders: [await fixture.order()], payment_terms: 'Contado' },
			MANAGER
		);
		const items = [{ product_id: product.id, counted_qty: 120 }];
		const count = await submitCount(db, { items }, WAREHOUSE);
		const jhon = await fixture.employee({ roles: ['DRIVER'], full_name: 'Jhon Fredy Ospina' });
		await fixture.payment(orderId);
		const punch = { work_date: '2026-11-20', punch: 'morningIn', hour: '7', minute: '0' };
		const punched = { ...punch, period: 'am', employee_id: String(jhon.employeeId) };
		await saveEmployeePunch(db, punched, MANAGER);
		await updateHelp(db, { text: '## ¿Qué hago al llegar?' }, MANAGER);
		await failedLogin('jperez');
		if (!billed.ok || !count.ok) {
			throw new Error('seeding failed');
		}

		const linkOf = async (type: string, entityId: number | null) => {
			const { events } = await getAuditLog(db, { entityType: type }, MANAGER);
			return events.find((event) => entityId === event.entityId)?.link;
		};

		expect(await linkOf('PRODUCT', product.id)).toEqual({
			href: `/productos/${product.id}`,
			label: 'Silla Tiffany dorada'
		});
		expect(await linkOf('CONTACT', contact.id)).toEqual({
			href: `/contactos/${contact.id}`,
			label: 'Luz Marina Restrepo'
		});
		expect(await linkOf('ORDER', orderId)).toEqual({
			href: `/pedidos/${orderId}`,
			label: `#${orderId}`
		});
		expect(await linkOf('QUOTE', quoteId)).toEqual({
			href: `/cotizaciones/${quoteId}`,
			label: `Cotización #${quoteId}`
		});
		expect(await linkOf('RECEIVABLE', billed.id)).toEqual({
			href: `/cuentas-de-cobro/${billed.id}`,
			label: `CC Nº ${billed.id}`
		});
		expect(await linkOf('INVENTORY_COUNT', count.id)).toEqual({
			href: `/inventario/revisar/${count.id}`,
			label: String(count.id)
		});
		expect(await linkOf('EMPLOYEE', jhon.employeeId)).toEqual({
			href: `/personal/${jhon.employeeId}`,
			label: 'Jhon Fredy Ospina'
		});
		const [movement] = (await getAuditLog(db, { entityType: 'CASH_MOVEMENT' }, MANAGER)).events;
		const [timesheet] = (await getAuditLog(db, { entityType: 'TIMESHEET' }, MANAGER)).events;
		const [settings] = (await getAuditLog(db, { entityType: 'SETTINGS' }, MANAGER)).events;
		expect(movement.link).toBeNull();
		expect(timesheet.link).toBeNull();
		expect(settings.link).toBeNull();
		expect(await linkOf('USER', null)).toBeNull();
	});

	test('reads, never writes: no Event is added by reading the log', async () => {
		await productCreated();
		const before = countEvents();

		await getAuditLog(db, {}, MANAGER);

		expect(countEvents()).toBe(before);
	});

	test('only managers read it: Sales, drivers and warehouse are refused', async () => {
		expect(await refusal(SALES)).toBe(403);
		expect(await refusal(DRIVER)).toBe(403);
		expect(await refusal(WAREHOUSE)).toBe(403);
		expect(await refusal(ADMIN)).toBeNull();
	});
});

describe('getSubLending', () => {
	function stocked(name: string, owned: number): Promise<number> {
		return fixture.product({ name, total_quantity: String(owned) });
	}

	type Booking = {
		lines: [productId: number, qty: number][];
		delivery: string;
		pickup: string;
		status?: OrderStatus;
		client?: string;
	};

	// An order holding `lines` from delivery to pickup, for a client of its own named `client`.
	async function book({ lines, delivery, pickup, status = 'CONFIRMED', client }: Booking) {
		const fullName = client ?? 'Luz Marina Restrepo';
		return fixture.order({
			client_id: await fixture.contact({ full_name: fullName }),
			status,
			event_date: delivery,
			delivery_date: delivery,
			pickup_date: pickup,
			order_items: lines.map(([productId, qty]) => ({
				product_id: productId,
				qty,
				unit_price: 1000
			}))
		});
	}

	const WEEKEND = { from: '2026-11-27', to: '2026-11-30' };

	test('100 chairs owned, 70 held Friday to Monday and 50 Saturday to Monday: 20 missing on Saturday', async () => {
		const chairs = await stocked('Silla Tiffany dorada', 100);
		const friday = await book({
			lines: [[chairs, 70]],
			delivery: '2026-11-27',
			pickup: '2026-11-30',
			client: 'Postobón S.A.'
		});
		const saturday = await book({
			lines: [[chairs, 50]],
			delivery: '2026-11-28',
			pickup: '2026-11-30'
		});

		const report = await getSubLending(db, WEEKEND, SALES);

		expect(report).toEqual({
			from: '2026-11-27',
			to: '2026-11-30',
			products: [
				{
					productId: chairs,
					name: 'Silla Tiffany dorada',
					owned: 100,
					held: 120,
					missing: 20,
					worstDay: '2026-11-28',
					orders: [
						{
							id: friday,
							clientName: 'Postobón S.A.',
							deliveryDate: '2026-11-27',
							pickupDate: '2026-11-30',
							quantity: 70
						},
						{
							id: saturday,
							clientName: 'Luz Marina Restrepo',
							deliveryDate: '2026-11-28',
							pickupDate: '2026-11-30',
							quantity: 50
						}
					]
				}
			]
		});
	});

	function missingOf(report: SubLending): Record<string, number> {
		return Object.fromEntries(report.products.map(({ name, missing }) => [name, missing]));
	}

	test('the worst single day, never a sum over the days; a tie goes to the earliest day', async () => {
		const glasses = await stocked('Copa para vino tinto', 10);
		await book({ lines: [[glasses, 15]], delivery: '2026-11-27', pickup: '2026-11-27' });
		await book({ lines: [[glasses, 12]], delivery: '2026-11-28', pickup: '2026-11-28' });
		await book({ lines: [[glasses, 15]], delivery: '2026-11-30', pickup: '2026-11-30' });

		const report = await getSubLending(db, WEEKEND, MANAGER);

		expect(report.products).toMatchObject([{ held: 15, missing: 5, worstDay: '2026-11-27' }]);
	});

	test('Hasta before Desde is the same period, swapped', async () => {
		const glasses = await stocked('Copa para vino tinto', 10);
		await book({ lines: [[glasses, 15]], delivery: '2026-11-28', pickup: '2026-11-28' });

		const report = await getSubLending(db, { from: '2026-11-30', to: '2026-11-27' }, MANAGER);

		expect(report).toMatchObject({ from: '2026-11-27', to: '2026-11-30' });
		expect(missingOf(report)).toEqual({ 'Copa para vino tinto': 5 });
	});

	test('an order holds its products on its delivery day and on its pickup day, both included', async () => {
		const tables = await stocked('Mesa redonda 10 puestos', 10);
		await book({ lines: [[tables, 12]], delivery: '2026-11-26', pickup: '2026-11-27' });
		const on = async (date: string) =>
			missingOf(await getSubLending(db, { from: date, to: date }, MANAGER));

		expect(await on('2026-11-25')).toEqual({});
		expect(await on('2026-11-26')).toEqual({ 'Mesa redonda 10 puestos': 2 });
		expect(await on('2026-11-27')).toEqual({ 'Mesa redonda 10 puestos': 2 });
		expect(await on('2026-11-28')).toEqual({});
	});

	test('only the orders that hold stock count: not a cancelled or a completed one', async () => {
		const reserving: OrderStatus[] = [
			'CONFIRMED',
			'PICKED',
			'OUT_FOR_DELIVERY',
			'DELIVERED',
			'OUT_FOR_PICKUP'
		];
		const chairs = await stocked('Silla Tiffany dorada', 0);
		for (const status of [...reserving, 'CANCELLED', 'COMPLETED'] as const) {
			await book({ lines: [[chairs, 1]], delivery: '2026-11-28', pickup: '2026-11-28', status });
		}

		const report = await getSubLending(db, WEEKEND, MANAGER);

		expect(missingOf(report)).toEqual({ 'Silla Tiffany dorada': reserving.length });
	});

	test('quotes never count, however many products they ask for', async () => {
		const chairs = await stocked('Silla Tiffany dorada', 10);
		await fixture.quote({
			event_date: '2026-11-28',
			quote_items: [{ product_id: chairs, qty: 500, unit_price: 1000 }]
		});

		expect((await getSubLending(db, WEEKEND, MANAGER)).products).toEqual([]);
	});

	test('a product held up to what the company owns is left out', async () => {
		const chairs = await stocked('Silla Tiffany dorada', 100);
		const tables = await stocked('Mesa redonda 10 puestos', 30);
		await book({
			lines: [
				[chairs, 100],
				[tables, 31]
			],
			delivery: '2026-11-28',
			pickup: '2026-11-29'
		});

		const report = await getSubLending(db, WEEKEND, MANAGER);

		expect(missingOf(report)).toEqual({ 'Mesa redonda 10 puestos': 1 });
	});

	test('an inactive product, or one with no stock, is listed when orders hold it', async () => {
		const tablecloth = await stocked('Mantel blanco 3×3', 0);
		const retired = await stocked('Silla Rimax', 20);
		await book({
			lines: [
				[tablecloth, 4],
				[retired, 25]
			],
			delivery: '2026-11-27',
			pickup: '2026-11-27'
		});
		await fixture.editProduct(retired, { active: 'off' });

		const report = await getSubLending(db, WEEKEND, MANAGER);

		expect(missingOf(report)).toEqual({ 'Mantel blanco 3×3': 4, 'Silla Rimax': 5 });
	});

	test('most missing first, then by name', async () => {
		const tables = await stocked('Mesa redonda 10 puestos', 30);
		const glasses = await stocked('Copa para vino tinto', 300);
		const chairs = await stocked('Silla Tiffany dorada', 100);
		const tablecloth = await stocked('Mantel blanco 3×3', 0);
		await book({
			lines: [
				[tables, 36],
				[glasses, 306],
				[chairs, 120],
				[tablecloth, 4]
			],
			delivery: '2026-11-28',
			pickup: '2026-11-28'
		});

		const report = await getSubLending(db, WEEKEND, MANAGER);

		expect(report.products.map(({ name }) => name)).toEqual([
			'Silla Tiffany dorada',
			'Copa para vino tinto',
			'Mesa redonda 10 puestos',
			'Mantel blanco 3×3'
		]);
	});

	test("the orders are the worst day's only, the largest first", async () => {
		const chairs = await stocked('Silla Tiffany dorada', 100);
		const thursday = await book({
			lines: [[chairs, 90]],
			delivery: '2026-11-26',
			pickup: '2026-11-27'
		});
		const small = await book({
			lines: [[chairs, 40]],
			delivery: '2026-11-28',
			pickup: '2026-11-28'
		});
		const large = await book({
			lines: [[chairs, 80]],
			delivery: '2026-11-28',
			pickup: '2026-11-29'
		});

		const [product] = (await getSubLending(db, WEEKEND, MANAGER)).products;

		expect(product.worstDay).toBe('2026-11-28');
		expect(product.orders.map(({ id, quantity }) => [id, quantity])).toEqual([
			[large, 80],
			[small, 40]
		]);
		expect(product.orders.map(({ id }) => id)).not.toContain(thursday);
	});

	test('opens on today only', async () => {
		vi.setSystemTime(new Date('2026-11-28T17:00:00Z')); // noon in Bogotá
		const chairs = await stocked('Silla Tiffany dorada', 10);
		await book({ lines: [[chairs, 12]], delivery: '2026-11-28', pickup: '2026-11-28' });
		await book({ lines: [[chairs, 50]], delivery: '2026-11-29', pickup: '2026-11-29' });

		const report = await getSubLending(db, { from: '', to: null }, SALES);

		expect(report).toMatchObject({ from: '2026-11-28', to: '2026-11-28' });
		expect(missingOf(report)).toEqual({ 'Silla Tiffany dorada': 2 });
	});

	test('agrees with availability for the same range: what is missing is what availability is short', async () => {
		const chairs = await stocked('Silla Tiffany dorada', 100);
		const glasses = await stocked('Copa para vino tinto', 300);
		const tables = await stocked('Mesa redonda 10 puestos', 30);
		await book({
			lines: [
				[chairs, 70],
				[glasses, 200],
				[tables, 20]
			],
			delivery: '2026-11-27',
			pickup: '2026-11-30'
		});
		await book({
			lines: [
				[chairs, 50],
				[tables, 5]
			],
			delivery: '2026-11-28',
			pickup: '2026-11-30'
		});
		await book({ lines: [[glasses, 112]], delivery: '2026-11-29', pickup: '2026-12-01' });
		await book({
			lines: [[glasses, 400]],
			delivery: '2026-11-20',
			pickup: '2026-11-26',
			status: 'COMPLETED'
		});

		const report = await getSubLending(db, WEEKEND, MANAGER);
		const availability = await getAvailability(
			db,
			{ delivery_date: WEEKEND.from, pickup_date: WEEKEND.to },
			MANAGER
		);

		const short = availability
			.filter(({ available }) => available < 0)
			.map(({ productId, available }) => [productId, -available]);
		expect(report.products.map(({ productId, missing }) => [productId, missing]).sort()).toEqual(
			short.sort()
		);
		expect(missingOf(report)).toEqual({ 'Silla Tiffany dorada': 20, 'Copa para vino tinto': 12 });
	});

	test('reads for the roles that take orders: drivers and warehouse are refused', async () => {
		const refusedWith = (actor: Actor) =>
			getSubLending(db, WEEKEND, actor).then(
				() => null,
				(thrown: unknown) => (isHttpError(thrown) ? thrown.status : thrown)
			);

		expect(await refusedWith(DRIVER)).toBe(403);
		expect(await refusedWith(WAREHOUSE)).toBe(403);
		expect(await refusedWith(ADMIN)).toBeNull();
		expect(await refusedWith(SALES)).toBeNull();
	});
});

describe('getProfitAndLoss', () => {
	const NOVEMBER = { from: '2026-11-01', to: '2026-11-30' };

	type Fields = Record<string, unknown>;

	function savedId(result: SaveResult<{ id: number }>): number {
		if (!result.ok) {
			throw new Error(JSON.stringify(result));
		}
		return result.id;
	}

	// An order worth $5.000.000, its event on 8 November: room for every payment a test records.
	async function sale(fields: Fields = {}): Promise<number> {
		const line = { product_id: await fixture.product(), qty: 100, unit_price: 50_000 };
		return fixture.order({
			event_date: '2026-11-08',
			delivery_date: '2026-11-07',
			pickup_date: '2026-11-09',
			order_items: [line],
			...fields
		});
	}

	type Entry = { concept: string; amount: number; date: string; [field: string]: unknown };

	// One of the order's entries, typed positive: the concept gives the sign.
	function pay(orderId: number, { amount, date, ...fields }: Entry) {
		return fixture.payment(orderId, { ...fields, amount: String(amount), movement_date: date });
	}

	// «Salida» (or «Entrada») of Caja's own, in cash.
	async function standalone(concept: string, amount: number, date: string): Promise<number> {
		const input = {
			direction: 'OTHER_INCOME' === concept ? 'IN' : 'OUT',
			concept,
			description: 'Movimiento de caja',
			payee: 'Almacén Éxito Laureles',
			payment_method: 'CASH',
			amount: String(amount),
			movement_date: date
		};
		return savedId(await recordMovement(db, input, MANAGER));
	}

	// The offsetting movement of `movementId`, from Caja.
	async function offset(movementId: number, date: string): Promise<number> {
		const input = {
			reverses_id: String(movementId),
			description: 'Corrige el movimiento',
			payee: 'Almacén Éxito Laureles',
			payment_method: 'CASH',
			movement_date: date
		};
		return savedId(await recordOffset(db, input, MANAGER));
	}

	async function cancel(orderId: number): Promise<void> {
		savedId(await cancelOrder(db, { id: orderId, reason: 'El cliente canceló' }, MANAGER));
	}

	// A delivered order of 10 units of its own product with one unit lost: an active incident.
	async function withIncident(fields: Fields = {}): Promise<number> {
		const productId = await fixture.product();
		const orderId = await sale({
			status: 'DELIVERED',
			order_items: [{ product_id: productId, qty: 10, unit_price: 50_000 }],
			...fields
		});
		const items = [{ product_id: productId, qty: 1, outcome: 'LOST' }];
		const input = { order_id: orderId, incident_description: 'Se perdió', items };
		savedId(await reportIncident(db, input, MANAGER));
		return orderId;
	}

	test('Recaudado nets payments, payment refunds and cancellation fees by movement date, offsets included', async () => {
		const order = await sale();
		const cancelled = await sale({ status: 'CANCELLED' });
		const billed = await sale({
			order_items: [{ product_id: await fixture.product(), qty: 1, unit_price: 300_000 }]
		});
		const cuenta = savedId(
			await issueReceivable(db, { orders: [billed], payment_terms: 'Contado' }, MANAGER)
		);
		await pay(order, { concept: 'INSTALLMENT', amount: 500_000, date: '2026-11-03' });
		const cuentaPayment = {
			id: String(cuenta),
			payment_method: 'CASH',
			amount: '300000',
			movement_date: '2026-11-30'
		};
		savedId(await recordReceivablePayment(db, cuentaPayment, MANAGER));
		const mistaken = await pay(order, {
			concept: 'INSTALLMENT',
			amount: 80_000,
			date: '2026-10-28'
		});
		await offset(mistaken, '2026-11-02');
		await pay(order, { concept: 'INSTALLMENT_REFUND', amount: 50_000, date: '2026-11-10' });
		await pay(cancelled, {
			concept: 'CANCELLATION_FEE',
			amount: 120_000,
			date: '2026-11-15',
			fee_source: 'NEW'
		});
		await pay(order, { concept: 'INSTALLMENT', amount: 900_000, date: '2026-12-01' });

		const report = await getProfitAndLoss(db, NOVEMBER, MANAGER);

		expect(report.income.collected).toEqual({
			amount: 790_000,
			concepts: ['INSTALLMENT', 'INSTALLMENT_REFUND', 'CANCELLATION_FEE']
		});
	});

	test('a fee kept from payments nets to nothing; one kept from the deposit counts; deposits are never read', async () => {
		const paidOrder = await sale();
		await pay(paidOrder, { concept: 'INSTALLMENT', amount: 500_000, date: '2026-11-03' });
		await cancel(paidOrder);
		await pay(paidOrder, {
			concept: 'CANCELLATION_FEE',
			amount: 100_000,
			date: '2026-11-05',
			fee_source: 'INSTALLMENTS'
		});
		const depositOrder = await sale({ deposit_amount: 200_000 });
		await pay(depositOrder, { concept: 'SECURITY_DEPOSIT', amount: 200_000, date: '2026-11-04' });
		await cancel(depositOrder);
		await pay(depositOrder, {
			concept: 'CANCELLATION_FEE',
			amount: 60_000,
			date: '2026-11-06',
			fee_source: 'DEPOSIT'
		});
		await pay(depositOrder, { concept: 'DEPOSIT_REFUND', amount: 140_000, date: '2026-11-06' });

		const report = await getProfitAndLoss(db, NOVEMBER, MANAGER);

		expect(report.income.collected.amount).toBe(560_000);
		expect(report.income.total).toBe(560_000);
		expect(report.expenses.total).toBe(0);
		expect(report.result).toBe(560_000);
	});

	test('Cobrado por novedades nets damage charges, offsets included, and counts the orders that paid', async () => {
		const charge = (source: string) => ({ fee_source: source, description: 'Copas rotas' });
		const keptFromDeposit = await withIncident({ deposit_amount: 300_000 });
		await pay(keptFromDeposit, {
			concept: 'SECURITY_DEPOSIT',
			amount: 300_000,
			date: '2026-11-04'
		});
		await pay(keptFromDeposit, {
			concept: 'DAMAGE_CHARGE',
			amount: 150_000,
			date: '2026-11-09',
			...charge('DEPOSIT')
		});
		await pay(await withIncident(), {
			concept: 'DAMAGE_CHARGE',
			amount: 70_000,
			date: '2026-11-12',
			...charge('NEW')
		});
		const undone = await withIncident();
		const mistaken = await pay(undone, {
			concept: 'DAMAGE_CHARGE',
			amount: 40_000,
			date: '2026-11-13',
			...charge('NEW')
		});
		await offset(mistaken, '2026-11-14');
		await pay(await withIncident(), {
			concept: 'DAMAGE_CHARGE',
			amount: 90_000,
			date: '2026-10-31',
			...charge('NEW')
		});
		await standalone('OTHER_INCOME', 350_000, '2026-11-20');

		const report = await getProfitAndLoss(db, NOVEMBER, ADMIN);

		expect(report.income).toEqual({
			collected: { amount: 0, concepts: ['INSTALLMENT', 'INSTALLMENT_REFUND', 'CANCELLATION_FEE'] },
			otherIncome: { amount: 350_000, concepts: ['OTHER_INCOME'] },
			damageCharges: { amount: 220_000, concepts: ['DAMAGE_CHARGE'], orderCount: 2 },
			total: 570_000
		});
	});

	// Week `periodStart` paid in cash on `paymentDate`: a non-salary bonus alone, so exactly `netPay`.
	async function paidWeek(
		employeeId: number | null,
		{
			periodStart,
			paymentDate,
			netPay
		}: { periodStart: string; paymentDate: string; netPay: number }
	): Promise<number> {
		const draft = (await openWeek(db, { employeeId, week: periodStart }, MANAGER))?.draft ?? null;
		if (null === draft) {
			throw new Error(`No draft for ${periodStart}`);
		}
		const noHours = draft.earnings.flatMap(({ concept, qty }) =>
			null === qty ? [] : [[concept, '0']]
		);
		const form = {
			employee_id: String(employeeId),
			period_start: periodStart,
			week_number: String(draft.weekNumber),
			payment_date: paymentDate,
			...Object.fromEntries(noHours),
			NON_SALARY_BONUS: String(netPay),
			LOANS: '0',
			OTHER: '0',
			payment_method: 'CASH'
		};
		const result = await recordPayment(db, form, MANAGER);
		if (!result.ok) {
			throw new Error(result.message);
		}
		const movement = database
			.prepare(
				`select cash_movements.id from cash_movements
				join payroll_runs on payroll_runs.id = cash_movements.entity_id
				where cash_movements.entity_type = 'PAYROLL_RUN' and payroll_runs.employee_id = ?
				and payroll_runs.period_start = ?`
			)
			.get(employeeId, periodStart);
		return Number(movement?.id);
	}

	test('each expense line sums its concepts by movement date, offsets included, and Resultado subtracts them', async () => {
		const order = await sale();
		await pay(order, { concept: 'INSTALLMENT', amount: 5_000_000, date: '2026-11-02' });
		await standalone('TRANSPORT_EXPENSE', 780_000, '2026-11-03');
		const carrier = await fixture.contact({ labels: ['TRANSPORTER'] });
		const delivery = {
			time: null,
			address_1: 'Calle 10 # 43-12',
			method: 'EXTERNAL_CARRIER',
			carrier_id: carrier
		};
		const carried = await sale({ delivery_attributes: delivery });
		await pay(carried, { concept: 'CARRIER_PAYMENT', amount: 1_200_000, date: '2026-11-04' });
		const fuel = await standalone('TRANSPORT_EXPENSE', 50_000, '2026-11-05');
		await offset(fuel, '2026-11-06');
		await standalone('SUPPLIES_EXPENSE', 410_000, '2026-11-07');
		await standalone('RENT', 2_500_000, '2026-11-01');
		await standalone('RENT', 2_500_000, '2026-12-01');
		await standalone('OTHER_EXPENSE', 185_000, '2026-11-30');
		await pay(order, { concept: 'INSTALLMENT_REFUND', amount: 200_000, date: '2026-11-08' });

		const report = await getProfitAndLoss(db, NOVEMBER, MANAGER);

		expect(report.expenses).toEqual({
			transport: {
				amount: -1_980_000,
				concepts: ['TRANSPORT_EXPENSE', 'CARRIER_PAYMENT'],
				transportExpenses: -780_000,
				carrierPayments: -1_200_000
			},
			supplies: { amount: -410_000, concepts: ['SUPPLIES_EXPENSE'] },
			salaries: { amount: 0, concepts: ['PAYROLL'], weekCount: 0 },
			rent: { amount: -2_500_000, concepts: ['RENT'] },
			other: { amount: -185_000, concepts: ['OTHER_EXPENSE'] },
			total: -5_075_000
		});
		expect(report.income.total).toBe(4_800_000);
		expect(report.result).toBe(-275_000);
	});

	test('Salarios is the payroll paid in the period, with the weeks it pays', async () => {
		const ana = await fixture.employee({ roles: ['WAREHOUSE'] });
		const jhon = await fixture.employee({ roles: ['DRIVER'] });
		const weekOne = { periodStart: '2026-11-02', paymentDate: '2026-11-07' };
		await paidWeek(ana.employeeId, { ...weekOne, netPay: 400_000 });
		await paidWeek(jhon.employeeId, { ...weekOne, netPay: 380_000 });
		await paidWeek(ana.employeeId, {
			periodStart: '2026-11-09',
			paymentDate: '2026-11-14',
			netPay: 410_000
		});
		const undone = await paidWeek(ana.employeeId, {
			periodStart: '2026-11-16',
			paymentDate: '2026-11-21',
			netPay: 390_000
		});
		await offset(undone, '2026-11-21');

		const report = await getProfitAndLoss(db, NOVEMBER, MANAGER);

		expect(report.expenses.salaries).toEqual({
			amount: -1_190_000,
			concepts: ['PAYROLL'],
			weekCount: 2
		});
	});

	type Sold = { eventDate: string; status: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' };

	// An order of one line worth `items`, with its discount and transport, its trips on its event day.
	async function soldOn({ eventDate, status }: Sold, [items, discount, transport]: number[]) {
		return fixture.order({
			status,
			event_date: eventDate,
			delivery_date: eventDate,
			pickup_date: eventDate,
			order_items: [{ product_id: await fixture.product(), qty: 1, unit_price: items }],
			discount,
			transport_cost: transport
		});
	}

	test('Vendido is the orders with their event in the period, paid or not, cancelled left out, split exactly', async () => {
		await soldOn({ eventDate: '2026-11-01', status: 'CONFIRMED' }, [1_000_000, 100_000, 150_000]);
		await soldOn({ eventDate: '2026-11-30', status: 'COMPLETED' }, [2_300_000, 0, 200_000]);
		await soldOn({ eventDate: '2026-11-15', status: 'CANCELLED' }, [5_000_000, 0, 300_000]);
		await soldOn({ eventDate: '2026-10-31', status: 'COMPLETED' }, [700_000, 0, 0]);
		await soldOn({ eventDate: '2026-12-01', status: 'CONFIRMED' }, [700_000, 0, 0]);

		const report = await getProfitAndLoss(db, NOVEMBER, MANAGER);

		expect(report.sold).toEqual({
			count: 2,
			rental: 3_200_000,
			transport: 350_000,
			total: 3_550_000
		});
		expect(report.result).toBe(0);
	});

	// A product of 100 units; `null` is one with no Costo de reposición.
	function insured(name: string, replacementCost: number | null): Promise<number> {
		const cost = null === replacementCost ? {} : { replacement_cost: String(replacementCost) };
		return fixture.product({ name, ...cost });
	}

	// A completed order of 100 of each product, for a client of its own named `clientName`.
	async function completedOrder(productIds: number[], clientName = 'Diana Zuluaga') {
		return fixture.order({
			client_id: await fixture.contact({ full_name: clientName }),
			status: 'COMPLETED',
			event_date: '2026-11-08',
			delivery_date: '2026-11-08',
			pickup_date: '2026-11-08',
			order_items: productIds.map((productId) => ({
				product_id: productId,
				qty: 100,
				unit_price: 1000
			}))
		});
	}

	type Incident = {
		orderId: number;
		items: [productId: number, qty: number, outcome: string][];
		party?: 'CLIENT' | 'COMPANY' | 'CARRIER' | 'UNDETERMINED';
		isReversed?: boolean;
		/** When it was reported, Bogotá wall clock. */
		at?: string;
	};

	// Reported by the driver at `at`; the manager then names whose fault it was, or reverses it.
	async function incident({
		orderId,
		items,
		party = 'CLIENT',
		isReversed = false,
		at = '2026-11-10T10:00:00'
	}: Incident): Promise<void> {
		vi.setSystemTime(bogota(at));
		const reported = items.map(([productId, qty, outcome]) => ({
			product_id: productId,
			qty,
			outcome
		}));
		const input = { order_id: orderId, incident_description: 'Se perdieron', items: reported };
		const id = savedId(await reportIncident(db, input, DRIVER));
		if ('UNDETERMINED' !== party) {
			savedId(await setResponsibleParty(db, { id, responsible_party: party }, MANAGER));
		}
		if (isReversed) {
			savedId(await reverseIncident(db, { id, reason: 'Aparecieron' }, MANAGER));
		}
		vi.setSystemTime(bogota('2026-11-22T10:00:00'));
	}

	test('Pérdidas counts only lost and unrecoverable units of active incidents reported in the period, any party', async () => {
		const chair = await insured('Silla Tiffany dorada', 95_000);
		const glass = await insured('Copa para vino tinto', 12_000);
		const cloth = await insured('Mantel blanco 3×3', 111_000);
		const order = await completedOrder([chair, glass, cloth]);
		await incident({
			orderId: order,
			items: [
				[chair, 4, 'LOST'],
				[chair, 2, 'UNRECOVERABLE'],
				[glass, 30, 'RECOVERABLE']
			]
		});
		await incident({ orderId: order, items: [[glass, 18, 'UNRECOVERABLE']], party: 'CARRIER' });
		await incident({ orderId: order, items: [[cloth, 4, 'LOST']], party: 'UNDETERMINED' });
		await incident({ orderId: order, items: [[cloth, 9, 'LOST']], isReversed: true });
		await incident({ orderId: order, items: [[chair, 5, 'LOST']], at: '2026-10-31T23:30:00' });
		await incident({ orderId: order, items: [[chair, 7, 'LOST']], at: '2026-12-01T00:10:00' });
		await incident({ orderId: order, items: [[glass, 1, 'LOST']], at: '2026-11-30T23:50:00' });

		const report = await getProfitAndLoss(db, NOVEMBER, MANAGER);

		expect(report.losses).toEqual({
			products: [
				{ productId: chair, name: 'Silla Tiffany dorada', units: 6, cost: 95_000, total: 570_000 },
				{ productId: cloth, name: 'Mantel blanco 3×3', units: 4, cost: 111_000, total: 444_000 },
				{ productId: glass, name: 'Copa para vino tinto', units: 19, cost: 12_000, total: 228_000 }
			],
			total: 1_242_000,
			withoutCost: 0
		});
		expect(report.result).toBe(0);
	});

	test('a product with no replacement cost is listed «sin costo», adds nothing and is counted', async () => {
		const chair = await insured('Silla Tiffany dorada', 95_000);
		const tray = await insured('Bandeja de plata', null);
		const order = await completedOrder([chair, tray]);
		await incident({
			orderId: order,
			items: [
				[chair, 1, 'LOST'],
				[tray, 2, 'LOST']
			]
		});

		const report = await getProfitAndLoss(db, NOVEMBER, MANAGER);

		expect(report.losses).toEqual({
			products: [
				{ productId: chair, name: 'Silla Tiffany dorada', units: 1, cost: 95_000, total: 95_000 },
				{ productId: tray, name: 'Bandeja de plata', units: 2, cost: null, total: 0 }
			],
			total: 95_000,
			withoutCost: 1
		});
	});

	test('Sin cobrar is per order, client-responsible losses only, less its damage charges of all time, never negative', async () => {
		const chair = await insured('Silla Tiffany dorada', 95_000);
		const cloth = await insured('Mantel blanco 3×3', 111_000);
		const tray = await insured('Bandeja de plata', null);
		const products = [chair, cloth, tray];
		const diana = await completedOrder(products, 'Diana Zuluaga');
		const carlos = await completedOrder(products, 'Carlos Mejía');
		const paidUp = await completedOrder(products, 'Luz Restrepo');
		const carriers = await completedOrder(products, 'Juan Gómez');
		const charge = { fee_source: 'NEW', description: 'Lo perdido' };
		await incident({
			orderId: diana,
			items: [
				[chair, 6, 'LOST'],
				[chair, 3, 'RECOVERABLE'],
				[tray, 1, 'LOST']
			]
		});
		await incident({ orderId: diana, items: [[cloth, 2, 'LOST']], party: 'COMPANY' });
		await incident({ orderId: diana, items: [[cloth, 5, 'LOST']], isReversed: true });
		await pay(diana, { concept: 'DAMAGE_CHARGE', amount: 200_000, date: '2026-10-30', ...charge });
		await pay(diana, { concept: 'DAMAGE_CHARGE', amount: 100_000, date: '2026-12-02', ...charge });
		await incident({ orderId: carlos, items: [[cloth, 4, 'UNRECOVERABLE']] });
		const mistaken = await pay(carlos, {
			concept: 'DAMAGE_CHARGE',
			amount: 50_000,
			date: '2026-11-15',
			...charge
		});
		await offset(mistaken, '2026-11-16');
		await incident({ orderId: paidUp, items: [[chair, 1, 'LOST']] });
		await pay(paidUp, { concept: 'DAMAGE_CHARGE', amount: 150_000, date: '2026-11-21', ...charge });
		await incident({ orderId: carriers, items: [[chair, 2, 'LOST']], party: 'CARRIER' });
		await incident({ orderId: carriers, items: [[chair, 2, 'LOST']], party: 'UNDETERMINED' });

		const report = await getProfitAndLoss(db, NOVEMBER, MANAGER);

		expect(report.uncollected).toEqual({
			orders: [
				{
					orderId: diana,
					clientName: 'Diana Zuluaga',
					loss: 570_000,
					charged: 300_000,
					uncollected: 270_000
				},
				{
					orderId: carlos,
					clientName: 'Carlos Mejía',
					loss: 444_000,
					charged: 0,
					uncollected: 444_000
				},
				{
					orderId: paidUp,
					clientName: 'Luz Restrepo',
					loss: 95_000,
					charged: 150_000,
					uncollected: 0
				}
			],
			total: 714_000,
			orderCount: 2
		});
	});

	test('opens on the current Bogotá month, first to last day', async () => {
		vi.setSystemTime(new Date('2026-12-01T03:00:00Z')); // 10 p.m. on 30 November in Bogotá
		await standalone('OTHER_INCOME', 10_000, '2026-11-01');
		await standalone('OTHER_INCOME', 20_000, '2026-11-30');
		await standalone('OTHER_INCOME', 40_000, '2026-12-01');

		const report = await getProfitAndLoss(db, { from: '', to: null }, MANAGER);

		expect(report).toMatchObject({ from: '2026-11-01', to: '2026-11-30', result: 30_000 });
	});

	test('reads only for managers: Sales, drivers and warehouse are refused', async () => {
		const refusedWith = (actor: Actor) =>
			getProfitAndLoss(db, NOVEMBER, actor).then(
				() => null,
				(thrown: unknown) => (isHttpError(thrown) ? thrown.status : thrown)
			);

		expect(await refusedWith(SALES)).toBe(403);
		expect(await refusedWith(DRIVER)).toBe(403);
		expect(await refusedWith(WAREHOUSE)).toBe(403);
		expect(await refusedWith(ADMIN)).toBeNull();
	});
});
