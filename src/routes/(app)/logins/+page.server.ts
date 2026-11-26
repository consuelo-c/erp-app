import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { listLogins } from '$lib/server/services/logins';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, POLICIES.logins);
	const db = getDb(platform);
	return { logins: await listLogins(db, locals.user) };
};
