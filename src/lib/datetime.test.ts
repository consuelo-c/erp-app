import { afterEach, expect, test, vi } from 'vitest';
import { formatInstant, getTodaysDate } from './datetime';

// 10:00 p.m. on 14 August in Bogotá (UTC−5) is already 15 August in UTC.
const BOGOTA_10PM = new Date('2026-08-15T03:00:00Z');

afterEach(() => {
	vi.useRealTimers();
});

// Intl separates "p. m." with non-breaking spaces.
function normalizeSpaces(text: string): string {
	return text.replace(/\s/g, ' ');
}

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
	const epochSeconds = BOGOTA_10PM.getTime() / 1000;
	expect(normalizeSpaces(formatInstant(epochSeconds))).toBe('14 de agosto de 2026, 10:00 p. m.');
});
