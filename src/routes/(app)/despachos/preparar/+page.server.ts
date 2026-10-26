import { error } from '@sveltejs/kit';
import { requireRole, ROLES } from '$lib/server/actor';
import { getDispatchDay } from '$lib/server/services/dispatch';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, ROLES);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return { day: await getDispatchDay(platform.env.DB, 'PREP', locals.user) };
};
