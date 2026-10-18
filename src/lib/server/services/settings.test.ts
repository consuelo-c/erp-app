import { isHttpError } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import { toDialTime } from '$lib/datetime';
import { getSettingInput } from '$lib/settings';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import {
	getHolidays,
	getSystemSettings,
	overrideFrozenHoliday,
	updateHolidays,
	updateSystemSettings,
	type Holiday,
	type SystemSettingKey,
	type SystemSettings
} from './settings';

const admin: Actor = { username: 'admin', employeeId: null, roles: ['ADMIN'], kind: 'user' };
const manager: Actor = { username: 'gerente', employeeId: null, roles: ['MANAGER'], kind: 'user' };
const sales: Actor = { username: 'ventas', employeeId: null, roles: ['SALES'], kind: 'user' };

let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	({ db, database } = createMemoryD1());
	database.exec(readFileSync('scripts/settings-defaults.sql', 'utf8'));
});

// The form as the screen posts it: a clock time as hour, minutes and a.m. or p.m.
function toForm(values: SystemSettings): Record<string, string> {
	return Object.fromEntries(
		Object.entries(values).flatMap(([key, value]) => {
			if ('clock' !== getSettingInput(key as SystemSettingKey)) {
				return [[key, value]];
			}
			return Object.entries(toDialTime(value)).map(([field, part]) => [`${key}.${field}`, part]);
		})
	);
}

function readValue(key: string) {
	return database.prepare('select value, updated_by from settings where key = ?').get(key);
}

function readEvents() {
	return database
		.prepare('select entity_type, entity_id, entity_key, action, before, after from events')
		.all();
}

test('only ADMIN and MANAGER read or edit the settings', async () => {
	const refusals = [
		getSystemSettings(db, sales).catch((caught) => caught),
		updateSystemSettings(db, {}, sales).catch((caught) => caught)
	];
	for (const refusal of await Promise.all(refusals)) {
		expect(isHttpError(refusal, 403)).toBe(true);
	}
});

test('the settings come in the screen order, without the holidays, left to their own editor', async () => {
	const values = await getSystemSettings(db, manager);
	expect(values).not.toHaveProperty('PAYROLL_HOLIDAYS');
	// The screen's order, not the query's: the night shift starts before it ends.
	const keys = Object.keys(values);
	expect(keys.indexOf('PAYROLL_NIGHT_START')).toBeLessThan(keys.indexOf('PAYROLL_NIGHT_END'));
	expect(values.PAYROLL_MINIMUM_WAGE).toBe('1750905');
});

test('saving the settings unchanged writes nothing', async () => {
	const form = toForm(await getSystemSettings(db, manager));
	expect(await updateSystemSettings(db, form, manager)).toEqual({ ok: true });
	expect(readEvents()).toEqual([]);
});

test('each changed key is saved as typed and logs its own SETTINGS event by key', async () => {
	const form = {
		...toForm(await getSystemSettings(db, manager)),
		PAYROLL_MINIMUM_WAGE: '1.800.000',
		'PAYROLL_NIGHT_START.hour': '9',
		'PAYROLL_NIGHT_START.minute': '30',
		'PAYROLL_NIGHT_START.period': 'pm'
	};
	expect(await updateSystemSettings(db, form, manager)).toEqual({ ok: true });
	expect(readValue('PAYROLL_MINIMUM_WAGE')).toEqual({ value: '1800000', updated_by: 'gerente' });
	expect(readValue('PAYROLL_NIGHT_START')).toMatchObject({ value: '21:30' });
	expect(readEvents()).toEqual([
		{
			entity_type: 'SETTINGS',
			entity_id: null,
			entity_key: 'PAYROLL_MINIMUM_WAGE',
			action: 'EDITED',
			before: '{"value":"1750905"}',
			after: '{"value":"1800000"}'
		},
		expect.objectContaining({ entity_key: 'PAYROLL_NIGHT_START', after: '{"value":"21:30"}' })
	]);
});

