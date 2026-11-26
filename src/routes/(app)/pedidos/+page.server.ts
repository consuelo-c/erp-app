import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { rememberFilters } from '$lib/server/list-filters';
import { getDb } from '$lib/server/platform';
import { listOrders } from '$lib/server/services/orders';
import type { PageServerLoad } from './$types';

// The filters live in the URL, so a filtered list can be shared and reloaded: `?texto=` (name or
// phone), `?entrega=` (this week's by default), `?desde=`, `?hasta=`, `?estado=`, `?novedad=1`, and
// `?pagina=`, the page shown.
export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	requireRole(locals.user, POLICIES.orders);
	rememberFilters('pedidos', url, cookies);
	const db = getDb(platform);
	const params = url.searchParams;
	const input = {
		text: params.get('texto'),
		delivery: params.get('entrega'),
		from: params.get('desde'),
		to: params.get('hasta'),
		status: params.get('estado'),
		hasIncident: params.get('novedad'),
		page: params.get('pagina') ?? undefined
	};
	return listOrders(db, input, locals.user);
};
