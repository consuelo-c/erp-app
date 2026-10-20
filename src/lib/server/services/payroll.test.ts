import { isHttpError } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { createEmployee, endEmployment, updateEmployee } from './employees';
import {
	getReceipt,
	openWeek,
	recordPayment,
	saveDraft,
	type Draft,
	type PayrollWeek
} from './payroll';

const manager: Actor = { username: 'gerente', employeeId: null, roles: ['MANAGER'], kind: 'user' };

// Saturday the 17th: the week settled is Monday 12 to Saturday 17, and its extra hours run from
// Saturday 10 to Friday 16.
const TODAY = '2026-10-17';
const WEEK = '2026-10-12';
const PREVIOUS_WEEK = '2026-10-05';

let db: D1Database;
let database: DatabaseSync;
let anaId: number;

async function hire(fullName: string, idNumber: string, start: string): Promise<number> {
	const result = await createEmployee(
		db,
		{
			full_name: fullName,
			id_number: idNumber,
			monthly_salary: '1750905',
			position: 'Bodega',
			start
		},
		manager
	);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.id;
}

function punch(workDate: string, ...times: [string, string, string | null, string | null]) {
	database
		.prepare(
			`insert into timesheets (employee_id, work_date, morning_in, morning_out, afternoon_in, afternoon_out,
			created_at, created_by, updated_at, updated_by) values (?, ?, ?, ?, ?, ?, 0, 'test', 0, 'test')
			on conflict (employee_id, work_date) do update set morning_in = excluded.morning_in,
			morning_out = excluded.morning_out, afternoon_in = excluded.afternoon_in,
			afternoon_out = excluded.afternoon_out`
		)
		.run(anaId, workDate, ...times);
}

function setSetting(key: string, value: string) {
	database.prepare('update settings set value = ? where key = ?').run(value, key);
}

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(`${TODAY}T17:00:00Z`)); // noon in Bogotá
	({ db, database } = createMemoryD1());
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
	anaId = await hire('Ana Pérez', '1036452118', '2026-07-01');
});

afterEach(() => {
	vi.useRealTimers();
});

async function open(week = WEEK, employeeId: number | null = anaId): Promise<PayrollWeek> {
	return openWeek(db, { employeeId, week }, manager);
}

async function openDraft(week = WEEK): Promise<Draft> {
	const { draft } = await open(week);
	if (null === draft) {
		throw new Error('No draft');
	}
	return draft;
}

const line = (draft: Draft, concept: string) =>
	draft.earnings.find((each) => concept === each.concept)!;

// The form as the screen posts it, untouched unless overridden.
function formOf(draft: Draft, periodStart: string, overrides: Record<string, string> = {}) {
	const values: Record<string, string> = {
		employee_id: String(draft.employeeId),
		period_start: periodStart,
		week_number: String(draft.weekNumber),
		payment_date: draft.paymentDate
	};
	for (const each of draft.earnings) {
		values[each.concept] =
			null === each.qty ? String(each.amount) : String(Math.round(each.qty * 100) / 100);
	}
	for (const each of draft.deductions.filter(
		({ concept }) => 'LOANS' === concept || 'OTHER' === concept
	)) {
		values[each.concept] = String(each.amount);
		values[`${each.concept}.description`] = each.description ?? '';
	}
	return { ...values, ...overrides };
}

function runRow() {
	return database
		.prepare('select * from payroll_runs where employee_id = ? and period_start = ?')
		.get(anaId, WEEK) as Record<string, string | number | null>;
}

