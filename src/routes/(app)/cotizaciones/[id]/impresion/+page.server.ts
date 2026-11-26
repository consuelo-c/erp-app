import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getQuotePrintout } from '$lib/server/services/quotes';
import type { PageServerLoad } from './$types';

// The quote's printed half-letter sheets, printed from its detail in any state.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.quotes);
	const db = getDb(platform);
	const printout = await getQuotePrintout(db, params.id, locals.user);
	if (null === printout) {
		error(404, 'Esa cotización no existe');
	}
	return { printout };
};
