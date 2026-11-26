import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { listCounts } from '$lib/server/services/inventory';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	requireRole(locals.user, POLICIES.inventoryReview);
	const db = getDb(platform);
	return { counts: await listCounts(db, locals.user) };
};
