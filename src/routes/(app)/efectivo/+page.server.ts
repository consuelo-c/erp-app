import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getCashStatement } from '$lib/server/services/cash-handovers';
import type { PageServerLoad } from './$types';

// The person's own tab, read-only. The range lives in the URL, `?desde=` and `?hasta=`, today by
// default.
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.takesCash);
	const db = getDb(platform);
	const input = {
		username: locals.user.username,
		from: url.searchParams.get('desde'),
		to: url.searchParams.get('hasta')
	};
	const statement = await getCashStatement(db, input, locals.user);
	if (null === statement) {
		error(404, 'Esa persona no tiene efectivo por entregar');
	}
	return { statement };
};
