import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getQuoteTimeline } from '$lib/server/services/quotes';
import type { PageServerLoad } from './$types';

// The quote's events, newest first; an edit's changes load when its row opens.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const entries = await getQuoteTimeline(platform.env.DB, params.id, locals.user);
	if (null === entries) {
		error(404, 'Esa cotización no existe');
	}
	return { quoteId: Number(params.id), entries };
};
