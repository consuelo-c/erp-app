import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { getCashBook, movementSchema, movementStatements, type Movement } from './cash';

const manager: Actor = { username: 'gerente', employeeId: null, roles: ['MANAGER'], kind: 'user' };

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-17T17:00:00Z')); // noon in Bogotá
	({ db, database } = createMemoryD1());
});

afterEach(() => {
	vi.useRealTimers();
});

const expense: Movement = {
	concept: 'OTHER_EXPENSE',
	payment_method: 'CASH',
	amount: -45000,
	movement_date: '2026-10-17',
	entity_type: null,
	entity_id: null,
	attributes: { description: 'Compra de jabón y desinfectante' }
};

const income: Movement = {
	...expense,
	concept: 'OTHER_INCOME',
	amount: 120000,
	attributes: { description: 'Venta de manteles usados' }
};

async function record(movement: Movement): Promise<void> {
	await db.batch(movementStatements(db, manager, movement));
}

function receiptNumbers() {
	return database
		.prepare('select amount, receipt_number from cash_movements order by id')
		.all()
		.map((row) => ({ ...row }));
}

test('inflows and outflows are numbered apart: egreso 1, recibo 1, egreso 2', async () => {
	await record(expense);
	await record(income);
	await record(expense);
	expect(receiptNumbers()).toEqual([
		{ amount: -45000, receipt_number: 1 },
		{ amount: 120000, receipt_number: 1 },
		{ amount: -45000, receipt_number: 2 }
	]);
});

test('an offsetting movement takes the next number of its own sign; the original keeps its own', async () => {
	await record(expense);
	await record(income);
	const correction = 'Corrige el comprobante de egreso N.º 0001';
	await record({
		...expense,
		amount: 45000,
		reverses_id: 1,
		attributes: { description: correction }
	});
	expect(receiptNumbers()).toEqual([
		{ amount: -45000, receipt_number: 1 },
		{ amount: 120000, receipt_number: 1 },
		{ amount: 45000, receipt_number: 2 }
	]);
});

test('each movement writes its CREATED event, pointing at its row', async () => {
	await record(expense);
	await record(income);
	const events = database
		.prepare(
			"select entity_type, entity_id, action from events where entity_type = 'CASH_MOVEMENT'"
		)
		.all()
		.map((row) => ({ ...row }));
	expect(events).toEqual([
		{ entity_type: 'CASH_MOVEMENT', entity_id: 1, action: 'CREATED' },
		{ entity_type: 'CASH_MOVEMENT', entity_id: 2, action: 'CREATED' }
	]);
});

test('a standalone movement needs a description; a PAYROLL one does without', () => {
	for (const concept of ['OTHER_INCOME', 'OTHER_EXPENSE'] as const) {
		expect(movementSchema.safeParse({ ...expense, concept, attributes: {} }).success).toBe(false);
	}
	const payroll = { ...expense, concept: 'PAYROLL', entity_type: 'PAYROLL_RUN', entity_id: 1 };
	expect(movementSchema.safeParse({ ...payroll, attributes: {} }).success).toBe(true);
});

const AUDIT = "0, 'gerente', 0, 'gerente'";

// A paid settlement to link a PAYROLL movement to: only what the cash book reads off it.
function insertRun({ employee, week }: { employee: string; week: number }): number {
	database.exec(
		`insert or ignore into employees (full_name, id_number, created_at, created_by, updated_at, updated_by) values ('${employee}', '${employee}', ${AUDIT})`
	);
	const { id } = database.prepare('select id from employees where full_name = ?').get(employee)!;
	const { lastInsertRowid } = database
		.prepare(
			`insert into payroll_runs (employee_id, status, week_number, period_start, period_end, payment_date, employee_snapshot, prepared_by, earnings, deductions, settings_snapshot, total_earnings, total_deductions, net_pay, created_at, created_by, updated_at, updated_by) values (?, 'PAID', ?, ?, '2026-10-17', '2026-10-17', '{}', 'gerente', '{}', '{}', '{}', 0, 0, 0, ${AUDIT})`
		)
		.run(id, week, `2026-W${week}`);
	return Number(lastInsertRowid);
}

