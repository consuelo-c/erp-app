import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getProfitAndLoss } from '$lib/server/services/reports';
import type { PageServerLoad } from './$types';

// The period lives in the URL, so it can be shared and reloaded: `?desde=` and `?hasta=` (Bogotá
// dates, both inclusive), the current month by default.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const input = { from: url.searchParams.get('desde'), to: url.searchParams.get('hasta') };
	return { report: await getProfitAndLoss(platform.env.DB, input, locals.user) };
};
