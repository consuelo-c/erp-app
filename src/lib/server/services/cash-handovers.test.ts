import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Actor, Role } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { movementStatements, type Movement } from './cash';
import { getCashStatement, listPeopleWithTab } from './cash-handovers';

const manager: Actor = { username: 'gerente', employeeId: null, roles: ['MANAGER'], kind: 'user' };
const driver: Actor = { username: 'conductor', employeeId: null, roles: ['DRIVER'], kind: 'user' };

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-20T17:00:00Z')); // noon in Bogotá
	({ db, database } = createMemoryD1());
	addLogin('gerente', ['MANAGER']);
	addLogin('conductor', ['DRIVER']);
});

afterEach(() => {
	vi.useRealTimers();
});

function addLogin(username: string, roles: Role[], isActive = true): number {
	const { lastInsertRowid } = database
		.prepare(
			`insert into users (username, roles, password_hash, password_salt, password_iterations, active,
				created_at, created_by, updated_at, updated_by) values (?, ?, 'hash', 'salt', 1, ?, 0, 'admin', 0, 'admin')`
		)
		.run(username, JSON.stringify(roles), Number(isActive));
	return Number(lastInsertRowid);
}

const payment: Movement = {
	concept: 'INSTALLMENT',
	payment_method: 'CASH',
	amount: 680000,
	movement_date: '2026-11-20',
	entity_type: 'ORDER',
	entity_id: 1043,
	attributes: {}
};

async function record(actor: Actor, movement: Partial<Movement>): Promise<void> {
	await db.batch(movementStatements(db, actor, { ...payment, ...movement }));
}

const today = { username: 'conductor', from: '2026-11-20', to: '2026-11-20' };

test('Por entregar is the cash the person collected less the cash they gave back', async () => {
	await record(driver, {});
	await record(driver, { concept: 'SECURITY_DEPOSIT', amount: 300000, entity_id: 1044 });
	await record(driver, { concept: 'DEPOSIT_REFUND', amount: -200000, entity_id: 1045 });
	expect((await getCashStatement(db, today, driver)).pending).toBe(780000);
});

test('transfers never count: that money is in the bank', async () => {
	await record(driver, { payment_method: 'TRANSFER' });
	await record(driver, { concept: 'DEPOSIT_REFUND', amount: -200000, payment_method: 'TRANSFER' });
	expect((await getCashStatement(db, today, driver)).pending).toBe(0);
});

test("the manager's offset of the person's movement comes off their tab, not the manager's own", async () => {
	await record(driver, {});
	await record(manager, { concept: 'INSTALLMENT', amount: 50000, entity_id: 1050 });
	await record(manager, { amount: -680000, reverses_id: 1 });
	expect((await getCashStatement(db, today, driver)).pending).toBe(0);
});

// Recording a handover is #622's: until it lands, a test writes the row itself.
type HandoverRow = { username: string; amount: number; date: string; note?: string };

function addHandover({ username, amount, date, note }: HandoverRow) {
	database
		.prepare(
			`insert into cash_handovers (user_id, amount, handover_date, note, created_at, created_by,
				updated_at, updated_by) select id, ?, ?, ?, 0, 'gerente', 0, 'gerente' from users where username = ?`
		)
		.run(amount, date, note ?? null, username);
}

test('Por entregar is all-time, whatever the range, less every handover', async () => {
	await record(driver, { movement_date: '2026-11-02' });
	await record(driver, { amount: 120000, movement_date: '2026-11-20' });
	addHandover({ username: 'conductor', amount: 600000, date: '2026-11-03' });
	const statement = await getCashStatement(db, today, driver);
	expect(statement.pending).toBe(200000);
});

test("the range lists the person's movements grouped by order, transfers marked as not counting", async () => {
	await record(driver, { movement_date: '2026-11-19' });
	await record(driver, { entity_id: 1044, amount: 90000 });
	await record(driver, { concept: 'SECURITY_DEPOSIT', amount: 300000, payment_method: 'TRANSFER' });
	await record(manager, { entity_id: 1044, amount: 10000 });
	await record(driver, { movement_date: '2026-11-21' });
	const statement = await getCashStatement(
		db,
		{ username: 'conductor', from: '2026-11-20', to: '2026-11-20' },
		driver
	);
	expect(statement.groups).toEqual([
		{
			orderId: 1043,
			receivableId: null,
			movements: [
				{
					id: 3,
					concept: 'SECURITY_DEPOSIT',
					paymentMethod: 'TRANSFER',
					amount: 300000,
					movementDate: '2026-11-20',
					receiptNumber: 3,
					isCounted: false
				}
			]
		},
		{
			orderId: 1044,
			receivableId: null,
			movements: [
				{
					id: 2,
					concept: 'INSTALLMENT',
					paymentMethod: 'CASH',
					amount: 90000,
					movementDate: '2026-11-20',
					receiptNumber: 2,
					isCounted: true
				}
			]
		}
	]);
});

