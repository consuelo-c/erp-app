import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import { createEmployee } from './employees';
import { getEmployeeHours, getOwnHours, saveEmployeePunch, saveOwnPunch } from './timesheets';

const manager: Actor = { username: 'gerente', employeeId: null, roles: ['MANAGER'], kind: 'user' };

const TODAY = '2026-07-31'; // a Friday

let db: D1Database;
let database: DatabaseSync;
let ana: Actor;

async function hire(idNumber: string, start: string): Promise<number> {
	const result = await createEmployee(
		db,
		{
			full_name: 'Ana Pérez',
			id_number: idNumber,
			monthly_salary: '1750905',
			position: 'Ventas',
			start
		},
		manager
	);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.id;
}

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(`${TODAY}T17:00:00Z`)); // noon in Bogotá
	({ db, database } = createMemoryD1());
	const employeeId = await hire('1036452118', '2026-07-01');
	ana = { username: 'ventas', employeeId, roles: ['WAREHOUSE'], kind: 'user' };
});

afterEach(() => {
	vi.useRealTimers();
});

// A punch as the dialog posts it: '07:02' is 7, 2, a.m.
function at(time: string) {
	const [hour, minute] = time.split(':').map(Number);
	return { hour: String(hour % 12 || 12), minute: String(minute), period: hour < 12 ? 'am' : 'pm' };
}

function timesheetEvents() {
	return database
		.prepare("select action, before, after from events where entity_type = 'TIMESHEET' order by id")
		.all();
}

test('the first punch of a day creates the row, the next ones edit it, each with its event', async () => {
	const morning = { work_date: TODAY, punch: 'morningIn', ...at('07:02') };
	expect(await saveOwnPunch(db, morning, ana)).toEqual({ ok: true });
	expect(await saveOwnPunch(db, { ...morning, punch: 'morningOut', ...at('12:01') }, ana)).toEqual({
		ok: true
	});
	const hours = await getOwnHours(db, { date: TODAY }, ana);
	expect(hours?.day.punches).toEqual({
		morningIn: '07:02',
		morningOut: '12:01',
		afternoonIn: null,
		afternoonOut: null
	});
	expect(hours?.day.workedMinutes).toBe(299);
	const [created, edited] = timesheetEvents();
	expect(created).toMatchObject({ action: 'CREATED', before: null });
	expect(JSON.parse(String(edited.after))).toEqual({ morning_out: '12:01' });
});

test('correcting a punch logs only that punch, before and after', async () => {
	await saveOwnPunch(db, { work_date: TODAY, punch: 'morningIn', ...at('07:02') }, ana);
	await saveOwnPunch(db, { work_date: TODAY, punch: 'morningIn', ...at('06:58') }, ana);
	const edited = timesheetEvents()[1];
	expect(JSON.parse(String(edited.before))).toEqual({ morning_in: '07:02' });
	expect(JSON.parse(String(edited.after))).toEqual({ morning_in: '06:58' });
});

test('the punch goes to the actor’s employee, whatever employee the input names', async () => {
	const other = await hire('71384902', '2026-07-01');
	const input = { work_date: TODAY, punch: 'morningIn', ...at('07:00'), employee_id: other };
	await saveOwnPunch(db, input, ana);
	expect(database.prepare('select employee_id from timesheets').all()).toEqual([
		{ employee_id: ana.employeeId }
	]);
});

test('a login with no employee can’t punch and has no hours to show', async () => {
	const noEmployee = { ...ana, employeeId: null };
	const result = await saveOwnPunch(
		db,
		{ work_date: TODAY, punch: 'morningIn', ...at('07:00') },
		noEmployee
	);
	expect(result).toEqual({ ok: false, message: 'Tu usuario no está vinculado a un empleado' });
	expect(await getOwnHours(db, { date: TODAY }, noEmployee)).toBeNull();
});

test('a day not yet come, or outside the employment, is refused', async () => {
	const future = await saveOwnPunch(
		db,
		{ work_date: '2026-08-01', punch: 'morningIn', ...at('07:00') },
		ana
	);
	expect(future).toEqual({ ok: false, message: 'Ese día todavía no ha llegado' });
	const before = await saveOwnPunch(
		db,
		{ work_date: '2026-06-30', punch: 'morningIn', ...at('07:00') },
		ana
	);
	expect(before).toEqual({ ok: false, message: 'Ese día no hace parte de ningún período laboral' });
});

test('any earlier day of the employment can be corrected: no date window', async () => {
	const result = await saveOwnPunch(
		db,
		{ work_date: '2026-07-01', punch: 'afternoonOut', ...at('17:00') },
		ana
	);
	expect(result).toEqual({ ok: true });
});

