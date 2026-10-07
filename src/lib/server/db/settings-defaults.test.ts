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
