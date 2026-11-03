import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { rememberFilters } from '$lib/server/list-filters';
import { listQuotes } from '$lib/server/services/quotes';
import type { PageServerLoad } from './$types';

// The filters live in the URL, so a filtered list can be shared and reloaded: `?texto=` (name or
// phone), `?estado=` (the valid ones by default) and `?pagina=`, the page shown.
export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	rememberFilters('cotizaciones', url, cookies);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const params = url.searchParams;
	const input = {
		text: params.get('texto'),
		state: params.get('estado'),
		page: params.get('pagina') ?? undefined
	};
	return listQuotes(platform.env.DB, input, locals.user);
};
