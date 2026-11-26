import { getTodaysDate } from '$lib/datetime';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getTeamWeek } from '$lib/server/services/timesheets';
import type { PageServerLoad } from './$types';

// Everyone's punches for a week (`?semana=`, this one by default), read-only, for ADMIN and MANAGER:
// the review before settling payroll. Any other role gets the shared 403.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.everyonesHours);
	const db = getDb(platform);
	const week = url.searchParams.get('semana');
	return {
		today: getTodaysDate(),
		...(await getTeamWeek(db, { week }, locals.user))
	};
};