test('a new draft comes pre-filled: six days, Sunday rest, the hours log, and nothing typed in', async () => {
	punch('2026-10-11', '08:00', '10:00', null, null); // Sunday: every hour is a holiday hour
	punch('2026-10-15', '07:00', '12:00', '13:00', '17:00'); // 9 h: 2 h daytime overtime
	const draft = await openDraft();
	expect(draft.isSaved).toBe(false);
	expect(draft.paymentDate).toBe(TODAY);
	expect(line(draft, 'DAYS_WORKED')).toMatchObject({ qty: 6, amount: 350181 });
	expect(line(draft, 'SUNDAY_REST')).toMatchObject({ qty: 1, amount: 58364 });
	expect(line(draft, 'OVERTIME_DAY')).toMatchObject({ qty: 2, derivedQty: 2, amount: 20844 });
	expect(line(draft, 'HOLIDAY_OVERTIME_DAY')).toMatchObject({ qty: 2, derivedQty: 2 });
	expect(line(draft, 'TRANSPORT_ALLOWANCE')).toMatchObject({ qty: 6, amount: 49819 });
	expect(line(draft, 'NON_SALARY_BONUS')).toEqual({
		concept: 'NON_SALARY_BONUS',
		qty: null,
		derivedQty: null,
		amount: 0
	});
	expect(
		draft.deductions.filter(({ amount }) => 0 === amount).map(({ concept }) => concept)
	).toEqual(['LOANS', 'OTHER']);
	const amounts = draft.earnings.reduce((sum, each) => sum + each.amount, 0);
	expect(draft.totalEarnings).toBe(amounts);
});

test("a week's own Saturday and Sunday hours go to the next week's settlement", async () => {
	punch('2026-10-10', '07:00', '12:00', '13:00', '16:00'); // Saturday the 10th: 1 h overtime
	expect(line(await openDraft(PREVIOUS_WEEK), 'OVERTIME_DAY').qty).toBe(0);
	expect(line(await openDraft(WEEK), 'OVERTIME_DAY').qty).toBe(1);
});

test('saving creates the draft with its event and snapshots; saving again edits it', async () => {
	punch('2026-10-15', '07:00', '12:00', '13:00', '17:00');
	const draft = await openDraft();
	expect(await saveDraft(db, formOf(draft, WEEK, { NON_SALARY_BONUS: '50.000' }), manager)).toEqual(
		{
			ok: true
		}
	);
	const row = runRow();
	expect(row).toMatchObject({
		status: 'DRAFT',
		period_end: TODAY,
		employee_name: 'Ana Pérez',
		employee_id_number: '1036452118',
		employee_position: 'Bodega',
		employee_hire_date: '2026-07-01',
		prepared_by: 'gerente'
	});
	const snapshot = JSON.parse(String(row.settings_snapshot));
	expect(snapshot.PAYROLL_OVERTIME_DAY_FACTOR).toBe('125');
	expect(JSON.parse(snapshot.PAYROLL_HOLIDAYS)).toContainEqual({
		date: '2026-10-12',
		label: 'Día de la Raza'
	});
	const reopened = await openDraft();
	expect(reopened.isSaved).toBe(true);
	expect(line(reopened, 'NON_SALARY_BONUS').amount).toBe(50000);
	expect(await saveDraft(db, formOf(reopened, WEEK, { LOANS: '30000' }), manager)).toEqual({
		ok: true
	});
	const events = database
		.prepare("select action from events where entity_type = 'PAYROLL_RUN' order by id")
		.all();
	expect(events).toEqual([{ action: 'CREATED' }, { action: 'EDITED' }]);
});

test('opening a draft recalculates the hours rows, keeping the ones the manager corrected', async () => {
	punch('2026-10-11', '08:00', '10:00', null, null);
	punch('2026-10-15', '07:00', '12:00', '13:00', '17:00');
	const draft = await openDraft();
	await saveDraft(db, formOf(draft, WEEK, { OVERTIME_DAY: '1' }), manager);
	punch('2026-10-11', '08:00', '11:00', null, null); // 3 h now
	punch('2026-10-15', '07:00', '12:00', '13:00', '18:00'); // 3 h now
	const reopened = await openDraft();
	expect(line(reopened, 'HOLIDAY_OVERTIME_DAY')).toMatchObject({ qty: 3, derivedQty: 3 });
	expect(line(reopened, 'OVERTIME_DAY')).toMatchObject({ qty: 1, derivedQty: 3, amount: 10422 });
});

