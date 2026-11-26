import { json } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import { getDb } from '$lib/server/platform';
import { searchContactCandidates } from '$lib/server/services/employees';
import type { RequestHandler } from './$types';

// The new employee form asks, as its search is typed, which contacts the employee could be.
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	requireRole(locals.user, POLICIES.employees);
	const db = getDb(platform);
	const search = url.searchParams.get('texto');
	return json(await searchContactCandidates(db, search, locals.user));
};
