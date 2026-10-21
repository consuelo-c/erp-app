import { isHttpError } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import {
	getCashBook,
	getMovement,
	getReceipt,
	movementSchema,
	movementStatements,
	recordMovement,
	recordOffset,
	getOffsetOriginal,
	type Movement
} from './cash';

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
	const correction = 'Corrige el comprobante de egreso # 0001';
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
			`insert into payroll_runs (employee_id, status, week_number, period_start, period_end, payment_date, employee_snapshot, prepared_by, earnings, deductions, settings_snapshot, total_earnings, total_deductions, net_pay, created_at, created_by, updated_at, updated_by) values (?, 'PAID', ?, ?, '2026-10-17', '2026-10-17', ?, 'gerente', '{}', '{}', '{}', 0, 0, 0, ${AUDIT})`
		)
		.run(id, week, `2026-W${week}`, JSON.stringify({ full_name: employee }));
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

test("a movement's detail has what its receipt prints, plus who recorded it and when", async () => {
	const attributes = {
		description: 'Compra de jabón',
		bank_account: 'Nequi 300',
		notes: 'Con IVA'
	};
	await record({ ...expense, payee: 'Almacén La Gloria', payment_method: 'TRANSFER', attributes });
	expect(await getMovement(db, 1, manager)).toEqual({
		id: 1,
		movementDate: '2026-10-17',
		concept: 'OTHER_EXPENSE',
		amount: -45000,
		method: 'TRANSFER',
		otherMethod: null,
		weekNumber: null,
		employeeName: null,
		payee: 'Almacén La Gloria',
		description: 'Compra de jabón',
		bankAccount: 'Nequi 300',
		notes: 'Con IVA',
		recordedBy: 'gerente',
		recordedAt: expect.any(Number),
		receiptNumber: 1,
		reverses: null,
		reversedBy: null,
		settlement: null
	});
	expect(await getMovement(db, '1', manager)).toMatchObject({ id: 1 });
	expect(await getMovement(db, 2, manager)).toBeNull();
	expect(await getMovement(db, 'uno', manager)).toBeNull();
});

test("a PAYROLL movement's detail names the week and the employee the settlement kept", async () => {
	await record(payroll(insertRun({ employee: 'Ana Pérez', week: 42 }), -480000));
	database.exec("update employees set full_name = 'Ana Pérez Gómez'");
	expect(await getMovement(db, 1, manager)).toMatchObject({
		weekNumber: 42,
		employeeName: 'Ana Pérez',
		payee: null,
		settlement: { employeeId: 1, periodStart: '2026-W42' }
	});
});

test('an offsetting movement names the one it corrects, and the corrected one names it', async () => {
	await record(income);
	await record(expense);
	await record({ ...expense, amount: 45000, reverses_id: 2 });
	expect(await getMovement(db, 2, manager)).toMatchObject({
		reverses: null,
		reversedBy: { amount: 45000, receiptNumber: 2 }
	});
	expect(await getMovement(db, 3, manager)).toMatchObject({
		reverses: { amount: -45000, receiptNumber: 1 },
		reversedBy: null
	});
	expect(await getMovement(db, 1, manager)).toMatchObject({ reverses: null, reversedBy: null });
});

