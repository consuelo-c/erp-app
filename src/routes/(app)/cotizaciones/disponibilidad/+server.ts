import { error, json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { getQuoteAvailability } from '$lib/server/services/quotes';
import type { RequestHandler } from './$types';

// The quote form asks, as its event date changes, what's available around it.
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const input = { event_date: url.searchParams.get('evento') };
	return json(await getQuoteAvailability(platform.env.DB, input, locals.user));
};
