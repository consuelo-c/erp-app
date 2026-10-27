import { error } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { fetchJson, loadDispatchCache, NO_CACHE_MESSAGE, saveDispatchCache } from '$lib/offline';
import type { DispatchDay } from '$lib/server/services/dispatch';
import type { OrderDetail } from '$lib/server/services/orders';
import type { PageLoad } from './$types';

// Rendered in the browser only: its HTML is an empty shell, which the service worker keeps to open
// Despachos with no network. No server load, so a failed fetch falls back to the phone's copy.
export const ssr = false;

type Day = { day: DispatchDay; details: Record<string, OrderDetail> | null };

// With signal, today's list is saved with its orders' details; another day's never. Without it,
// today's copy shows whatever day was asked: it's the only one there is.
export const load: PageLoad = async ({ fetch, url }) => {
	const fetched = await fetchJson<Day>(fetch, `${resolve('/despachos/dia')}${url.search}`);
	if (null === fetched) {
		const cache = loadDispatchCache(getTodaysDate());
		if (null === cache) {
			error(503, NO_CACHE_MESSAGE);
		}
		return { day: cache.day, capturedAt: cache.capturedAt };
	}
	const { day, details } = fetched;
	if (null !== details) {
		const capturedAt = Math.floor(Date.now() / 1000);
		saveDispatchCache({ date: day.today, capturedAt, day, details });
	}
	return { day, capturedAt: null };
};
