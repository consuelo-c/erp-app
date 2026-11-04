import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { rememberFilters } from '$lib/server/list-filters';
import { listReceivables } from '$lib/server/services/receivables';
import type { PageServerLoad } from './$types';

// The filters live in the URL, so a filtered list can be shared and reloaded: `?texto=` (name or
// phone), `?pendiente=1` (with a balance) and `?pagina=`, the page shown.
export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	rememberFilters('cuentas-de-cobro', url, cookies);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const params = url.searchParams;
	const input = {
		text: params.get('texto'),
		hasBalance: params.get('pendiente'),
		page: params.get('pagina') ?? undefined
	};
	return listReceivables(platform.env.DB, input, locals.user);
};