test('an invalid field saves nothing and comes back with its message', async () => {
	const form = {
		...toForm(await getSystemSettings(db, manager)),
		COMPANY_NAME: 'Banquetes C',
		PAYROLL_HOURS_PER_MONTH: '',
		ORDERS_SUGGESTED_ADVANCE_PCT: '120',
		'PAYROLL_NIGHT_END.hour': '13'
	};
	expect(await updateSystemSettings(db, form, manager)).toEqual({
		ok: false,
		errors: {
			PAYROLL_HOURS_PER_MONTH: 'Escribe un número entero mayor que cero',
			ORDERS_SUGGESTED_ADVANCE_PCT: 'Escribe un porcentaje de 0 a 100',
			PAYROLL_NIGHT_END: 'Escribe la hora, de 1 a 12'
		}
	});
	expect(readValue('COMPANY_NAME')).toMatchObject({ value: 'Banquetes Consuelo C' });
	expect(readEvents()).toEqual([]);
});

test('an event never carries both an id and a key', () => {
	expect(() =>
		database.exec(
			"insert into events (entity_type, entity_id, entity_key, action, actor_username, actor_kind, created_at) values ('SETTINGS', 1, 'COMPANY_NAME', 'EDITED', 'gerente', 'user', 0)"
		)
	).toThrow(/CHECK constraint failed/);
});

// A settlement as far as the freeze line cares: which week, and whether it's paid. Each one its
// own employee: a week holds one settlement per employee.
function settle(periodStart: string, status: 'DRAFT' | 'PAID') {
	const { lastInsertRowid: employeeId } = database
		.prepare(
			`insert into employees (full_name, id_number, created_at, created_by, updated_at, updated_by)
			values ('Ana Pérez', ?, 0, 'gerente', 0, 'gerente')`
		)
		.run(periodStart);
	database
		.prepare(
			`insert into payroll_runs (employee_id, status, week_number, period_start, period_end,
			payment_date, employee_name, employee_id_number, prepared_by, earnings, deductions,
			settings_snapshot, total_earnings, total_deductions, net_pay,
			created_at, created_by, updated_at, updated_by)
			values (?, ?, 1, ?, '', '', 'Ana Pérez', '1', 'gerente', '[]', '[]', '{}', 0, 0, 0, 0, 'gerente', 0, 'gerente')`
		)
		.run(employeeId, status, periodStart);
}

function readHolidays(): Holiday[] {
	return JSON.parse(String(readValue('PAYROLL_HOLIDAYS')?.value));
}

// What the editor posts: only the dates after the freeze line.
function postOpen(holidays: Holiday[], freezeLine: string) {
	return { holidays: JSON.stringify(holidays.filter(({ date }) => date > freezeLine)) };
}

test('the freeze line is the Friday ending the latest PAID settlement extra hours; drafts move nothing', async () => {
	expect((await getHolidays(db, manager)).freezeLine).toBeNull();
	settle('2026-08-31', 'PAID');
	settle('2026-10-05', 'PAID');
	settle('2026-10-12', 'DRAFT');
	const editor = await getHolidays(db, manager);
	expect(editor.freezeLine).toBe('2026-10-09');
	expect(editor.canOverrideFreeze).toBe(false);
	expect((await getHolidays(db, admin)).canOverrideFreeze).toBe(true);
	const refusal = await getHolidays(db, sales).catch((caught: unknown) => caught);
	expect(isHttpError(refusal, 403)).toBe(true);
});

test('saving the holidays keeps the closed ones and logs a SETTINGS event by key', async () => {
	settle('2026-10-05', 'PAID');
	const before = readHolidays();
	const added = { date: '2027-02-15', label: 'Festivo local' };
	const open = before.filter(({ date }) => date > '2026-10-09' && '2026-11-02' !== date);
	const input = { holidays: JSON.stringify([added, ...open]) };
	expect(await updateHolidays(db, input, manager)).toEqual({ ok: true });
	const after = readHolidays();
	expect(after).toContainEqual(added);
	expect(after).not.toContainEqual(expect.objectContaining({ date: '2026-11-02' }));
	expect(after.filter(({ date }) => date <= '2026-10-09')).toEqual(
		before.filter(({ date }) => date <= '2026-10-09')
	);
	expect(readEvents()).toEqual([
		expect.objectContaining({
			entity_type: 'SETTINGS',
			entity_id: null,
			entity_key: 'PAYROLL_HOLIDAYS',
			action: 'EDITED'
		})
	]);
});

