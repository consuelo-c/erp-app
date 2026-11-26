import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { listEmployees } from '$lib/server/services/employees';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, POLICIES.employees);
	const db = getDb(platform);
	return { employees: await listEmployees(db, locals.user) };
};
