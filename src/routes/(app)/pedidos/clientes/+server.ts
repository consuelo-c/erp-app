import { json } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { searchClients } from '$lib/server/services/contacts';
import type { RequestHandler } from './$types';

// The order form asks, as its client search is typed, which contacts match by name, phone or address.
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.orders);
	const db = getDb(platform);
	return json(await searchClients(db, url.searchParams.get('texto'), locals.user));
};