test('punches out of order are refused; the afternoon may start when the morning ends', async () => {
	await saveOwnPunch(db, { work_date: TODAY, punch: 'morningOut', ...at('12:00') }, ana);
	const early = await saveOwnPunch(
		db,
		{ work_date: TODAY, punch: 'morningIn', ...at('12:30') },
		ana
	);
	expect(early.ok).toBe(false);
	const back = await saveOwnPunch(
		db,
		{ work_date: TODAY, punch: 'afternoonIn', ...at('12:00') },
		ana
	);
	expect(back).toEqual({ ok: true });
});

test('12 a.m. is midnight, 12 p.m. noon, and blank minutes are :00', async () => {
	const midnight = { hour: '12', minute: '30', period: 'am' };
	const noon = { hour: '12', minute: '', period: 'pm' };
	await saveOwnPunch(db, { work_date: TODAY, punch: 'morningIn', ...midnight }, ana);
	await saveOwnPunch(db, { work_date: TODAY, punch: 'morningOut', ...noon }, ana);
	const hours = await getOwnHours(db, { date: TODAY }, ana);
	expect(hours?.day.punches).toMatchObject({ morningIn: '00:30', morningOut: '12:00' });
});

test('each field out of range is refused with its own message', async () => {
	const base = { work_date: TODAY, punch: 'morningIn', hour: '7', minute: '0', period: 'am' };
	const cases = [
		[{ hour: '13' }, 'Escribe la hora, de 1 a 12'],
		[{ hour: '' }, 'Escribe la hora, de 1 a 12'],
		[{ minute: '60' }, 'Escribe los minutos, de 0 a 59'],
		[{ period: undefined }, 'Escoge a.m. o p.m.']
	] as const;
	for (const [change, message] of cases) {
		expect(await saveOwnPunch(db, { ...base, ...change }, ana)).toEqual({ ok: false, message });
	}
});

test('the week runs Monday to Sunday, the days after today marked as future', async () => {
	const hours = await getOwnHours(db, { date: TODAY }, ana);
	expect(hours?.employeeName).toBe('Ana Pérez');
	expect(hours?.week.map((day) => [day.workDate, day.isFuture])).toEqual([
		['2026-07-27', false],
		['2026-07-28', false],
		['2026-07-29', false],
		['2026-07-30', false],
		['2026-07-31', false],
		['2026-08-01', true],
		['2026-08-02', true]
	]);
	const earlier = await getOwnHours(db, { date: TODAY, week: '2026-07-22' }, ana);
	expect(earlier?.week[0].workDate).toBe('2026-07-20');
});

test('a future or malformed day is a 404', async () => {
	for (const date of ['2026-08-01', 'ayer']) {
		const error = await getOwnHours(db, { date }, ana).catch((caught: unknown) => caught);
		expect(isHttpError(error, 404)).toBe(true);
	}
});

test('a manager logs a punch for the employee chosen in the selector, signed as the manager', async () => {
	const input = {
		employee_id: String(ana.employeeId),
		work_date: TODAY,
		punch: 'morningIn',
		...at('07:00')
	};
	expect(await saveEmployeePunch(db, input, manager)).toEqual({ ok: true });
	expect(database.prepare('select employee_id, created_by from timesheets').all()).toEqual([
		{ employee_id: ana.employeeId, created_by: 'gerente' }
	]);
	const hours = await getEmployeeHours(db, { employeeId: ana.employeeId, date: TODAY }, manager);
	expect(hours.employeeName).toBe('Ana Pérez');
	expect(hours.day.punches.morningIn).toBe('07:00');
});

test('a manager’s punch follows the same rules: no unknown employee, no day outside the employment', async () => {
	const base = { work_date: TODAY, punch: 'morningIn', ...at('07:00') };
	expect(await saveEmployeePunch(db, { ...base, employee_id: '999' }, manager)).toEqual({
		ok: false,
		message: 'Escoge el empleado'
	});
	const before = { ...base, employee_id: String(ana.employeeId), work_date: '2026-06-30' };
	expect(await saveEmployeePunch(db, before, manager)).toEqual({
		ok: false,
		message: 'Ese día no hace parte de ningún período laboral'
	});
});

test('only ADMIN and MANAGER see or log another employee’s hours; an unknown one is a 404', async () => {
	const input = {
		employee_id: String(ana.employeeId),
		work_date: TODAY,
		punch: 'morningIn',
		...at('07:00')
	};
	const forbidden = await saveEmployeePunch(db, input, ana).catch((caught: unknown) => caught);
	expect(isHttpError(forbidden, 403)).toBe(true);
	const unknown = await getEmployeeHours(db, { employeeId: 999, date: TODAY }, manager).catch(
		(caught: unknown) => caught
	);
	expect(isHttpError(unknown, 404)).toBe(true);
});
