import { expect, test, vi } from 'vitest';
import {
	CHECKLIST_KEY,
	clearDispatchCache,
	DISPATCH_CACHE_KEY,
	fetchJson,
	lineMark,
	readChecklist,
	readDispatchCache
} from './offline';

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

const checklists = JSON.stringify({ 1043: { status: 'CONFIRMED', lines: ['7:20', '9:4'] } });

test("an order's ticks are kept for its current status", () => {
	expect(readChecklist(checklists, '1043', 'CONFIRMED')).toEqual(['7:20', '9:4']);
	expect(readChecklist(checklists, '1044', 'CONFIRMED')).toEqual([]);
});

test('a status change starts an empty list: the driver checks the load again', () => {
	expect(readChecklist(checklists, '1043', 'PICKED')).toEqual([]);
});

test("a line whose quantity changed isn't ticked any more", () => {
	const lines = readChecklist(checklists, '1043', 'CONFIRMED');
	expect(lines).toContain(lineMark({ product_id: 7, qty: 20 }));
	expect(lines).not.toContain(lineMark({ product_id: 7, qty: 24 }));
});

test('missing or malformed ticks are none', () => {
	expect(readChecklist(null, '1043', 'CONFIRMED')).toEqual([]);
	expect(readChecklist('{"1043":', '1043', 'CONFIRMED')).toEqual([]);
	expect(readChecklist('{"1043":{"lines":"7:20"}}', '1043', 'CONFIRMED')).toEqual([]);
});

test('logging out clears the ticks with the copy', () => {
	const storage = new Map([
		[DISPATCH_CACHE_KEY, JSON.stringify(cache)],
		[CHECKLIST_KEY, checklists]
	]);
	vi.stubGlobal('localStorage', { removeItem: (key: string) => storage.delete(key) });
	clearDispatchCache();
	expect(storage.size).toBe(0);
	vi.unstubAllGlobals();
});
