import { error } from '@sveltejs/kit';
import { getTodaysDate } from '$lib/datetime';
import { requireRole } from '$lib/server/actor';
import { getTeamWeek } from '$lib/server/services/timesheets';
import type { PageServerLoad } from './$types';

// Everyone's punches for a week (`?semana=`, this one by default), read-only, for ADMIN and MANAGER:
// the review before settling payroll. Any other role gets the shared 403.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const week = url.searchParams.get('semana');
	return {
		today: getTodaysDate(),
		...(await getTeamWeek(platform.env.DB, { week }, locals.user))
	};
};
