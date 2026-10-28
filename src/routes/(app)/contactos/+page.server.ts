import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { rememberFilters } from '$lib/server/list-filters';
import { listContacts } from '$lib/server/services/contacts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	rememberFilters('contactos', url, cookies);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const input = {
		search: url.searchParams.get('texto') ?? undefined,
		service: url.searchParams.get('servicio') ?? undefined,
		page: url.searchParams.get('pagina') ?? undefined
	};
	return listContacts(platform.env.DB, input, locals.user);
};
