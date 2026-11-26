import { POLICIES } from '$lib/roles';
import { hasAnyRole, requireRole } from '$lib/server/actor';
import { rememberFilters } from '$lib/server/list-filters';
import { getDb } from '$lib/server/platform';
import { listProducts } from '$lib/server/services/products';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	requireRole(locals.user, POLICIES.products);
	rememberFilters('productos', url, cookies);
	const db = getDb(platform);
	const input = {
		search: url.searchParams.get('texto') ?? undefined,
		category: url.searchParams.get('categoria') ?? undefined
	};
	// Sales quotes from the list; it doesn't open the form.
	return {
		...(await listProducts(db, input, locals.user)),
		canEdit: hasAnyRole(locals.user, POLICIES.manageProducts)
	};
};
