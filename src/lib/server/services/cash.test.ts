import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { actorWith, createFixture, MANAGER, SALES } from '../db/fixture';
import { updateEmployee } from './employees';
import { openWeek, recordPayment } from './payroll';
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

let db: D1Database;
let database: DatabaseSync;
let fixture: ReturnType<typeof createFixture>;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-17T17:00:00Z')); // noon in Bogotá
	fixture = createFixture();
	({ db, database } = fixture);
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
	await db.batch(movementStatements(db, MANAGER, movement));
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

type Settlement = { employeeId: number; runId: number };

// Week 42 (12 to 18 October) settled and paid by transfer on the 17th: a non-salary bonus alone,
// no days worked, so its PAYROLL movement is exactly `netPay`.
async function paidSettlement(fields: Record<string, string>, netPay: string): Promise<Settlement> {
	const { employeeId } = await fixture.employee({ roles: ['WAREHOUSE'], ...fields });
	const draft = (await openWeek(db, { employeeId, week: '2026-10-12' }, MANAGER))?.draft ?? null;
	if (null === draft) {
		throw new Error('No draft for week 42');
	}
	const noHours = draft.earnings.flatMap(({ concept, qty }) =>
		null === qty ? [] : [[concept, '0']]
	);
	const form = {
		employee_id: String(employeeId),
		period_start: '2026-10-12',
		week_number: '42',
		payment_date: '2026-10-17',
		...Object.fromEntries(noHours),
		NON_SALARY_BONUS: netPay,
		LOANS: '0',
		OTHER: '0',
		payment_method: 'TRANSFER',
		bank_account: 'Bancolombia 123'
	};
	const result = await recordPayment(db, form, MANAGER);
	if (!result.ok) {
		throw new Error(result.message);
	}
	const run = database.prepare('select id from payroll_runs where employee_id = ?').get(employeeId);
	return { employeeId: Number(employeeId), runId: Number(run?.id) };
}

async function seedBook(): Promise<void> {
	await record({ ...expense, payee: 'Almacén La Gloria', movement_date: '2026-10-03' });
	await record({ ...income, payee: 'Silvia Ruiz', movement_date: '2026-09-30' });
	await paidSettlement({ full_name: 'Ana Pérez' }, '480.000');
	await paidSettlement({ full_name: 'Jorge Salamanca' }, '390.000');
	const notes = { description: 'Venta de sillas dadas de baja', notes: 'Pagó con jabón de regalo' };
	await record({ ...income, movement_date: '2026-10-10', attributes: notes });
}

async function bookIds(filters: Record<string, string> = {}): Promise<number[]> {
	return (await getCashBook(db, filters, MANAGER)).entries.map((entry) => entry.id);
}

