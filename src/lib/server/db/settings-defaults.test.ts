import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, test } from 'vitest';
import { SETTINGS, type SettingKey } from '$lib/settings';

const defaults = readFileSync('scripts/settings-defaults.sql', 'utf8');

let database: DatabaseSync;

beforeEach(() => {
	database = new DatabaseSync(':memory:');
	const files = readdirSync('migrations')
		.filter((file) => file.endsWith('.sql'))
		.sort();
	for (const file of files) {
		database.exec(readFileSync(`migrations/${file}`, 'utf8'));
	}
	database.exec(defaults);
});

function readSettings() {
	return database.prepare('select * from settings order by key').all();
}

test('creates every settings key, each passing its Zod schema', () => {
	const rows = readSettings();
	expect(rows.map((row) => row.key)).toEqual(Object.keys(SETTINGS).sort());
	for (const row of rows) {
		const { schema } = SETTINGS[row.key as SettingKey];
		expect(schema.safeParse(row.value).success, String(row.key)).toBe(true);
	}
});

test('loads the 2026 and 2027 holidays', () => {
	const { value } = database
		.prepare("select value from settings where key = 'PAYROLL_HOLIDAYS'")
		.get() as { value: string };
	const holidays = SETTINGS.PAYROLL_HOLIDAYS.schema.parse(value);
	expect(holidays.filter((holiday) => holiday.date.startsWith('2026'))).toHaveLength(18);
	expect(holidays.filter((holiday) => holiday.date.startsWith('2027'))).toHaveLength(18);
});

test('the help is a first draft: an intro, at least ten questions and no images', () => {
	const { value } = database.prepare("select value from settings where key = 'HELP_FAQ'").get() as {
		value: string;
	};
	const [intro, ...questions] = value.split(/^## /m);
	expect(intro.trim()).not.toBe('');
	expect(questions.length).toBeGreaterThanOrEqual(10);
	expect(value).not.toContain('![');
});

test("the contacts' etiquetas are the seven services and Vetado, sorted by name", () => {
	const { value } = database
		.prepare("select value from settings where key = 'CONTACTS_LABELS'")
		.get() as { value: string };
	expect(SETTINGS.CONTACTS_LABELS.schema.parse(value)).toEqual([
		{ key: 'BARISTA', name: 'Barista' },
		{ key: 'BARTENDER', name: 'Bartender' },
		{ key: 'CHEF', name: 'Chef' },
		{ key: 'DECORATOR', name: 'Decorador' },
		{ key: 'WAITER', name: 'Mesero' },
		{ key: 'TRANSPORTER', name: 'Transportador' },
		{ key: 'BANNED', name: 'Vetado' },
		{ key: 'WEDDING_PLANNER', name: 'Wedding planner' }
	]);
	database.exec(
		`update settings set value = '[{"key":"TRANSPORTER","name":"Carga"},{"key":"BANNED","name":"No"}]' where key = 'CONTACTS_LABELS'`
	);
	database.exec(defaults);
	expect(
		database.prepare("select value from settings where key = 'CONTACTS_LABELS'").get()
	).toEqual({ value: '[{"key":"TRANSPORTER","name":"Carga"},{"key":"BANNED","name":"No"}]' });
});

test('a second run duplicates and overwrites nothing', () => {
	database.exec("update settings set value = '99' where key = 'PAYROLL_PENSION_RATE'");
	const before = readSettings();
	database.exec(defaults);
	expect(readSettings()).toEqual(before);
});

test('every row is created by system and writes no events', () => {
	for (const row of readSettings()) {
		expect([row.created_by, row.updated_by]).toEqual(['system', 'system']);
		expect(row.updated_at).toBe(row.created_at);
	}
	expect(database.prepare('select count(*) as count from events').get()).toEqual({ count: 0 });
});

test('a new quote is valid for 30 days by default', () => {
	const row = database
		.prepare("select value from settings where key = 'QUOTES_VALIDITY_DAYS'")
		.get();
	expect(row).toEqual({ value: '30' });
});
