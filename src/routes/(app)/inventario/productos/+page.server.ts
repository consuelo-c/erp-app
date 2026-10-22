import { error } from '@sveltejs/kit';
import { isAdminOrManager, requireRole } from '$lib/server/actor';
import { listProducts } from '$lib/server/services/products';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	// Sales quotes from the list; it doesn't open the form.
	return {
		products: await listProducts(platform.env.DB, locals.user),
		canEdit: isAdminOrManager(locals.user)
	};
};
