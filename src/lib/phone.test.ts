import { expect, test } from 'vitest';
import { formatPhone, normalizePhone } from './phone';

test.each([
	['310 442 8890', '573104428890', '310 442 8890'],
	['(310) 442-8890', '573104428890', '310 442 8890'],
	['+57 310 442 8890', '573104428890', '310 442 8890'],
	['57 3104428890', '573104428890', '310 442 8890'],
	['604 444 1234', '576044441234', '604 444 1234'],
	['+1 305 555 0142', '13055550142', '+13055550142']
])('%s is stored as %s and shown as %s', (typed, stored, shown) => {
	expect(normalizePhone(typed)).toBe(stored);
	expect(formatPhone(stored)).toBe(shown);
});

test.each(['442 8890', '13055550142', '+57 310 442 889', '', '+1234567', '+1234567890123456'])(
	'%s is rejected',
	(typed) => {
		expect(normalizePhone(typed)).toBeNull();
	}
);
