import { isHttpError } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import { toDialTime } from '$lib/datetime';
import { getSettingInput } from '$lib/settings';
import type { Actor } from '../actor';
import { createMemoryD1 } from '../db/memory-d1';
import {
	getSystemSettings,
	updateSystemSettings,
	type SystemSettingKey,
	type SystemSettings
} from './settings';

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
