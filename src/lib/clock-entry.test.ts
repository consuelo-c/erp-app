import { expect, test } from 'vitest';
import { guessPeriod, isHourComplete } from './clock-entry';

test.each([
	['2', true],
	['9', true],
	['10', true],
	['11', true],
	['12', true],
	['1', false],
	['', false],
	['0', false]
])('the hour %j is complete: %s', (hour, complete) => {
	expect(isHourComplete(hour)).toBe(complete);
});

test.each([
	['7', 'am'],
	['11', 'am'],
	['12', 'pm'],
	['1', 'pm'],
	['6', 'pm'],
	['0', null],
	['13', null],
	['', null]
])('the hour %j suggests %s', (hour, period) => {
	expect(guessPeriod(hour)).toBe(period);
});