test('the hours rows keep the exact minute: an untouched row never reads as corrected', async () => {
	punch('2026-10-15', '07:00', '12:00', '13:00', '15:17'); // 17 min of overtime
	const draft = await openDraft();
	expect(formOf(draft, WEEK).OVERTIME_DAY).toBe('0.28');
	await saveDraft(db, formOf(draft, WEEK), manager);
	punch('2026-10-15', '07:00', '12:00', '13:00', '15:30');
	expect(line(await openDraft(), 'OVERTIME_DAY')).toMatchObject({ qty: 0.5, derivedQty: 0.5 });
});

test('a draft uses the current settings: a holiday added while preparing it counts', async () => {
	punch('2026-10-15', '07:00', '12:00', '13:00', '17:00');
	await saveDraft(db, formOf(await openDraft(), WEEK), manager);
	const holidays = JSON.parse(
		String(
			database.prepare("select value from settings where key = 'PAYROLL_HOLIDAYS'").get()?.value
		)
	) as { date: string; label: string }[];
	const withThursday = [...holidays, { date: '2026-10-15', label: 'Prueba' }].sort(
		(first, second) => first.date.localeCompare(second.date)
	);
	setSetting('PAYROLL_HOLIDAYS', JSON.stringify(withThursday));
	const reopened = await openDraft();
	expect(line(reopened, 'OVERTIME_DAY').qty).toBe(0);
	expect(line(reopened, 'HOLIDAY_OVERTIME_DAY').qty).toBe(9);
	await saveDraft(db, formOf(reopened, WEEK), manager);
	const snapshot = JSON.parse(String(runRow().settings_snapshot));
	expect(JSON.parse(snapshot.PAYROLL_HOLIDAYS)).toContainEqual({
		date: '2026-10-15',
		label: 'Prueba'
	});
});

test('«Otros» is not saved without a description', async () => {
	const draft = await openDraft();
	const result = await saveDraft(db, formOf(draft, WEEK, { OTHER: '20.000' }), manager);
	expect(result).toMatchObject({
		ok: false,
		errors: { 'OTHER.description': 'Escribe la descripción. «Otros» no se guarda sin ella.' }
	});
	expect(runRow()).toBeUndefined();
	const described = { OTHER: '20.000', 'OTHER.description': 'Copa rota pedido #1043' };
	expect(await saveDraft(db, formOf(draft, WEEK, described), manager)).toEqual({ ok: true });
	expect((await openDraft()).deductions.at(-1)).toEqual({
		concept: 'OTHER',
		amount: 20000,
		description: 'Copa rota pedido #1043'
	});
});

test('the week number is proposed as the previous one + 1, and is editable', async () => {
	const previous = await openDraft(PREVIOUS_WEEK);
	await saveDraft(db, formOf(previous, PREVIOUS_WEEK, { week_number: '41' }), manager);
	const draft = await openDraft();
	expect(draft).toMatchObject({ weekNumber: 42, previousWeekNumber: 41 });
	await saveDraft(db, formOf(draft, WEEK, { week_number: '43' }), manager);
	expect((await openDraft()).weekNumber).toBe(43);
});

test('the first settlement of January is proposed as week 1', async () => {
	vi.setSystemTime(new Date('2027-01-02T17:00:00Z'));
	const december = await openDraft('2026-12-21');
	await saveDraft(db, formOf(december, '2026-12-21', { week_number: '51' }), manager);
	// Monday 28 December to Saturday 2 January: paid in January.
	expect(await openDraft('2026-12-28')).toMatchObject({ weekNumber: 1, previousWeekNumber: null });
});

const CASH = { payment_method: 'CASH' };

