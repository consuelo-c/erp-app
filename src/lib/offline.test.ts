import { expect, test, vi } from 'vitest';
import { DISPATCH_CACHE_KEY, fetchJson, readDispatchCache } from './offline';

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

test("a 401 clears the copy: without a session the phone keeps no clients' data", async () => {
	const storage = new Map([[DISPATCH_CACHE_KEY, JSON.stringify(cache)]]);
	vi.stubGlobal('localStorage', { removeItem: (key: string) => storage.delete(key) });
	const fetch = async () => Response.json({ message: 'Inicia sesión' }, { status: 401 });
	await expect(fetchJson(fetch, '/sesion')).rejects.toMatchObject({ status: 401 });
	expect(storage.has(DISPATCH_CACHE_KEY)).toBe(false);
	vi.unstubAllGlobals();
});