function payroll(runId: number, amount: number): Movement {
	return {
		concept: 'PAYROLL',
		payment_method: 'TRANSFER',
		amount,
		movement_date: '2026-10-17',
		entity_type: 'PAYROLL_RUN',
		entity_id: runId,
		attributes: { bank_account: 'Bancolombia 123' }
	};
}

async function seedBook(): Promise<void> {
	await record({ ...expense, payee: 'Almacén La Gloria', movement_date: '2026-10-03' });
	await record({ ...income, payee: 'Silvia Ruiz', movement_date: '2026-09-30' });
	await record(payroll(insertRun({ employee: 'Ana Pérez', week: 42 }), -480000));
	await record(payroll(insertRun({ employee: 'Jorge Salamanca', week: 42 }), -390000));
	const notes = { description: 'Venta de sillas dadas de baja', notes: 'Pagó con jabón de regalo' };
	await record({ ...income, movement_date: '2026-10-10', attributes: notes });
}

async function bookIds(filters: Record<string, string> = {}): Promise<number[]> {
	return (await getCashBook(db, filters, manager)).entries.map((entry) => entry.id);
}

test("by default the book shows this month's movements, newest first, with link and who recorded them", async () => {
	await seedBook();
	const book = await getCashBook(db, {}, manager);
	expect(book.filters).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
	expect(book.entries.map((entry) => entry.id)).toEqual([4, 3, 5, 1]);
	expect(book.entries[1]).toEqual({
		id: 3,
		movementDate: '2026-10-17',
		concept: 'PAYROLL',
		amount: -480000,
		method: 'TRANSFER',
		weekNumber: 42,
		employeeName: 'Ana Pérez',
		payee: null,
		description: null,
		recordedBy: 'gerente',
		recordedAt: expect.any(Number),
		receiptNumber: 2
	});
	expect(book.entries[3]).toMatchObject({
		payee: 'Almacén La Gloria',
		description: 'Compra de jabón y desinfectante',
		weekNumber: null,
		employeeName: null
	});
});

test('each filter narrows the book on its own', async () => {
	await seedBook();
	expect(await bookIds({ from: '2026-09-01', to: '2026-09-30' })).toEqual([2]);
	expect(await bookIds({ concept: 'PAYROLL' })).toEqual([4, 3]);
	expect(await bookIds({ method: 'CASH' })).toEqual([5, 1]);
	expect(await bookIds({ direction: 'IN' })).toEqual([5]);
	expect(await bookIds({ direction: 'OUT' })).toEqual([4, 3, 1]);
	expect(await bookIds({ employee: 'ana pé' })).toEqual([3]);
	expect(await bookIds({ min: '$100.000', max: '400.000' })).toEqual([4, 5]);
	// The free text looks in the payee, the description and the notes.
	expect(await bookIds({ text: 'gloria' })).toEqual([1]);
	expect(await bookIds({ text: 'jabón' })).toEqual([5, 1]);
	expect(await bookIds({ text: '%' })).toEqual([]);
});

test('a tampered filter is ignored, not an error', async () => {
	await seedBook();
	expect(await bookIds({ concept: 'BOGUS', from: 'ayer', min: 'mucho' })).toEqual([4, 3, 5, 1]);
});

test('the three totals follow the filters, and net is in minus out', async () => {
	await seedBook();
	expect((await getCashBook(db, {}, manager)).totals).toEqual({
		inflow: 120000,
		outflow: 915000,
		net: -795000
	});
	expect((await getCashBook(db, { concept: 'PAYROLL' }, manager)).totals).toEqual({
		inflow: 0,
		outflow: 870000,
		net: -870000
	});
	expect((await getCashBook(db, { text: 'nada así' }, manager)).totals).toEqual({
		inflow: 0,
		outflow: 0,
		net: 0
	});
});

test('only MANAGER and ADMIN open the cash book', async () => {
	for (const role of ['SALES', 'WAREHOUSE', 'DRIVER'] as const) {
		const actor: Actor = { ...manager, roles: [role] };
		await expect(getCashBook(db, {}, actor)).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
	}
});
