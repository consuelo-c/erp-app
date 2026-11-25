import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Actor, Role } from '../actor';
import { ADMIN, createFixture, MANAGER, TEST_PASSWORD, TEST_PEPPER } from '../db/fixture';
import { recordMovement, recordOffset } from './cash';
import { getCashStatement, listPeopleWithTab, recordHandover } from './cash-handovers';
import { createLogin, deactivateLogin } from './logins';
import { recordOrderPayment } from './orders';

let db: D1Database;
let database: DatabaseSync;
let fixture: ReturnType<typeof createFixture>;
let driver: Actor;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-20T17:00:00Z')); // noon in Bogotá
	fixture = createFixture();
	({ db, database } = fixture);
	driver = await fixture.employee({ roles: ['DRIVER'], full_name: 'Carlos Ospina' });
});

afterEach(() => {
	vi.useRealTimers();
});

// An order on its way to the client, worth enough for every payment a test collects on it.
async function onTheRoad(fields: Record<string, unknown> = {}): Promise<number> {
	const line = { product_id: await fixture.product(), qty: 1, unit_price: 5_000_000 };
	return fixture.order({ status: 'OUT_FOR_DELIVERY', order_items: [line], ...fields });
}

// A payment recorded from Despachos by `actor`: a «Pago» of $680.000 in cash today, unless told.
async function collect(actor: Actor, orderId: number, fields: Record<string, string> = {}) {
	const payment = {
		order_id: String(orderId),
		concept: 'INSTALLMENT',
		payment_method: 'CASH',
		amount: '680.000',
		movement_date: '2026-11-20',
		...fields
	};
	const result = await recordOrderPayment(db, payment, actor);
	if (!result.ok) {
		throw new Error(JSON.stringify(result));
	}
	return result.id;
}

// An order back at OUT_FOR_PICKUP holding a $200.000 deposit the office took, for the driver to return.
async function depositToReturn(): Promise<number> {
	const orderId = await onTheRoad({ status: 'OUT_FOR_PICKUP', deposit_amount: 200000 });
	await fixture.payment(orderId, { concept: 'SECURITY_DEPOSIT', amount: '200.000' });
	return orderId;
}

const today = () => ({ username: driver.username, from: '2026-11-20', to: '2026-11-20' });

test('Por entregar is the cash the person collected less the cash they gave back', async () => {
	await collect(driver, await onTheRoad());
	const deposit = { concept: 'SECURITY_DEPOSIT', amount: '300.000' };
	await collect(driver, await onTheRoad({ deposit_amount: 300000 }), deposit);
	await collect(driver, await depositToReturn(), { concept: 'DEPOSIT_REFUND', amount: '200.000' });
	expect((await getCashStatement(db, today(), driver)).pending).toBe(780000);
});

test('transfers never count: that money is in the bank', async () => {
	await collect(driver, await onTheRoad(), { payment_method: 'TRANSFER' });
	await collect(driver, await depositToReturn(), {
		concept: 'DEPOSIT_REFUND',
		amount: '200.000',
		payment_method: 'TRANSFER',
		bank_account: 'Bancolombia 123'
	});
	expect((await getCashStatement(db, today(), driver)).pending).toBe(0);
});

test("the manager's offset of the person's movement comes off their tab, not the manager's own", async () => {
	const collected = await collect(driver, await onTheRoad());
	await fixture.payment(await onTheRoad(), { amount: '50.000' });
	const offset = { reverses_id: String(collected), payment_method: 'CASH' };
	await recordOffset(db, { ...offset, movement_date: '2026-11-20' }, MANAGER);
	expect((await getCashStatement(db, today(), driver)).pending).toBe(0);
});

type HandoverRow = { username: string; amount: number; date: string; note?: string };

async function addHandover({ username, amount, date, note }: HandoverRow): Promise<void> {
	const input = { username, amount: String(amount), handover_date: date, note };
	expect(await recordHandover(db, input, MANAGER)).toMatchObject({ ok: true });
}

test('Por entregar is all-time, whatever the range, less every handover', async () => {
	const orderId = await onTheRoad();
	await collect(driver, orderId, { movement_date: '2026-11-02' });
	await collect(driver, orderId, { amount: '120.000' });
	await addHandover({ username: driver.username, amount: 600000, date: '2026-11-03' });
	const statement = await getCashStatement(db, today(), driver);
	expect(statement.pending).toBe(200000);
});

test("the range lists the person's movements grouped by order, transfers marked as not counting", async () => {
	const first = await onTheRoad({ deposit_amount: 300000 });
	const second = await onTheRoad();
	await collect(driver, first, { movement_date: '2026-11-19' });
	await collect(driver, second, { amount: '90.000' });
	await collect(driver, first, {
		concept: 'SECURITY_DEPOSIT',
		amount: '300.000',
		payment_method: 'TRANSFER'
	});
	await fixture.payment(second, { amount: '10.000' });
	await collect(driver, first, { movement_date: '2026-11-21' });
	const statement = await getCashStatement(db, today(), driver);
	expect(statement.groups).toEqual([
		{
			orderId: first,
			receivableId: null,
			movements: [
				{
					id: 3,
					concept: 'SECURITY_DEPOSIT',
					paymentMethod: 'TRANSFER',
					amount: 300000,
					movementDate: '2026-11-20',
					receiptNumber: 3,
					isCounted: false,
					description: null,
					recordedBy: driver.username
				}
			]
		},
		{
			orderId: second,
			receivableId: null,
			movements: [
				{
					id: 2,
					concept: 'INSTALLMENT',
					paymentMethod: 'CASH',
					amount: 90000,
					movementDate: '2026-11-20',
					receiptNumber: 2,
					isCounted: true,
					description: null,
					recordedBy: driver.username
				}
			]
		}
	]);
});

