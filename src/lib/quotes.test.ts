import { afterEach, expect, test, vi } from 'vitest';
import { getTodaysDate } from './datetime';
import { QUOTE_STATE_LABELS } from './labels';
import { getQuoteState } from './quotes';

afterEach(() => {
	vi.useRealTimers();
});

test('with the clock on 2 December 2026, an open quote is valid through its date', () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-12-02T15:00:00Z'));
	const today = getTodaysDate();
	expect(getQuoteState({ orderId: null, validUntil: '2026-12-02' }, today)).toBe('VALID');
	expect(getQuoteState({ orderId: null, validUntil: '2026-12-01' }, today)).toBe('EXPIRED');
	expect(getQuoteState({ orderId: 1060, validUntil: '2027-01-31' }, today)).toBe('CONVERTED');
	expect(getQuoteState({ orderId: 1060, validUntil: '2026-12-01' }, today)).toBe('CONVERTED');
});

test("at 11:30 p.m. on 1 December in Bogotá, already the 2nd in UTC, it's still valid", () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-12-02T04:30:00Z'));
	expect(getQuoteState({ orderId: null, validUntil: '2026-12-01' }, getTodaysDate())).toBe('VALID');
});

test('each state reaches the screen through its label', () => {
	expect(QUOTE_STATE_LABELS).toEqual({
		VALID: 'Vigente',
		EXPIRED: 'Vencida',
		CONVERTED: 'Convertida'
	});
});
