import { error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getQuoteDetail, getQuotePublicToken } from '$lib/server/services/quotes';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, platform }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const db = platform.env.DB;
	const quote = await getQuoteDetail(db, params.id, locals.user);
	if (null === quote) {
		error(404, 'Esa cotización no existe');
	}
	return { quote, publicToken: await getQuotePublicToken(db, quote.id, locals.user) };
};