function movements() {
	return database
		.prepare(
			'select concept, payment_method, amount, movement_date, entity_type, entity_id, attributes from cash_movements'
		)
		.all();
}

test('recording the payment marks it PAID and writes its PAYROLL movement, in one action', async () => {
	const draft = await openDraft();
	const typed = { NON_SALARY_BONUS: '50.000' };
	expect(await recordPayment(db, { ...formOf(draft, WEEK, typed), ...CASH }, manager)).toEqual({
		ok: true
	});
	const row = runRow();
	expect(row.status).toBe('PAID');
	// What's paid is what was on screen, saved in the same action.
	expect(row.net_pay).toBe(draft.netPay + 50000);
	expect(movements()).toEqual([
		{
			concept: 'PAYROLL',
			payment_method: 'CASH',
			amount: -row.net_pay!,
			movement_date: TODAY,
			entity_type: 'PAYROLL_RUN',
			entity_id: row.id,
			attributes: '{}'
		}
	]);
	const events = database
		.prepare(
			"select entity_type, action from events where entity_type in ('PAYROLL_RUN', 'CASH_MOVEMENT') order by id"
		)
		.all();
	expect(events).toEqual([
		{ entity_type: 'PAYROLL_RUN', action: 'CREATED' },
		{ entity_type: 'PAYROLL_RUN', action: 'PAID' },
		{ entity_type: 'CASH_MOVEMENT', action: 'CREATED' }
	]);
});

test('a paid settlement shows what was stored and is never written again', async () => {
	await recordPayment(db, { ...formOf(await openDraft(), WEEK), ...CASH }, manager);
	punch('2026-10-15', '07:00', '12:00', '13:00', '17:00');
	const paid = await openDraft();
	expect(paid.status).toBe('PAID');
	expect(line(paid, 'OVERTIME_DAY').qty).toBe(0);
	expect(paid.payment).toMatchObject({
		method: 'CASH',
		amount: paid.netPay,
		movementDate: TODAY,
		recordedBy: 'gerente',
		employeeName: 'Ana Pérez'
	});
	const refusal = { ok: false, message: 'Esta liquidación ya se pagó: no se puede cambiar' };
	expect(await saveDraft(db, formOf(paid, WEEK), manager)).toMatchObject(refusal);
	expect(await recordPayment(db, { ...formOf(paid, WEEK), ...CASH }, manager)).toMatchObject(
		refusal
	);
	expect(movements()).toHaveLength(1);
});

test("a transfer keeps a copy of the account, pre-filled from the employee's", async () => {
	const details = {
		id: String(anaId),
		full_name: 'Ana Pérez',
		id_number: '1036452118',
		monthly_salary: '1750905',
		position: 'Bodega',
		bank_account: 'Bancolombia ahorros 0123-456789-01'
	};
	await updateEmployee(db, details, manager);
	const draft = await openDraft();
	expect(draft.employeeBankAccount).toBe('Bancolombia ahorros 0123-456789-01');
	const transfer = { payment_method: 'TRANSFER', bank_account: '' };
	expect(await recordPayment(db, { ...formOf(draft, WEEK), ...transfer }, manager)).toMatchObject({
		ok: false,
		errors: { bank_account: 'Escribe la cuenta a la que se transfiere' }
	});
	expect(runRow()).toBeUndefined();
	const otherAccount = { payment_method: 'TRANSFER', bank_account: 'Nequi 300 123 4567' };
	await recordPayment(db, { ...formOf(draft, WEEK), ...otherAccount }, manager);
	expect(movements()).toMatchObject([{ attributes: '{"bank_account":"Nequi 300 123 4567"}' }]);
	expect((await openDraft()).payment).toMatchObject({
		bankAccount: 'Nequi 300 123 4567',
		otherMethod: null
	});
});

