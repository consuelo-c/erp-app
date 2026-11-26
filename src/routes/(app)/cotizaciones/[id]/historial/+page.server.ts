import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getQuoteTimeline } from '$lib/server/services/quotes';
import type { PageServerLoad } from './$types';

// The quote's events, newest first; an edit's changes load when its row opens.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.quotes);
	const db = getDb(platform);
	const entries = await getQuoteTimeline(db, params.id, locals.user);
	if (null === entries) {
		error(404, 'Esa cotización no existe');
	}
	return { quoteId: Number(params.id), entries };
};