test("only MANAGER and ADMIN open a movement's detail", async () => {
	await record(expense);
	const actor: Actor = { ...manager, roles: ['SALES'] };
	await expect(getMovement(db, 1, actor)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
});

test("a movement's receipt carries the company's header from settings", async () => {
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	await record(expense);
	expect(await getReceipt(db, 1, manager)).toMatchObject({
		movement: { id: 1, receiptNumber: 1 },
		company: { COMPANY_NAME: 'Banquetes Consuelo C' }
	});
	await expect(getReceipt(db, 2, manager)).rejects.toSatisfy((thrown) => isHttpError(thrown, 404));
	const actor: Actor = { ...manager, roles: ['SALES'] };
	await expect(getReceipt(db, 1, actor)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
});

// The movement entry tab as it posts: every field as text.
const typedExpense = {
	direction: 'OUT',
	description: 'Compra de jabón y desinfectante',
	payee: 'Almacén Éxito Laureles',
	payment_method: 'CASH',
	amount: '$48.500',
	movement_date: '2026-10-20',
	notes: ''
};

function storedMovement(id: number) {
	return { ...database.prepare('select * from cash_movements where id = ?').get(id) };
}

test('«Salida» saves an OTHER_EXPENSE with a negative amount, and «Entrada» an OTHER_INCOME', async () => {
	expect(await recordMovement(db, typedExpense, manager)).toEqual({ ok: true, id: 1 });
	expect(storedMovement(1)).toMatchObject({
		concept: 'OTHER_EXPENSE',
		amount: -48500,
		payment_method: 'CASH',
		movement_date: '2026-10-20',
		payee: 'Almacén Éxito Laureles',
		entity_type: null,
		attributes: '{"description":"Compra de jabón y desinfectante"}',
		created_by: 'gerente'
	});
	await recordMovement(db, { ...typedExpense, direction: 'IN', amount: '120000' }, manager);
	expect(storedMovement(2)).toMatchObject({ concept: 'OTHER_INCOME', amount: 120000 });
});

test('saving fails without a description, a payee or a value greater than zero', async () => {
	const missing = { ...typedExpense, description: ' ', payee: '', amount: '0' };
	expect(await recordMovement(db, missing, manager)).toMatchObject({
		ok: false,
		errors: {
			description: 'Escribe la descripción',
			payee: 'Escribe a quién se le pagó',
			amount: 'Escribe un valor mayor que cero'
		}
	});
	expect(storedMovement(1)).toEqual({});
});

test('«Otro» needs which method, kept in attributes.other_method', async () => {
	const other = { ...typedExpense, payment_method: 'OTHER' };
	expect(await recordMovement(db, other, manager)).toMatchObject({
		ok: false,
		errors: { other_method: 'Escribe el medio de pago' }
	});
	await recordMovement(db, { ...other, other_method: 'Nequi' }, manager);
	expect(JSON.parse(String(storedMovement(1).attributes))).toMatchObject({ other_method: 'Nequi' });
});

test('only an outflow by transfer needs, and keeps, the destination account', async () => {
	const transfer = { ...typedExpense, payment_method: 'TRANSFER' };
	expect(await recordMovement(db, transfer, manager)).toMatchObject({
		ok: false,
		errors: { bank_account: 'Escribe la cuenta de destino' }
	});
	const account = 'Bancolombia ahorros 123-456789-01';
	await recordMovement(db, { ...transfer, bank_account: account }, manager);
	await recordMovement(db, { ...transfer, direction: 'IN', bank_account: account }, manager);
	expect(JSON.parse(String(storedMovement(1).attributes))).toMatchObject({ bank_account: account });
	expect(JSON.parse(String(storedMovement(2).attributes))).not.toHaveProperty('bank_account');
});

test('only MANAGER and ADMIN record a movement, even calling the service directly', async () => {
	for (const role of ['SALES', 'WAREHOUSE', 'DRIVER'] as const) {
		const actor: Actor = { ...manager, roles: [role] };
		await expect(recordMovement(db, typedExpense, actor)).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
	}
	expect(storedMovement(1)).toEqual({});
});

// The offsetting movement as the pre-filled tab posts it: the original's id comes from `?corrige=`.
const typedCorrection = {
	reverses_id: '1',
	description: 'Corrige el comprobante de egreso # 0001',
	payee: 'Almacén Éxito Laureles',
	payment_method: 'CASH',
	movement_date: '2026-10-21',
	notes: ''
};

test('an offset keeps the concept and link, flips the amount and points at the original', async () => {
	await recordMovement(db, typedExpense, manager);
	// Tipo and Valor aren't the form's to set: a tampered one changes nothing.
	const tampered = { ...typedCorrection, direction: 'OUT', amount: '1' };
	expect(await recordOffset(db, tampered, manager)).toEqual({ ok: true, id: 2 });
	expect(storedMovement(2)).toMatchObject({
		concept: 'OTHER_EXPENSE',
		amount: 48500,
		entity_type: null,
		entity_id: null,
		payee: 'Almacén Éxito Laureles',
		movement_date: '2026-10-21',
		reverses_id: 1,
		receipt_number: 1,
		attributes: '{"description":"Corrige el comprobante de egreso # 0001"}'
	});
	expect(storedMovement(1)).toMatchObject({ amount: -48500, receipt_number: 1 });
});

test('a movement is offset once, and a correction never', async () => {
	await recordMovement(db, typedExpense, manager);
	await recordOffset(db, typedCorrection, manager);
	expect(await recordOffset(db, typedCorrection, manager)).toMatchObject({
		ok: false,
		message: 'Ese movimiento ya tiene su movimiento contrario.'
	});
	expect(await recordOffset(db, { ...typedCorrection, reverses_id: '2' }, manager)).toMatchObject({
		ok: false
	});
	expect(await recordOffset(db, { ...typedCorrection, reverses_id: '9' }, manager)).toMatchObject({
		ok: false,
		message: 'Ese movimiento no existe.'
	});
	expect(receiptNumbers()).toHaveLength(2);
	await expect(getOffsetOriginal(db, 1, manager)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 400)
	);
	await expect(getOffsetOriginal(db, 2, manager)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 400)
	);
});

test("a PAYROLL movement's offset keeps its link; the settlement stays PAID", async () => {
	const runId = insertRun({ employee: 'Ana Pérez', week: 42 });
	await record(payroll(runId, -480000));
	const correction = { reverses_id: '1', payment_method: 'TRANSFER', movement_date: '2026-10-21' };
	expect(await recordOffset(db, correction, manager)).toEqual({ ok: true, id: 2 });
	expect(storedMovement(2)).toMatchObject({
		concept: 'PAYROLL',
		amount: 480000,
		entity_type: 'PAYROLL_RUN',
		entity_id: runId,
		payee: null,
		reverses_id: 1
	});
	const run = database.prepare('select status from payroll_runs where id = ?').get(runId);
	expect(run).toMatchObject({ status: 'PAID' });
});

test('an original and its correction net to zero, both under their concept', async () => {
	await recordMovement(db, typedExpense, manager);
	await recordOffset(db, typedCorrection, manager);
	const filters = { from: '2026-10-01', to: '2026-10-31', concept: 'OTHER_EXPENSE' };
	const { entries, totals } = await getCashBook(db, filters, manager);
	expect(entries).toHaveLength(2);
	expect(totals).toEqual({ inflow: 48500, outflow: 48500, net: 0 });
});

test('only MANAGER and ADMIN record an offsetting movement', async () => {
	await recordMovement(db, typedExpense, manager);
	const actor: Actor = { ...manager, roles: ['SALES'] };
	await expect(recordOffset(db, typedCorrection, actor)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 403)
	);
});
