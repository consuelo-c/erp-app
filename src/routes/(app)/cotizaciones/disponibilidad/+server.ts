import { json } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { getQuoteAvailability } from '$lib/server/services/quotes';
import type { RequestHandler } from './$types';

// The quote form asks, as its event date changes, what's available around it.
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.quotes);
	const db = getDb(platform);
	const input = { event_date: url.searchParams.get('evento') };
	return json(await getQuoteAvailability(db, input, locals.user));
};
