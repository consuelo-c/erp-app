import { json } from '@sveltejs/kit';
import { POLICIES } from '$lib/roles';
import { requireRole } from '$lib/server/actor';
import type { RequestHandler } from './$types';

// The shell's session, asked by the (app) layout's universal load: who's logged in and the roles
// its menu shows, or a 401.
export const GET: RequestHandler = ({ locals }) => {
	requireRole(locals.user, POLICIES.anyLogin);
	return json({ username: locals.user.username, roles: locals.user.roles });
};