test("the range lists the person's handovers, and only theirs", async () => {
	const seller = await fixture.employee({ roles: ['SALES'] });
	await addHandover({ username: driver.username, amount: 500000, date: '2026-11-01' });
	await addHandover({
		username: driver.username,
		amount: 600000,
		date: '2026-11-03',
		note: 'Faltaron $80.000'
	});
	await addHandover({ username: seller.username, amount: 100000, date: '2026-11-03' });
	const statement = await getCashStatement(
		db,
		{ username: driver.username, from: '2026-11-02', to: '2026-11-20' },
		driver
	);
	expect(statement.handovers).toEqual([
		{
			id: 2,
			amount: 600000,
			handoverDate: '2026-11-03',
			note: 'Faltaron $80.000',
			recordedBy: 'manager'
		}
	]);
});

async function statusOf(promise: Promise<unknown>): Promise<number | undefined> {
	try {
		await promise;
		return undefined;
	} catch (thrown) {
		return isHttpError(thrown) ? thrown.status : undefined;
	}
}

test('a non-manager reads only their own tab; the manager reads anyone who has one', async () => {
	const seller = await fixture.employee({ roles: ['SALES'] });
	const sellersTab = { ...today(), username: seller.username };
	expect(await statusOf(getCashStatement(db, sellersTab, driver))).toBe(403);
	expect(await statusOf(getCashStatement(db, sellersTab, seller))).toBeUndefined();
	expect(await statusOf(getCashStatement(db, sellersTab, MANAGER))).toBeUndefined();
	expect(await statusOf(getCashStatement(db, sellersTab, null))).toBe(401);
});

const tabOf = (actor: Actor) => ({ ...today(), username: actor.username });

test('managers and admins have no tab, nor does the warehouse, which takes no cash', async () => {
	const manager = await fixture.employee({ roles: ['MANAGER'] });
	const boss = await fixture.employee({ roles: ['SALES', 'MANAGER'] });
	const warehouse = await fixture.employee({ roles: ['WAREHOUSE'] });
	expect(await statusOf(getCashStatement(db, tabOf(manager), manager))).toBe(404);
	expect(await statusOf(getCashStatement(db, tabOf(boss), boss))).toBe(404);
	expect(await statusOf(getCashStatement(db, tabOf(warehouse), warehouse))).toBe(403);
	expect(await statusOf(getCashStatement(db, { ...today(), username: 'nadie' }, manager))).toBe(
		404
	);
});

// A login of nobody on payroll: its tab goes by its username.
async function loginWithoutEmployee(username: string, roles: Role[]): Promise<void> {
	const login = { username, roles, employee_id: '', password: TEST_PASSWORD };
	const result = await createLogin({ db, pepper: TEST_PEPPER }, login, ADMIN);
	if (!result.ok) {
		throw new Error(result.message);
	}
}

async function deactivate({ username }: Actor): Promise<void> {
	const login = database.prepare('select id from users where username = ?').get(username);
	const result = await deactivateLogin(db, { id: String(login?.id) }, ADMIN);
	if (!result.ok) {
		throw new Error(result.message);
	}
}

test('the people with a tab are the drivers and Sales reps who are not managers, by name; a deactivated one only while they hold cash', async () => {
	const seller = await fixture.employee({ roles: ['SALES'], full_name: 'Ana Restrepo' });
	await fixture.employee({ roles: ['WAREHOUSE'] });
	await fixture.employee({ roles: ['SALES', 'MANAGER'] });
	await fixture.employee({ roles: ['ADMIN', 'DRIVER'] });
	await deactivate(await fixture.employee({ roles: ['DRIVER'] }));
	await loginWithoutEmployee('ayudante', ['WAREHOUSE', 'DRIVER']);
	const leaving = await fixture.employee({ roles: ['DRIVER'], full_name: 'Wilson Mejía' });
	await collect(leaving, await onTheRoad());
	await deactivate(leaving);
	expect(await listPeopleWithTab(db, MANAGER)).toEqual([
		{ username: seller.username, name: 'Ana Restrepo', pending: 0 },
		{ username: 'ayudante', name: 'ayudante', pending: 0 },
		{ username: driver.username, name: 'Carlos Ospina', pending: 0 },
		{ username: leaving.username, name: 'Wilson Mejía', pending: 680000 }
	]);
	expect(await statusOf(listPeopleWithTab(db, driver))).toBe(403);
});

