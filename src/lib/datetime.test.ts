import { afterEach, expect, test, vi } from 'vitest';
import {
	addDays,
	formatCivilDate,
	formatClockTime,
	formatInstant,
	formatLongDay,
	formatShortDay,
	formatWeekRange,
	getTodaysDate,
	getWeekStart
} from './datetime';

// 10:00 p.m. on 14 August in Bogotá (UTC−5) is already 15 August in UTC.
const BOGOTA_10PM = new Date('2026-08-15T03:00:00Z');

afterEach(() => {
	vi.useRealTimers();
});

test("getTodaysDate returns Bogotá's day when UTC is already on the next one", () => {
	vi.useFakeTimers();
	vi.setSystemTime(BOGOTA_10PM);
	expect(getTodaysDate()).toBe('2026-08-14');
});

test('getTodaysDate rolls over at midnight in Bogotá', () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-08-15T05:00:00Z'));
	expect(getTodaysDate()).toBe('2026-08-15');
});

test('formatInstant shows the instant in Bogotá time', () => {
	expect(formatInstant(BOGOTA_10PM.getTime() / 1000)).toBe('14 de agosto de 2026, 10:00 p.m.');
});

test('formatInstant writes midnight and noon as 12', () => {
	expect(formatInstant(Date.parse('2026-01-01T05:05:00Z') / 1000)).toBe(
		'1 de enero de 2026, 12:05 a.m.'
	);
	expect(formatInstant(Date.parse('2026-01-01T17:00:00Z') / 1000)).toBe(
		'1 de enero de 2026, 12:00 p.m.'
	);
});

test('formatCivilDate writes the day, the short month and the year', () => {
	expect(formatCivilDate('2025-02-03')).toBe('3 feb 2025');
	expect(formatCivilDate('2024-12-31')).toBe('31 dic 2024');
});

test('formatClockTime writes a stored punch the way people read it', () => {
	expect(formatClockTime('07:02')).toBe('7:02 a.m.');
	expect(formatClockTime('12:01')).toBe('12:01 p.m.');
	expect(formatClockTime('00:30')).toBe('12:30 a.m.');
});

test('addDays crosses months and years', () => {
	expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
	expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
});

test('getWeekStart is the Monday, Sunday included in the week before it', () => {
	expect(getWeekStart('2026-07-31')).toBe('2026-07-27');
	expect(getWeekStart('2026-08-02')).toBe('2026-07-27');
	expect(getWeekStart('2026-07-27')).toBe('2026-07-27');
});

test('day and week labels', () => {
	expect(formatShortDay('2026-07-27')).toBe('Lun 27 jul');
	expect(formatLongDay('2026-07-31')).toBe('Vie 31 jul 2026');
	expect(formatWeekRange('2026-07-27')).toBe('27 jul – 2 ago');
});
