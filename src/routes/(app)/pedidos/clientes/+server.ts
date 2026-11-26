import { error, json } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { searchClients } from '$lib/server/services/contacts';
import type { RequestHandler } from './$types';

// The order form asks, as its client search is typed, which contacts match by name, phone or address.
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.orders);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return json(await searchClients(platform.env.DB, url.searchParams.get('texto'), locals.user));
};
