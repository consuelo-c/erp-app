import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getProfitAndLoss } from '$lib/server/services/reports';
import type { PageServerLoad } from './$types';

// The period lives in the URL, so it can be shared and reloaded: `?desde=` and `?hasta=` (Bogotá
// dates, both inclusive), the current month by default.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.reports);
	const db = getDb(platform);
	const input = { from: url.searchParams.get('desde'), to: url.searchParams.get('hasta') };
	return { report: await getProfitAndLoss(db, input, locals.user) };
};