test("by default the book shows this month's movements, newest first, with link and who recorded them", async () => {
	await seedBook();
	const book = await getCashBook(db, {}, MANAGER);
	expect(book.filters).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
	expect(book.entries.map((entry) => entry.id)).toEqual([4, 3, 5, 1]);
	expect(book.entries[1]).toEqual({
		id: 3,
		movementDate: '2026-10-17',
		concept: 'PAYROLL',
		amount: -480000,
		method: 'TRANSFER',
		orderId: null,
		receivableId: null,
		weekNumber: 42,
		employeeName: 'Ana Pérez',
		payee: null,
		description: null,
		recordedBy: 'manager',
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
	expect(await bookIds({ concepts: 'PAYROLL' })).toEqual([4, 3]);
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

// A «Pago» by transfer through the order's payment entry.
async function installment(orderId: number, amount = '500.000'): Promise<void> {
	await fixture.payment(orderId, { payment_method: 'TRANSFER', amount });
}

test('an order movement links to its order, which narrows the book and its totals', async () => {
	const orderId = await fixture.order();
	await record(income);
	await installment(orderId);
	await installment(await fixture.order(), '300.000');
	const book = await getCashBook(db, { order: `#${orderId}` }, MANAGER);
	expect(book.entries).toMatchObject([{ id: 2, orderId, weekNumber: null }]);
	expect(book.totals).toEqual({ inflow: 500000, outflow: 0, net: 500000 });
	expect((await getMovement(db, 1, MANAGER))?.orderId).toBeNull();
	expect(await bookIds({ order: 'nada' })).toEqual([3, 2, 1]);
});

test("SALES prints an order movement's receipt, never a standalone one's", async () => {
	const orderId = await fixture.order();
	await record(income);
	await installment(orderId);
	const actor = SALES;
	expect(await getReceipt(db, 2, actor)).toMatchObject({ movement: { id: 2, orderId } });
	await expect(getReceipt(db, 1, actor)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
	for (const role of ['WAREHOUSE', 'DRIVER'] as const) {
		await expect(getReceipt(db, 2, actorWith(role))).rejects.toSatisfy((thrown) =>
			isHttpError(thrown, 403)
		);
	}
});

test('a tampered filter is ignored, not an error', async () => {
	await seedBook();
	expect(await bookIds({ concepts: 'BOGUS', from: 'ayer', min: 'mucho' })).toEqual([4, 3, 5, 1]);
});

test('the three totals follow the filters, and net is in minus out', async () => {
	await seedBook();
	expect((await getCashBook(db, {}, MANAGER)).totals).toEqual({
		inflow: 120000,
		outflow: 915000,
		net: -795000
	});
	expect((await getCashBook(db, { concepts: 'PAYROLL' }, MANAGER)).totals).toEqual({
		inflow: 0,
		outflow: 870000,
		net: -870000
	});
	expect((await getCashBook(db, { text: 'nada así' }, MANAGER)).totals).toEqual({
		inflow: 0,
		outflow: 0,
		net: 0
	});
});

test('only MANAGER and ADMIN open the cash book', async () => {
	for (const role of ['SALES', 'WAREHOUSE', 'DRIVER'] as const) {
		const actor = actorWith(role);
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
	expect(await getMovement(db, 1, MANAGER)).toEqual({
		id: 1,
		movementDate: '2026-10-17',
		concept: 'OTHER_EXPENSE',
		amount: -45000,
		method: 'TRANSFER',
		otherMethod: null,
		orderId: null,
		receivableId: null,
		weekNumber: null,
		employeeName: null,
		payee: 'Almacén La Gloria',
		description: 'Compra de jabón',
		bankAccount: 'Nequi 300',
		notes: 'Con IVA',
		recordedBy: 'manager',
		recordedAt: expect.any(Number),
		receiptNumber: 1,
		reverses: null,
		reversedBy: null,
		settlement: null
	});
	expect(await getMovement(db, '1', MANAGER)).toMatchObject({ id: 1 });
	expect(await getMovement(db, 2, MANAGER)).toBeNull();
	expect(await getMovement(db, 'uno', MANAGER)).toBeNull();
});

test("a PAYROLL movement's detail names the week and the employee the settlement kept", async () => {
	const ana = { full_name: 'Ana Pérez', phone: '3106452118', document_id: '1036452118' };
	const { employeeId } = await paidSettlement(ana, '480.000');
	const renamed = { ...ana, id: String(employeeId), full_name: 'Ana Pérez Gómez' };
	const employment = { monthly_salary: '1.750.905', position: 'Bodega' };
	expect(await updateEmployee(db, { ...renamed, ...employment }, MANAGER)).toMatchObject({
		ok: true
	});
	expect(await getMovement(db, 1, MANAGER)).toMatchObject({
		weekNumber: 42,
		employeeName: 'Ana Pérez',
		payee: null,
		settlement: { employeeId, periodStart: '2026-10-12' }
	});
});

test('an offsetting movement names the one it corrects, and the corrected one names it', async () => {
	await record(income);
	await record(expense);
	await record({ ...expense, amount: 45000, reverses_id: 2 });
	expect(await getMovement(db, 2, MANAGER)).toMatchObject({
		reverses: null,
		reversedBy: { amount: 45000, receiptNumber: 2 }
	});
	expect(await getMovement(db, 3, MANAGER)).toMatchObject({
		reverses: { amount: -45000, receiptNumber: 1 },
		reversedBy: null
	});
	expect(await getMovement(db, 1, MANAGER)).toMatchObject({ reverses: null, reversedBy: null });
});

test("only MANAGER and ADMIN open a movement's detail", async () => {
	await record(expense);
	const actor = SALES;
	await expect(getMovement(db, 1, actor)).rejects.toSatisfy((thrown) => isHttpError(thrown, 403));
});

test("a movement's receipt carries the company's header from settings", async () => {
	await record(expense);
	expect(await getReceipt(db, 1, MANAGER)).toMatchObject({
		movement: { id: 1, receiptNumber: 1 },
		company: { COMPANY_NAME: 'Banquetes Consuelo C' }
	});
	expect(await getReceipt(db, 2, MANAGER)).toBeNull();
	const actor = SALES;
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
	expect(await recordMovement(db, typedExpense, MANAGER)).toEqual({ ok: true, id: 1 });
	expect(storedMovement(1)).toMatchObject({
		concept: 'OTHER_EXPENSE',
		amount: -48500,
		payment_method: 'CASH',
		movement_date: '2026-10-20',
		payee: 'Almacén Éxito Laureles',
		entity_type: null,
		attributes: '{"description":"Compra de jabón y desinfectante"}',
		created_by: 'manager'
	});
	await recordMovement(db, { ...typedExpense, direction: 'IN', amount: '120000' }, MANAGER);
	expect(storedMovement(2)).toMatchObject({ concept: 'OTHER_INCOME', amount: 120000 });
});

test('saving fails without a description, a payee or a value greater than zero', async () => {
	const missing = { ...typedExpense, description: ' ', payee: '', amount: '0' };
	expect(await recordMovement(db, missing, MANAGER)).toMatchObject({
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
	expect(await recordMovement(db, other, MANAGER)).toMatchObject({
		ok: false,
		errors: { other_method: 'Escribe el medio de pago' }
	});
	await recordMovement(db, { ...other, other_method: 'Nequi' }, MANAGER);
	expect(JSON.parse(String(storedMovement(1).attributes))).toMatchObject({ other_method: 'Nequi' });
});

test('a transfer out needs its account, a transfer in may name its bank, and both keep it', async () => {
	const transfer = { ...typedExpense, payment_method: 'TRANSFER' };
	expect(await recordMovement(db, transfer, MANAGER)).toMatchObject({
		ok: false,
		errors: { bank_account: 'Escribe la cuenta de destino' }
	});
	const account = 'Bancolombia ahorros 123-456789-01';
	await recordMovement(db, { ...transfer, bank_account: account }, MANAGER);
	await recordMovement(db, { ...transfer, direction: 'IN', bank_account: 'Davivienda' }, MANAGER);
	await recordMovement(db, { ...typedExpense, bank_account: account }, MANAGER);
	expect(await recordMovement(db, { ...transfer, direction: 'IN' }, MANAGER)).toMatchObject({
		ok: true
	});
	expect(JSON.parse(String(storedMovement(4).attributes))).not.toHaveProperty('bank_account');
	expect(JSON.parse(String(storedMovement(1).attributes))).toMatchObject({ bank_account: account });
	expect(JSON.parse(String(storedMovement(2).attributes))).toMatchObject({
		bank_account: 'Davivienda'
	});
	expect(JSON.parse(String(storedMovement(3).attributes))).not.toHaveProperty('bank_account');
});

test('only MANAGER and ADMIN record a movement, even calling the service directly', async () => {
	for (const role of ['SALES', 'WAREHOUSE', 'DRIVER'] as const) {
		const actor = actorWith(role);
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
	await recordMovement(db, typedExpense, MANAGER);
	// Tipo and Valor aren't the form's to set: a tampered one changes nothing.
	const tampered = { ...typedCorrection, direction: 'OUT', amount: '1' };
	expect(await recordOffset(db, tampered, MANAGER)).toEqual({ ok: true, id: 2 });
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
	await recordMovement(db, typedExpense, MANAGER);
	await recordOffset(db, typedCorrection, MANAGER);
	expect(await recordOffset(db, typedCorrection, MANAGER)).toMatchObject({
		ok: false,
		message: 'Ese movimiento ya tiene su movimiento contrario.'
	});
	expect(await recordOffset(db, { ...typedCorrection, reverses_id: '2' }, MANAGER)).toMatchObject({
		ok: false
	});
	expect(await recordOffset(db, { ...typedCorrection, reverses_id: '9' }, MANAGER)).toMatchObject({
		ok: false,
		message: 'Ese movimiento no existe.'
	});
	expect(receiptNumbers()).toHaveLength(2);
	expect(await getOffsetOriginal(db, 1, MANAGER)).toEqual({
		ok: false,
		message: 'Ese movimiento ya tiene su movimiento contrario.',
		errors: {}
	});
	expect(await getOffsetOriginal(db, 2, MANAGER)).toMatchObject({
		ok: false,
		message: expect.stringMatching(/^Un movimiento contrario no se corrige/)
	});
	expect(await getOffsetOriginal(db, 9, MANAGER)).toBeNull();
});

test("a PAYROLL movement's offset keeps its link; the settlement stays PAID", async () => {
	const { runId } = await paidSettlement({ full_name: 'Ana Pérez' }, '480.000');
	const correction = {
		reverses_id: '1',
		payment_method: 'TRANSFER',
		bank_account: 'Bancolombia',
		movement_date: '2026-10-21'
	};
	expect(await recordOffset(db, correction, MANAGER)).toEqual({ ok: true, id: 2 });
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
	await recordMovement(db, typedExpense, MANAGER);
	await recordOffset(db, typedCorrection, MANAGER);
	const filters = { from: '2026-10-01', to: '2026-10-31', concepts: ['OTHER_EXPENSE'] };
	const { entries, totals } = await getCashBook(db, filters, MANAGER);
	expect(entries).toHaveLength(2);
	expect(totals).toEqual({ inflow: 48500, outflow: 48500, net: 0 });
});

test('only MANAGER and ADMIN record an offsetting movement', async () => {
	await recordMovement(db, typedExpense, MANAGER);
	const actor = SALES;
	await expect(recordOffset(db, typedCorrection, actor)).rejects.toSatisfy((thrown) =>
		isHttpError(thrown, 403)
	);
});

const EXPENSE_CONCEPTS = [
	'TRANSPORT_EXPENSE',
	'SUPPLIES_EXPENSE',
	'RENT',
	'OTHER_EXPENSE'
] as const;

test('«Salida» saves the expense concept it picks, each with its description', async () => {
	for (const [index, concept] of EXPENSE_CONCEPTS.entries()) {
		expect(await recordMovement(db, { ...typedExpense, concept }, MANAGER)).toEqual({
			ok: true,
			id: index + 1
		});
		expect(storedMovement(index + 1)).toMatchObject({
			concept,
			amount: -48500,
			attributes: '{"description":"Compra de jabón y desinfectante"}'
		});
	}
});

test('every expense concept refuses a «Salida» without a description', async () => {
	for (const concept of EXPENSE_CONCEPTS) {
		expect(
			await recordMovement(db, { ...typedExpense, concept, description: '' }, MANAGER)
		).toMatchObject({ ok: false, errors: { description: 'Escribe la descripción' } });
		expect(movementSchema.safeParse({ ...expense, concept, attributes: {} }).success).toBe(false);
	}
	expect(storedMovement(1)).toEqual({});
});

test('«Entrada» stays an OTHER_INCOME and never takes an expense concept', async () => {
	const entry = { ...typedExpense, direction: 'IN' };
	for (const concept of ['RENT', 'SUPPLIES_EXPENSE', 'DAMAGE_CHARGE', 'OTHER_EXPENSE']) {
		expect(await recordMovement(db, { ...entry, concept }, MANAGER)).toMatchObject({
			ok: false,
			errors: { concept: expect.any(String) }
		});
	}
	expect(
		await recordMovement(db, { ...typedExpense, concept: 'INSTALLMENT' }, MANAGER)
	).toMatchObject({ ok: false, errors: { concept: expect.any(String) } });
	expect(storedMovement(1)).toEqual({});
	await recordMovement(db, { ...entry, concept: 'OTHER_INCOME' }, MANAGER);
	expect(storedMovement(1)).toMatchObject({ concept: 'OTHER_INCOME', amount: 48500 });
});

test('a new expense concept is offset like OTHER_EXPENSE: same concept, its sign flipped', async () => {
	await recordMovement(db, { ...typedExpense, concept: 'RENT' }, MANAGER);
	expect(await recordOffset(db, typedCorrection, MANAGER)).toMatchObject({ ok: true });
	expect(storedMovement(2)).toMatchObject({ concept: 'RENT', amount: 48500, reverses_id: 1 });
});

test('a DAMAGE_CHARGE needs an order and is money in, unless it offsets one', async () => {
	const charge: Movement = {
		concept: 'DAMAGE_CHARGE',
		payment_method: 'TRANSFER',
		amount: 500000,
		movement_date: '2026-10-17',
		entity_type: 'ORDER',
		entity_id: await fixture.order(),
		attributes: { description: 'Dos copas rotas' }
	};
	await record(charge);
	await record({ ...charge, amount: -500000, reverses_id: 1 });
	const refused: Movement[] = [
		{ ...charge, amount: -500000 },
		{ ...charge, entity_type: null, entity_id: null },
		{ ...charge, entity_type: 'RECEIVABLE' }
	];
	for (const movement of refused) {
		await expect(record(movement)).rejects.toThrow(/CHECK/);
	}
	expect(receiptNumbers()).toHaveLength(2);
});

test('the concept filter takes several concepts at once', async () => {
	await recordMovement(db, { ...typedExpense, concept: 'RENT' }, MANAGER);
	await recordMovement(db, { ...typedExpense, concept: 'SUPPLIES_EXPENSE' }, MANAGER);
	await recordMovement(db, { ...typedExpense, concept: 'TRANSPORT_EXPENSE' }, MANAGER);
	await record({ ...expense, movement_date: '2026-10-20' });
	const filters = { from: '2026-10-01', to: '2026-10-31' };
	const book = await getCashBook(
		db,
		{ ...filters, concepts: ['RENT', 'TRANSPORT_EXPENSE', 'BOGUS'] },
		MANAGER
	);
	expect(book.filters.concepts).toEqual(['TRANSPORT_EXPENSE', 'RENT']);
	expect(book.entries.map((entry) => entry.id)).toEqual([3, 1]);
	expect(book.totals).toEqual({ inflow: 0, outflow: 97000, net: -97000 });
	const one = await getCashBook(db, { ...filters, concepts: 'OTHER_EXPENSE' }, MANAGER);
	expect(one.entries.map((entry) => entry.id)).toEqual([4]);
	const none = await getCashBook(db, { ...filters, concepts: [] }, MANAGER);
	expect(none.filters.concepts).toEqual([]);
	expect(none.entries).toHaveLength(4);
});

test('«Pagado por» keeps the login that paid a cash «Salida» out of their Efectivo por entregar', async () => {
	const driver = await fixture.employee({ roles: ['DRIVER'] });
	const paid = { ...typedExpense, concept: 'SUPPLIES_EXPENSE', paid_by: driver.username };
	expect(await recordMovement(db, paid, MANAGER)).toEqual({ ok: true, id: 1 });
	expect(JSON.parse(String(storedMovement(1).attributes))).toEqual({
		description: 'Compra de jabón y desinfectante',
		paid_by: driver.username
	});
	expect(await recordMovement(db, { ...typedExpense, paid_by: '' }, MANAGER)).toEqual({
		ok: true,
		id: 2
	});
	expect(JSON.parse(String(storedMovement(2).attributes))).not.toHaveProperty('paid_by');
});

test('«Pagado por» is refused on a transfer or an «Entrada», for the drawer and for an unknown login', async () => {
	const { username: driver } = await fixture.employee({ roles: ['DRIVER'] });
	const { username: manager } = await fixture.employee({ roles: ['MANAGER'] });
	const { username: warehouse } = await fixture.employee({ roles: ['WAREHOUSE'] });
	const account = 'Bancolombia ahorros 123-456789-01';
	const refused = [
		{ ...typedExpense, paid_by: driver, payment_method: 'TRANSFER', bank_account: account },
		{ ...typedExpense, paid_by: driver, payment_method: 'OTHER', other_method: 'Nequi' },
		{ ...typedExpense, paid_by: driver, direction: 'IN' },
		{ ...typedExpense, paid_by: manager },
		{ ...typedExpense, paid_by: warehouse },
		{ ...typedExpense, paid_by: 'nadie' }
	];
	for (const input of refused) {
		expect(await recordMovement(db, input, MANAGER)).toMatchObject({
			ok: false,
			errors: { paid_by: expect.any(String) }
		});
	}
	expect(storedMovement(1)).toEqual({});
});
