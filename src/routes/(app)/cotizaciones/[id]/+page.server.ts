import { error } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getQuoteDetail, getQuotePublicToken } from '$lib/server/services/quotes';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, POLICIES.quotes);
	const db = getDb(platform);
	const quote = await getQuoteDetail(db, params.id, locals.user);
	if (null === quote) {
		error(404, 'Esa cotización no existe');
	}
	return { quote, publicToken: await getQuotePublicToken(db, quote.id, locals.user) };
};
