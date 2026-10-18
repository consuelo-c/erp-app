import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getReceipt } from '$lib/server/services/payroll';
import type { PageServerLoad } from './$types';

// The printed receipt of a paid settlement: `?empleado=` and `?semana=`, any date of the week.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const input = {
		employeeId: url.searchParams.get('empleado'),
		week: url.searchParams.get('semana')
	};
	return { receipt: await getReceipt(platform.env.DB, input, locals.user) };
};
