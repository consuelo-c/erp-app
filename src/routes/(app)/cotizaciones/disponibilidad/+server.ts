import { error, json } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getQuoteAvailability } from '$lib/server/services/quotes';
import type { RequestHandler } from './$types';

// The quote form asks, as its event date changes, what's available around it.
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.quotes);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const input = { event_date: url.searchParams.get('evento') };
	return json(await getQuoteAvailability(platform.env.DB, input, locals.user));
};
