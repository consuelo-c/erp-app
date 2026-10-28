import { expect, test } from 'vitest';
import { SETTINGS } from './settings';

const holidays = SETTINGS.PAYROLL_HOLIDAYS.schema;

function parsesHolidays(entries: unknown): boolean {
	return holidays.safeParse(JSON.stringify(entries)).success;
}

test('PAYROLL_HOLIDAYS accepts sorted, unique, well-formed dates', () => {
	expect(
		parsesHolidays([
			{ date: '2026-01-01', label: 'Año Nuevo' },
			{ date: '2026-01-12', label: 'Reyes Magos' }
		])
	).toBe(true);
	expect(parsesHolidays([])).toBe(true);
});

test('PAYROLL_HOLIDAYS rejects a malformed date', () => {
	expect(parsesHolidays([{ date: '2026-1-01', label: 'Año Nuevo' }])).toBe(false);
	expect(parsesHolidays([{ date: '2026-02-30', label: 'No existe' }])).toBe(false);
});

test('PAYROLL_HOLIDAYS rejects a duplicate date', () => {
	expect(
		parsesHolidays([
			{ date: '2026-01-01', label: 'Año Nuevo' },
			{ date: '2026-01-01', label: 'Año Nuevo' }
		])
	).toBe(false);
});

test('PAYROLL_HOLIDAYS rejects entries out of date order', () => {
	expect(
		parsesHolidays([
			{ date: '2026-01-12', label: 'Reyes Magos' },
			{ date: '2026-01-01', label: 'Año Nuevo' }
		])
	).toBe(false);
});

test('PAYROLL_HOLIDAYS rejects text that is not JSON', () => {
	expect(holidays.safeParse('not json').success).toBe(false);
});

test('numeric settings parse the stored text into integers', () => {
	expect(SETTINGS.PAYROLL_OVERTIME_DAY_FACTOR.schema.parse('125')).toBe(125);
	expect(SETTINGS.PAYROLL_MINIMUM_WAGE.schema.safeParse('1.5').success).toBe(false);
	expect(SETTINGS.PAYROLL_NIGHT_START.schema.safeParse('19:00').success).toBe(true);
	expect(SETTINGS.PAYROLL_NIGHT_START.schema.safeParse('25:00').success).toBe(false);
});

test('HELP_FAQ takes a non-empty text of at most 50,000 characters', () => {
	const help = SETTINGS.HELP_FAQ.schema;
	expect(help.safeParse('').success).toBe(false);
	expect(help.safeParse('   ').success).toBe(false);
	expect(help.safeParse('a'.repeat(50_000)).success).toBe(true);
	expect(help.safeParse('a'.repeat(50_001)).success).toBe(false);
});
