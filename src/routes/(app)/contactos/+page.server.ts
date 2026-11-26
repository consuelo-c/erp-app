import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { rememberFilters } from '$lib/server/list-filters';
import { getDb } from '$lib/server/platform';
import { listContacts } from '$lib/server/services/contacts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	requireRole(locals.user, POLICIES.contacts);
	rememberFilters('contactos', url, cookies);
	const db = getDb(platform);
	const input = {
		search: url.searchParams.get('texto') ?? undefined,
		label: url.searchParams.get('etiqueta') ?? undefined,
		page: url.searchParams.get('pagina') ?? undefined
	};
	return listContacts(db, input, locals.user);
};
