import { error, json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/actor';
import { searchContactCandidates } from '$lib/server/services/employees';
import type { RequestHandler } from './$types';

// The new employee form asks, as its search is typed, which contacts the employee could be.
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	requireRole(locals.user, ['ADMIN', 'MANAGER']);
	if (undefined === platform) {
		error(500, 'Sin acceso a la base de datos');
	}
	const search = url.searchParams.get('texto');
	return json(await searchContactCandidates(platform.env.DB, search, locals.user));
};
