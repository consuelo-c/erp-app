import { expect, test } from 'vitest';
import { readDispatchCache } from './offline';

const cache = {
	date: '2026-10-26',
	capturedAt: 1793020440,
	day: { today: '2026-10-26', date: '2026-10-26', rows: [] },
	details: { 1043: { id: 1043 } }
};

test("today's copy is returned", () => {
	expect(readDispatchCache(JSON.stringify(cache), '2026-10-26')).toEqual(cache);
});

test("another day's copy isn't shown: yesterday's data is worse than none", () => {
	expect(readDispatchCache(JSON.stringify(cache), '2026-10-27')).toBeNull();
});

test('a missing or malformed copy is nothing', () => {
	expect(readDispatchCache(null, '2026-10-26')).toBeNull();
	expect(readDispatchCache('{"date":', '2026-10-26')).toBeNull();
	expect(readDispatchCache(JSON.stringify({ ...cache, day: null }), '2026-10-26')).toBeNull();
	expect(readDispatchCache(JSON.stringify({ ...cache, date: 'hoy' }), '2026-10-26')).toBeNull();
	expect(
		readDispatchCache(JSON.stringify({ ...cache, details: { 1043: null } }), '2026-10-26')
	).toBeNull();
});
