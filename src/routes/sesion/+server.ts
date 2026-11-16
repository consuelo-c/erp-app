import { json } from '@sveltejs/kit';
import { requireRole, ROLES } from '$lib/server/actor';
import type { RequestHandler } from './$types';

// The shell's session, asked by the (app) layout's universal load: who's logged in and the roles
// its menu shows, or a 401.
export const GET: RequestHandler = ({ locals }) => {
	requireRole(locals.user, ROLES);
	return json({ username: locals.user.username, roles: locals.user.roles });
};
