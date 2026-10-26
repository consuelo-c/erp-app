import { error } from '@sveltejs/kit';
import { requireRole, ROLES } from '$lib/server/actor';
import { getDispatchDay } from '$lib/server/services/dispatch';
import type { PageServerLoad } from './$types';

// Where every login lands: today's deliveries and pickups, or another day's through `?fecha=`.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ROLES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return { day: await getDispatchDay(platform.env.DB, url.searchParams.get('fecha'), locals.user) };
};
