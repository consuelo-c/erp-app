import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { movementSchema, movementStatements, type Movement } from './cash';

const manager: Actor = { username: 'gerente', employeeId: null, roles: ['MANAGER'], kind: 'user' };

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
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
