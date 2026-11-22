import { error } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { fetchJson, loadDispatchCache, NO_CACHE_MESSAGE } from '$lib/offline';
import type { Incident } from '$lib/server/services/incidents';
import type { OrderDetail } from '$lib/server/services/orders';
import type { PageLoad } from './$types';

// Like the list: rendered in the browser only, and with no network it opens from today's copy.
export const ssr = false;

// The incidents come only with signal: `null` from the phone's copy.
type Detail = { order: OrderDetail; incidents: Incident[] | null };

export const load: PageLoad = async ({ fetch, params }) => {
	const href = resolve('/(app)/despachos/[id]/detalle', { id: params.id });
	const fetched = await fetchJson<Detail>(fetch, href);
	if (null !== fetched) {
		return { ...fetched, capturedAt: null };
	}
	const cache = loadDispatchCache(getTodaysDate());
	const order = cache?.details[params.id];
	if (null === cache || undefined === order) {
		error(503, NO_CACHE_MESSAGE);
	}
	return { order, incidents: null, capturedAt: cache.capturedAt };
};
