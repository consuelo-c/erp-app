import { error, json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { searchClients } from '$lib/server/services/contacts';
import type { RequestHandler } from './$types';

// The order form asks, as its client search is typed, which contacts match by name, phone or address.
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER', 'SALES']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	return json(await searchClients(platform.env.DB, url.searchParams.get('texto'), locals.user));
};