test('with «Otro», recording fails without «¿Cuál medio de pago?», which lands in attributes', async () => {
	const draft = await openDraft();
	const other = { payment_method: 'OTHER', bank_account: 'ignorada' };
	expect(await recordPayment(db, { ...formOf(draft, WEEK), ...other }, manager)).toMatchObject({
		ok: false,
		errors: { payment_method_other: 'Escribe cuál medio de pago se usó' }
	});
	const described = { ...other, payment_method_other: 'Nequi' };
	expect(await recordPayment(db, { ...formOf(draft, WEEK), ...described }, manager)).toEqual({
		ok: true
	});
	expect(movements()).toMatchObject([
		{ payment_method: 'OTHER', attributes: '{"other_method":"Nequi"}' }
	]);
	expect((await openDraft()).payment).toMatchObject({ bankAccount: null, otherMethod: 'Nequi' });
});

test('the employee picked earlier is kept if they worked the period, or the first one shows', async () => {
	const luisId = await hire('Luis Gómez', '71384902', '2026-07-01');
	const leftId = await hire('Pedro Ruiz', '98765432', '2026-07-01');
	await endEmployment(db, { id: String(leftId), end: '2026-09-30' }, manager);
	const opened = (preferredEmployeeId: number) =>
		openWeek(db, { employeeId: null, preferredEmployeeId, week: WEEK }, manager);
	expect((await opened(luisId)).draft?.employeeId).toBe(luisId);
	// Pedro left in September: the first one of the week, never a 404.
	expect((await opened(leftId)).draft?.employeeId).toBe(anaId);
});

test('only the employees who worked in the period are offered, and only to ADMIN and MANAGER', async () => {
	const leftId = await hire('Luis Gómez', '71384902', '2026-07-01');
	await endEmployment(db, { id: String(leftId), end: '2026-09-30' }, manager);
	const week = await open(WEEK, null);
	expect(week.employees.map(({ fullName }) => fullName)).toEqual(['Ana Pérez']);
	expect(week.draft?.employeeId).toBe(anaId);
	await expect(open(WEEK, leftId)).rejects.toSatisfy(
		(thrown) => isHttpError(thrown) && 404 === thrown.status
	);
	const warehouse: Actor = {
		username: 'bodega',
		employeeId: anaId,
		roles: ['WAREHOUSE'],
		kind: 'user'
	};
	await expect(openWeek(db, { employeeId: anaId, week: WEEK }, warehouse)).rejects.toSatisfy(
		(thrown) => isHttpError(thrown) && 403 === thrown.status
	);
	expect(await saveDraft(db, { employee_id: String(leftId) }, manager)).toMatchObject({
		ok: false
	});
});

test('the receipt prints a paid settlement: its snapshot, who prepared it, and the company header', async () => {
	const draft = await openDraft();
	const notPaid = await getReceipt(db, { employeeId: anaId, week: WEEK }, manager).catch(
		(caught: unknown) => caught
	);
	expect(isHttpError(notPaid, 404)).toBe(true);
	await recordPayment(db, { ...formOf(draft, WEEK), ...CASH }, manager);
	const receipt = await getReceipt(db, { employeeId: anaId, week: TODAY }, manager);
	expect(receipt.periodStart).toBe(WEEK);
	expect(receipt.extraHours).toEqual({ start: '2026-10-10', end: '2026-10-16' });
	expect(receipt.payment).toMatchObject({
		employeeName: 'Ana Pérez',
		employeeIdNumber: '1036452118',
		employeePosition: 'Bodega',
		employeeHireDate: '2026-07-01',
		preparedBy: 'gerente'
	});
	expect(receipt.company.COMPANY_NAME).toBe('Banquetes Consuelo C');
	// Another employee's id never falls back to Ana's receipt.
	const otherId = await hire('Luis Gómez', '71000111', '2026-07-01');
	const other = await getReceipt(db, { employeeId: otherId, week: WEEK }, manager).catch(
		(caught: unknown) => caught
	);
	expect(isHttpError(other, 404)).toBe(true);
});
