import { afterEach, expect, test, vi } from 'vitest';
import { formatInstant, getTodaysDate } from './datetime';

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
