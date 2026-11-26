import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getReceipt } from '$lib/server/services/payroll';
import type { PageServerLoad } from './$types';

// The printed receipt of a paid settlement: `?empleado=` and `?semana=`, any date of the week.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.payroll);
	const db = getDb(platform);
	const input = {
		employeeId: url.searchParams.get('empleado'),
		week: url.searchParams.get('semana')
	};
	return { receipt: await getReceipt(db, input, locals.user) };
};