test('saving the holidays unchanged writes nothing', async () => {
	settle('2026-10-05', 'PAID');
	expect(await updateHolidays(db, postOpen(readHolidays(), '2026-10-09'), manager)).toEqual({
		ok: true
	});
	expect(readEvents()).toEqual([]);
});

test('the editor refuses a date on or before the freeze line, for ADMIN too', async () => {
	settle('2026-10-05', 'PAID');
	const open = JSON.parse(postOpen(readHolidays(), '2026-10-09').holidays);
	const input = { holidays: JSON.stringify([{ date: '2026-10-09', label: 'Puente' }, ...open]) };
	for (const actor of [manager, admin]) {
		expect(await updateHolidays(db, input, actor)).toEqual({
			ok: false,
			message: 'El vie 9 oct 2026 está en una nómina pagada: no se puede agregar ni cambiar'
		});
	}
	expect(readEvents()).toEqual([]);
});

test('the editor refuses a repeated date or a holiday without a name', async () => {
	const holidays = readHolidays();
	const repeated = { holidays: JSON.stringify([...holidays, holidays[0]]) };
	expect(await updateHolidays(db, repeated, manager)).toEqual({
		ok: false,
		message: 'Esa fecha ya está en la lista'
	});
	const unnamed = { holidays: JSON.stringify([{ date: '2027-03-22', label: ' ' }]) };
	expect(await updateHolidays(db, unnamed, manager)).toEqual({
		ok: false,
		message: 'Escribe el nombre del festivo'
	});
});

test('only ADMIN changes a closed holiday, and only with a reason, kept on the event', async () => {
	settle('2026-10-05', 'PAID');
	const input = { original: '2026-05-18', date: '2026-05-19', label: 'Ascensión del Señor' };
	const refusal = await overrideFrozenHoliday(db, { ...input, reason: 'x' }, manager).catch(
		(caught: unknown) => caught
	);
	expect(isHttpError(refusal, 403)).toBe(true);
	expect(await overrideFrozenHoliday(db, { ...input, reason: ' ' }, admin)).toEqual({
		ok: false,
		message: 'Escribe el motivo del cambio'
	});
	expect(readEvents()).toEqual([]);

	const reason = 'El festivo se trasladó por decreto';
	expect(await overrideFrozenHoliday(db, { ...input, reason }, admin)).toEqual({ ok: true });
	const holidays = readHolidays();
	expect(holidays).toContainEqual({ date: '2026-05-19', label: 'Ascensión del Señor' });
	expect(holidays).not.toContainEqual(expect.objectContaining({ date: '2026-05-18' }));
	expect(JSON.stringify(holidays)).not.toContain(reason);
	const event = database.prepare('select entity_key, action, reason from events').get();
	expect(event).toEqual({ entity_key: 'PAYROLL_HOLIDAYS', action: 'EDITED', reason });
});

test('ADMIN removes a closed holiday with a reason; an open date is not an override', async () => {
	settle('2026-10-05', 'PAID');
	const ascension = { date: '2026-05-18', label: 'Ascensión del Señor' };
	const removal = { original: '2026-05-18', ...ascension, remove: 'true', reason: 'No aplica' };
	expect(await overrideFrozenHoliday(db, removal, admin)).toEqual({ ok: true });
	expect(readHolidays()).not.toContainEqual(expect.objectContaining({ date: '2026-05-18' }));
	const open = { ...removal, original: '2026-11-02' };
	expect(await overrideFrozenHoliday(db, open, admin)).toEqual({
		ok: false,
		message: 'Esa fecha no está en una nómina pagada'
	});
});
