import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { listCounts } from '$lib/server/services/inventory';
import type { LayoutServerLoad } from './$types';

// The list stays beside a count's detail on a desktop, so it loads here, for every route under it.
export const load: LayoutServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return { counts: await listCounts(platform.env.DB, locals.user) };
};
