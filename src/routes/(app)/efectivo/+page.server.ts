import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getCashStatement } from '$lib/server/services/cash-handovers';
import type { PageServerLoad } from './$types';

// The person's own tab, read-only. The range lives in the URL, `?desde=` and `?hasta=`, today by
// default.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.takesCash);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const input = {
		username: locals.user.username,
		from: url.searchParams.get('desde'),
		to: url.searchParams.get('hasta')
	};
	return { statement: await getCashStatement(platform.env.DB, input, locals.user) };
};
