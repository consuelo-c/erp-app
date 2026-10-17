import { error } from '@sveltejs/kit';
import { isAdmin, requireRole } from '$lib/server/actor';
import { listEmployees } from '$lib/server/services/employees';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return {
		employees: await listEmployees(platform.env.DB, locals.user),
		canManageLogins: isAdmin(locals.user)
	};
};
