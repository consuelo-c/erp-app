import { error } from '@sveltejs/kit';
import { isAdminOrManager, requireRole } from '$lib/server/actor';
import { rememberFilters } from '$lib/server/list-filters';
import { listProducts } from '$lib/server/services/products';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	rememberFilters('productos', url, cookies);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const input = {
		search: url.searchParams.get('texto') ?? undefined,
		category: url.searchParams.get('categoria') ?? undefined
	};
	// Sales quotes from the list; it doesn't open the form.
	return {
		...(await listProducts(platform.env.DB, input, locals.user)),
		canEdit: isAdminOrManager(locals.user)
	};
};