test("the range lists the person's handovers, and only theirs", async () => {
	addLogin('vendedora', ['SALES']);
	addHandover({ username: 'conductor', amount: 500000, date: '2026-11-01' });
	addHandover({
		username: 'conductor',
		amount: 600000,
		date: '2026-11-03',
		note: 'Faltaron $80.000'
	});
	addHandover({ username: 'vendedora', amount: 100000, date: '2026-11-03' });
	const statement = await getCashStatement(
		db,
		{ username: 'conductor', from: '2026-11-02', to: '2026-11-20' },
		driver
	);
	expect(statement.handovers).toEqual([
		{
			id: 2,
			amount: 600000,
			handoverDate: '2026-11-03',
			note: 'Faltaron $80.000',
			recordedBy: 'gerente'
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
	addLogin('vendedora', ['SALES']);
	const seller: Actor = { ...driver, username: 'vendedora', roles: ['SALES'] };
	const sellersTab = { ...today, username: 'vendedora' };
	expect(await statusOf(getCashStatement(db, sellersTab, driver))).toBe(403);
	expect(await statusOf(getCashStatement(db, sellersTab, seller))).toBeUndefined();
	expect(await statusOf(getCashStatement(db, sellersTab, manager))).toBeUndefined();
	expect(await statusOf(getCashStatement(db, sellersTab, null))).toBe(401);
});

test('managers and admins have no tab, nor does the warehouse, which takes no cash', async () => {
	addLogin('bodega', ['WAREHOUSE']);
	addLogin('jefe', ['SALES', 'MANAGER']);
	const warehouse: Actor = { ...driver, username: 'bodega', roles: ['WAREHOUSE'] };
	const boss: Actor = { ...driver, username: 'jefe', roles: ['SALES', 'MANAGER'] };
	expect(await statusOf(getCashStatement(db, { ...today, username: 'gerente' }, manager))).toBe(
		404
	);
	expect(await statusOf(getCashStatement(db, { ...today, username: 'jefe' }, boss))).toBe(404);
	expect(await statusOf(getCashStatement(db, { ...today, username: 'bodega' }, warehouse))).toBe(
		403
	);
	expect(await statusOf(getCashStatement(db, { ...today, username: 'nadie' }, manager))).toBe(404);
});

test('the people with a tab are the drivers and Sales reps who are not managers, by name; a deactivated one only while they hold cash', async () => {
	database.exec(
		`insert into contacts (full_name, document_id, created_at, created_by, updated_at, updated_by)
			values ('Ana Restrepo', '43000111', 0, 'admin', 0, 'admin');
		insert into employees (contact_id, created_at, created_by, updated_at, updated_by)
			values (1, 0, 'admin', 0, 'admin');`
	);
	const sellerId = addLogin('vendedora', ['SALES']);
	database.prepare('update users set employee_id = 1 where id = ?').run(sellerId);
	addLogin('bodega', ['WAREHOUSE']);
	addLogin('jefe', ['SALES', 'MANAGER']);
	addLogin('admin2', ['ADMIN', 'DRIVER']);
	addLogin('retirado', ['DRIVER'], false);
	addLogin('ayudante', ['WAREHOUSE', 'DRIVER']);
	addLogin('saliente', ['DRIVER'], false);
	await record({ ...driver, username: 'saliente' }, {});
	expect(await listPeopleWithTab(db, manager)).toEqual([
		{ username: 'vendedora', name: 'Ana Restrepo' },
		{ username: 'ayudante', name: 'ayudante' },
		{ username: 'conductor', name: 'conductor' },
		{ username: 'saliente', name: 'saliente' }
	]);
	expect(await statusOf(listPeopleWithTab(db, driver))).toBe(403);
});

test('the range is today unless given; an unreadable end is today too', async () => {
	await record(driver, { movement_date: '2026-11-19' });
	await record(driver, { entity_id: 1044 });
	const statement = await getCashStatement(db, { username: 'conductor', from: 'ayer' }, driver);
	expect(statement.range).toEqual({ from: '2026-11-20', to: '2026-11-20' });
	expect(statement.groups.map(({ orderId }) => orderId)).toEqual([1044]);
});