test('the range is today unless given; an unreadable end is today too', async () => {
	const yesterdays = await onTheRoad();
	const todays = await onTheRoad();
	await collect(driver, yesterdays, { movement_date: '2026-11-19' });
	await collect(driver, todays);
	const statement = await getCashStatement(db, { username: driver.username, from: 'ayer' }, driver);
	expect(statement.range).toEqual({ from: '2026-11-20', to: '2026-11-20' });
	expect(statement.groups.map(({ orderId }) => orderId)).toEqual([todays]);
});

test('a recorded handover lowers the tab by the amount received; a shortfall stays on it', async () => {
	await collect(driver, await onTheRoad());
	const result = await recordHandover(
		db,
		{ username: driver.username, amount: '600.000', handover_date: '2026-11-20', note: 'Faltaron' },
		MANAGER
	);
	expect(result).toEqual({ ok: true, id: 1 });
	const statement = await getCashStatement(db, today(), driver);
	expect(statement.pending).toBe(80000);
	expect(statement.handovers).toEqual([
		{ id: 1, amount: 600000, handoverDate: '2026-11-20', note: 'Faltaron', recordedBy: 'manager' }
	]);
});

test('only a manager or an admin records a handover, and only for someone with a tab', async () => {
	const seller = await fixture.employee({ roles: ['SALES'] });
	const manager = await fixture.employee({ roles: ['MANAGER'] });
	const handover = { username: driver.username, amount: '100.000', handover_date: '2026-11-20' };
	expect(await statusOf(recordHandover(db, handover, driver))).toBe(403);
	expect(await statusOf(recordHandover(db, handover, seller))).toBe(403);
	expect(await statusOf(recordHandover(db, handover, null))).toBe(401);
	expect(await recordHandover(db, handover, ADMIN)).toEqual({ ok: true, id: 1 });
	expect(
		await recordHandover(db, { ...handover, username: manager.username }, MANAGER)
	).toMatchObject({
		ok: false,
		errors: { username: 'Esa persona no tiene efectivo por entregar' }
	});
	expect(await recordHandover(db, { ...handover, amount: '0' }, MANAGER)).toMatchObject({
		ok: false,
		errors: { amount: 'Escribe un valor mayor que cero' }
	});
	expect((await getCashStatement(db, today(), MANAGER)).pending).toBe(-100000);
});

// «Salida» of supplies in cash, paid out of the driver's tab unless told otherwise.
function supplies(fields: Record<string, string> = {}) {
	return {
		direction: 'OUT',
		concept: 'SUPPLIES_EXPENSE',
		description: 'Compra de jabón y desinfectante',
		payee: 'Almacén Éxito Laureles',
		payment_method: 'CASH',
		amount: '85.000',
		movement_date: '2026-11-20',
		paid_by: driver.username,
		...fields
	};
}

test('an expense «Pagado por» the person comes off their tab and shows in their statement, recorded by the manager', async () => {
	await collect(driver, await onTheRoad());
	await recordMovement(db, supplies(), MANAGER);
	const statement = await getCashStatement(db, today(), driver);
	expect(statement.pending).toBe(595000);
	expect(statement.groups[0]).toEqual({
		orderId: null,
		receivableId: null,
		movements: [
			{
				id: 2,
				concept: 'SUPPLIES_EXPENSE',
				paymentMethod: 'CASH',
				amount: -85000,
				movementDate: '2026-11-20',
				receiptNumber: 1,
				isCounted: true,
				description: 'Compra de jabón y desinfectante',
				recordedBy: 'manager'
			}
		]
	});
	expect(await listPeopleWithTab(db, MANAGER)).toEqual([
		{ username: driver.username, name: 'Carlos Ospina', pending: 595000 }
	]);
});

test('the offset of an expense «Pagado por» the person lands on their tab and restores it', async () => {
	await collect(driver, await onTheRoad());
	const expense = await recordMovement(db, supplies(), MANAGER);
	await recordOffset(
		db,
		{
			reverses_id: String(expense.ok ? expense.id : 0),
			description: 'Corrige el comprobante de egreso # 0001',
			payee: 'Almacén Éxito Laureles',
			payment_method: 'CASH',
			movement_date: '2026-11-20'
		},
		MANAGER
	);
	const statement = await getCashStatement(db, today(), driver);
	expect(statement.pending).toBe(680000);
	expect(statement.groups.flatMap(({ movements }) => movements.map(({ id }) => id))).toEqual([
		3, 2, 1
	]);
});

test('an expense without «Pagado por» leaves every tab unchanged', async () => {
	const seller = await fixture.employee({ roles: ['SALES'], full_name: 'Diana Zuluaga' });
	await collect(driver, await onTheRoad());
	await recordMovement(db, supplies({ description: 'Jabón', paid_by: '' }), MANAGER);
	expect((await getCashStatement(db, today(), driver)).pending).toBe(680000);
	expect(await listPeopleWithTab(db, MANAGER)).toEqual([
		{ username: driver.username, name: 'Carlos Ospina', pending: 680000 },
		{ username: seller.username, name: 'Diana Zuluaga', pending: 0 }
	]);
});
