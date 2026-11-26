import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { listLogins } from '$lib/server/services/logins';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, POLICIES.logins);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return { logins: await listLogins(platform.env.DB, locals.user) };
};
