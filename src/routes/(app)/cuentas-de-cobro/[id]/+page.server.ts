import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getReceivableDetail } from '$lib/server/services/receivables';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.receivables);
	const db = getDb(platform);
	const receivable = await getReceivableDetail(db, params.id, locals.user);
	if (null === receivable) {
		error(404, 'Esa cuenta de cobro no existe');
	}
	return { receivable };
};
