import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getReceivablePrintout } from '$lib/server/services/receivables';
import type { PageServerLoad } from './$types';

// The cuenta's letter sheets, printed from its detail.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.receivables);
	const db = getDb(platform);
	const printout = await getReceivablePrintout(db, params.id, locals.user);
	if (null === printout) {
		error(404, 'Esa cuenta de cobro no existe');
	}
	return { printout };
};
