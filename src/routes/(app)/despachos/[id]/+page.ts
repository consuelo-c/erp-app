import { error } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getTodaysDate } from '$lib/datetime';
import { fetchJson, loadDispatchCache, NO_CACHE_MESSAGE } from '$lib/offline';
import type { OrderDetail } from '$lib/server/services/orders';
import type { PageLoad } from './$types';

// Like the list: rendered in the browser only, and with no network it opens from today's copy.
export const ssr = false;

type Detail = { order: OrderDetail; hasIncidents: boolean };

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
	return { order, hasIncidents: false, capturedAt: cache.capturedAt };
};
