import { isHttpError } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import { toDialTime } from '$lib/datetime';
import { getSettingInput, type SettingModule } from '$lib/settings';
import { ADMIN, createFixture, DRIVER, MANAGER, SALES, WAREHOUSE } from '../db/fixture';
import { openWeek, recordPayment, saveDraft } from './payroll';
import {
	getHelp,
	getHolidays,
	getSystemSettings,
	getTerms,
	overrideFrozenHoliday,
	updateHelp,
	updateHolidays,
	updateSystemSettings,
	updateTerms,
	type Holiday,
	type SystemSettingKey,
	type SystemSettings
} from './settings';

// Both screens' modules: Configuración's and Nómina's.
const modules: SettingModule[] = ['COMPANY', 'QUOTES', 'PAYROLL'];

let fixture: ReturnType<typeof createFixture>;
let db: D1Database;
let database: DatabaseSync;

beforeEach(() => {
	fixture = createFixture();
	({ db, database } = fixture);
});

// The form as the screen posts it: a clock time as hour, minutes and a.m. or p.m.
function toForm(values: Partial<SystemSettings>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(values).flatMap(([key, value = '']) => {
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

// The settings' own events: a settlement a test pays leaves its own, which aren't these.
function readEvents() {
	return database
		.prepare(
			"select entity_type, entity_id, entity_key, action, before, after from events where entity_type = 'SETTINGS'"
		)
		.all();
}

test('only ADMIN and MANAGER read or edit the settings', async () => {
	const refusals = [
		getSystemSettings(db, modules, SALES).catch((caught) => caught),
		updateSystemSettings(db, { modules, values: {} }, SALES).catch((caught) => caught)
	];
	for (const refusal of await Promise.all(refusals)) {
		expect(isHttpError(refusal, 403)).toBe(true);
	}
});

test('the settings come in the screen order, without the holidays, left to their own editor', async () => {
	const values = await getSystemSettings(db, modules, MANAGER);
	expect(values).not.toHaveProperty('PAYROLL_HOLIDAYS');
	// The screen's order, not the query's: the night shift starts before it ends.
	const keys = Object.keys(values);
	expect(keys.indexOf('PAYROLL_NIGHT_START')).toBeLessThan(keys.indexOf('PAYROLL_NIGHT_END'));
	expect(values.PAYROLL_MINIMUM_WAGE).toBe('1750905');
});

test('saving the settings unchanged writes nothing', async () => {
	const form = toForm(await getSystemSettings(db, modules, MANAGER));
	expect(await updateSystemSettings(db, { modules, values: form }, MANAGER)).toEqual({ ok: true });
	expect(readEvents()).toEqual([]);
});

test('each changed key is saved as typed and logs its own SETTINGS event by key', async () => {
	const form = {
		...toForm(await getSystemSettings(db, modules, MANAGER)),
		PAYROLL_MINIMUM_WAGE: '1.800.000',
		'PAYROLL_NIGHT_START.hour': '9',
		'PAYROLL_NIGHT_START.minute': '30',
		'PAYROLL_NIGHT_START.period': 'pm'
	};
	expect(await updateSystemSettings(db, { modules, values: form }, MANAGER)).toEqual({ ok: true });
	expect(readValue('PAYROLL_MINIMUM_WAGE')).toEqual({ value: '1800000', updated_by: 'manager' });
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
		...toForm(await getSystemSettings(db, modules, MANAGER)),
		COMPANY_NAME: 'Banquetes C',
		PAYROLL_HOURS_PER_MONTH: '',
		'PAYROLL_NIGHT_END.hour': '13'
	};
	expect(await updateSystemSettings(db, { modules, values: form }, MANAGER)).toEqual({
		ok: false,
		message: 'Revisa los campos marcados en rojo antes de guardar.',
		errors: {
			PAYROLL_HOURS_PER_MONTH: 'Escribe un número entero mayor que cero',
			PAYROLL_NIGHT_END: 'Escribe la hora, de 1 a 12'
		}
	});
	expect(readValue('COMPANY_NAME')).toMatchObject({ value: 'Banquetes Consuelo C' });
	expect(readEvents()).toEqual([]);
});

test('an empty WhatsApp is refused; a valid one is stored normalized', async () => {
	const form = toForm(await getSystemSettings(db, modules, MANAGER));
	expect(
		await updateSystemSettings(db, { modules, values: { ...form, COMPANY_WHATSAPP: ' ' } }, MANAGER)
	).toMatchObject({ ok: false, errors: { COMPANY_WHATSAPP: expect.any(String) } });
	expect(readValue('COMPANY_WHATSAPP')).toEqual({ value: '573006113392', updated_by: 'system' });
	const typed = { ...form, COMPANY_WHATSAPP: '310 555 0142' };
	expect(await updateSystemSettings(db, { modules, values: typed }, MANAGER)).toEqual({ ok: true });
	expect(readValue('COMPANY_WHATSAPP')).toEqual({ value: '573105550142', updated_by: 'manager' });
});

test('each tab reads and saves only its own modules: Nómina ignores a general field', async () => {
	const values = await getSystemSettings(db, ['PAYROLL'], MANAGER);
	expect(values).not.toHaveProperty('COMPANY_NAME');
	expect(values).toHaveProperty('PAYROLL_MINIMUM_WAGE');
	const form = { ...toForm(values), COMPANY_NAME: '' };
	expect(await updateSystemSettings(db, { modules: ['PAYROLL'], values: form }, MANAGER)).toEqual({
		ok: true
	});
	expect(readValue('COMPANY_NAME')).toMatchObject({ value: 'Banquetes Consuelo C' });
	expect(readEvents()).toEqual([]);
});

test("changing a quote's validity moves no existing quote's «Válida hasta»", async () => {
	await fixture.quote();
	await fixture.quote({ valid_until: '2030-01-31' });
	const readValidity = () =>
		database.prepare('select id, valid_until from quotes order by id').all();
	const before = readValidity();
	const form = {
		...toForm(await getSystemSettings(db, modules, MANAGER)),
		QUOTES_VALIDITY_DAYS: '15'
	};
	expect(await updateSystemSettings(db, { modules, values: form }, MANAGER)).toEqual({ ok: true });
	expect(readValue('QUOTES_VALIDITY_DAYS')).toMatchObject({ value: '15' });
	expect(before).toHaveLength(2);
	expect(readValidity()).toEqual(before);
});

// A week settled for an employee of its own (a week holds one settlement per employee) through
// Nómina, as the screen proposes it: saved as a draft, or paid.
async function settle(periodStart: string, status: 'DRAFT' | 'PAID') {
	const { employeeId } = await fixture.employee({ roles: ['WAREHOUSE'] });
	const draft = (await openWeek(db, { employeeId, week: periodStart }, MANAGER))?.draft ?? null;
	if (null === draft) {
		throw new Error(`No draft for ${periodStart}`);
	}
	const quantities = draft.earnings.flatMap(({ concept, qty }) =>
		null === qty ? [] : [[concept, String(qty)]]
	);
	const form = {
		employee_id: String(employeeId),
		period_start: periodStart,
		week_number: String(draft.weekNumber),
		payment_date: draft.paymentDate,
		...Object.fromEntries(quantities),
		NON_SALARY_BONUS: '0',
		LOANS: '0',
		OTHER: '0'
	};
	const result =
		'PAID' === status
			? await recordPayment(db, { ...form, payment_method: 'CASH' }, MANAGER)
			: await saveDraft(db, form, MANAGER);
	if (!result.ok) {
		throw new Error(result.message);
	}
}

function readHolidays(): Holiday[] {
	return JSON.parse(String(readValue('PAYROLL_HOLIDAYS')?.value));
}

// What the editor posts: only the dates after the freeze line.
function postOpen(holidays: Holiday[], freezeLine: string) {
	return { holidays: JSON.stringify(holidays.filter(({ date }) => date > freezeLine)) };
}

test('the freeze line is the Friday ending the latest PAID settlement extra hours; drafts move nothing', async () => {
	expect((await getHolidays(db, MANAGER)).freezeLine).toBeNull();
	await settle('2026-08-31', 'PAID');
	await settle('2026-10-05', 'PAID');
	await settle('2026-10-12', 'DRAFT');
	const editor = await getHolidays(db, MANAGER);
	expect(editor.freezeLine).toBe('2026-10-09');
	expect(editor.canOverrideFreeze).toBe(false);
	expect((await getHolidays(db, ADMIN)).canOverrideFreeze).toBe(true);
	const refusal = await getHolidays(db, SALES).catch((caught: unknown) => caught);
	expect(isHttpError(refusal, 403)).toBe(true);
});

test('saving the holidays keeps the closed ones and logs a SETTINGS event by key', async () => {
	await settle('2026-10-05', 'PAID');
	const before = readHolidays();
	const added = { date: '2027-02-15', label: 'Festivo local' };
	const open = before.filter(({ date }) => date > '2026-10-09' && '2026-11-02' !== date);
	const input = { holidays: JSON.stringify([added, ...open]) };
	expect(await updateHolidays(db, input, MANAGER)).toEqual({ ok: true });
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
	await settle('2026-10-05', 'PAID');
	expect(await updateHolidays(db, postOpen(readHolidays(), '2026-10-09'), MANAGER)).toEqual({
		ok: true
	});
	expect(readEvents()).toEqual([]);
});

test('the editor refuses a date on or before the freeze line, for ADMIN too', async () => {
	await settle('2026-10-05', 'PAID');
	const open = JSON.parse(postOpen(readHolidays(), '2026-10-09').holidays);
	const input = { holidays: JSON.stringify([{ date: '2026-10-09', label: 'Puente' }, ...open]) };
	for (const actor of [MANAGER, ADMIN]) {
		expect(await updateHolidays(db, input, actor)).toEqual({
			ok: false,
			message: 'El vie 9 oct 2026 está en una nómina pagada: no se puede agregar ni cambiar',
			errors: {}
		});
	}
	expect(readEvents()).toEqual([]);
});

test('the editor refuses a repeated date or a holiday without a name', async () => {
	const holidays = readHolidays();
	const repeated = { holidays: JSON.stringify([...holidays, holidays[0]]) };
	expect(await updateHolidays(db, repeated, MANAGER)).toEqual({
		ok: false,
		message: 'Esa fecha ya está en la lista',
		errors: {}
	});
	const unnamed = { holidays: JSON.stringify([{ date: '2027-03-22', label: ' ' }]) };
	expect(await updateHolidays(db, unnamed, MANAGER)).toEqual({
		ok: false,
		message: 'Escribe el nombre del festivo',
		errors: {}
	});
});

test('only ADMIN changes a closed holiday, and only with a reason, kept on the event', async () => {
	await settle('2026-10-05', 'PAID');
	const input = { original: '2026-05-18', date: '2026-05-19', label: 'Ascensión del Señor' };
	const refusal = await overrideFrozenHoliday(db, { ...input, reason: 'x' }, MANAGER).catch(
		(caught: unknown) => caught
	);
	expect(isHttpError(refusal, 403)).toBe(true);
	expect(await overrideFrozenHoliday(db, { ...input, reason: ' ' }, ADMIN)).toEqual({
		ok: false,
		message: 'Escribe el motivo del cambio',
		errors: {}
	});
	expect(readEvents()).toEqual([]);

	const reason = 'El festivo se trasladó por decreto';
	expect(await overrideFrozenHoliday(db, { ...input, reason }, ADMIN)).toEqual({ ok: true });
	const holidays = readHolidays();
	expect(holidays).toContainEqual({ date: '2026-05-19', label: 'Ascensión del Señor' });
	expect(holidays).not.toContainEqual(expect.objectContaining({ date: '2026-05-18' }));
	expect(JSON.stringify(holidays)).not.toContain(reason);
	const event = database
		.prepare("select entity_key, action, reason from events where entity_type = 'SETTINGS'")
		.get();
	expect(event).toEqual({ entity_key: 'PAYROLL_HOLIDAYS', action: 'EDITED', reason });
});

test('ADMIN removes a closed holiday with a reason; an open date is not an override', async () => {
	await settle('2026-10-05', 'PAID');
	const ascension = { date: '2026-05-18', label: 'Ascensión del Señor' };
	const removal = { original: '2026-05-18', ...ascension, remove: 'true', reason: 'No aplica' };
	expect(await overrideFrozenHoliday(db, removal, ADMIN)).toEqual({ ok: true });
	expect(readHolidays()).not.toContainEqual(expect.objectContaining({ date: '2026-05-18' }));
	const open = { ...removal, original: '2026-11-02' };
	expect(await overrideFrozenHoliday(db, open, ADMIN)).toEqual({
		ok: false,
		message: 'Esa fecha no está en una nómina pagada',
		errors: {}
	});
});

test('every login reads the help; with no session it is a 401', async () => {
	for (const actor of [WAREHOUSE, DRIVER, SALES]) {
		const help = await getHelp(db, actor);
		expect(help.text).toMatch(/^Bienvenido/);
		// The default isn't a save in the app: no «Actualizado» line yet.
		expect(help.updatedAt).toBeNull();
	}
	expect(isHttpError(await getHelp(db, null).catch((caught) => caught), 401)).toBe(true);
});

test('only ADMIN and MANAGER save the help; anyone else gets a 403 and changes nothing', async () => {
	const { text } = await getHelp(db, MANAGER);
	for (const actor of [SALES, WAREHOUSE, DRIVER]) {
		const refusal = await updateHelp(db, { text: '## Otra' }, actor).catch((caught) => caught);
		expect(isHttpError(refusal, 403)).toBe(true);
	}
	expect(readValue('HELP_FAQ')).toEqual({ value: text, updated_by: 'system' });
	expect(readEvents()).toEqual([]);
});

test('saving the help writes the text and its EDITED event, which dates «Actualizado»', async () => {
	const { text } = await getHelp(db, MANAGER);
	expect(await updateHelp(db, { text: '## ¿Qué hago al llegar?\n\nMarca.' }, MANAGER)).toEqual({
		ok: true
	});
	expect(readValue('HELP_FAQ')).toEqual({
		value: '## ¿Qué hago al llegar?\n\nMarca.',
		updated_by: 'manager'
	});
	expect(readEvents()).toEqual([
		{
			entity_type: 'SETTINGS',
			entity_id: null,
			entity_key: 'HELP_FAQ',
			action: 'EDITED',
			before: JSON.stringify({ value: text }),
			after: JSON.stringify({ value: '## ¿Qué hago al llegar?\n\nMarca.' })
		}
	]);
	expect((await getHelp(db, WAREHOUSE)).updatedAt).toEqual(expect.any(Number));
});

test('saving the help unchanged writes nothing', async () => {
	const { text } = await getHelp(db, ADMIN);
	expect(await updateHelp(db, { text }, ADMIN)).toEqual({ ok: true });
	// As the textarea posts it.
	expect(await updateHelp(db, { text: text.replaceAll('\n', '\r\n') }, ADMIN)).toEqual({
		ok: true
	});
	expect(readEvents()).toEqual([]);
});

test('an empty or too-long help saves nothing and comes back with its message', async () => {
	expect(await updateHelp(db, { text: '  \n ' }, MANAGER)).toEqual({
		ok: false,
		message: 'Escribe el texto de la ayuda',
		errors: {}
	});
	expect(await updateHelp(db, { text: 'a'.repeat(50_001) }, MANAGER)).toEqual({
		ok: false,
		message: 'La ayuda no puede pasar de 50.000 caracteres',
		errors: {}
	});
	expect(readEvents()).toEqual([]);
});

test('the generic settings leave the help out and ignore a HELP_FAQ field', async () => {
	const values = await getSystemSettings(db, modules, MANAGER);
	expect(values).not.toHaveProperty('HELP_FAQ');
	const { text } = await getHelp(db, MANAGER);
	const form = { ...toForm(values), HELP_FAQ: '## Otra' };
	expect(await updateSystemSettings(db, { modules, values: form }, MANAGER)).toEqual({ ok: true });
	expect(readValue('HELP_FAQ')).toMatchObject({ value: text });
	expect(readEvents()).toEqual([]);
});

test('the terms start empty; only ADMIN and MANAGER read or save them', async () => {
	expect(await getTerms(db, MANAGER)).toBe('');
	for (const actor of [SALES, WAREHOUSE, DRIVER]) {
		expect(isHttpError(await getTerms(db, actor).catch((caught) => caught), 403)).toBe(true);
		const refusal = await updateTerms(db, { text: '## Depósito' }, actor).catch((caught) => caught);
		expect(isHttpError(refusal, 403)).toBe(true);
	}
	expect(readValue('TERMS_CONDITIONS')).toEqual({ value: '', updated_by: 'system' });
	expect(readEvents()).toEqual([]);
});

test('saving the terms writes the text and its EDITED event; emptying them is a save too', async () => {
	expect(await updateTerms(db, { text: '## Depósito\r\n\r\nSe devuelve.' }, ADMIN)).toEqual({
		ok: true
	});
	expect(readValue('TERMS_CONDITIONS')).toEqual({
		value: '## Depósito\n\nSe devuelve.',
		updated_by: 'admin'
	});
	expect(await updateTerms(db, { text: '  \n ' }, ADMIN)).toEqual({ ok: true });
	expect(readValue('TERMS_CONDITIONS')).toMatchObject({ value: '' });
	expect(readEvents()).toEqual([
		expect.objectContaining({
			entity_key: 'TERMS_CONDITIONS',
			action: 'EDITED',
			before: JSON.stringify({ value: '' }),
			after: JSON.stringify({ value: '## Depósito\n\nSe devuelve.' })
		}),
		expect.objectContaining({
			entity_key: 'TERMS_CONDITIONS',
			before: JSON.stringify({ value: '## Depósito\n\nSe devuelve.' }),
			after: JSON.stringify({ value: '' })
		})
	]);
});

test('too-long terms save nothing; the generic settings ignore a TERMS_CONDITIONS field', async () => {
	expect(await updateTerms(db, { text: 'a'.repeat(10_001) }, MANAGER)).toEqual({
		ok: false,
		message: 'Los términos no pueden pasar de 10.000 caracteres',
		errors: {}
	});
	const values = await getSystemSettings(db, modules, MANAGER);
	expect(values).not.toHaveProperty('TERMS_CONDITIONS');
	const form = { ...toForm(values), TERMS_CONDITIONS: '## Otra' };
	expect(await updateSystemSettings(db, { modules, values: form }, MANAGER)).toEqual({ ok: true });
	expect(readValue('TERMS_CONDITIONS')).toMatchObject({ value: '' });
	expect(readEvents()).toEqual([]);
});
