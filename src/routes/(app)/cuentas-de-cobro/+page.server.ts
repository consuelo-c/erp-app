import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { rememberFilters } from '$lib/server/list-filters';
import { getDb } from '$lib/server/platform';
import { listReceivables } from '$lib/server/services/receivables';
import type { PageServerLoad } from './$types';

// The filters live in the URL, so a filtered list can be shared and reloaded: `?texto=` (name or
// phone), `?pendiente=1` (with a balance) and `?pagina=`, the page shown.
export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	requireRole(locals.user, POLICIES.receivables);
	rememberFilters('cuentas-de-cobro', url, cookies);
	const db = getDb(platform);
	const params = url.searchParams;
	const input = {
		text: params.get('texto'),
		hasBalance: params.get('pendiente'),
		page: params.get('pagina') ?? undefined
	};
	return listReceivables(db, input, locals.user);
};
